import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  VerticalAlign,
  PageNumber,
  Header,
  Footer,
  TabStopType,
  PageBreak,
} from 'docx';
import { WorkInstruction, Step, getStepImages, JUMP_END_TARGET } from '@/types/instruction';
import type { RewrittenText } from './formalTextRoundTrip';

/**
 * 会社規定の作業手順書用紙「(株)ホリゾン 様式6-3号」の体裁で Word（.docx）を作る。
 * 文章は手順書の内容をそのまま、または AI で書き直した文章（rewritten）で入れる。
 * 画像・フロー図・改訂履歴はアプリの内容から付ける。
 */

export interface Form63Options {
  /** フロー図の PNG（任意）。〈業務フロー〉として本文の先頭に入れる */
  flowImage?: { data: Uint8Array; width: number; height: number } | null;
  /** AI で書き直した文章（任意）。見出しと本文だけ置き換える */
  rewritten?: RewrittenText | null;
}

const FONT = 'MS Mincho';
const PAGE_WIDTH = 11906; // A4 (DXA)
const PAGE_HEIGHT = 16838;
const MARGIN = 1150;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2; // 9606
const IMAGE_WIDTH_PX = 265; // 約70mm

const thin = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
const cellBorders = { top: thin, bottom: thin, left: thin, right: thin };

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function fmtDateDot(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function run(text: string, opt: Partial<ConstructorParameters<typeof TextRun>[0] & object> = {}): TextRun {
  return new TextRun({ text, font: FONT, size: 20, ...(opt as object) });
}

function para(children: TextRun | TextRun[], opt: Record<string, unknown> = {}): Paragraph {
  return new Paragraph({ spacing: { after: 60 }, ...opt, children: Array.isArray(children) ? children : [children] });
}

function cell(content: string | Paragraph[], width: number, opt: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; rowSpan?: number } = {}): TableCell {
  const children = typeof content === 'string'
    ? [para(run(content), { spacing: { after: 0 }, alignment: opt.align })]
    : content;
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: cellBorders,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    rowSpan: opt.rowSpan,
    children,
  });
}

function parseDataUrl(dataUrl: string): { data: Uint8Array; type: 'png' | 'jpg' } | null {
  const match = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { data: bytes, type: match[1] === 'png' ? 'png' : 'jpg' };
}

/** 画像の縦横比を読む（PNG/JPEG のヘッダーから）。読めなければ 4:3 */
function imageSize(bytes: Uint8Array, type: 'png' | 'jpg'): { width: number; height: number } {
  try {
    if (type === 'png' && bytes.length > 24) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (type === 'jpg') {
      let i = 2;
      while (i < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker >= 0xc0 && marker <= 0xc3) {
          const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        }
        const len = (bytes[i + 2] << 8) | bytes[i + 3];
        i += 2 + len;
      }
    }
  } catch {
    // フォールバック
  }
  return { width: 4, height: 3 };
}

function numbered(lines: string[]): Paragraph[] {
  return lines.map((l, i) => para(
    [run(`${i + 1}.`), new TextRun({ text: '\t' }), run(l)],
    { indent: { left: 700, hanging: 500 }, tabStops: [{ type: TabStopType.LEFT, position: 700 }] },
  ));
}

function noteLine(text: string): Paragraph {
  return para(run(text), { indent: { left: 700 } });
}

