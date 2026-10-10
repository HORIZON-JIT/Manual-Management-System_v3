import { WorkInstruction } from '@/types/instruction';
import { CheckboxCell } from '@/lib/exportSpreadsheet';
import { ensureAccessToken, throwForResponse } from '@/lib/googleAuth';

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
  if (!res.ok) await throwForResponse(res, 'Sheets API');
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
  const token = await ensureAccessToken();

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

  if (!updateRes.ok) await throwForResponse(updateRes, 'Sheets API batchUpdate');
}

/**
 * Convert ☐ text cells to interactive Google Sheets checkboxes.
 */
export async function addSheetCheckboxes(
  spreadsheetId: string,
  checkboxCells: CheckboxCell[],
): Promise<void> {
  if (checkboxCells.length === 0) return;

  const token = await ensureAccessToken();

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

  if (!updateRes.ok) await throwForResponse(updateRes, 'Sheets API batchUpdate');
}
