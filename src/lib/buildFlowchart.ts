import { WorkInstruction, Step, Condition, getStepConditionIds } from '@/types/instruction';

function esc(text: string): string {
  return text.replace(/\"/g, '#quot;').replace(/[[\\]{}()]/g, '');
}

function wrapLabel(text: string, maxLength: number): string {
  const chunks: string[] = [];
  let current = '';

  for (const char of text) {
    current += char;
    if (current.length >= maxLength && /[\u3001\u3002\u30fb,.\s]/.test(char)) {
      chunks.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.join('<br/>');
}

function stepTitle(stepNum: Map<string, number>, step: Step): string {
  return `${stepNum.get(step.id)}. ${step.title}`;
}

function processLabel(stepNum: Map<string, number>, step: Step): string {
  return `\"${esc(wrapLabel(stepTitle(stepNum, step), 18))}\"`;
}

function decisionLabel(stepNum: Map<string, number>, step: Step): string {
  return `\"${esc(wrapLabel(stepTitle(stepNum, step), 14))}\"`;
}

function plainDecisionLabel(text: string): string {
  return `\"${esc(wrapLabel(text, 12))}\"`;
}

function terminalLabel(text: string): string {
  return `\"${esc(text)}\"`;
}

function pushHeader(lines: string[]) {
  lines.push('graph TD');
  lines.push('  classDef terminal fill:#F7FBFF,stroke:#4B8CF5,stroke-width:2px,color:#111827,font-size:18px,font-weight:600;');
  lines.push('  classDef process fill:#FFFFFF,stroke:#A3A3A3,stroke-width:1.5px,color:#111827,font-size:16px;');
  lines.push('  classDef decision fill:#FFF8E7,stroke:#E0A100,stroke-width:2px,color:#111827,font-size:16px;');
  lines.push(`  START((${terminalLabel('開始')})):::terminal`);
  lines.push(`  END((${terminalLabel('終了')})):::terminal`);
}

function buildStepMaps(instruction: WorkInstruction) {
  const steps = [...instruction.steps].sort((a, b) => a.orderIndex - b.orderIndex);
  const stepNum = new Map<string, number>();
  const stepIndex = new Map<string, number>();
  const stepById = new Map<string, Step>();
  steps.forEach((step, index) => {
    stepNum.set(step.id, index + 1);
    stepIndex.set(step.id, index);
    stepById.set(step.id, step);
  });
  return { steps, stepNum, stepIndex, stepById };
}

function canAutoFollow(source: Step, candidate: Step): boolean {
  const sourceConditionIds = getStepConditionIds(source);
  const candidateConditionIds = getStepConditionIds(candidate);

  if (candidateConditionIds.length === 0) return true;
  if (sourceConditionIds.length === 0) return false;

  const sourceContainsCandidate = candidateConditionIds.every((id) => sourceConditionIds.includes(id));
  const candidateContainsSource = sourceConditionIds.every((id) => candidateConditionIds.includes(id));
  return sourceContainsCandidate || candidateContainsSource;
}

function resolveFallbackNextStep(step: Step, steps: Step[], stepIndex: Map<string, number>): Step | null {
  const startIndex = stepIndex.get(step.id);
  if (startIndex === undefined) return null;

  for (let index = startIndex + 1; index < steps.length; index += 1) {
    const candidate = steps[index];
    if (canAutoFollow(step, candidate)) return candidate;
  }

  return null;
}

function buildLinear(steps: Step[], stepNum: Map<string, number>, stepIndex: Map<string, number>): string {
  const lines: string[] = [];
  pushHeader(lines);

  const nodeIds = new Map<string, string>();
  steps.forEach((step, index) => nodeIds.set(step.id, `s${index}`));

  const resolveNextId = (step: Step): string | null => {
    if (step.endsBranch) return null;
    if (step.nextStepId && step.nextStepId !== step.id && nodeIds.has(step.nextStepId)) {
      return nodeIds.get(step.nextStepId)!;
    }
    const fallback = resolveFallbackNextStep(step, steps, stepIndex);
    return fallback ? nodeIds.get(fallback.id)! : null;
  };

  steps.forEach((step, index) => {
    const id = nodeIds.get(step.id)!;
    const isDecision = !!(step.jumps?.length);
    lines.push(`  ${id}${isDecision ? `{${decisionLabel(stepNum, step)}}:::decision` : `(${processLabel(stepNum, step)}):::process`}`);

    if (index === 0) {
      lines.push(`  START --> ${id}`);
    }

    for (const jump of step.jumps ?? []) {
      const targetId = nodeIds.get(jump.targetStepId);
      if (targetId) lines.push(`  ${id} -- \"${esc(jump.label)}\" --> ${targetId}`);
    }

    const nextId = resolveNextId(step);
    if (nextId) {
      if (step.jumpDefaultLabel) {
        lines.push(`  ${id} -- \"${esc(step.jumpDefaultLabel)}\" --> ${nextId}`);
      } else {
        lines.push(`  ${id} --> ${nextId}`);
      }
    } else {
      lines.push(`  ${id} --> END`);
    }
  });

  return lines.join('\n');
}

export function buildFlowchartDefinition(instruction: WorkInstruction): string {
  const { steps, stepNum, stepIndex, stepById } = buildStepMaps(instruction);
  const conditions = instruction.conditions ?? [];

  if (steps.length === 0) {
    const lines: string[] = [];
    pushHeader(lines);
    lines.push('  START --> END');
    return lines.join('\n');
  }

  if (conditions.length === 0) {
    return buildLinear(steps, stepNum, stepIndex);
  }

  const lines: string[] = [];
  pushHeader(lines);

  const groupConditions = new Map<string, Condition[]>();
  const conditionGroup = new Map<string, string>();
  for (const condition of conditions) {
    const groupId = condition.group || '__default';
    conditionGroup.set(condition.id, groupId);
    if (!groupConditions.has(groupId)) groupConditions.set(groupId, []);
    groupConditions.get(groupId)!.push(condition);
  }

  const groupOrder: string[] = [];
  for (const condition of conditions) {
    const groupId = condition.group || '__default';
    if (!groupOrder.includes(groupId)) groupOrder.push(groupId);
  }

  const nodeIds = new Map<string, string>();
  steps.forEach((step, index) => nodeIds.set(step.id, `s${index}`));

  const branchAnchorByGroup = new Map<string, string>();
  const anchorStepIds = new Set<string>();
  let syntheticCounter = 0;

  const getBranchFirstStep = (conditionId: string): Step | null => {
    for (const step of steps) {
      if (getStepConditionIds(step).includes(conditionId)) return step;
    }
    return null;
  };

  for (const groupId of groupOrder) {
    const branchStarts = (groupConditions.get(groupId) ?? [])
      .map((condition) => getBranchFirstStep(condition.id))
      .filter((step): step is Step => !!step);

    if (branchStarts.length === 0) continue;

    const earliestIndex = Math.min(
      ...branchStarts.map((step) => stepIndex.get(step.id) ?? Number.MAX_SAFE_INTEGER),
    );

    if (earliestIndex > 0) {
      const anchorStep = steps[earliestIndex - 1];
      branchAnchorByGroup.set(groupId, nodeIds.get(anchorStep.id)!);
      anchorStepIds.add(anchorStep.id);
    } else {
      const syntheticId = `g${syntheticCounter++}`;
      branchAnchorByGroup.set(groupId, syntheticId);
      lines.push(`  ${syntheticId}{${plainDecisionLabel('条件分岐')}}:::decision`);
      lines.push(`  START --> ${syntheticId}`);
    }
  }

  const resolveNextStep = (step: Step): Step | null => {
    if (step.endsBranch) return null;
    if (step.nextStepId && step.nextStepId !== step.id) {
      const target = stepById.get(step.nextStepId);
      if (target) return target;
    }
    return resolveFallbackNextStep(step, steps, stepIndex);
  };

  steps.forEach((step, index) => {
    const id = nodeIds.get(step.id)!;
    const isDecision = anchorStepIds.has(step.id) || !!(step.jumps?.length);
    lines.push(`  ${id}${isDecision ? `{${decisionLabel(stepNum, step)}}:::decision` : `(${processLabel(stepNum, step)}):::process`}`);

    if (index === 0 && !anchorStepIds.has(step.id)) {
      lines.push(`  START --> ${id}`);
    }
  });

  for (const groupId of groupOrder) {
    const anchorId = branchAnchorByGroup.get(groupId);
    if (!anchorId) continue;

    for (const condition of groupConditions.get(groupId) ?? []) {
      const firstStep = getBranchFirstStep(condition.id);
      if (!firstStep) continue;
      lines.push(`  ${anchorId} -- \"${esc(condition.label)}\" --> ${nodeIds.get(firstStep.id)}`);
    }
  }

  for (const step of steps) {
    const id = nodeIds.get(step.id)!;

    for (const jump of step.jumps ?? []) {
      const targetId = nodeIds.get(jump.targetStepId);
      if (targetId) lines.push(`  ${id} -- \"${esc(jump.label)}\" --> ${targetId}`);
    }

    if (anchorStepIds.has(step.id)) continue;

    const nextStep = resolveNextStep(step);
    if (nextStep) {
      const nextId = nodeIds.get(nextStep.id)!;
      if (step.jumpDefaultLabel) {
        lines.push(`  ${id} -- \"${esc(step.jumpDefaultLabel)}\" --> ${nextId}`);
      } else {
        lines.push(`  ${id} --> ${nextId}`);
      }
    } else {
      lines.push(`  ${id} --> END`);
    }
  }

  return lines.join('\n');
}
