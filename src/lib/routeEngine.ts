import { Step, Condition, ConditionGroup, getStepConditionIds } from '../types/instruction';

/**
 * 閲覧画面（instructions/view）が「どのステップをどの順に表示するか」を決めるロジックの純粋関数版。
 * 条件グループ／親条件／選択肢（jumps）／nextStepId／endsBranch をすべて同じ規則で解釈する。
 * 閲覧画面の実装と同じ結果になることを前提に、条件グループ→図方式の変換の検証に使う。
 */

export const DEFAULT_JUMP_VALUE = '__default__';

export interface RouteSource {
  steps: Step[];
  conditions?: Condition[];
  conditionGroups?: ConditionGroup[];
}

export type ConditionSelection = Record<string, string | null | undefined>;
export type JumpSelection = Record<string, string | undefined>;

export function computeRoute(source: RouteSource, selectedConditions: ConditionSelection, selectedJumpTargets: JumpSelection): Step[] {
  const sortedSteps = [...source.steps].sort((a, b) => a.orderIndex - b.orderIndex);
  const conditions = source.conditions ?? [];

  const condGroupMap = new Map<string, string>();
  for (const condition of conditions) condGroupMap.set(condition.id, condition.group || '__default');

  const groupConditions = new Map<string, Condition[]>();
  for (const condition of conditions) {
    const groupId = condition.group || '__default';
    if (!groupConditions.has(groupId)) groupConditions.set(groupId, []);
    groupConditions.get(groupId)!.push(condition);
  }

  const groupOrder: string[] = [];
  for (const condition of conditions) {
    const groupId = condition.group || '__default';
    if (!groupOrder.includes(groupId)) groupOrder.push(groupId);
  }

  const stepIndex = new Map<string, number>();
  const stepById = new Map<string, Step>();
  sortedSteps.forEach((step, index) => {
    stepIndex.set(step.id, index);
    stepById.set(step.id, step);
  });

  const getStepGroups = (step: Step): string[] => {
    const groups: string[] = [];
    for (const conditionId of getStepConditionIds(step)) {
      const groupId = condGroupMap.get(conditionId);
      if (groupId && !groups.includes(groupId)) groups.push(groupId);
    }
    return groups;
  };

  const groupMetaMap = new Map<string, { parentConditionId?: string }>();
  for (const group of source.conditionGroups ?? []) groupMetaMap.set(group.id, group);

  const isGroupVisible = (groupId: string, visited = new Set<string>()): boolean => {
    if (visited.has(groupId)) return true;
    visited.add(groupId);
    const meta = groupMetaMap.get(groupId);
    if (!meta?.parentConditionId) return true;
    const parentGroupId = condGroupMap.get(meta.parentConditionId);
    if (!parentGroupId) return true;
    if (!isGroupVisible(parentGroupId, visited)) return false;
    const parentSelection = selectedConditions[parentGroupId];
    if (parentSelection === null || parentSelection === undefined) {
      const firstParentCondition = groupConditions.get(parentGroupId)?.[0];
      return firstParentCondition ? firstParentCondition.id === meta.parentConditionId : true;
    }
    return parentSelection === meta.parentConditionId;
  };

  const stepMatchesSelection = (step: Step): boolean => {
    const stepConditionIds = getStepConditionIds(step);
    if (stepConditionIds.length === 0) return true;
    const stepGroups = getStepGroups(step);
    if (stepGroups.length === 0) return true;
    if (stepGroups.some((groupId) => !isGroupVisible(groupId))) return false;
    return stepGroups.every((groupId) => {
      const selectedConditionId = selectedConditions[groupId];
      const activeConditionId = selectedConditionId ?? groupConditions.get(groupId)?.[0]?.id ?? null;
      if (!activeConditionId) return true;
      return stepConditionIds.includes(activeConditionId);
    });
  };

  const getBranchFirstStep = (conditionId: string): Step | null => {
    for (const step of sortedSteps) {
      if (getStepConditionIds(step).includes(conditionId) && stepMatchesSelection(step)) return step;
    }
    return null;
  };

  const branchAnchorByStepId = new Map<string, string[]>();
  for (const groupId of groupOrder) {
    const branchStarts = (groupConditions.get(groupId) ?? [])
      .map((condition) => sortedSteps.find((step) => getStepConditionIds(step).includes(condition.id)) ?? null)
      .filter((step): step is Step => !!step);
    if (branchStarts.length === 0) continue;
    const earliestIndex = Math.min(...branchStarts.map((step) => stepIndex.get(step.id) ?? Number.MAX_SAFE_INTEGER));
    const parentConditionId = groupMetaMap.get(groupId)?.parentConditionId;
    const parentAnchorStep = parentConditionId
      ? [...sortedSteps].slice(0, earliestIndex).reverse().find((step) => getStepConditionIds(step).includes(parentConditionId))
      : undefined;
    const anchorStep = parentAnchorStep ?? (earliestIndex > 0 ? sortedSteps[earliestIndex - 1] : null);
    if (anchorStep) {
      const current = branchAnchorByStepId.get(anchorStep.id) ?? [];
      branchAnchorByStepId.set(anchorStep.id, [...current, groupId]);
    }
  }

  const resolveBranchNextStep = (step: Step): Step | null => {
    for (const groupId of branchAnchorByStepId.get(step.id) ?? []) {
      if (!isGroupVisible(groupId)) continue;
      const options = groupConditions.get(groupId) ?? [];
      const activeConditionId = selectedConditions[groupId] ?? options[0]?.id ?? null;
      if (!activeConditionId) continue;
      const branchStep = getBranchFirstStep(activeConditionId);
      if (branchStep) return branchStep;
    }
    return null;
  };

  const resolveFallbackNextStep = (step: Step): Step | null => {
    const startIndex = stepIndex.get(step.id);
    if (startIndex === undefined) return null;
    for (let index = startIndex + 1; index < sortedSteps.length; index += 1) {
      const candidate = sortedSteps[index];
      if (!stepMatchesSelection(candidate)) continue;
      const sourceConditions = getStepConditionIds(step);
      const candidateConditions = getStepConditionIds(candidate);
      if (candidateConditions.length === 0) return candidate;
      if (sourceConditions.length === 0) return candidate;
      const sourceContainsCandidate = candidateConditions.every((id) => sourceConditions.includes(id));
      const candidateContainsSource = sourceConditions.every((id) => candidateConditions.includes(id));
      if (sourceContainsCandidate || candidateContainsSource) return candidate;
    }
    return null;
  };

  const visibleSteps: Step[] = [];
  const firstStep = sortedSteps.find((step) => stepMatchesSelection(step));
  if (!firstStep) return visibleSteps;
  const visited = new Set<string>();
  let current: Step | null = firstStep;
  while (current && !visited.has(current.id)) {
    visibleSteps.push(current);
    visited.add(current.id);
    if (current.endsBranch) break;
    const jumpOptions = current.jumps ?? [];
    const selectedJumpTarget: string | undefined = selectedJumpTargets[current.id];
    if (jumpOptions.length > 0 && !selectedJumpTarget) break;
    let nextStep: Step | null = null;
    if (jumpOptions.length > 0 && selectedJumpTarget !== DEFAULT_JUMP_VALUE) {
      nextStep = selectedJumpTarget ? stepById.get(selectedJumpTarget) ?? null : null;
      if (!nextStep) break;
    } else {
      nextStep = resolveBranchNextStep(current);
      if (!nextStep && current.nextStepId && current.nextStepId !== current.id) {
        const explicitTarget = stepById.get(current.nextStepId);
        if (explicitTarget && stepMatchesSelection(explicitTarget)) nextStep = explicitTarget;
      }
      if (!nextStep) nextStep = resolveFallbackNextStep(current);
    }
    current = nextStep;
  }
  return visibleSteps;
}

/** 条件グループごとの条件の一覧（並び順どおり） */
export function groupConditionsOf(conditions: Condition[]): { groupId: string; conditions: Condition[] }[] {
  const order: string[] = [];
  const map = new Map<string, Condition[]>();
  for (const condition of conditions) {
    const groupId = condition.group || '__default';
    if (!map.has(groupId)) { map.set(groupId, []); order.push(groupId); }
    map.get(groupId)!.push(condition);
  }
  return order.map((groupId) => ({ groupId, conditions: map.get(groupId)! }));
}
