import { WorkInstruction } from '@/types/instruction';
import { CheckboxCell } from '@/lib/exportSpreadsheet';

interface SheetProperties {
  sheetId: number;
  title: string;
  index: number;
}

interface SheetsGetResponse {
  sheets: { properties: SheetProperties }[];
}

async function getSheetList(spreadsheetId: string, token: string): Promise<SheetProperties[]> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API ${res.status}: ${err}`);
  }
  const data = await res.json() as SheetsGetResponse;
  return data.sheets.map((s) => s.properties);
}

/** Build the tab name for a step (must match exportSpreadsheet.ts logic) */
function stepTabName(index: number, title: string): string {
  const stepNum = String(index + 1).padStart(2, '0');
  return `${stepNum} ${title}`.replace(/[\\/*?[\]:]/g, '').substring(0, 31);
}

const BLUE_BG = { red: 0.145, green: 0.388, blue: 0.922 };
const BTN_BG = { red: 0.231, green: 0.510, blue: 0.965 };  // primaryLight
const WHITE = { red: 1.0, green: 1.0, blue: 1.0 };

function linkCellRequest(
  sheetId: number,
  rowIndex: number,
  colIndex: number,
  label: string,
  targetUri: string,
  bg: { red: number; green: number; blue: number },
  fg: { red: number; green: number; blue: number },
  fontSize: number,
) {
  return {
    updateCells: {
      range: {
        sheetId,
        startRowIndex: rowIndex,
        endRowIndex: rowIndex + 1,
        startColumnIndex: colIndex,
        endColumnIndex: colIndex + 1,
      },
      rows: [{
        values: [{
          userEnteredValue: { stringValue: label },
          userEnteredFormat: {
            backgroundColor: bg,
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            textFormat: {
              foregroundColor: fg,
              bold: true,
              fontSize,
            },
          },
          textFormatRuns: [{
            startIndex: 0,
            format: {
              foregroundColor: fg,
              link: { uri: targetUri },
            },
          }],
        }],
      }],
      fields: 'userEnteredValue,userEnteredFormat,textFormatRuns',
    },
  };
}

/**
 * After uploading an XLSX (converted to Google Sheets format), add proper
 * internal navigation links:
 * 1. Nav footer at the bottom of each step sheet ("次へ →" / "↑ 概要へ戻る")
 * 2. Index "→ 開く" buttons on the main sheet's table of contents
 */
export async function addStepNavLinks(
  spreadsheetId: string,
  instruction: WorkInstruction,
  stepNavRows: number[],
  indexNavRows: number[],
): Promise<void> {
  const token = gapi.client.getToken()?.access_token;
  if (!token) throw new Error('Google認証が必要です');

  // 1. Get all sheets with their gids
  const sheetList = await getSheetList(spreadsheetId, token);

  // Build expected tab names for each step
  const sortedSteps = [...instruction.steps].sort((a, b) => a.orderIndex - b.orderIndex);
  const stepNames = sortedSteps.map((s, i) => stepTabName(i, s.title));

  // Match step names to gids
  const stepGids: number[] = [];
  for (const name of stepNames) {
    const found = sheetList.find((s) => s.title === name);
    if (found) stepGids.push(found.sheetId);
  }

  // Find main sheet gid (first sheet = "作業手順書")
  const mainSheet = sheetList.find((s) => s.index === 0);
  const mainGid = mainSheet ? mainSheet.sheetId : 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requests: any[] = [];

  // 2a. Step sheet footer nav links ("次へ →" / "↑ 概要へ戻る")
  // Nav footer cell is in column B (index 1) — the first cell of the B-N merge
  stepGids.forEach((gid, i) => {
    const isLast = i === stepGids.length - 1;
    const label = isLast ? '↑ 概要へ戻る' : '次へ →';
    const targetGid = isLast ? mainGid : stepGids[i + 1];
    const navRowIndex = stepNavRows[i] ?? 0;
    requests.push(linkCellRequest(
      gid, navRowIndex, 1, label, `#gid=${targetGid}&range=A1`,
      BLUE_BG, WHITE, 13,
    ));
  });

  // 2b. Main sheet index "→ 開く" buttons
  // Index button cell is in column M (index 12) — the first cell of the M-N merge
  const INDEX_BTN_COL = 12;  // column M (0-based)
  indexNavRows.forEach((rowIdx, i) => {
    if (i < stepGids.length) {
      requests.push(linkCellRequest(
        mainGid, rowIdx, INDEX_BTN_COL, '→ 開く', `#gid=${stepGids[i]}&range=A1`,
        BTN_BG, WHITE, 11,
      ));
    }
  });

  if (requests.length === 0) return;

  // 3. Apply batchUpdate
  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    },
  );

  if (!updateRes.ok) {
    const err = await updateRes.text();
    throw new Error(`Sheets API batchUpdate ${updateRes.status}: ${err}`);
  }
}

