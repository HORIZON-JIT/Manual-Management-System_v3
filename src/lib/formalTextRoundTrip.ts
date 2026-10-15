import { Step, WorkInstruction, JUMP_END_TARGET } from '@/types/instruction';

/**
 * 文章の書き直しを外部の AI（Gemini など）に任せるための往復用テキスト。
 * - exportTextForAI: 指示文＋手順書の文章（見出しと本文）を決まった形式で書き出す
 * - parseRewrittenText: AI が同じ形式で返した文章を読み取り、ステップごとに対応づける
 * 画像・改訂履歴はアプリ側で付けるので、ここでは扱わない。
 */

export interface RewrittenStep {
  title?: string;
  lines: string[];
}

export interface RewrittenText {
  title?: string;
  overview?: string[];
  /** ステップID → 書き直した見出しと本文 */
  steps: Map<string, RewrittenStep>;
}

export const STEP_MARK = /^##\s*\[S(\d+)\]\s*(.*)$/;

export const AI_INSTRUCTION = `以下は社内の手順書作成アプリで作った作業手順書の文章です。会社規定の作業手順書（様式6-3号）に載せるため、次の規則で文体だけを整えてください。

【書き直しの規則】
- 文体は「である調」に統一する。口語・感嘆・曖昧な表現（〜してみる、〜かも、など）は使わない。
- 主語は書かない。「担当者は」「作業者は」を文頭に付けない（手順書の読み手が行うことが前提）。相手や部門が動作主のときだけ「調達課から回答が届いたら」のように書く。
- 1 行につき 1 つの作業にまとめる。宛先・CC・本文など 1 通のメールに付随する項目や、1 つの画面での一連の操作は、細かく分けずに 1〜2 行にまとめる。行数は元より増やさない。
- 「・」で始まる箇条書き、「↓例文」「例文：」「（例）」「（計算例）」以降のメール文面・計算例・ファイルのパス・画面名・ボタン名は、行をそのまま残し、文言を変えない（文体の統一もしない）。削除しない。
- 人名・部署名・システム名・数値・固有名詞は変えない。敬称（さん）も変えない。「氏」に置き換えない。
- 「質問：」「→ 答え：」の行は分岐の説明である。「○○の場合は〈見出し〉へ進む。」のように条件文に直す。
- 「※」で始まる行は注意事項、「□」で始まる行は確認項目である。それぞれ記号を残して簡潔に書き直す。
- 内容を増やさない。元に無い手順を追加しない。同じ内容の繰り返しだけ、まとめてよい。

【出力の形式（厳守）】
- 下の入力と同じ形式で返す。「# 」で始まる表題、「## 概要」、各ステップの「## [S1] 見出し」の行をそのまま残す。
- 「## [S1]」の番号は変えない・並べ替えない・省略しない。見出しの文言は書き直してよい。
- 本文は行ごとに書く。番号は付けない。記号（・ ※ □ → ↓）は元のまま残す。
- 説明や前置きは書かず、書き直した文章だけを返す。

====================
`;

function bodyLinesOf(step: Step, steps: Step[]): string[] {
  const lines: string[] = [];
  const push = (text: string | undefined) => {
    for (const l of (text ?? '').split(/\r?\n/)) if (l.trim()) lines.push(l.trim());
  };
  push(step.description);
  push(step.detailDescription);
  if (step.branchQuestion?.trim()) lines.push(`質問：${step.branchQuestion.trim()}`);
  for (const jump of step.jumps ?? []) {
    const target = steps.find((s) => s.id === jump.targetStepId);
    const to = jump.targetStepId === JUMP_END_TARGET ? '終了' : target ? `〈${target.title || '（無題）'}〉へ` : '';
    if (to) lines.push(`→ 答え：${jump.label || '（答え）'} → ${to}`);
  }
  if (step.caution?.trim()) for (const l of step.caution.split(/\r?\n/)) if (l.trim()) lines.push(`※ ${l.trim()}`);
  for (const item of step.checkItems ?? []) if (item.label?.trim()) lines.push(`□ ${item.label.trim()}`);
  return lines;
}

/** AI に渡す本文（指示文を含む） */
export function exportTextForAI(instruction: WorkInstruction): string {
  return AI_INSTRUCTION + exportTextBody(instruction);
}