function splitLines(text?: string): string[] {
  return (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** 本文の行を「番号付き」「注意（※）」「確認（□）」「分岐（→）」に振り分ける */
function classify(lines: string[]): { body: string[]; notes: string[] } {
  const body: string[] = [];
  const notes: string[] = [];
  for (const l of lines) {
    if (/^[※□→]/.test(l)) notes.push(l);
    else body.push(l);
  }
  return { body, notes };
}

export async function buildForm63(instruction: WorkInstruction, options: Form63Options = {}): Promise<Blob> {
  const steps = [...instruction.steps].sort((a, b) => a.orderIndex - b.orderIndex);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const rewritten = options.rewritten ?? null;
  const title = rewritten?.title || instruction.title || '（無題）';
  const dept = instruction.department || '';

  const header = new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.CENTER, position: 5200 }],
        spacing: { after: 120 },
        children: [
          new TextRun({ text: 'Horizon', bold: true, size: 40, color: 'C8102E', font: 'Arial' }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: title, size: 30, font: FONT, italics: true, underline: {} }),
        ],
      }),
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 2 } },
        spacing: { after: 160 },
        children: [
          run('文書番号：'),
          new TextRun({ text: '\t' }),
          new TextRun({ children: [PageNumber.CURRENT, '/', PageNumber.TOTAL_PAGES], font: FONT, size: 20 }),
        ],
      }),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }],
        border: { top: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 2 } },
        children: [run(' ', { size: 16 }), new TextRun({ text: '\t' }), run('－(株)ホリゾン 様式6-3号－', { size: 18 })],
      }),
    ],
  });

  const stampCell = (label: string) => cell([
    para(run(label, { size: 16 }), { alignment: AlignmentType.CENTER, spacing: { after: 0 } }),
    para(run(' '), { spacing: { after: 0 } }),
    para(run(' '), { spacing: { after: 0 } }),
  ], 850, { rowSpan: 2 });

  const info = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [3300, 2300, 2300, 850, 850],
    rows: [
      new TableRow({
        children: [
          cell(`初版作成日：${fmtDate(instruction.createdAt)}`, 3300),
          cell(`作成部門：${dept}`, 2300),
          cell(`作成者：${instruction.createdBy || ''}`, 2300),
          stampCell('承　認'),
          stampCell('審　査'),
        ],
      }),
      new TableRow({
        children: [
          cell(`最新改訂日：${fmtDate(instruction.updatedAt)}`, 3300),
          cell(`最新改訂部門：${dept}`, 2300),
          cell(`最新改訂者：${instruction.updatedBy || instruction.createdBy || ''}`, 2300),
        ],
      }),
    ],
  });

  const body: (Paragraph | Table)[] = [para(run(' '))];

  const overview = rewritten?.overview?.length ? rewritten.overview : splitLines(instruction.description);
  if (overview.length) {
    body.push(para(run('〈適用範囲〉'), { keepNext: true }));
    for (const line of overview) body.push(para(run(line), { indent: { left: 200 } }));
    body.push(para(run(' ')));
  }

  if (options.flowImage && options.flowImage.data.length > 0) {
    const maxW = 460; // 約120mm
    const ratio = options.flowImage.height / Math.max(options.flowImage.width, 1);
    const w = Math.min(maxW, options.flowImage.width);
    const h = Math.round(w * ratio);
    body.push(para(run('〈業務フロー〉'), { keepNext: true }));
    body.push(new Paragraph({ indent: { left: 200 }, spacing: { after: 120 }, children: [new ImageRun({ type: 'png', data: options.flowImage.data, transformation: { width: w, height: Math.min(h, 640) } })] }));
    body.push(para(run(' ')));
  }

  for (const step of steps) {
    const rw = rewritten?.steps.get(step.id);
    const heading = rw?.title || step.title || '（無題）';
    body.push(para(run(`〈${heading}〉`), { keepNext: true }));

    let lines: string[];
    let notes: string[];
    if (rw && rw.lines.length > 0) {
      const c = classify(rw.lines);
      lines = c.body;
      notes = c.notes;
    } else {
      lines = [...splitLines(step.description), ...splitLines(step.detailDescription)];
      if (step.branchQuestion?.trim()) lines.push(step.branchQuestion.trim());
      notes = [];
      for (const jump of step.jumps ?? []) {
        const target = byId.get(jump.targetStepId);
        const to = jump.targetStepId === JUMP_END_TARGET ? '終了' : target ? `〈${target.title || '（無題）'}〉へ` : '';
        if (to) notes.push(`→ ${jump.label || '（答え）'}：${to}`);
      }
      for (const l of splitLines(step.caution)) notes.push(`※ ${l}`);
      for (const item of step.checkItems ?? []) if (item.label?.trim()) notes.push(`□ ${item.label.trim()}`);
    }
    if (lines.length === 0) lines = [heading];
    body.push(...numbered(lines));
    for (const n of notes) body.push(noteLine(n));

    for (const url of getStepImages(step)) {
      const parsed = parseDataUrl(url);
      if (!parsed) continue;
      const size = imageSize(parsed.data, parsed.type);
      const w = IMAGE_WIDTH_PX;
      const h = Math.max(40, Math.round((w * size.height) / Math.max(size.width, 1)));
      body.push(new Paragraph({
        indent: { left: 700 },
        spacing: { after: 120 },
        children: [new ImageRun({ type: parsed.type, data: parsed.data, transformation: { width: w, height: Math.min(h, 400) } })],
      }));
    }
    body.push(para(run(' ')));
  }

  const history = (instruction.updateHistory ?? []).map((h, i) => [
    String(i + 1).padStart(2, '0'),
    fmtDateDot(h.updatedAt),
    h.note || '',
    h.updatedBy || '',
  ]);
  while (history.length < 5) history.push([String(history.length + 1).padStart(2, '0'), '', '', '']);
  const hdr = (t: string, w: number) => cell(t, w, { align: AlignmentType.CENTER });
  const histTable = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [500, 1500, 6800, 800],
    rows: [
      new TableRow({ tableHeader: true, children: [hdr('版', 500), hdr('改訂日', 1500), hdr('改訂内容', 6800), hdr('改訂者', 800)] }),
      ...history.map((r) => new TableRow({ children: [cell(r[0], 500, { align: AlignmentType.CENTER }), cell(r[1], 1500), cell(r[2], 6800), cell(r[3], 800)] })),
    ],
  });

  const doc = new Document({
    // ページの色を白に固定（Word のダークモードでも紙面が黒く表示されないように）
    background: { color: 'FFFFFF' },
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{
      properties: { page: { size: { width: PAGE_WIDTH, height: PAGE_HEIGHT }, margin: { top: 1000, bottom: 900, left: MARGIN, right: MARGIN, header: 500, footer: 450 } } },
      headers: { default: header },
      footers: { default: footer },
      children: [
        info,
        ...body,
        new Paragraph({ children: [new PageBreak()] }),
        para(run('【改訂履歴】'), { alignment: AlignmentType.CENTER }),
        histTable,
      ],
    }],
  });

  return Packer.toBlob(doc);
}

export function form63FileName(instruction: WorkInstruction): string {
  const safe = (instruction.title || '手順書').replace(/[\\/:*?"<>|]/g, '_');
  return `${safe}_様式6-3号.docx`;
}

/** Step 型を外から参照しやすいよう再エクスポート（テスト用） */
export type { Step };
