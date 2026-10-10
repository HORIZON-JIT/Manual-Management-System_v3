import { v4 as uuidv4 } from 'uuid';
import { WorkInstruction } from '@/types/instruction';

export const TEMPLATE_TEMP_KEY = 'template_instruction';

/**
 * 既存の手順書をひな形にして「新しい手順書」を作る。
 * 本文・ステップ・分岐・条件はそのまま、id・Drive の紐づけ・更新履歴・承認・作成者情報は引き継がない。
 */
export function copyAsNewInstruction(source: WorkInstruction, options: { titleSuffix?: string } = {}): WorkInstruction {
  const suffix = options.titleSuffix ?? '（コピー）';
  const now = new Date().toISOString();
  const title = (source.title || '').trim();
  return {
    id: uuidv4(),
    title: title ? (title.endsWith(suffix) ? title : `${title}${suffix}`) : '',
    category: source.category,
    department: source.department,
    description: source.description,
    steps: (source.steps ?? []).map((step) => ({ ...step })),
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    keywords: source.keywords ? [...source.keywords] : undefined,
    conditions: source.conditions ? source.conditions.map((c) => ({ ...c })) : undefined,
    conditionGroups: source.conditionGroups ? source.conditionGroups.map((g) => ({ ...g })) : undefined,
    sequential: source.sequential,
  };
}
