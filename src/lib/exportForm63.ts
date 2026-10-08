import JSZip from 'jszip';
import { WorkInstruction, getStepImages, JUMP_END_TARGET } from '@/types/instruction';
import type { RewrittenText } from './formalTextRoundTrip';
import { FORM63_TEMPLATE_BASE64 } from './form63TemplateData';

/**
 * 会社規定の作業手順書用紙「(株)ホリゾン 様式6-3号」の正式な雛形（.docx）に、手順書の内容を流し込む。
 * 雛形のロゴ・罫線・余白・フォント・フッターはそのまま使い、XML に内容だけを差し込む。
 *
 * 雛形の構造（document.xml）:
 *   表1: 作成情報（初版作成日／作成部門／作成者／最新改訂日／最新改訂部門／最新改訂者＋承認・審査欄）
 *   空段落 … → ここに本文を入れる
 *   「【改訂履歴】」段落
 *   表2: 改訂履歴（版／改訂日／改訂内容／改訂者、5行）
 * header1.xml: ロゴ ＋ タブ ＋ 表題（ここに表題を入れる）／文書番号：＋ページ番号
 */

export interface Form63Options {
  /** フロー図の PNG（任意）。〈業務フロー〉として本文の先頭に入れる */
  flowImage?: { data: Uint8Array; width: number; height: number } | null;
  /** AI で書き直した文章（任意）。見出しと本文だけ置き換える */
  rewritten?: RewrittenText | null;
}