/** AI に渡す本文（指示文なし） */
export function exportTextBody(instruction: WorkInstruction): string {
  const steps = [...instruction.steps].sort((a, b) => a.orderIndex - b.orderIndex);
  const out: string[] = [];
  out.push(`# ${instruction.title || '（無題）'}`);
  out.push('');
  out.push('## 概要');
  const overview = (instruction.description || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  out.push(...(overview.length ? overview : ['（概要なし）']));
  out.push('');
  steps.forEach((step, index) => {
    out.push(`## [S${index + 1}] ${step.title || '（無題）'}`);
    const lines = bodyLinesOf(step, steps);
    out.push(...(lines.length ? lines : ['（本文なし）']));
    out.push('');
  });
  return out.join('\n');
}

/** AI の返答を読み取る。ステップの対応は [S番号] で取る（番号は元の並び順）。 */
export function parseRewrittenText(text: string, instruction: WorkInstruction): RewrittenText {
  const steps = [...instruction.steps].sort((a, b) => a.orderIndex - b.orderIndex);
  const result: RewrittenText = { steps: new Map() };
  let current: { kind: 'none' | 'overview' | 'step'; stepId?: string } = { kind: 'none' };
  let buffer: string[] = [];
  const flush = () => {
    const lines = buffer.map((l) => cleanLine(l)).filter(Boolean);
    if (current.kind === 'overview') result.overview = lines;
    if (current.kind === 'step' && current.stepId) {
      const existing = result.steps.get(current.stepId);
      if (existing) existing.lines = lines;
    }
    buffer = [];
  };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/^﻿/, '');
    const stepMatch = line.match(STEP_MARK);
    if (stepMatch) {
      flush();
      const index = Number(stepMatch[1]) - 1;
      const step = steps[index];
      if (step) {
        result.steps.set(step.id, { title: cleanHeading(stepMatch[2]) || undefined, lines: [] });
        current = { kind: 'step', stepId: step.id };
      } else {
        current = { kind: 'none' };
      }
      continue;
    }
    if (/^##\s*概要/.test(line)) { flush(); current = { kind: 'overview' }; continue; }
    if (/^#\s+/.test(line) && !/^##/.test(line)) { flush(); result.title = cleanHeading(line.replace(/^#\s+/, '')) || undefined; current = { kind: 'none' }; continue; }
    if (/^```/.test(line.trim())) continue; // コードブロックの囲いは無視
    buffer.push(line);
  }
  flush();
  return result;
}

function cleanHeading(text: string): string {
  return text.replace(/^[〈<【\[]|[〉>】\]]$/g, '').trim();
}

/** 先頭の番号・記号・Markdown の箇条書きを取り除く（※ と □ と → は残す） */
export function cleanLine(line: string): string {
  let t = line.trim();
  if (!t) return '';
  // 「・」の箇条書きは残す（様式では番号なしの小項目として出す）。Markdown の - * は外す
  t = t.replace(/^(?:[-*]\s+)/, '');
  // AI が付けがちな「担当者は、」「作業者は、」は外す（手順書の読み手が行うことが前提）
  t = t.replace(/^(?:担当者|作業者|作業担当者)(?:は|が)[、,]?\s*/, '');
  t = t.replace(/^(?:\(?\d+[.)）]\s*)/, '');
  t = t.replace(/^(?:[（(]\d+[)）]\s*)/, '');
  // AI が付けがちな Markdown の飾りを外す: [表示](mailto:… や URL) → 表示、**太字** → 太字
  t = t.replace(/\[([^\]]+)\]\((?:mailto:)?[^)]*\)/g, '$1');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  return t.trim();
}

/** 書き直しが何ステップ分あるかの要約 */
export function summarizeRewritten(rewritten: RewrittenText, instruction: WorkInstruction): { replaced: number; total: number; missing: string[] } {
  const steps = [...instruction.steps].sort((a, b) => a.orderIndex - b.orderIndex);
  const missing: string[] = [];
  let replaced = 0;
  steps.forEach((step, index) => {
    const r = rewritten.steps.get(step.id);
    if (r && (r.lines.length > 0 || r.title)) replaced += 1;
    else missing.push(`${index + 1}. ${step.title || '（無題）'}`);
  });
  return { replaced, total: steps.length, missing };
}
