import { v4 as uuidv4 } from 'uuid';
import { Step, StepJump, Condition, ConditionGroup, JUMP_END_TARGET } from '../types/instruction';
import { computeRoute, groupConditionsOf, selectableGroupIds, DEFAULT_JUMP_VALUE, ConditionSelection, JumpSelection } from './routeEngine';
import { implicitNextId, sortSteps } from './flowModel';

/**
 * 条件グループ（conditions / conditionGroups / 各ステップの表示条件）で表した分岐を、
 * 図で組み立てる方式（jumps / nextStepId / endsBranch）に変換する。
 *
 * やり方: 条件の選び方をすべて列挙して閲覧画面と同じ規則で経路を求め、
 * 「各ステップの次はどこか」を集める。次が一通りならそのまま、条件によって変わるなら
 * その条件グループを質問（jumps）にする。最後に、すべての選び方で変換前後の経路が
 * 一致することを確かめ、一致しなければ変換しない。
 */

export interface ConvertSource {
  steps: Step[];
  conditions?: Condition[];
  conditionGroups?: ConditionGroup[];
}

/** 閲覧画面で選べなかったため、先頭の条件に固定して変換したグループ */
export interface FixedGroup {
  /** グループの条件名（並び順） */
  conditions: string[];
  /** 採用した（先頭の）条件名 */
  chosen: string;
}

export type ConvertResult =
  | { ok: true; steps: Step[]; combinations: number; questions: number; fixedGroups: FixedGroup[] }
  | { ok: false; reason: string };

const MAX_COMBINATIONS = 512;
const END = JUMP_END_TARGET;

function stepName(step: Step | undefined, steps: Step[]): string {
  if (!step) return '?';
  return `${sortSteps(steps).findIndex((s) => s.id === step.id) + 1}. ${step.title || '（無題）'}`;
}

