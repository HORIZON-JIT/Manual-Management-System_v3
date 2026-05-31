import ExcelJS from 'exceljs';
import { WorkInstruction, Condition, getCategoryLabel, getStepImages, getImageCaption } from '@/types/instruction';

/** Estimate row height for text in merged content columns */
function calcRowHeight(text: string, charsPerLine: number, lineHeight: number, minHeight: number): number {
  const lines = text.split('\n');
  let totalLines = 0;
  for (const line of lines) {
    totalLines += Math.max(1, Math.ceil(line.length / charsPerLine));
  }
  return Math.max(minHeight, totalLines * lineHeight);
}

// Color palette (matching PDF design)
const C = {
  primary: '1E40AF',        // deep blue
  primaryMid: '2563EB',     // blue-600
  primaryLight: '3B82F6',   // blue-500
  headerBg: 'EFF6FF',       // blue-50
  badgeBlueBg: 'DBEAFE',    // blue-100
  badgeBlueText: '1D4ED8',  // blue-700
  badgeOrangeBg: 'FFEDD5',  // orange-100
  badgeOrangeText: 'C2410C',// orange-700
  white: 'FFFFFF',
  dark: '111827',           // gray-900
  text: '1F2937',           // gray-800 (was gray-700 窶・darkened for readability)
  gray: '374151',           // gray-700 (was gray-500 窶・darkened for readability)
  grayLight: 'F9FAFB',      // gray-50
  grayMid: 'F3F4F6',        // gray-100
  border: 'D1D5DB',         // gray-300 (was gray-200 窶・slightly more visible)
  borderLight: 'F3F4F6',    // gray-100
  borderBlue: 'BFDBFE',     // blue-200
  cautionBg: 'FEF3C7',      // amber-100
  cautionText: '78350F',    // amber-900 (was amber-800 窶・darker for readability)
  cautionBorder: 'F59E0B',  // amber-400
  stepTitle: '1E3A5F',      // dark blue
  accent: '2563EB',         // blue for accent strip
};

const THIN_BORDER: Partial<ExcelJS.Border> = { style: 'medium', color: { argb: C.border } };
const NO_BORDER: Partial<ExcelJS.Border> = { style: undefined };

// Condition color palette (accent, step header bg, step header text, divider bg)
interface CondColor { accent: string; headerBg: string; headerText: string; dividerBg: string; }
const COND_COLORS: CondColor[] = [
  { accent: 'EA580C', headerBg: 'FFF7ED', headerText: '7C2D12', dividerBg: 'FED7AA' }, // orange
  { accent: '7C3AED', headerBg: 'F5F3FF', headerText: '4C1D95', dividerBg: 'DDD6FE' }, // purple
  { accent: 'BE185D', headerBg: 'FFF1F2', headerText: '881337', dividerBg: 'FECDD3' }, // rose
];

function buildCondColorMap(conditions?: Condition[]): Map<string, CondColor> {
  const m = new Map<string, CondColor>();
  if (!conditions) return m;
  conditions.forEach((c, i) => m.set(c.id, COND_COLORS[Math.min(i, COND_COLORS.length - 1)]));
  return m;
}

function parseDataUrl(dataUrl: string): { base64: string; extension: 'png' | 'jpeg' } {
  const match = dataUrl.match(/^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/);
  if (!match) return { base64: dataUrl, extension: 'png' };
  const mimeType = match[1];
  const base64 = match[2];
  const extension = mimeType === 'jpeg' || mimeType === 'jpg' ? 'jpeg' : 'png';
  return { base64, extension };
}

/** Get natural pixel dimensions of an image from its data URL */
function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 16, height: 9 }); // fallback to 16:9
    img.src = dataUrl;
  });
}