/**
 * Convert ☐ text cells to interactive Google Sheets checkboxes.
 */
export async function addSheetCheckboxes(
  spreadsheetId: string,
  checkboxCells: CheckboxCell[],
): Promise<void> {
  if (checkboxCells.length === 0) return;

  const token = gapi.client.getToken()?.access_token;
  if (!token) throw new Error('Google認証が必要です');

  const sheetList = await getSheetList(spreadsheetId, token);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requests: any[] = [];

  for (const cell of checkboxCells) {
    const sheet = sheetList.find((s) => s.title === cell.sheetName);
    if (!sheet) continue;

    requests.push({
      updateCells: {
        range: {
          sheetId: sheet.sheetId,
          startRowIndex: cell.row,
          endRowIndex: cell.row + 1,
          startColumnIndex: 1,
          endColumnIndex: 2,
        },
        rows: [{
          values: [{
            userEnteredValue: { boolValue: false },
            dataValidation: {
              condition: { type: 'BOOLEAN' },
              showCustomUi: true,
            },
          }],
        }],
        fields: 'userEnteredValue,dataValidation',
      },
    });
  }

  if (requests.length === 0) return;

  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    },
  );

  if (!updateRes.ok) {
    const err = await updateRes.text();
    throw new Error(`Sheets API batchUpdate ${updateRes.status}: ${err}`);
  }
}

const SCRIPT_ID_KEY = 'sheets_reset_script_ids';

function getStoredScriptId(spreadsheetId: string): string | null {
  try {
    const stored = localStorage.getItem(SCRIPT_ID_KEY);
    const map: Record<string, string> = stored ? JSON.parse(stored) : {};
    return map[spreadsheetId] ?? null;
  } catch { return null; }
}

function storeScriptId(spreadsheetId: string, scriptId: string): void {
  try {
    const stored = localStorage.getItem(SCRIPT_ID_KEY);
    const map: Record<string, string> = stored ? JSON.parse(stored) : {};
    map[spreadsheetId] = scriptId;
    localStorage.setItem(SCRIPT_ID_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

export const RESET_SCRIPT_SOURCE = `function onOpen() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var range = sheet.getDataRange();
    if (range.getNumRows() === 0 || range.getNumColumns() === 0) continue;
    var validations = range.getDataValidations();
    var values = range.getValues();
    var changed = false;
    for (var r = 0; r < validations.length; r++) {
      for (var c = 0; c < validations[r].length; c++) {
        if (validations[r][c] !== null) {
          try {
            if (validations[r][c].getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX) {
              values[r][c] = false;
              changed = true;
              sheet.getRange(r + 1, 3, 1, 12).setFontLine('none');
            }
          } catch(e) {}
        }
      }
    }
    if (changed) range.setValues(values);
  }
}

function onEdit(e) {
  var range = e.range;
  if (range.getColumn() !== 2 || range.getNumRows() !== 1) return;
  var validation = range.getDataValidation();
  if (!validation) return;
  try {
    if (validation.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.CHECKBOX) return;
  } catch(e) { return; }
  var isChecked = range.getValue() === true;
  range.getSheet().getRange(range.getRow(), 3, 1, 12).setFontLine(isChecked ? 'line-through' : 'none');
}`;

const APPSSCRIPT_MANIFEST = JSON.stringify({
  timeZone: 'Asia/Tokyo',
  dependencies: {},
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
});

/**
 * Attach a bound Apps Script that auto-resets checkboxes on open.
 * Returns true if successful, false if the API call failed
 * (e.g. Apps Script API not enabled in Cloud Console).
 */
export async function addResetScript(spreadsheetId: string): Promise<boolean> {
  const token = gapi.client.getToken()?.access_token;
  if (!token) return false;

  const existingScriptId = getStoredScriptId(spreadsheetId);
  const scriptContent = {
    files: [
      { name: 'Code', type: 'SERVER_JS', source: RESET_SCRIPT_SOURCE },
      { name: 'appsscript', type: 'JSON', source: APPSSCRIPT_MANIFEST },
    ],
  };

  try {
    if (existingScriptId) {
      const res = await fetch(
        `https://script.googleapis.com/v1/projects/${existingScriptId}/content`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(scriptContent),
        },
      );
      if (res.ok) return true;
    }

    const createRes = await fetch('https://script.googleapis.com/v1/projects', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'チェックリストリセット', parentId: spreadsheetId }),
    });
    if (!createRes.ok) return false;

    const project = await createRes.json() as { scriptId: string };
    const scriptId = project.scriptId;
    if (!scriptId) return false;

    storeScriptId(spreadsheetId, scriptId);

    const contentRes = await fetch(
      `https://script.googleapis.com/v1/projects/${scriptId}/content`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(scriptContent),
      },
    );
    return contentRes.ok;
  } catch {
    return false;
  }
}