export function convertConditionsToFlow(source: ConvertSource): ConvertResult {
  const steps = sortSteps(source.steps);
  const conditions = source.conditions ?? [];
  const allGroups = groupConditionsOf(conditions);
  if (allGroups.length === 0) return { ok: true, steps, combinations: 1, questions: 0, fixedGroups: [] };
  // 閲覧画面で実際に選べるグループだけを列挙し、選べないグループは閲覧画面と同じく先頭の条件に固定する
  const selectable = selectableGroupIds(source);
  const groups = allGroups.filter((g) => selectable.has(g.groupId));
  const fixedGroups: FixedGroup[] = allGroups
    .filter((g) => !selectable.has(g.groupId))
    .map((g) => ({ conditions: g.conditions.map((c) => c.label || '（未入力）'), chosen: g.conditions[0]?.label || '（未入力）' }));

  // --- 選び方の列挙（条件グループ × 既存の選択肢） ---
  type Combo = { cond: ConditionSelection; jumps: JumpSelection };
  let combos: Combo[] = [{ cond: {}, jumps: {} }];
  for (const g of groups) {
    const next: Combo[] = [];
    for (const c of combos) for (const condition of g.conditions) next.push({ cond: { ...c.cond, [g.groupId]: condition.id }, jumps: c.jumps });
    combos = next;
    if (combos.length > MAX_COMBINATIONS) return { ok: false, reason: '条件の組み合わせが多すぎるため自動変換できません。' };
  }
  const jumpSteps = steps.filter((s) => (s.jumps?.length ?? 0) > 0);
  for (const s of jumpSteps) {
    const choices = (s.jumps ?? []).map((j) => j.targetStepId).filter(Boolean);
    if (s.jumpDefaultLabel) choices.push(DEFAULT_JUMP_VALUE);
    const next: Combo[] = [];
    for (const c of combos) for (const choice of choices) next.push({ cond: c.cond, jumps: { ...c.jumps, [s.id]: choice } });
    combos = next;
    if (combos.length > MAX_COMBINATIONS) return { ok: false, reason: '条件と選択肢の組み合わせが多すぎるため自動変換できません。' };
  }

  // --- 変換前の経路から「次はどこか」を集める ---
  const routes = combos.map((c) => ({ combo: c, route: computeRoute(source, c.cond, c.jumps) }));
  const successors = new Map<string, Map<string, Combo[]>>(); // stepId -> successorId(or END) -> combos
  const record = (from: string, to: string, combo: Combo) => {
    if (!successors.has(from)) successors.set(from, new Map());
    const m = successors.get(from)!;
    if (!m.has(to)) m.set(to, []);
    m.get(to)!.push(combo);
  };
  for (const { combo, route } of routes) {
    for (let i = 0; i < route.length; i++) {
      const s = route[i];
      if ((s.jumps?.length ?? 0) > 0) {
        // 既存の選択肢はそのまま残す。通常ルート（既定）の先だけ確認する
        if (combo.jumps[s.id] === DEFAULT_JUMP_VALUE) record(s.id, i + 1 < route.length ? route[i + 1].id : END, combo);
        continue;
      }
      if (s.endsBranch) continue;
      record(s.id, i + 1 < route.length ? route[i + 1].id : END, combo);
    }
  }

  // --- 新しいステップを組み立てる ---
  let questions = 0;
  const questionGroupByStep = new Map<string, string>();
  const converted: Step[] = steps.map((orig) => {
    const s: Step = { ...orig };
    delete s.conditionId;
    delete s.conditionIds;
    const succ = successors.get(orig.id);
    if (!succ) return s; // どの経路にも出てこない（到達不能）か、終了ステップ
    const targets = [...succ.keys()];
    if ((orig.jumps?.length ?? 0) > 0) {
      if (targets.length > 1) throw new ConvertError(`「${stepName(orig, steps)}」の通常ルートの進み先が条件によって変わるため自動変換できません。`);
      return s;
    }
    if (targets.length === 1) {
      applyNext(s, targets[0], steps);
      return s;
    }
    // 進み先が条件で変わる: それを決めている条件グループを探す
    const combosHere = targets.flatMap((t) => succ.get(t)!.map((c) => ({ t, c })));
    const explaining = groups.find((g) => {
      const byCondition = new Map<string, string>();
      for (const { t, c } of combosHere) {
        const cid = c.cond[g.groupId] as string;
        if (byCondition.has(cid) && byCondition.get(cid) !== t) return false;
        byCondition.set(cid, t);
      }
      return true;
    });
    if (!explaining) throw new ConvertError(`「${stepName(orig, steps)}」の次の進み先が複数の条件の組み合わせで決まっているため自動変換できません。`);
    const targetByCondition = new Map<string, string>();
    for (const { t, c } of combosHere) targetByCondition.set(c.cond[explaining.groupId] as string, t);
    const jumps: StepJump[] = explaining.conditions.map((condition) => ({
      id: uuidv4(),
      label: condition.label || '（未入力）',
      targetStepId: targetByCondition.get(condition.id) ?? END,
    }));
    s.jumps = jumps;
    questionGroupByStep.set(orig.id, explaining.groupId);
    if (s.branchQuestion === undefined) s.branchQuestion = '';
    delete s.nextStepId;
    delete s.endsBranch;
    delete s.jumpDefaultLabel;
    questions += 1;
    return s;
  });

  // --- 検証: すべての選び方で経路が一致すること ---
  const convertedById = new Map(converted.map((s) => [s.id, s]));
  for (const { combo, route } of routes) {
    const jumpSel: JumpSelection = { ...combo.jumps };
    for (const s of converted) {
      const groupId = questionGroupByStep.get(s.id);
      if (!groupId || !s.jumps?.length) continue; // 既存の選択肢は元の選び方をそのまま使う
      const g = groups.find((gr) => gr.groupId === groupId)!;
      const chosen = combo.cond[g.groupId] as string;
      const index = g.conditions.findIndex((c) => c.id === chosen);
      jumpSel[s.id] = s.jumps[index]?.targetStepId;
    }
    const after = computeRoute({ steps: converted }, {}, jumpSel);
    const a = route.map((s) => s.id).join('>');
    const b = after.map((s) => s.id).join('>');
    if (a !== b) {
      const firstDiff = route.find((s, i) => after[i]?.id !== s.id) ?? after[route.length];
      return { ok: false, reason: `変換前後で手順の流れが一致しないため自動変換できません（「${stepName(convertedById.get(firstDiff?.id ?? '') ?? firstDiff, steps)}」付近）。` };
    }
  }
  return { ok: true, steps: converted.map((s, i) => ({ ...s, orderIndex: i })), combinations: combos.length, questions, fixedGroups };
}

class ConvertError extends Error {}

/** 例外を結果型に畳み込む入口 */
export function tryConvertConditionsToFlow(source: ConvertSource): ConvertResult {
  try {
    return convertConditionsToFlow(source);
  } catch (e) {
    if (e instanceof ConvertError) return { ok: false, reason: e.message };
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

function applyNext(s: Step, target: string, steps: Step[]) {
  delete s.nextStepId;
  delete s.endsBranch;
  if (target === END) {
    if (implicitNextId(steps, s.id) !== null) s.endsBranch = true; // 最後のステップなら何も付けなくても終了
    return;
  }
  if (target !== implicitNextId(steps, s.id)) s.nextStepId = target;
}