function downloadBuffer(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function setBoxBorder(cell: ExcelJS.Cell, options?: {
  top?: Partial<ExcelJS.Border>;
  bottom?: Partial<ExcelJS.Border>;
  left?: Partial<ExcelJS.Border>;
  right?: Partial<ExcelJS.Border>;
}) {
  cell.border = {
    top: options?.top ?? THIN_BORDER,
    bottom: options?.bottom ?? THIN_BORDER,
    left: options?.left ?? THIN_BORDER,
    right: options?.right ?? THIN_BORDER,
  };
}

/** Apply style to a range of cells in a row */
function styleRange(
  ws: ExcelJS.Worksheet,
  row: number,
  colStart: number,
  colEnd: number,
  opts: {
    font?: Partial<ExcelJS.Font>;
    fill?: ExcelJS.Fill;
    alignment?: Partial<ExcelJS.Alignment>;
    border?: {
      top?: Partial<ExcelJS.Border>;
      bottom?: Partial<ExcelJS.Border>;
      left?: Partial<ExcelJS.Border>;
      right?: Partial<ExcelJS.Border>;
    };
  },
) {
  for (let c = colStart; c <= colEnd; c++) {
    const cell = ws.getCell(row, c);
    cell.font = { name: 'Arial', ...opts.font };
    if (opts.fill) cell.fill = opts.fill;
    if (opts.alignment) cell.alignment = opts.alignment;
    if (opts.border) {
      setBoxBorder(cell, opts.border);
    }
  }
}

/** Merge cells and set value with styling */
function mergeStyled(
  ws: ExcelJS.Worksheet,
  rowStart: number,
  colStart: number,
  rowEnd: number,
  colEnd: number,
  value: string | ExcelJS.CellRichTextValue,
  opts: {
    font?: Partial<ExcelJS.Font>;
    fill?: ExcelJS.Fill;
    alignment?: Partial<ExcelJS.Alignment>;
    border?: {
      top?: Partial<ExcelJS.Border>;
      bottom?: Partial<ExcelJS.Border>;
      left?: Partial<ExcelJS.Border>;
      right?: Partial<ExcelJS.Border>;
    };
  },
) {
  ws.mergeCells(rowStart, colStart, rowEnd, colEnd);
  const cell = ws.getCell(rowStart, colStart);
  cell.value = value;
  cell.font = { name: 'Arial', ...opts.font };
  if (opts.fill) cell.fill = opts.fill;
  cell.alignment = { vertical: 'middle', wrapText: true, ...opts.alignment };

  // Apply border to all cells in range
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      if (opts.border) {
        setBoxBorder(ws.getCell(r, c), opts.border);
      }
    }
  }
}

const solidFill = (color: string): ExcelJS.Fill => ({
  type: 'pattern', pattern: 'solid', fgColor: { argb: color },
});

// ============================================================
// Single instruction export
// ============================================================

export type ExcelNavMode = 'none' | 'scroll' | 'jump';

export interface CheckboxCell {
  sheetName: string;
  row: number;  // 0-based row index
}

export interface ExcelBuildResult {
  buffer: ArrayBuffer;
  stepNavRows: number[];   // 0-based row index of nav footer in each step sheet (jump mode only)
  indexNavRows: number[];  // 0-based row index of each "開く" button on main sheet (jump mode only)
  checkboxCells: CheckboxCell[];  // positions of check item cells for Sheets API
}

export async function exportToExcel(instruction: WorkInstruction, navMode: ExcelNavMode = 'scroll'): Promise<void> {
  const { buffer } = await buildExcelBuffer(instruction, navMode);
  downloadBuffer(buffer, `${instruction.title}_手順書.xlsx`);
}