const EMU_PER_PX = 9525;
const STEP_IMAGE_WIDTH_PX = 416; // 約110mm（本文幅の約2/3）
const IMAGE_MAX_HEIGHT_PX = 500;
// フロー図は1ページ丸ごと使う（本文幅 9921dxa ≒ 661px、本文高さ 14456dxa ≒ 963px から見出し分を引く）
const FLOW_IMAGE_MAX_WIDTH_PX = 660;
const FLOW_IMAGE_MAX_HEIGHT_PX = 880;

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDateJa(iso?: string): string {
  if (!iso) return '年 月 日';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '年 月 日';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function fmtDateDot(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function splitLines(text?: string): string[] {
  return (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// ---- OOXML の部品 ----

/** 段落の run をすべて置き換える（pPr は残す） */
function setParagraphText(paraXml: string, text: string, runProps = '<w:rPr><w:rFonts w:hint="eastAsia"/><w:sz w:val="18"/></w:rPr>'): string {
  const run = text ? `<w:r>${runProps}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>` : '';
  const pprEnd = paraXml.indexOf('</w:pPr>');
  if (pprEnd >= 0) return paraXml.slice(0, pprEnd + 8) + run + '</w:p>';
  const open = paraXml.indexOf('>');
  return paraXml.slice(0, open + 1) + run + '</w:p>';
}

/** セル内の最初の段落の文字を置き換える */
function setCellText(cellXml: string, text: string): string {
  const pStart = cellXml.indexOf('<w:p ');
  const pStart2 = cellXml.indexOf('<w:p>');
  const start = pStart >= 0 && (pStart2 < 0 || pStart < pStart2) ? pStart : pStart2;
  if (start < 0) return cellXml;
  const end = cellXml.indexOf('</w:p>', start) + 6;
  return cellXml.slice(0, start) + setParagraphText(cellXml.slice(start, end), text) + cellXml.slice(end);
}

/** 表の中のセルを順番に差し替える */
function mapCells(tableXml: string, fn: (cellXml: string, index: number) => string): string {
  let index = 0;
  return tableXml.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, (cell) => fn(cell, index++));
}

function bodyParagraph(text: string, opt: { keepNext?: boolean; indentLeft?: number; hanging?: number; tab?: number; bold?: boolean } = {}): string {
  const ppr = [
    '<w:spacing w:line="240" w:lineRule="atLeast"/>',
    opt.keepNext ? '<w:keepNext/>' : '',
    opt.tab ? `<w:tabs><w:tab w:val="left" w:pos="${opt.tab}"/></w:tabs>` : '',
    opt.indentLeft ? `<w:ind w:left="${opt.indentLeft}"${opt.hanging ? ` w:hanging="${opt.hanging}"` : ''}/>` : '',
  ].join('');
  const rpr = `<w:rPr><w:rFonts w:hint="eastAsia"/>${opt.bold ? '<w:b/>' : ''}</w:rPr>`;
  return `<w:p><w:pPr>${ppr}</w:pPr><w:r>${rpr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function numberedParagraph(no: number, text: string): string {
  return `<w:p><w:pPr><w:spacing w:line="240" w:lineRule="atLeast"/><w:tabs><w:tab w:val="left" w:pos="700"/></w:tabs><w:ind w:left="700" w:hanging="500"/></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:hint="eastAsia"/></w:rPr><w:t>${no}.</w:t></w:r><w:r><w:tab/></w:r><w:r><w:rPr><w:rFonts w:hint="eastAsia"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function emptyParagraph(): string {
  return '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="atLeast"/></w:pPr></w:p>';
}

function drawingParagraph(rId: string, docPrId: number, widthPx: number, heightPx: number, indentLeft: number): string {
  const cx = Math.round(widthPx * EMU_PER_PX);
  const cy = Math.round(heightPx * EMU_PER_PX);
  return `<w:p><w:pPr><w:spacing w:line="240" w:lineRule="atLeast"/><w:ind w:left="${indentLeft}"/></w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="図 ${docPrId}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="図 ${docPrId}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

// ---- 画像 ----

function parseDataUrl(dataUrl: string): { data: Uint8Array; ext: 'png' | 'jpeg' } | null {
  const match = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { data: bytes, ext: match[1] === 'png' ? 'png' : 'jpeg' };
}

/** 画像の縦横（PNG/JPEG のヘッダーから）。読めなければ 4:3 */
function imageSize(bytes: Uint8Array, ext: 'png' | 'jpeg'): { width: number; height: number } {
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (ext === 'png' && bytes.length > 24) return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (ext === 'jpeg') {
      let i = 2;
      while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker >= 0xc0 && marker <= 0xc3) return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
        i += 2 + dv.getUint16(i + 2);
      }
    }
  } catch {
    // フォールバック
  }
  return { width: 4, height: 3 };
}

class MediaStore {
  private count = 0;
  private rels: string[] = [];
  private docPrId = 100;
  constructor(private zip: JSZip) {}
  add(data: Uint8Array, ext: 'png' | 'jpeg'): { rId: string; docPrId: number } {
    this.count += 1;
    const name = `media/form63_${this.count}.${ext}`;
    this.zip.file(`word/${name}`, data);
    const rId = `rIdForm63Img${this.count}`;
    this.rels.push(`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${name}"/>`);
    return { rId, docPrId: this.docPrId++ };
  }
  get relationships(): string { return this.rels.join(''); }
  get hasJpeg(): boolean { return this.rels.some((r) => r.endsWith('.jpeg"/>')); }
  get hasPng(): boolean { return this.rels.some((r) => r.endsWith('.png"/>')); }
}

// ---- 本文 ----

function buildBody(instruction: WorkInstruction, options: Form63Options, media: MediaStore): string {
  const steps = [...instruction.steps].sort((a, b) => a.orderIndex - b.orderIndex);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const rewritten = options.rewritten ?? null;
  const parts: string[] = [emptyParagraph()];

  const overview = rewritten?.overview?.length ? rewritten.overview : splitLines(instruction.description);
  if (overview.length) {
    parts.push(bodyParagraph('〈適用範囲〉', { keepNext: true }));
    for (const line of overview) parts.push(bodyParagraph(line, { indentLeft: 200 }));
    parts.push(emptyParagraph());
  }

  if (options.flowImage && options.flowImage.data.length > 0) {
    const ratio = options.flowImage.height / Math.max(options.flowImage.width, 1);
    let w = Math.min(FLOW_IMAGE_MAX_WIDTH_PX, options.flowImage.width);
    let h = Math.round(w * ratio);
    if (h > FLOW_IMAGE_MAX_HEIGHT_PX) { h = FLOW_IMAGE_MAX_HEIGHT_PX; w = Math.round(h / ratio); }
    const { rId, docPrId } = media.add(options.flowImage.data, 'png');
    // 図は段落として分割されないので、入りきらなければ Word が見出しごと次のページへ送る
    parts.push(bodyParagraph('〈業務フロー〉', { keepNext: true }));
    parts.push(drawingParagraph(rId, docPrId, w, h, 0));
    parts.push(emptyParagraph());
  }

  for (const step of steps) {
    const rw = rewritten?.steps.get(step.id);
    const heading = rw?.title || step.title || '（無題）';
    parts.push(bodyParagraph(`〈${heading}〉`, { keepNext: true }));

    let lines: string[];
    const notes: string[] = [];
    if (rw && rw.lines.length > 0) {
      lines = rw.lines.filter((l) => !/^[※□→]/.test(l));
      notes.push(...rw.lines.filter((l) => /^[※□→]/.test(l)));
    } else {
      lines = [...splitLines(step.description), ...splitLines(step.detailDescription)];
      if (step.branchQuestion?.trim()) lines.push(step.branchQuestion.trim());
      for (const jump of step.jumps ?? []) {
        const target = byId.get(jump.targetStepId);
        const to = jump.targetStepId === JUMP_END_TARGET ? '終了' : target ? `〈${target.title || '（無題）'}〉へ` : '';
        if (to) notes.push(`→ ${jump.label || '（答え）'}：${to}`);
      }
      for (const l of splitLines(step.caution)) notes.push(`※ ${l}`);
      for (const item of step.checkItems ?? []) if (item.label?.trim()) notes.push(`□ ${item.label.trim()}`);
    }
    if (lines.length === 0) lines = [heading];
    lines.forEach((l, i) => parts.push(numberedParagraph(i + 1, l)));
    for (const n of notes) parts.push(bodyParagraph(n, { indentLeft: 700 }));

    for (const url of getStepImages(step)) {
      const parsed = parseDataUrl(url);
      if (!parsed) continue;
      const size = imageSize(parsed.data, parsed.ext);
      const w = STEP_IMAGE_WIDTH_PX;
      const h = Math.min(IMAGE_MAX_HEIGHT_PX, Math.max(40, Math.round((w * size.height) / Math.max(size.width, 1))));
      const { rId, docPrId } = media.add(parsed.data, parsed.ext);
      parts.push(drawingParagraph(rId, docPrId, w, h, 700));
    }
    parts.push(emptyParagraph());
  }
  return parts.join('');
}

// ---- 雛形への差し込み ----

function fillInfoTable(tableXml: string, instruction: WorkInstruction): string {
  const dept = instruction.department || '';
  const values: Record<number, string> = {
    0: `初版作成日： ${fmtDateJa(instruction.createdAt)}`,
    1: `作成部門： ${dept}`,
    2: `作成者： ${instruction.createdBy || ''}`,
    5: `最新改訂日： ${fmtDateJa(instruction.updatedAt)}`,
    6: `最新改訂部門： ${dept}`,
    7: `最新改訂者： ${instruction.updatedBy || instruction.createdBy || ''}`,
  };
  return mapCells(tableXml, (cell, index) => (index in values ? setCellText(cell, values[index]) : cell));
}

function fillHistoryTable(tableXml: string, instruction: WorkInstruction): string {
  const history = (instruction.updateHistory ?? []).map((h, i) => [
    String(i + 1).padStart(2, '0'),
    fmtDateDot(h.updatedAt),
    h.note || '',
    h.updatedBy || '',
  ]);
  const rows = tableXml.match(/<w:tr [\s\S]*?<\/w:tr>/g) ?? [];
  if (rows.length < 2) return tableXml;
  const header = rows[0] ?? '';
  const dataRows = rows.slice(1);
  const templateRow = dataRows[dataRows.length - 1] ?? '';
  const count = Math.max(dataRows.length, history.length);
  const filled: string[] = [];
  for (let i = 0; i < count; i++) {
    const source = dataRows[i] ?? templateRow;
    const values = history[i] ?? [String(i + 1).padStart(2, '0'), '', '', ''];
    // 改訂履歴の表がページをまたいで割れないよう、行は分割せず次の行と一緒に動かす
    let row = mapCells(source, (cell, index) => setCellText(cell, values[index] ?? ''));
    row = row.replace(/<w:pPr>/g, '<w:pPr><w:keepNext/>');
    row = row.includes('<w:trPr>') ? row.replace('<w:trPr>', '<w:trPr><w:cantSplit/>') : row.replace(/^(<w:tr[^>]*>)/, '$1<w:trPr><w:cantSplit/></w:trPr>');
    filled.push(row);
  }
  const tblStart = tableXml.indexOf(header);
  const tblEnd = tableXml.lastIndexOf('</w:tr>') + 7;
  return tableXml.slice(0, tblStart) + header + filled.join('') + tableXml.slice(tblEnd);
}

function fillHeader(headerXml: string, title: string): string {
  const firstParaEnd = headerXml.indexOf('</w:p>');
  if (firstParaEnd < 0) return headerXml;
  const run = `<w:r><w:rPr><w:rFonts w:ascii="ＭＳ ゴシック" w:eastAsia="ＭＳ ゴシック" w:hint="eastAsia"/><w:i/><w:spacing w:val="20"/><w:sz w:val="28"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${esc(title)}</w:t></w:r>`;
  return headerXml.slice(0, firstParaEnd) + run + headerXml.slice(firstParaEnd);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function buildForm63(instruction: WorkInstruction, options: Form63Options = {}): Promise<Blob> {
  const zip = await JSZip.loadAsync(base64ToBytes(FORM63_TEMPLATE_BASE64));
  const docPath = 'word/document.xml';
  const headerPath = 'word/header1.xml';
  const relsPath = 'word/_rels/document.xml.rels';
  const ctPath = '[Content_Types].xml';
  const settingsPath = 'word/settings.xml';
  let doc = await zip.file(docPath)!.async('string');
  const media = new MediaStore(zip);
  const title = options.rewritten?.title || instruction.title || '（無題）';

  // 表1（作成情報）
  const t1Start = doc.indexOf('<w:tbl>');
  const t1End = doc.indexOf('</w:tbl>', t1Start) + 8;
  const table1 = fillInfoTable(doc.slice(t1Start, t1End), instruction);

  // 本文（表1 と「【改訂履歴】」段落の間）
  const histLabel = doc.indexOf('【改訂履歴】');
  const histParaStart = doc.lastIndexOf('<w:p ', histLabel);
  const body = buildBody(instruction, options, media);

  // 表2（改訂履歴）
  const t2Start = doc.indexOf('<w:tbl>', histLabel);
  const t2End = doc.indexOf('</w:tbl>', t2Start) + 8;
  const table2 = fillHistoryTable(doc.slice(t2Start, t2End), instruction);

  // 「【改訂履歴】」の段落は表と一緒に動かす
  const histLabelPara = doc.slice(histParaStart, t2Start).replace('<w:pPr>', '<w:pPr><w:keepNext/>');
  doc = doc.slice(0, t1Start) + table1 + body + histLabelPara + table2 + doc.slice(t2End);

  // ページの色を白に（Word のダークモードで紙面が黒く見えないように）
  if (!doc.includes('<w:background')) doc = doc.replace('<w:body>', '<w:background w:color="FFFFFF"/><w:body>');
  zip.file(docPath, doc);

  const settings = await zip.file(settingsPath)?.async('string');
  if (settings && !settings.includes('displayBackgroundShape')) {
    zip.file(settingsPath, settings.replace(/(<w:settings[^>]*>)/, '$1<w:displayBackgroundShape/>'));
  }

  // ヘッダーの表題
  const header = await zip.file(headerPath)?.async('string');
  if (header) zip.file(headerPath, fillHeader(header, title));

  // 画像の関係と型
  if (media.relationships) {
    const rels = await zip.file(relsPath)!.async('string');
    zip.file(relsPath, rels.replace('</Relationships>', media.relationships + '</Relationships>'));
    let ct = await zip.file(ctPath)!.async('string');
    if (media.hasPng && !/Extension="png"/i.test(ct)) ct = ct.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
    if (media.hasJpeg && !/Extension="jpeg"/i.test(ct)) ct = ct.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
    zip.file(ctPath, ct);
  }

  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}

export function form63FileName(instruction: WorkInstruction): string {
  const safe = (instruction.title || '手順書').replace(/[\\/:*?"<>|]/g, '_');
  return `${safe}_様式6-3号.docx`;
}
