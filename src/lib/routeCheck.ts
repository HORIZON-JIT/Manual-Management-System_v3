import { Step, JUMP_END_TARGET } from '../types/instruction';
import { buildFlowGraph, sortSteps, START_NODE, END_NODE } from './flowModel';
import { computeRoute, groupConditionsOf, selectableGroupIds, DEFAULT_JUMP_VALUE, ConditionSelection, JumpSelection, RouteSource } from './routeEngine';

/**
 * 分岐の設計ミスを保存前に見つける。
 * - unreachable: どの答え（条件）を選んでも表示されないステップ
 * - unset-answer: 答えの進み先が未設定・削除済み
 * - broken-next: 「次はどこ？」が存在しないステップを指している
 * - no-exit: 戻る線だけで閉じていて「終了」にたどり着けない
 * - too-many: 組み合わせが多すぎて到達チェックを省いた（情報）
 */
export type RouteIssueKind = 'unreachable' | 'unset-answer' | 'broken-next' | 'no-exit' | 'too-many';

export interface RouteIssue {
  kind: RouteIssueKind;
  stepId?: string;
  message: string;
}

const MAX_COMBINATIONS = 512;

function name(steps: Step[], step: Step): string {
  return `〈${sortSteps(steps).findIndex((s) => s.id === step.id) + 1}. ${step.title || '（無題）'}〉`;
}

export function checkRoutes(source: RouteSource): RouteIssue[] {
  const steps = sortSteps(source.steps);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const issues: RouteIssue[] = [];
  if (steps.length === 0) return issues;

  // 未設定の答え・壊れた nextStepId
  for (const step of steps) {
    (step.jumps ?? []).forEach((jump, index) => {
      if (jump.targetStepId === JUMP_END_TARGET || byId.has(jump.targetStepId)) return;
      issues.push({ kind: 'unset-answer', stepId: step.id, message: `${name(steps, step)}の答え「${jump.label || `（答え${index + 1}）`}」の進み先が決まっていません。` });
    });
    if (step.nextStepId && step.nextStepId !== step.id && !byId.has(step.nextStepId)) {
      issues.push({ kind: 'broken-next', stepId: step.id, message: `${name(steps, step)}の「次はどこ？」が、存在しないステップを指しています。` });
    }
  }

  const conditions = source.conditions ?? [];
  if (conditions.length === 0) {
    // 図方式: グラフから到達不能と出口なしを判定
    const graph = buildFlowGraph(steps);
    const reported = new Set<string>();
    for (const node of graph.nodes) {
      if (!node.unreachable || !node.stepId || reported.has(node.stepId)) continue;
      reported.add(node.stepId);
      const step = byId.get(node.stepId);
      if (step) issues.push({ kind: 'unreachable', stepId: step.id, message: `${name(steps, step)}には、どの答えを選んでもたどり着けません。` });
    }
    // 終了（または未設定の枠）にたどり着けるノードを逆向きに集める
    const canExit = new Set<string>();
    const reverse = new Map<string, string[]>();
    for (const e of graph.edges) {
      if (!reverse.has(e.to)) reverse.set(e.to, []);
      reverse.get(e.to)!.push(e.from);
    }
    const queue: string[] = graph.nodes.filter((n) => n.kind === 'end' || n.kind === 'placeholder').map((n) => n.id);
    while (queue.length) {
      const id = queue.pop()!;
      if (canExit.has(id)) continue;
      canExit.add(id);
      for (const from of reverse.get(id) ?? []) queue.push(from);
    }
    // 開始から到達できるノード
    const forward = new Map<string, string[]>();
    for (const e of graph.edges) {
      if (!forward.has(e.from)) forward.set(e.from, []);
      forward.get(e.from)!.push(e.to);
    }
    const fromStart = new Set<string>();
    const q2 = [START_NODE];
    while (q2.length) {
      const id = q2.pop()!;
      if (fromStart.has(id)) continue;
      fromStart.add(id);
      for (const to of forward.get(id) ?? []) q2.push(to);
    }
    const noExit = new Set<string>();
    for (const node of graph.nodes) {
      if (!node.stepId || node.id === END_NODE) continue;
      if (fromStart.has(node.id) && !canExit.has(node.id)) noExit.add(node.stepId);
    }
    for (const stepId of noExit) {
      const step = byId.get(stepId);
      if (step) issues.push({ kind: 'no-exit', stepId, message: `${name(steps, step)}から先は「終了」にたどり着けません（戻る線だけで閉じています）。` });
    }
    return issues;
  }

  // 条件グループ方式: 閲覧画面で選べる組み合わせをすべて試し、一度も表示されないステップを探す
  const selectable = selectableGroupIds(source);
  const groups = groupConditionsOf(conditions).filter((g) => selectable.has(g.groupId));
  type Combo = { cond: ConditionSelection; jumps: JumpSelection };
  let combos: Combo[] = [{ cond: {}, jumps: {} }];
  for (const g of groups) {
    const next: Combo[] = [];
    for (const c of combos) for (const condition of g.conditions) next.push({ cond: { ...c.cond, [g.groupId]: condition.id }, jumps: c.jumps });
    combos = next;
    if (combos.length > MAX_COMBINATIONS) {
      issues.push({ kind: 'too-many', message: '条件の組み合わせが多いため、表示されないステップの確認は省きました。' });
      return issues;
    }
  }
  for (const s of steps.filter((x) => (x.jumps?.length ?? 0) > 0)) {
    const choices = (s.jumps ?? []).map((j) => j.targetStepId).filter((id) => id === JUMP_END_TARGET || byId.has(id));
    if (s.jumpDefaultLabel) choices.push(DEFAULT_JUMP_VALUE);
    if (choices.length === 0) continue;
    const next: Combo[] = [];
    for (const c of combos) for (const choice of choices) next.push({ cond: c.cond, jumps: { ...c.jumps, [s.id]: choice } });
    combos = next;
    if (combos.length > MAX_COMBINATIONS) {
      issues.push({ kind: 'too-many', message: '条件と答えの組み合わせが多いため、表示されないステップの確認は省きました。' });
      return issues;
    }
  }
  const seen = new Set<string>();
  for (const c of combos) for (const step of computeRoute(source, c.cond, c.jumps)) seen.add(step.id);
  for (const step of steps) {
    if (!seen.has(step.id)) issues.push({ kind: 'unreachable', stepId: step.id, message: `${name(steps, step)}は、どの条件・答えを選んでも表示されません。` });
  }
  return issues;
}
