import { v4 as uuidv4 } from 'uuid';
import { Step, StepJump, JUMP_END_TARGET } from '../types/instruction';

/**
 * 「図で組み立てる分岐エディタ」のデータ層。
 * ステップ配列（既存の保存形式そのまま）から図を導き、図の操作をステップ配列の変更に落とす。
 * 条件グループ（conditions）を使う手順書は対象外（呼び出し側で判定する）。
 *
 * 進み先の決まり（ビューアと同じ）:
 *   endsBranch → 終了 / nextStepId → そのステップ / どちらも無ければ並び順で次のステップ / 最後なら終了
 *   jumps があるステップは質問（菱形）になり、各選択肢の targetStepId へ進む。
 */

export const START_NODE = '__flow_start__';
export const END_NODE = '__flow_end__';

export type FlowNodeKind = 'start' | 'end' | 'step' | 'question' | 'placeholder';

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  label: string;
  /** step / question / placeholder が属するステップID */
  stepId?: string;
  /** placeholder のとき、どの選択肢の先か */
  jumpIndex?: number;
  /** 開始からたどり着けないステップ */
  unreachable?: boolean;
}

export interface FlowEdge {
  from: string;
  to: string;
  label: string;
  /** 上のほうにある箱へ戻る線 */
  loop: boolean;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type Successor = { kind: 'end' } | { kind: 'step'; id: string };

export const questionNodeId = (stepId: string) => `q:${stepId}`;
export const placeholderNodeId = (stepId: string, jumpIndex: number) => `ph:${stepId}:${jumpIndex}`;

export function sortSteps(steps: Step[]): Step[] {
  return [...steps].sort((a, b) => a.orderIndex - b.orderIndex);
}

function renumber(steps: Step[]): Step[] {
  return steps.map((step, index) => ({ ...step, orderIndex: index }));
}

export function stepNumber(steps: Step[], stepId: string): number {
  return sortSteps(steps).findIndex((step) => step.id === stepId) + 1;
}

export function stepLabel(steps: Step[], step: Step): string {
  return `${stepNumber(steps, step.id)}. ${step.title || '（無題）'}`;
}

/** 並び順で次のステップのID（最後なら null） */
export function implicitNextId(steps: Step[], stepId: string): string | null {
  const sorted = sortSteps(steps);
  const index = sorted.findIndex((step) => step.id === stepId);
  if (index < 0 || index >= sorted.length - 1) return null;
  return sorted[index + 1].id;
}

/** 選択肢を使わない場合の進み先（通常ルート） */
export function successorOf(steps: Step[], step: Step): Successor {
  if (step.endsBranch) return { kind: 'end' };
  if (step.nextStepId && step.nextStepId !== step.id && steps.some((s) => s.id === step.nextStepId)) {
    return { kind: 'step', id: step.nextStepId };
  }
  const next = implicitNextId(steps, step.id);
  return next ? { kind: 'step', id: next } : { kind: 'end' };
}

export function hasBranch(step: Step): boolean {
  return (step.jumps?.length ?? 0) > 0;
}

export function createFlowStep(orderIndex: number): Step {
  return { id: uuidv4(), orderIndex, title: '', description: '' };
}

/** ステップ配列から図（箱と線）を作る。開始から深さ優先でたどり、答えの順番を保つ。 */
export function buildFlowGraph(input: Step[]): FlowGraph {
  const steps = sortSteps(input);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const have = new Set<string>();

  const addNode = (node: FlowNode) => {
    if (have.has(node.id)) return;
    have.add(node.id);
    nodes.push(node);
  };
  addNode({ id: START_NODE, kind: 'start', label: '開始' });

  const ensureEnd = () => addNode({ id: END_NODE, kind: 'end', label: '終了' });
  const ensureStep = (step: Step, unreachable = false) =>
    addNode({ id: step.id, kind: 'step', label: stepLabel(steps, step), stepId: step.id, unreachable });

  const visited = new Set<string>();
  const stack = new Set<string>();

  // 箱は「たどり着いた順」に登録する（深さ優先）。ELK は同じ段の箱をこの順に並べるので、
  // 答え1の枝全体が答え2の枝より左に来る。
  const visit = (step: Step) => {
    visited.add(step.id);
    stack.add(step.id);
    const outs: { from: string; target: string; label: string; jumpIndex?: number }[] = [];
    let from = step.id;
    if (hasBranch(step)) {
      const qid = questionNodeId(step.id);
      addNode({ id: qid, kind: 'question', label: step.branchQuestion || 'どちらに進む？', stepId: step.id });
      edges.push({ from: step.id, to: qid, label: '', loop: false });
      from = qid;
      (step.jumps ?? []).forEach((jump, index) => {
        outs.push({ from, target: jump.targetStepId, label: jump.label || `（答え${index + 1}）`, jumpIndex: index });
      });
      if (step.jumpDefaultLabel) {
        const succ = successorOf(steps, step);
        outs.push({ from, target: succ.kind === 'end' ? JUMP_END_TARGET : succ.id, label: step.jumpDefaultLabel });
      }
    } else {
      const succ = successorOf(steps, step);
      outs.push({ from, target: succ.kind === 'end' ? JUMP_END_TARGET : succ.id, label: '' });
    }
    for (const out of outs) {
      const targetStep = byId.get(out.target);
      if (out.target === JUMP_END_TARGET) {
        ensureEnd();
        edges.push({ from: out.from, to: END_NODE, label: out.label, loop: false });
      } else if (!targetStep) {
        const to = placeholderNodeId(step.id, out.jumpIndex ?? 0);
        addNode({ id: to, kind: 'placeholder', label: '＋ 次を追加', stepId: step.id, jumpIndex: out.jumpIndex });
        edges.push({ from: out.from, to, label: out.label, loop: false });
      } else {
        ensureStep(targetStep);
        edges.push({ from: out.from, to: targetStep.id, label: out.label, loop: stack.has(targetStep.id) });
        if (!visited.has(targetStep.id)) visit(targetStep);
      }
    }
    stack.delete(step.id);
  };

  if (steps.length === 0) {
    ensureEnd();
    edges.push({ from: START_NODE, to: END_NODE, label: '', loop: false });
  } else {
    ensureStep(steps[0]);
    edges.push({ from: START_NODE, to: steps[0].id, label: '', loop: false });
    visit(steps[0]);
  }
  for (const step of steps) {
    if (visited.has(step.id)) continue;
    ensureStep(step, true);
    visit(step);
  }
  return { nodes, edges };
}

// ---- 操作（すべて新しい配列を返す。orderIndex は振り直す） ----

export function setStepTitle(steps: Step[], stepId: string, title: string): Step[] {
  return steps.map((step) => (step.id === stepId ? { ...step, title } : step));
}

/** ステップの直後に新しいステップを挿入する。元の進み先（終了／明示の次）は新しいステップへ引き継ぐ。 */
export function addStepAfter(steps: Step[], afterId: string): { steps: Step[]; newId: string } {
  const sorted = sortSteps(steps);
  const index = sorted.findIndex((step) => step.id === afterId);
  const created = createFlowStep(0);
  if (index < 0) return { steps: renumber([...pinLastStep(sorted), created]), newId: created.id };
  const source = sorted[index];
  const inherited: Step = { ...created };
  if (source.endsBranch) inherited.endsBranch = true;
  if (source.nextStepId && source.nextStepId !== source.id) inherited.nextStepId = source.nextStepId;
  const updatedSource: Step = { ...source };
  delete updatedSource.endsBranch;
  delete updatedSource.nextStepId;
  const next = [...sorted];
  next[index] = updatedSource;
  next.splice(index + 1, 0, inherited);
  return { steps: renumber(next), newId: created.id };
}

/** 末尾のステップが「並び順で次」に頼って終了していた場合、末尾に追加しても進み先が変わらないよう明示の終了にする */
function pinLastStep(sorted: Step[]): Step[] {
  if (sorted.length === 0) return sorted;
  const last = sorted[sorted.length - 1];
  // 質問（jumps）のあるステップに endsBranch を付けるとビューアが選択肢より先に終了してしまうので触らない
  if (hasBranch(last) || last.endsBranch || (last.nextStepId && last.nextStepId !== last.id && sorted.some((s) => s.id === last.nextStepId))) return sorted;
  return [...sorted.slice(0, -1), { ...last, endsBranch: true }];
}

/** 選択肢の先に新しいステップを作る。末尾に追加し、その枝はいったん「終了」で止める。 */
export function addAnswerStep(steps: Step[], stepId: string, jumpIndex: number): { steps: Step[]; newId: string } {
  const sorted = pinLastStep(sortSteps(steps));
  const created: Step = { ...createFlowStep(sorted.length), endsBranch: true };
  const next = sorted.map((step) => {
    if (step.id !== stepId) return step;
    const jumps = (step.jumps ?? []).map((jump, index) => (index === jumpIndex ? { ...jump, targetStepId: created.id } : jump));
    return { ...step, jumps };
  });
  return { steps: renumber([...next, created]), newId: created.id };
}

/**
 * 選択肢の先に「質問だけのステップ」を作る（質問→質問をつなぐため）。
 * タイトル＝質問文、本文なし、答えは「はい」「いいえ」とも未設定。
 */
export function addAnswerQuestion(steps: Step[], stepId: string, jumpIndex: number, question = ''): { steps: Step[]; newId: string } {
  const result = addAnswerStep(steps, stepId, jumpIndex);
  const next = result.steps.map((s) => {
    if (s.id !== result.newId) return s;
    const updated: Step = {
      ...s,
      title: question,
      branchQuestion: question,
      jumps: [
        { id: uuidv4(), label: 'はい', targetStepId: '' },
        { id: uuidv4(), label: 'いいえ', targetStepId: '' },
      ],
    };
    delete updated.endsBranch;
    return updated;
  });
  return { steps: next, newId: result.newId };
}

/** 質問だけのステップ（タイトルが質問文と同じ、本文なし）かどうか */
export function isQuestionOnlyStep(step: Step): boolean {
  return hasBranch(step) && !step.description.trim() && step.title === (step.branchQuestion ?? '');
}

/** ステップを質問にする。答え1は元の進み先へ、答え2は未設定。 */
export function addBranch(steps: Step[], stepId: string): Step[] {
  const sorted = sortSteps(steps);
  const step = sorted.find((s) => s.id === stepId);
  if (!step || hasBranch(step)) return sorted;
  // 答え1は元の進み先を引き継ぐ。最後のステップ（並び順で終了していただけ）なら未設定にして「＋ 次を追加」を出す。
  const succ = successorOf(sorted, step);
  const inherited = step.endsBranch ? JUMP_END_TARGET : succ.kind === 'step' ? succ.id : '';
  const jumps: StepJump[] = [
    { id: uuidv4(), label: 'はい', targetStepId: inherited },
    { id: uuidv4(), label: 'いいえ', targetStepId: '' },
  ];
  return sorted.map((s) => {
    if (s.id !== stepId) return s;
    const updated: Step = { ...s, jumps, branchQuestion: s.branchQuestion ?? '' };
    delete updated.endsBranch;
    delete updated.nextStepId;
    delete updated.jumpDefaultLabel;
    return updated;
  });
}

/** 質問をやめる。答え1の先を通常ルートとして残す（他の枝は切り離される）。 */
export function removeBranch(steps: Step[], stepId: string): Step[] {
  const sorted = sortSteps(steps);
  return sorted.map((s) => {
    if (s.id !== stepId) return s;
    const first = s.jumps?.[0]?.targetStepId;
    const updated: Step = { ...s };
    delete updated.jumps;
    delete updated.branchQuestion;
    delete updated.jumpDefaultLabel;
    delete updated.endsBranch;
    delete updated.nextStepId;
    if (first === JUMP_END_TARGET) updated.endsBranch = true;
    else if (first && sorted.some((t) => t.id === first) && first !== implicitNextId(sorted, stepId)) updated.nextStepId = first;
    return updated;
  });
}

/** 質問文を変える。質問だけのステップならタイトルも同じ文に追従させる。 */
export function setBranchQuestion(steps: Step[], stepId: string, question: string): Step[] {
  return steps.map((step) => {
    if (step.id !== stepId) return step;
    const followTitle = isQuestionOnlyStep(step) || !step.title.trim();
    return { ...step, branchQuestion: question, title: followTitle ? question : step.title };
  });
}

export function setAnswer(steps: Step[], stepId: string, jumpIndex: number, patch: Partial<Pick<StepJump, 'label' | 'targetStepId'>>): Step[] {
  return steps.map((step) => {
    if (step.id !== stepId) return step;
    const jumps = (step.jumps ?? []).map((jump, index) => (index === jumpIndex ? { ...jump, ...patch } : jump));
    return { ...step, jumps };
  });
}

export function addAnswer(steps: Step[], stepId: string): Step[] {
  return steps.map((step) => (step.id === stepId ? { ...step, jumps: [...(step.jumps ?? []), { id: uuidv4(), label: '', targetStepId: '' }] } : step));
}

export function removeAnswer(steps: Step[], stepId: string, jumpIndex: number): Step[] {
  const step = steps.find((s) => s.id === stepId);
  if (!step) return steps;
  const jumps = (step.jumps ?? []).filter((_, index) => index !== jumpIndex);
  if (jumps.length === 0) return removeBranch(steps, stepId);
  return steps.map((s) => (s.id === stepId ? { ...s, jumps } : s));
}

/** 通常ルートの進み先を設定する。target は JUMP_END_TARGET（終了）かステップID。 */
export function setNext(steps: Step[], stepId: string, target: string): Step[] {
  const sorted = sortSteps(steps);
  return sorted.map((s) => {
    if (s.id !== stepId) return s;
    const updated: Step = { ...s };
    delete updated.endsBranch;
    delete updated.nextStepId;
    if (target === JUMP_END_TARGET) updated.endsBranch = true;
    else if (target && target !== stepId && target !== implicitNextId(sorted, stepId) && sorted.some((t) => t.id === target)) updated.nextStepId = target;
    return updated;
  });
}

/** ステップを削除する。削除したステップを指していた線は、そのステップの進み先へつなぎ直す。 */
export function removeStep(steps: Step[], stepId: string): Step[] {
  const sorted = sortSteps(steps);
  if (sorted.length <= 1) return sorted;
  const removed = sorted.find((s) => s.id === stepId);
  if (!removed) return sorted;
  const succ = hasBranch(removed)
    ? ({ kind: 'end' } as Successor)
    : successorOf(sorted, removed);
  const removedIndex = sorted.indexOf(removed);
  const remaining = sorted.filter((s) => s.id !== stepId);
  const replacementId = succ.kind === 'end' ? JUMP_END_TARGET : succ.id;
  // 並び順で削除ステップに進んでいた直前のステップも、同じ進み先へつなぎ直す
  const implicitPrev = removedIndex > 0 ? sorted[removedIndex - 1] : null;
  const fixed = remaining.map((s) => {
    let updated = s;
    if (implicitPrev && s.id === implicitPrev.id && !hasBranch(s) && !s.endsBranch && !(s.nextStepId && s.nextStepId !== s.id && sorted.some((t) => t.id === s.nextStepId))) {
      updated = { ...updated };
      delete updated.nextStepId;
      if (succ.kind === 'end') updated.endsBranch = true;
      else if (succ.id !== implicitNextId(remaining, s.id)) updated.nextStepId = succ.id;
    }
    if (s.jumps?.some((jump) => jump.targetStepId === stepId)) {
      updated = { ...updated, jumps: s.jumps.map((jump) => (jump.targetStepId === stepId ? { ...jump, targetStepId: replacementId } : jump)) };
    }
    if (s.nextStepId === stepId) {
      updated = { ...updated };
      delete updated.nextStepId;
      if (succ.kind === 'end') updated.endsBranch = true;
      else if (succ.id !== implicitNextId(remaining, s.id)) updated.nextStepId = succ.id;
    }
    return updated;
  });
  return renumber(fixed);
}