export async function buildExcelBuffer(instruction: WorkInstruction, navMode: ExcelNavMode = 'scroll'): Promise<ExcelBuildResult> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('作業手順書', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    properties: { showGridLines: false },
  });

  // Columns: A(accent 1.5) B(label 6) C-N(content, 12 cols ﾃ・10 width)
  const contentColWidth = 10;
  ws.columns = [
    { width: 1.5 },  // A: accent stripe
    { width: 6 },    // B: step number / label
    { width: contentColWidth },   // C
    { width: contentColWidth },   // D
    { width: contentColWidth },   // E
    { width: contentColWidth },   // F
    { width: contentColWidth },   // G
    { width: contentColWidth },   // H
    { width: contentColWidth },   // I
    { width: contentColWidth },   // J
    { width: contentColWidth },   // K
    { width: contentColWidth },   // L
    { width: contentColWidth },   // M
    { width: contentColWidth },   // N
  ];

  const LAST_COL = 14; // N
  const CONTENT_START_COL = 3; // C
  let row = 1;

  // ===== TITLE BANNER =====
  ws.getRow(row).height = 52;
  mergeStyled(ws, row, 1, row, LAST_COL, instruction.title, {
    font: { bold: true, size: 22, color: { argb: C.white } },
    fill: solidFill(C.primary),
    alignment: { horizontal: 'center' },
    border: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
  });
  row++;

  // Subtitle "作業手順書"
  ws.getRow(row).height = 26;
  mergeStyled(ws, row, 1, row, LAST_COL, '作業手順書', {
    font: { size: 12, color: { argb: C.white } },
    fill: solidFill(C.primaryMid),
    alignment: { horizontal: 'center' },
    border: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
  });
  row++;

  // ===== META BAR =====
  const catColors: Record<string, { bg: string; text: string }> = {
    pc_work: { bg: C.badgeBlueBg, text: C.badgeBlueText },
    packing: { bg: C.badgeOrangeBg, text: C.badgeOrangeText },
  };
  const catC = catColors[instruction.category] || catColors.pc_work;

  ws.getRow(row).height = 30;
  // Category (left)
  mergeStyled(ws, row, 1, row, 5, `  ${getCategoryLabel(instruction.category)}`, {
    font: { size: 11, bold: true, color: { argb: catC.text } },
    fill: solidFill(catC.bg),
    alignment: { horizontal: 'left' },
    border: { top: THIN_BORDER, bottom: THIN_BORDER, left: NO_BORDER, right: NO_BORDER },
  });
  // Dates & author (right)
  const created = new Date(instruction.createdAt).toLocaleDateString('ja-JP');
  const updated = new Date(instruction.updatedAt).toLocaleDateString('ja-JP');
  const creatorStr = instruction.createdBy ? `作成者: ${instruction.createdBy}` : '';
  const updaterStr = instruction.updatedBy ? `更新者: ${instruction.updatedBy}` : '';
  const authorParts = [creatorStr, updaterStr].filter(Boolean).join('  |  ');
  const metaRight = `${authorParts ? `${authorParts}  |  ` : ''}作成日: ${created}  |  更新日: ${updated}  `;
  mergeStyled(ws, row, 6, row, LAST_COL, metaRight, {
    font: { size: 10, color: { argb: C.gray } },
    fill: solidFill(C.grayLight),
    alignment: { horizontal: 'right' },
    border: { top: THIN_BORDER, bottom: THIN_BORDER, left: NO_BORDER, right: NO_BORDER },
  });
  row++;

  // ===== DESCRIPTION =====
  if (instruction.description) {
    ws.getRow(row).height = calcRowHeight(instruction.description, 65, 20, 36);
    mergeStyled(ws, row, 1, row, LAST_COL, `  ${instruction.description}`, {
      font: { size: 12, color: { argb: C.text } },
      fill: solidFill(C.white),
      border: { top: NO_BORDER, bottom: THIN_BORDER, left: NO_BORDER, right: NO_BORDER },
    });
    row++;
  }

  // Spacer
  ws.getRow(row).height = 12;
  row++;

  // ===== STEPS =====
  const sortedSteps = [...instruction.steps].sort((a, b) => a.orderIndex - b.orderIndex);
  const stepNavRows: number[] = [];  // 0-based row index of nav footer per step sheet
  const indexNavRows: number[] = [];  // 0-based row index of index buttons on main sheet
  const checkboxCells: CheckboxCell[] = [];
  const mainSheetRowBeforeSteps = row;  // save row for main sheet (jump mode resets row)
  const condColorMap = buildCondColorMap(instruction.conditions);

  // Column definitions for reuse when creating per-step sheets
  const colDefs = [
    { width: 1.5 },  // A
    { width: 6 },    // B
    ...Array(12).fill(null).map(() => ({ width: contentColWidth })), // C-N
  ];

  // Track condition group to insert dividers in scroll mode
  let lastCondKey: string = 'shared';

  for (let i = 0; i < sortedSteps.length; i++) {
    const step = sortedSteps[i];
    const stepNum = String(i + 1).padStart(2, '0');
    const condColors = step.conditionId ? condColorMap.get(step.conditionId) : null;
    const accentColor = condColors ? condColors.accent : C.accent;
    const headerBgColor = condColors ? condColors.headerBg : C.headerBg;
    const headerTextColor = condColors ? condColors.headerText : C.stepTitle;
    const currentCondKey = step.conditionId ?? 'shared';

    // In jump mode, each step gets its own sheet tab for navigation
    let sws = ws;
    if (navMode === 'jump') {
      const rawName = `${stepNum} ${step.title}`;
      const tabName = rawName.replace(/[\\/*?[\]:]/g, '').substring(0, 31);
      sws = wb.addWorksheet(tabName, {
        pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
        properties: { showGridLines: false },
      });
      sws.columns = colDefs.map(c => ({ ...c }));
      row = 1;
    }

    // Condition divider row (scroll mode only) when transitioning between groups
    if (navMode === 'scroll' && instruction.conditions && instruction.conditions.length > 0 && currentCondKey !== lastCondKey) {
      const dividerLabel = currentCondKey === 'shared'
        ? '共通（すべて）'
        : `${instruction.conditions.find(c => c.id === currentCondKey)?.label ?? '条件'}のみ`;
      const dividerBg = condColors ? condColors.dividerBg : C.headerBg;
      ws.getRow(row).height = 26;
      mergeStyled(ws, row, 1, row, LAST_COL, `  ${dividerLabel}`, {
        font: { bold: true, size: 11, color: { argb: condColors ? condColors.headerText : C.primary } },
        fill: solidFill(dividerBg),
        alignment: { horizontal: 'left', vertical: 'middle' },
        border: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
      });
      row++;
      lastCondKey = currentCondKey;
    }

    // --- Step header row ---
    sws.getRow(row).height = 42;

    // A: accent stripe (condition-colored)
    const accentCell = sws.getCell(row, 1);
    accentCell.fill = solidFill(accentColor);
    setBoxBorder(accentCell, { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER });

    // B: step number
    const numCell = sws.getCell(row, 2);
    numCell.value = stepNum;
    numCell.font = { name: 'Arial', bold: true, size: 18, color: { argb: C.white } };
    numCell.fill = solidFill(condColors ? accentColor : C.primaryMid);
    numCell.alignment = { horizontal: 'center', vertical: 'middle' };
    setBoxBorder(numCell, { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER });

    // C-N: step title (condition label prefix if applicable)
    const condLabel = condColors && step.conditionId
      ? instruction.conditions?.find(c => c.id === step.conditionId)?.label
      : null;
    const titleText = condLabel ? `  [${condLabel}] ${step.title}` : `  ${step.title}`;
    mergeStyled(sws, row, CONTENT_START_COL, row, LAST_COL, titleText, {
      font: { bold: true, size: 15, color: { argb: headerTextColor } },
      fill: solidFill(headerBgColor),
      alignment: { horizontal: 'left' },
      border: {
        top: { style: 'thin', color: { argb: condColors ? condColors.accent : C.borderBlue } },
        bottom: { style: 'medium', color: { argb: condColors ? condColors.accent : C.borderBlue } },
        left: NO_BORDER,
        right: { style: 'thin', color: { argb: condColors ? condColors.accent : C.borderBlue } },
      },
    });
    row++;

    // --- Description ---
    if (step.description) {
      sws.getRow(row).height = calcRowHeight(step.description, 58, 20, 40);

      // A: accent (condition-colored)
      const aCell = sws.getCell(row, 1);
      aCell.fill = solidFill(accentColor);
      setBoxBorder(aCell, { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER });

      // B: label
      const labelCell = sws.getCell(row, 2);
      labelCell.value = '説明';
      labelCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: C.gray } };
      labelCell.fill = solidFill(C.grayLight);
      labelCell.alignment = { horizontal: 'center', vertical: 'top' };
      setBoxBorder(labelCell, { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER });

      // C-N: description content
      mergeStyled(sws, row, CONTENT_START_COL, row, LAST_COL, step.description, {
        font: { size: 12, color: { argb: C.text } },
        fill: solidFill(C.white),
        border: { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER },
      });
      row++;
    }

    // --- Caution ---
    if (step.caution) {
      sws.getRow(row).height = calcRowHeight(step.caution, 58, 20, 36);

      // A: accent (caution uses amber border color to distinguish from condition accent)
      const aCell = sws.getCell(row, 1);
      aCell.fill = solidFill(C.cautionBorder);
      setBoxBorder(aCell, { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER });

      // B: label
      const labelCell = sws.getCell(row, 2);
      labelCell.value = '注意';
      labelCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: C.cautionText } };
      labelCell.fill = solidFill(C.cautionBg);
      labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
      setBoxBorder(labelCell, {
        top: { style: 'thin', color: { argb: C.cautionBorder } },
        bottom: { style: 'thin', color: { argb: C.cautionBorder } },
        left: { style: 'thin', color: { argb: C.cautionBorder } },
        right: { style: 'thin', color: { argb: C.cautionBorder } },
      });

      // C-N: caution text
      mergeStyled(sws, row, CONTENT_START_COL, row, LAST_COL, step.caution, {
        font: { size: 12, color: { argb: C.cautionText } },
        fill: solidFill(C.cautionBg),
        border: {
          top: { style: 'thin', color: { argb: C.cautionBorder } },
          bottom: { style: 'thin', color: { argb: C.cautionBorder } },
          left: { style: 'thin', color: { argb: C.cautionBorder } },
          right: { style: 'thin', color: { argb: C.cautionBorder } },
        },
      });
      row++;
    }

    // --- Images ---
    const stepImages = getStepImages(step);
    for (let imgIdx = 0; imgIdx < stepImages.length; imgIdx++) {
      const IMAGE_ROW_HEIGHT = 18; // points
      const PX_PER_PT = 1.33; // 1 Excel point 竕・1.33 pixels
      const IMAGE_ROW_HEIGHT_PX = IMAGE_ROW_HEIGHT * PX_PER_PT;
      const MAX_IMG_WIDTH = 700;
      const MAX_IMG_HEIGHT = 500;

      // Get actual image dimensions and scale to fit
      const dims = await getImageDimensions(stepImages[imgIdx]);
      let imgW = dims.width;
      let imgH = dims.height;
      if (imgW > MAX_IMG_WIDTH) {
        imgH = Math.round(imgH * (MAX_IMG_WIDTH / imgW));
        imgW = MAX_IMG_WIDTH;
      }
      if (imgH > MAX_IMG_HEIGHT) {
        imgW = Math.round(imgW * (MAX_IMG_HEIGHT / imgH));
        imgH = MAX_IMG_HEIGHT;
      }

      // Row count: convert pixel height to Excel row count using pt-to-px ratio
      const imageRows = Math.max(3, Math.ceil(imgH / IMAGE_ROW_HEIGHT_PX) + 1);

      const imageStartRow = row;

      for (let r = 0; r < imageRows; r++) {
        sws.getRow(imageStartRow + r).height = IMAGE_ROW_HEIGHT;
        // A: accent stripe continuation (condition-colored)
        const aCell = sws.getCell(imageStartRow + r, 1);
        aCell.fill = solidFill(accentColor);
        setBoxBorder(aCell, { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER });

        // B: label column (separate from image merge)
        const bCell = sws.getCell(imageStartRow + r, 2);
        bCell.fill = solidFill(C.grayLight);
        setBoxBorder(bCell, { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER });
      }

      // B label text on first row
      const labelCell = sws.getCell(imageStartRow, 2);
      labelCell.value = stepImages.length > 1 ? `画像${imgIdx + 1}` : '画像';
      labelCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: C.gray } };
      labelCell.alignment = { horizontal: 'center', vertical: 'top' };

      // Merge image region C-N only (not B)
      sws.mergeCells(imageStartRow, CONTENT_START_COL, imageStartRow + imageRows - 1, LAST_COL);
      const imgCell = sws.getCell(imageStartRow, CONTENT_START_COL);
      imgCell.fill = solidFill(C.grayLight);
      imgCell.alignment = { vertical: 'middle', horizontal: 'center' };
      for (let r = imageStartRow; r < imageStartRow + imageRows; r++) {
        for (let c = CONTENT_START_COL; c <= LAST_COL; c++) {
          setBoxBorder(sws.getCell(r, c), { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER });
        }
      }

      // Place image with tl + ext (pixel size) to guarantee correct aspect ratio
      const { base64, extension } = parseDataUrl(stepImages[imgIdx]);
      const imageId = wb.addImage({ base64, extension });
      const imagePosition: ExcelJS.ImagePosition = {
        tl: { col: CONTENT_START_COL - 1 + 0.2, row: imageStartRow - 1 + 0.3 },
        ext: { width: imgW, height: imgH },
      };
      sws.addImage(imageId, imagePosition);

      row = imageStartRow + imageRows;

      // Caption row
      const caption = getImageCaption(step, imgIdx);
      if (caption) {
        sws.getRow(row).height = calcRowHeight(caption, 58, 18, 28);

        const aCap = sws.getCell(row, 1);
        aCap.fill = solidFill(accentColor);
        setBoxBorder(aCap, { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER });

        const bCap = sws.getCell(row, 2);
        bCap.fill = solidFill(C.grayLight);
        setBoxBorder(bCap, { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER });

        mergeStyled(sws, row, CONTENT_START_COL, row, LAST_COL, caption, {
          font: { size: 11, italic: true, color: { argb: C.gray } },
          fill: solidFill(C.grayLight),
          border: { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER },
        });
        row++;
      }
    }


    // --- Check items ---
    if (step.checkItems && step.checkItems.length > 0) {
      for (const item of step.checkItems) {
        sws.getRow(row).height = 22;

        const aCell = sws.getCell(row, 1);
        aCell.fill = solidFill(accentColor);
        setBoxBorder(aCell, { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER });

        const labelCell = sws.getCell(row, 2);
        labelCell.value = '□';
        labelCell.font = { name: 'Arial', size: 12, color: { argb: C.dark } };
        labelCell.fill = solidFill(C.grayLight);
        labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
        setBoxBorder(labelCell);

        checkboxCells.push({ sheetName: sws.name, row: row - 1 });

        mergeStyled(sws, row, CONTENT_START_COL, row, LAST_COL, item.label, {
          font: { size: 11, color: { argb: C.dark } },
          fill: solidFill(C.grayLight),
        });
        row++;
      }
    }

    // Nav footer row at the bottom of each step sheet (jump mode only)
    if (navMode === 'jump') {
      const isLastStep = i === sortedSteps.length - 1;
      sws.getRow(row).height = 36;

      // A: accent stripe (condition-colored)
      const aNav = sws.getCell(row, 1);
      aNav.fill = solidFill(accentColor);

      // B-N: nav button (merged, blue bar)
      mergeStyled(sws, row, 2, row, LAST_COL, isLastStep ? '概要へ戻る' : '次へ', {
        font: { bold: true, size: 13, color: { argb: C.white } },
        fill: solidFill(C.primaryMid),
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
      });

      stepNavRows.push(row - 1);  // 0-based for Sheets API
      row++;
    }

    // Spacer between steps (scroll mode only)
    if (navMode === 'scroll' && i < sortedSteps.length - 1) {
      ws.getRow(row).height = 10;
      row++;
    }
  }

  // ===== FOOTER (on main sheet) =====
  if (navMode === 'jump') {
    // Restore row to main sheet position (step loop resets row for each step sheet)
    row = mainSheetRowBeforeSteps;

    // Section header
    ws.getRow(row).height = 32;
    mergeStyled(ws, row, 1, row, LAST_COL, '  目次', {
      font: { bold: true, size: 14, color: { argb: C.white } },
      fill: solidFill(C.primaryMid),
      alignment: { horizontal: 'left', vertical: 'middle' },
      border: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
    });
    row++;

    // Step index with jump buttons
    const INDEX_BTN_COL = LAST_COL - 1; // column M (13)
    for (let i = 0; i < sortedSteps.length; i++) {
      const stepNum = String(i + 1).padStart(2, '0');
      const bg = i % 2 === 0 ? C.white : C.grayLight;
      ws.getRow(row).height = 32;

      // A-L: step title
      mergeStyled(ws, row, 1, row, INDEX_BTN_COL - 1, `  ${stepNum}  ${sortedSteps[i].title}`, {
        font: { size: 12, color: { argb: C.text } },
        fill: solidFill(bg),
        alignment: { horizontal: 'left', vertical: 'middle' },
        border: { top: THIN_BORDER, bottom: THIN_BORDER, left: NO_BORDER, right: NO_BORDER },
      });

      // M-N: "開く" button placeholder (link added by Sheets API)
      mergeStyled(ws, row, INDEX_BTN_COL, row, LAST_COL, '開く', {
        font: { bold: true, size: 11, color: { argb: C.white } },
        fill: solidFill(C.primaryLight),
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
      });

      indexNavRows.push(row - 1);  // 0-based for Sheets API
      row++;
    }
  }
  ws.getRow(row).height = 22;
  mergeStyled(ws, row, 1, row, LAST_COL, `全 ${sortedSteps.length} ステップ`, {
    font: { size: 9, italic: true, color: { argb: C.gray } },
    fill: solidFill(C.grayMid),
    alignment: { horizontal: 'right' },
    border: { top: THIN_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
  });

  ws.pageSetup.printArea = `A1:N${row}`;

  // ===== KEYWORDS SHEET =====
  if (instruction.keywords && instruction.keywords.length > 0) {
    const ks = wb.addWorksheet('関連キーワード', {
      properties: { showGridLines: false },
    });
    ks.columns = [
      { width: 6 },   // No.
      { width: 40 },  // キーワード
    ];

    let kRow = 1;
    // Title
    ks.getRow(kRow).height = 36;
    mergeStyled(ks, kRow, 1, kRow, 2, `関連キーワード - ${instruction.title}`, {
      font: { bold: true, size: 14, color: { argb: C.white } },
      fill: solidFill(C.primary),
      alignment: { horizontal: 'center' },
      border: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
    });
    kRow++;

    // Headers
    const kHeaders = ['No.', 'キーワード'];
    ks.getRow(kRow).height = 26;
    kHeaders.forEach((h, i) => {
      const cell = ks.getCell(kRow, i + 1);
      cell.value = h;
      cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: C.dark } };
      cell.fill = solidFill(C.headerBg);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      setBoxBorder(cell, {
        top: { style: 'medium', color: { argb: C.borderBlue } },
        bottom: { style: 'medium', color: { argb: C.borderBlue } },
        left: THIN_BORDER,
        right: THIN_BORDER,
      });
    });
    kRow++;

    // Data rows
    instruction.keywords.forEach((kw, i) => {
      const bgColor = i % 2 === 0 ? C.white : C.grayLight;
      ks.getRow(kRow).height = 24;
      const numCell = ks.getCell(kRow, 1);
      numCell.value = i + 1;
      numCell.font = { name: 'Arial', size: 10, color: { argb: C.dark } };
      numCell.fill = solidFill(bgColor);
      numCell.alignment = { horizontal: 'center', vertical: 'middle' };
      setBoxBorder(numCell);

      const kwCell = ks.getCell(kRow, 2);
      kwCell.value = kw;
      kwCell.font = { name: 'Arial', size: 10, color: { argb: C.dark } };
      kwCell.fill = solidFill(bgColor);
      kwCell.alignment = { vertical: 'middle', wrapText: true };
      setBoxBorder(kwCell);
      kRow++;
    });
  }

  // ===== UPDATE HISTORY SHEET =====
  if (instruction.updateHistory && instruction.updateHistory.length > 0) {
    const hs = wb.addWorksheet('更新履歴', {
      properties: { showGridLines: false },
    });
    hs.columns = [
      { width: 6 },   // No.
      { width: 20 },  // 更新日時
      { width: 18 },  // 更新者
      { width: 50 },  // メモ
    ];

    let hRow = 1;
    // Title
    hs.getRow(hRow).height = 36;
    mergeStyled(hs, hRow, 1, hRow, 4, `更新履歴 - ${instruction.title}`, {
      font: { bold: true, size: 14, color: { argb: C.white } },
      fill: solidFill(C.primary),
      alignment: { horizontal: 'center' },
      border: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
    });
    hRow++;

    // Headers
    const hHeaders = ['No.', '更新日時', '更新者', 'メモ'];
    hs.getRow(hRow).height = 26;
    hHeaders.forEach((h, i) => {
      const cell = hs.getCell(hRow, i + 1);
      cell.value = h;
      cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: C.dark } };
      cell.fill = solidFill(C.headerBg);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      setBoxBorder(cell, {
        top: { style: 'medium', color: { argb: C.borderBlue } },
        bottom: { style: 'medium', color: { argb: C.borderBlue } },
        left: THIN_BORDER,
        right: THIN_BORDER,
      });
    });
    hRow++;

    // Data rows
    instruction.updateHistory.forEach((entry, i) => {
      const bgColor = i % 2 === 0 ? C.white : C.grayLight;
      const dateStr = new Date(entry.updatedAt).toLocaleString('ja-JP');
      const values = [i + 1, dateStr, entry.updatedBy, entry.note || ''];
      hs.getRow(hRow).height = 24;
      values.forEach((v, ci) => {
        const cell = hs.getCell(hRow, ci + 1);
        cell.value = v;
        cell.font = { name: 'Arial', size: 10, color: { argb: C.dark } };
        cell.fill = solidFill(bgColor);
        cell.alignment = {
          vertical: 'middle',
          wrapText: true,
          horizontal: ci === 0 ? 'center' : 'left',
        };
        setBoxBorder(cell);
      });
      hRow++;
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: buffer as ArrayBuffer, stepNavRows, indexNavRows, checkboxCells };
}

// ============================================================
// All instructions list export
// ============================================================

export async function exportAllToExcel(instructions: WorkInstruction[]): Promise<void> {
  const buffer = await buildAllExcelBuffer(instructions);
  downloadBuffer(buffer, '作業手順書一覧.xlsx');
}

export async function buildAllExcelBuffer(instructions: WorkInstruction[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('手順書一覧', {
    properties: { showGridLines: false },
  });

  ws.columns = [
    { width: 5 },   // No.
    { width: 30 },  // タイトル
    { width: 14 },  // カテゴリ
    { width: 45 },  // 概要
    { width: 10 },  // ステップ数
    { width: 14 },  // 作成日
    { width: 14 },  // 更新日
  ];

  const COLS = 7;
  let row = 1;

  // Title banner
  ws.getRow(row).height = 40;
  mergeStyled(ws, row, 1, row, COLS, '作業手順書一覧', {
    font: { bold: true, size: 18, color: { argb: C.white } },
    fill: solidFill(C.primary),
    alignment: { horizontal: 'center' },
    border: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
  });
  row++;

  // Column headers
  const headers = ['No.', 'タイトル', 'カテゴリ', '概要', 'ステップ数', '作成日', '更新日'];
  ws.getRow(row).height = 26;
  headers.forEach((h, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = h;
    cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: C.dark } };
    cell.fill = solidFill(C.headerBg);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    setBoxBorder(cell, {
      top: { style: 'medium', color: { argb: C.borderBlue } },
      bottom: { style: 'medium', color: { argb: C.borderBlue } },
      left: THIN_BORDER,
      right: THIN_BORDER,
    });
  });
  row++;

  // Data rows
  instructions.forEach((inst, i) => {
    const bgColor = i % 2 === 0 ? C.white : C.grayLight;
    const values: (string | number | undefined)[] = [
      i + 1,
      inst.title,
      getCategoryLabel(inst.category),
      inst.description,
      inst.steps.length,
      new Date(inst.createdAt).toLocaleDateString('ja-JP'),
      new Date(inst.updatedAt).toLocaleDateString('ja-JP'),
    ];
    ws.getRow(row).height = 24;
    values.forEach((v, ci) => {
      const cell = ws.getCell(row, ci + 1);
      cell.value = v;
      cell.font = { name: 'Arial', size: 10, color: { argb: C.dark } };
      cell.fill = solidFill(bgColor);
      cell.alignment = {
        vertical: 'middle',
        wrapText: true,
        horizontal: ci === 0 || ci === 4 ? 'center' : 'left',
      };
      setBoxBorder(cell);
    });
    row++;
  });

  // Footer
  row++;
  mergeStyled(ws, row, 1, row, COLS, `合計: ${instructions.length} 件`, {
    font: { size: 9, italic: true, color: { argb: C.gray } },
    alignment: { horizontal: 'right' },
    border: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
  });

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

// ============================================================
// Instruction list with details (作成者/更新者/作成日/更新日/改版)
// ============================================================

function fmtDate(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('ja-JP');
}

export async function buildInstructionListExcel(instructions: WorkInstruction[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('手順書一覧', { properties: { showGridLines: false } });

  ws.columns = [
    { width: 5 },   // No.
    { width: 32 },  // タイトル
    { width: 14 },  // カテゴリ
    { width: 14 },  // 部署
    { width: 9 },   // 状態
    { width: 16 },  // 作成者
    { width: 16 },  // 更新者
    { width: 13 },  // 作成日
    { width: 13 },  // 更新日
    { width: 7 },   // 改版
  ];
  const COLS = 10;
  let row = 1;

  ws.getRow(row).height = 40;
  mergeStyled(ws, row, 1, row, COLS, '手順書一覧', {
    font: { bold: true, size: 18, color: { argb: C.white } },
    fill: solidFill(C.primary),
    alignment: { horizontal: 'center' },
    border: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
  });
  row++;

  const headers = ['No.', 'タイトル', 'カテゴリ', '部署', '状態', '作成者', '更新者', '作成日', '更新日', '改版'];
  ws.getRow(row).height = 26;
  headers.forEach((h, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = h;
    cell.font = { name: 'Arial', bold: true, size: 10, color: { argb: C.dark } };
    cell.fill = solidFill(C.headerBg);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    setBoxBorder(cell, {
      top: { style: 'medium', color: { argb: C.borderBlue } },
      bottom: { style: 'medium', color: { argb: C.borderBlue } },
      left: THIN_BORDER,
      right: THIN_BORDER,
    });
  });
  row++;

  instructions.forEach((inst, i) => {
    const bgColor = i % 2 === 0 ? C.white : C.grayLight;
    const lastHist = inst.updateHistory?.[inst.updateHistory.length - 1];
    const updater = inst.updatedBy || lastHist?.updatedBy || '';
    const revision = inst.updateHistory?.length ?? 0;
    const statusLabel = inst.status === 'draft' ? '下書き' : inst.status === 'completed' ? '完成' : '';
    const values: (string | number)[] = [
      i + 1,
      inst.title || '',
      getCategoryLabel(inst.category),
      inst.department || '',
      statusLabel,
      inst.createdBy || '',
      updater,
      fmtDate(inst.createdAt),
      fmtDate(inst.updatedAt),
      revision,
    ];
    ws.getRow(row).height = 22;
    values.forEach((v, ci) => {
      const cell = ws.getCell(row, ci + 1);
      cell.value = v;
      cell.font = { name: 'Arial', size: 10, color: { argb: C.dark } };
      cell.fill = solidFill(bgColor);
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: ci === 1 ? 'left' : 'center' };
      setBoxBorder(cell);
    });
    row++;
  });

  row++;
  mergeStyled(ws, row, 1, row, COLS, `合計: ${instructions.length} 件`, {
    font: { size: 9, italic: true, color: { argb: C.gray } },
    alignment: { horizontal: 'right' },
    border: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
  });

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export async function exportInstructionList(
  instructions: WorkInstruction[],
  filename = '手順書一覧.xlsx',
): Promise<void> {
  const buffer = await buildInstructionListExcel(instructions);
  downloadBuffer(buffer, filename);
}
