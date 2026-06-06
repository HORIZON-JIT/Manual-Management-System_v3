'use client';

import { useEffect, useState, Suspense, Fragment } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  WorkInstruction,
  InstructionSnapshot,
  Step,
  getApprovalStatus,
  getCategoryLabel,
  getImageCaption,
  getStepConditionIds,
  getStepImages,
} from '@/types/instruction';
import { getInstruction } from '@/lib/storage';
import { getViewPageBaseUrl, parseShareData } from '@/lib/shareLink';
import { downloadDriveFile } from '@/lib/googleDrive';
import {
  isGoogleConfigured,
  getAuthState,
  addAuthListener,
  GoogleAuthState,
  signIn,
  initGoogleAuth,
} from '@/lib/googleAuth';
import { getTempData } from '@/lib/tempStorage';
import ViewHistoryModal from '@/components/ViewHistoryModal';
import FlowchartModal from '@/components/FlowchartModal';
import { VIEWER_ONLY } from '@/lib/appMode';

const DEFAULT_JUMP_VALUE = '__default__';

function InstructionViewContent() {
  const searchParams = useSearchParams();
  const [instruction, setInstruction] = useState<WorkInstruction | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSharedView, setIsSharedView] = useState(false);
  const [isPreviewView, setIsPreviewView] = useState(false);
  const [auth, setAuth] = useState<GoogleAuthState>(getAuthState());
  const [checkStates, setCheckStates] = useState<Record<string, Record<string, boolean>>>({});
  const [selectedConditions, setSelectedConditions] = useState<Record<string, string | null>>({});
  const [selectedJumpTargets, setSelectedJumpTargets] = useState<Record<string, string>>({});
  const [scrollTargetStepId, setScrollTargetStepId] = useState<string | null>(null);
  const [chapterTargetStepId, setChapterTargetStepId] = useState<string | null>(null);
  const [revealedCount, setRevealedCount] = useState(1);
  const [showHistory, setShowHistory] = useState(false);
  const [showApprovalHistory, setShowApprovalHistory] = useState(false);
  const [showFlowchart, setShowFlowchart] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showChapters, setShowChapters] = useState(false);
  const [viewingSnapshot, setViewingSnapshot] = useState<InstructionSnapshot | null>(null);
  const [viewUrlCopied, setViewUrlCopied] = useState(false);
  const [expandedStepDetails, setExpandedStepDetails] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isGoogleConfigured()) return;
    return addAuthListener(setAuth);
  }, []);

  useEffect(() => {
    const openSearch = () => setShowSearch(true);
    window.addEventListener('open-instruction-search', openSearch);
    return () => window.removeEventListener('open-instruction-search', openSearch);
  }, []);

  useEffect(() => {
    // 再フェッチ中（ログイン状態の確定後の再実行など）に「見つかりません」が
    // 一瞬表示されるのを防ぐため、毎回ローディングを立て直す
    setLoading(true);
    setCheckStates({});
    setSelectedConditions({});
    setSelectedJumpTargets({});
    setExpandedStepDetails({});
    setScrollTargetStepId(null);
    setChapterTargetStepId(null);
    setRevealedCount(1);

    if (window.location.hash) {
      const shared = parseShareData(window.location.hash);
      if (shared) {
        setInstruction(shared);
        setIsSharedView(true);
        setLoading(false);
        return;
      }
    }

    if (searchParams.get('source') === 'preview') {
      getTempData('preview_instruction')
        .then((raw) => {
          if (raw) {
            try {
              setInstruction(JSON.parse(raw) as WorkInstruction);
              setIsPreviewView(true);
            } catch {
              // fall through
            }
          }
          setLoading(false);
        })
        .catch(() => setLoading(false));
      return;
    }

    const driveFileId = searchParams.get('driveFileId');
    if (driveFileId) {
      initGoogleAuth()
        .then(() => {
          const state = getAuthState();
          if (!state.isSignedIn) {
            setLoading(false);
            return;
          }
          return downloadDriveFile(driveFileId)
            .then((text) => {
              const data = JSON.parse(text) as WorkInstruction;
              setInstruction(data);
            })
            .catch(() => setInstruction(null));
        })
        .finally(() => setLoading(false));
      return;
    }

    const id = searchParams.get('id');
    if (id) {
      const data = getInstruction(id);
      setInstruction(data || null);
    }
    setLoading(false);
  }, [searchParams, auth.isSignedIn]);

  useEffect(() => {
    if (!scrollTargetStepId) return;
    const target = document.getElementById(`step-${scrollTargetStepId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setScrollTargetStepId(null);
  }, [scrollTargetStepId, revealedCount, selectedJumpTargets]);

  const handlePrint = () => {
    window.print();
  };

  const appViewUrl = (() => {
    const driveFileId = searchParams.get('driveFileId') || instruction?.driveFileId;
    return driveFileId ? `${getViewPageBaseUrl()}?driveFileId=${driveFileId}` : null;
  })();
  const editUrl = (() => {
    const driveFileId = searchParams.get('driveFileId') || instruction?.driveFileId;
    if (driveFileId) {
      return `/instructions/edit?source=drive&driveFileId=${encodeURIComponent(driveFileId)}`;
    }
    return `/instructions/edit?id=${instruction?.id}`;
  })();

  const handleCopyViewUrl = async () => {
    if (!appViewUrl) return;
    await navigator.clipboard.writeText(appViewUrl);
    setViewUrlCopied(true);
    setTimeout(() => setViewUrlCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-slate-500">読み込み中...</p>
      </div>
    );
  }

  if (!instruction) {
    const driveFileId = searchParams.get('driveFileId');
    if (driveFileId && !auth.isSignedIn) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 px-4">
          <p className="text-slate-700 text-base font-medium">
            この手順書を閲覧するにはGoogleログインが必要です
          </p>
          {isGoogleConfigured() && (
            <button
              onClick={() => signIn()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition"
            >
              Googleでログイン
            </button>
          )}
          <Link href="/" className="text-sm text-blue-600 hover:text-blue-800">
            ホームへ戻る
          </Link>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <p className="text-slate-500 text-lg">手順書が見つかりません</p>
        <Link href="/" className="text-blue-600 hover:text-blue-800">
          ホームへ戻る
        </Link>
      </div>
    );
  }

  const sortedSteps = [...(viewingSnapshot?.steps ?? instruction.steps)].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );
  const displayTitle = viewingSnapshot?.title ?? instruction.title;
  const displayDescription = viewingSnapshot?.description ?? instruction.description;
  const displayCategory = viewingSnapshot?.category ?? instruction.category;
  const displayKeywords = viewingSnapshot?.keywords ?? instruction.keywords;
  const hasConditions = !!instruction.conditions?.length;
  const isSequential = !!instruction.sequential;

  const condGroupMap = new Map<string, string>();
  for (const condition of instruction.conditions ?? []) {
    condGroupMap.set(condition.id, condition.group || '__default');
  }

  const groupConditions = new Map<string, NonNullable<WorkInstruction['conditions']>>();
  for (const condition of instruction.conditions ?? []) {
    const groupId = condition.group || '__default';
    if (!groupConditions.has(groupId)) groupConditions.set(groupId, []);
    groupConditions.get(groupId)!.push(condition);
  }

  const groupOrder: string[] = [];
  for (const condition of instruction.conditions ?? []) {
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

  const getPrimaryStepGroup = (step: Step) => getStepGroups(step)[0];

  const groupMetaMap = new Map<string, { parentConditionId?: string }>();
  for (const group of instruction.conditionGroups ?? []) {
    groupMetaMap.set(group.id, group);
  }

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
      if (getStepConditionIds(step).includes(conditionId) && stepMatchesSelection(step)) {
        return step;
      }
    }
    return null;
  };

  const branchAnchorByStepId = new Map<string, string[]>();
  for (const groupId of groupOrder) {
    const branchStarts = (groupConditions.get(groupId) ?? [])
      .map((condition) =>
        sortedSteps.find((step) => getStepConditionIds(step).includes(condition.id)) ?? null,
      )
      .filter((step): step is Step => !!step);

    if (branchStarts.length === 0) continue;

    const earliestIndex = Math.min(
      ...branchStarts.map((step) => stepIndex.get(step.id) ?? Number.MAX_SAFE_INTEGER),
    );

    const parentConditionId = groupMetaMap.get(groupId)?.parentConditionId;
    const parentAnchorStep = parentConditionId
      ? [...sortedSteps]
          .slice(0, earliestIndex)
          .reverse()
          .find((step) => getStepConditionIds(step).includes(parentConditionId))
      : undefined;
    const anchorStep = parentAnchorStep ?? (earliestIndex > 0 ? sortedSteps[earliestIndex - 1] : null);

    if (anchorStep) {
      const current = branchAnchorByStepId.get(anchorStep.id) ?? [];
      branchAnchorByStepId.set(anchorStep.id, [...current, groupId]);
    }
  }

  const resolveBranchNextStep = (step: Step): Step | null => {
    const branchGroups = branchAnchorByStepId.get(step.id) ?? [];
    for (const groupId of branchGroups) {
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
  if (firstStep) {
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
        nextStep = stepById.get(selectedJumpTarget) ?? null;
        if (!nextStep) break;
      } else {
        nextStep = resolveBranchNextStep(current);
        if (!nextStep && current.nextStepId && current.nextStepId !== current.id) {
          const explicitTarget = stepById.get(current.nextStepId);
          if (explicitTarget && stepMatchesSelection(explicitTarget)) {
            nextStep = explicitTarget;
          }
        }

        if (!nextStep) {
          nextStep = resolveFallbackNextStep(current);
        }
      }

      current = nextStep;
    }
  }

  const stepNumbers: number[] = [];
  let logicalNumber = 0;
  const seenGroups = new Set<string>();
  for (const step of visibleSteps) {
    const groupId = getPrimaryStepGroup(step);
    if (groupId) {
      if (!seenGroups.has(groupId)) {
        logicalNumber += 1;
        seenGroups.add(groupId);
      }
    } else {
      logicalNumber += 1;
    }
    stepNumbers.push(logicalNumber);
  }

  const handleConditionSelect = (groupId: string, conditionId: string, visibleIndex: number) => {
    const activeConditionId = selectedConditions[groupId] ?? groupConditions.get(groupId)?.[0]?.id;
    const branchChanged = activeConditionId !== conditionId;

    setSelectedConditions((previous) => ({ ...previous, [groupId]: conditionId }));
    if (isSequential && branchChanged) {
      setRevealedCount((count) => Math.min(count, visibleIndex + 1));
    }
  };

  const pendingJumpStepId =
    visibleSteps.length > 0 &&
    (visibleSteps[visibleSteps.length - 1].jumps?.length ?? 0) > 0 &&
    !selectedJumpTargets[visibleSteps[visibleSteps.length - 1].id]
      ? visibleSteps[visibleSteps.length - 1].id
      : null;

  const handleJumpSelect = (stepId: string, targetStepId: string, visibleIndex: number) => {
    setChapterTargetStepId(null);
    setSelectedJumpTargets((previous) => ({ ...previous, [stepId]: targetStepId }));
    setScrollTargetStepId(targetStepId === DEFAULT_JUMP_VALUE ? null : targetStepId);
    if (isSequential) {
      setRevealedCount((count) => Math.max(count, visibleIndex + 2));
    }
  };

  const routeSteps = isSequential ? visibleSteps.slice(0, revealedCount) : visibleSteps;
  const chapterTargetStep = chapterTargetStepId ? stepById.get(chapterTargetStepId) : undefined;
  const displayedSteps =
    chapterTargetStep && !routeSteps.some((step) => step.id === chapterTargetStep.id)
      ? [...routeSteps, chapterTargetStep]
      : routeSteps;
  const chapterStepNumbers = new Map(sortedSteps.map((step, index) => [step.id, index + 1]));
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const searchResults = normalizedSearchQuery
    ? sortedSteps.filter((step) => {
        const searchText = [
          step.title,
          step.description,
          step.detailDescription,
          step.caution,
          ...(step.checkItems ?? []).map((item) => item.label),
          ...(step.imageCaptions ?? []),
          ...(step.links ?? []).map((link) => link.label),
        ]
          .filter(Boolean)
          .join('\n')
          .toLocaleLowerCase();
        return searchText.includes(normalizedSearchQuery);
      })
    : [];

  const scrollToStep = (step: Step) => {
    const targetConditions = getStepConditionIds(step);
    if (targetConditions.length > 0) {
      setSelectedConditions((previous) => {
        const next = { ...previous };
        for (const conditionId of targetConditions) {
          const groupId = condGroupMap.get(conditionId);
          if (groupId) next[groupId] = conditionId;
        }
        return next;
      });
    }
    setSelectedJumpTargets({});
    setRevealedCount(sortedSteps.length);
    setChapterTargetStepId(step.id);
    setScrollTargetStepId(step.id);
    setShowChapters(false);
  };

  return (
    <div className="mx-auto grid max-w-[104rem] gap-8 px-4 py-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)]">
      <main className="min-w-0 w-full">
      <div className="flex flex-wrap items-center gap-2 mb-6 no-print">
        <div className="flex-1" />
        {appViewUrl && !VIEWER_ONLY && (
          <button
            onClick={handleCopyViewUrl}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-100 transition"
          >
            {viewUrlCopied ? 'URLをコピー済み' : 'アプリ閲覧URL'}
          </button>
        )}
        {instruction.updateHistory && instruction.updateHistory.some((entry) => !!entry.snapshot) && (
          <button
            onClick={() => setShowHistory(true)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-100 transition"
          >
            更新履歴
          </button>
        )}
        {instruction.approval?.history && instruction.approval.history.length > 0 && (
          <button
            onClick={() => setShowApprovalHistory(true)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-100 transition"
          >
            承認履歴
          </button>
        )}
        <button
          onClick={() => setShowFlowchart(true)}
          className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-100 transition"
        >
          フロー図
        </button>
        {!isPreviewView && (
          <button
            onClick={handlePrint}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-100 transition"
          >
            印刷
          </button>
        )}
        {!isSharedView && !isPreviewView && !VIEWER_ONLY && (
          <Link
            href={editUrl}
            className="px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg text-sm hover:from-blue-600 hover:to-indigo-600 transition shadow-sm"
          >
            編集
          </Link>
        )}
      </div>

      {viewingSnapshot && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between no-print">
          <p className="text-sm text-amber-800">過去バージョンを表示中です</p>
          <button
            onClick={() => setViewingSnapshot(null)}
            className="px-3 py-1.5 bg-amber-600 text-white rounded text-sm hover:bg-amber-700 transition"
          >
            現在のバージョンに戻る
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">{displayTitle}</h1>
          <span
            className={`shrink-0 text-sm px-3 py-1 rounded-full font-medium ${
              displayCategory === 'pc_work' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'
            }`}
          >
            {getCategoryLabel(displayCategory)}
          </span>
        </div>
        {displayDescription && <p className="text-slate-600 mb-4">{displayDescription}</p>}
        <div className="text-xs text-slate-400 flex flex-wrap gap-4">
          {instruction.department && <span>部署: {instruction.department}</span>}
          <span>
            作成日: {new Date(instruction.createdAt).toLocaleDateString('ja-JP')}
            {instruction.createdBy ? ` (${instruction.createdBy})` : ''}
          </span>
          <span>
            更新日: {new Date(instruction.updatedAt).toLocaleDateString('ja-JP')}
            {instruction.updatedBy ? ` (${instruction.updatedBy})` : ''}
          </span>
          <span>{sortedSteps.length} ステップ</span>
        </div>
        {displayKeywords && displayKeywords.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {displayKeywords.map((keyword, index) => (
              <span
                key={`${keyword}-${index}`}
                className="inline-block text-xs px-2.5 py-1 bg-slate-100 text-slate-600 rounded-full border border-slate-200"
              >
                {keyword}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {displayedSteps.map((step, index) => {
          const previousStep = index > 0 ? visibleSteps[index - 1] : null;
          const groupId = getPrimaryStepGroup(step);
          const previousGroupId = previousStep ? getPrimaryStepGroup(previousStep) : undefined;
          const showInlineTabs = hasConditions && !!groupId && groupId !== previousGroupId;
          const groupOptions = groupId ? groupConditions.get(groupId) ?? [] : [];
          const selectedGroupCondition = groupId ? (selectedConditions[groupId] ?? null) : null;
          const isLastRevealed = isSequential && index === Math.min(revealedCount, visibleSteps.length) - 1;
          const awaitingJumpChoice = pendingJumpStepId === step.id;

          return (
            <Fragment key={step.id}>
              {showInlineTabs && groupId && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 no-print">
                  <p className="text-sm font-semibold text-slate-800">条件を選択</p>
                  <p className="mt-1 text-xs text-slate-500">
                    該当する条件を選ぶと、その条件に沿った手順を表示します。
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {groupOptions.map((condition, conditionIndex) => {
                      const isActive =
                        selectedGroupCondition === condition.id ||
                        (selectedGroupCondition === null && conditionIndex === 0);
                      return (
                        <button
                          key={condition.id}
                          onClick={() => handleConditionSelect(groupId, condition.id, index)}
                          className={`rounded-lg border px-4 py-3 text-left text-sm font-semibold transition ${
                            isActive
                              ? 'border-slate-950 bg-slate-950 text-white'
                              : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400'
                          }`}
                        >
                          {condition.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div id={`step-${step.id}`} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-gradient-to-r from-slate-50 to-blue-50/50 px-5 py-3.5 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-950 text-sm font-bold text-white shadow-sm shrink-0">
                      {stepNumbers[index]}
                    </span>
                    <h2 className="font-semibold text-slate-800 flex-1">{step.title}</h2>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  {step.description && (
                    <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{step.description}</p>
                  )}

                  {step.detailDescription && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedStepDetails((current) => ({
                            ...current,
                            [step.id]: !current[step.id],
                          }))
                        }
                        className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-slate-800 transition hover:text-blue-700"
                        aria-expanded={!!expandedStepDetails[step.id]}
                        aria-controls={`step-detail-${step.id}`}
                      >
                        <span>詳細説明</span>
                        <svg
                          className={`h-4 w-4 shrink-0 transition ${
                            expandedStepDetails[step.id] ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {expandedStepDetails[step.id] && (
                        <div
                          id={`step-detail-${step.id}`}
                          className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-700"
                        >
                          <p className="whitespace-pre-wrap">{step.detailDescription}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {getStepImages(step).map((imgUrl, imgIdx) => (
                    <div key={imgIdx} className="rounded-lg border border-slate-200 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imgUrl}
                        alt={`ステップ${stepNumbers[index]} の画像 ${imgIdx + 1}`}
                        className="max-w-full h-auto mx-auto"
                      />
                      {getImageCaption(step, imgIdx) && (
                        <p className="px-3 py-2 text-sm text-slate-600 bg-slate-50 border-t border-slate-200">
                          {getImageCaption(step, imgIdx)}
                        </p>
                      )}
                    </div>
                  ))}

                  {step.links && step.links.length > 0 && (
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 space-y-1.5">
                      <p className="text-xs font-medium text-indigo-700 mb-1">関連リンク</p>
                      {step.links.map((link) => {
                        const href =
                          link.type === 'instruction'
                            ? link.driveFileId
                              ? `/instructions/view?driveFileId=${link.driveFileId}`
                              : `/instructions/view?id=${link.instructionId}`
                            : link.url;
                        return (
                          <a
                            key={link.id}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 transition"
                          >
                            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                              />
                            </svg>
                            {link.label}
                          </a>
                        );
                      })}
                    </div>
                  )}

                  {step.jumps && step.jumps.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-sm font-semibold text-slate-800">次の進行を選択</p>
                      <p className="mt-1 text-xs text-slate-500">該当する内容を選ぶと、その先の手順を表示します。</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {step.jumps.map((jump) => {
                        const targetStep = sortedSteps.find((candidate) => candidate.id === jump.targetStepId);
                        const isSelected = selectedJumpTargets[step.id] === jump.targetStepId;
                        return (
                          <button
                            key={jump.id}
                            type="button"
                            onClick={() => handleJumpSelect(step.id, jump.targetStepId, index)}
                            className={`rounded-lg border px-4 py-3 text-left transition ${
                              isSelected
                                ? 'border-slate-950 bg-slate-950 text-white'
                                : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400'
                            }`}
                          >
                            <span className="block text-sm font-semibold">{jump.label}</span>
                            {targetStep && (
                              <span className={`mt-1 block text-xs ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                                {targetStep.title}
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {step.jumpDefaultLabel && (
                        <button
                          type="button"
                          onClick={() => handleJumpSelect(step.id, DEFAULT_JUMP_VALUE, index)}
                          className={`rounded-lg border px-4 py-3 text-left transition ${
                            selectedJumpTargets[step.id] === DEFAULT_JUMP_VALUE
                              ? 'border-slate-950 bg-slate-950 text-white'
                              : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400'
                          }`}
                        >
                          <span className="block text-sm font-semibold">{step.jumpDefaultLabel}</span>
                          <span
                            className={`mt-1 block text-xs ${
                              selectedJumpTargets[step.id] === DEFAULT_JUMP_VALUE ? 'text-slate-300' : 'text-slate-500'
                            }`}
                          >
                            通常の次に進む先
                          </span>
                        </button>
                      )}
                      </div>
                    </div>
                  )}

                  {step.caution && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                      <div className="flex items-start gap-1.5 text-sm text-amber-800 font-medium">
                        <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                          />
                        </svg>
                        <p className="whitespace-pre-wrap leading-6">注意: {step.caution}</p>
                      </div>
                    </div>
                  )}

                  {step.checkItems && step.checkItems.length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 space-y-2">
                      <p className="text-xs font-medium text-blue-700 mb-1">チェック項目</p>
                      {step.checkItems.map((item) => (
                        <label key={item.id} className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={checkStates[step.id]?.[item.id] ?? false}
                            onChange={(event) => {
                              setCheckStates((prev) => ({
                                ...prev,
                                [step.id]: {
                                  ...(prev[step.id] ?? {}),
                                  [item.id]: event.target.checked,
                                },
                              }));
                            }}
                            className="w-4 h-4 rounded border-blue-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span
                            className="text-sm text-blue-800"
                            style={
                              checkStates[step.id]?.[item.id]
                                ? { textDecoration: 'line-through', opacity: 0.5 }
                                : undefined
                            }
                          >
                            {item.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {isLastRevealed && (
                <div className="flex items-center justify-between no-print">
                  <span className="text-sm text-slate-500">
                    {stepNumbers[index]} / {stepNumbers[visibleSteps.length - 1]} ステップ
                  </span>
                  {awaitingJumpChoice ? (
                    <span className="px-4 py-2.5 text-sm font-medium text-slate-500">
                      進行先を選択してください
                    </span>
                  ) : revealedCount < visibleSteps.length ? (
                    <button
                      onClick={() => setRevealedCount((count) => count + 1)}
                      className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow transition"
                    >
                      次へ
                    </button>
                  ) : (
                    <span className="px-6 py-2.5 bg-emerald-100 text-emerald-700 font-bold rounded-xl">
                      完了
                    </span>
                  )}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {(!isSequential || revealedCount >= visibleSteps.length) && !pendingJumpStepId && (
        <div className="text-center py-6">
          <p className="text-sm font-medium text-emerald-600">全ステップ完了</p>
        </div>
      )}

      {showHistory && instruction.updateHistory && (
        <ViewHistoryModal
          history={instruction.updateHistory}
          currentTitle={instruction.title}
          currentStepCount={instruction.steps.length}
          createdAt={instruction.createdAt}
          onView={(snapshot) => {
            setViewingSnapshot(snapshot);
            setShowHistory(false);
          }}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showApprovalHistory && instruction.approval?.history && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 no-print" onClick={() => setShowApprovalHistory(false)}>
          <section
            className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-gray-800">承認履歴</h2>
                <p className="mt-1 text-xs text-gray-500">
                  現在状態: {getApprovalStatus(instruction) === 'approved' ? '承認済み' : getApprovalStatus(instruction) === 'needs_reapproval' ? '要再承認' : '未承認'}
                </p>
              </div>
              <button
                onClick={() => setShowApprovalHistory(false)}
                className="text-2xl leading-none text-gray-400 hover:text-gray-600"
              >
                &times;
              </button>
            </div>
            <div className="space-y-3 overflow-y-auto px-6 py-4">
              {[...instruction.approval.history].reverse().map((entry, index) => (
                <div key={`${entry.actedAt}-${index}`} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      entry.action === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {entry.action === 'approved' ? '承認' : '承認取消'}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(entry.actedAt).toLocaleString('ja-JP')}
                    </span>
                    <span className="text-xs text-gray-500">v{entry.revision + 1}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-gray-700">
                    {entry.userName || 'Googleユーザー'}
                  </p>
                  {entry.userEmail && <p className="break-all text-xs text-gray-500">{entry.userEmail}</p>}
                  {entry.reason && (
                    <p className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
                      理由: {entry.reason}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="border-t border-gray-200 px-6 py-3">
              <button
                onClick={() => setShowApprovalHistory(false)}
                className="w-full py-2 text-sm text-gray-500 transition hover:text-gray-700"
              >
                閉じる
              </button>
            </div>
          </section>
        </div>
      )}

      {showFlowchart && (
        <FlowchartModal instruction={instruction} onClose={() => setShowFlowchart(false)} />
      )}
      {showSearch && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-neutral-950/35 px-4 pt-24 no-print">
          <section className="w-full max-w-xl rounded-lg border border-neutral-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-950">手順書内を検索</h2>
                <p className="mt-1 text-xs text-slate-500">分岐に関係なく、全ステップを検索します。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSearch(false)}
                className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="検索を閉じる"
              >
                &times;
              </button>
            </div>
            <div className="p-5">
              <input
                autoFocus
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="検索する単語を入力"
                className="w-full rounded-md border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-slate-400"
              />
              <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
                {normalizedSearchQuery && searchResults.length === 0 && (
                  <p className="rounded-md bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                    該当するステップがありません。
                  </p>
                )}
                {searchResults.map((step) => (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => {
                      scrollToStep(step);
                      setShowSearch(false);
                    }}
                    className="flex w-full items-start gap-3 rounded-md border border-slate-200 px-4 py-3 text-left transition hover:border-slate-400 hover:bg-slate-50"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-600">
                      {chapterStepNumbers.get(step.id)}
                    </span>
                    <span className="text-sm font-semibold text-slate-800">{step.title || '未入力のステップ'}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
      </main>

      <aside className="order-first no-print hidden min-w-0 lg:block">
        {showChapters ? (
        <nav className="sticky top-24 w-full rounded-lg border border-slate-200 bg-white p-4 shadow-[0_18px_44px_rgba(15,23,42,0.10)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Chapter</p>
              <h2 className="mt-2 text-base font-semibold text-slate-900">ステップ一覧</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowChapters(false)}
              className="rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="ステップ一覧を閉じる"
            >
              &times;
            </button>
          </div>
          <div className="mt-4 max-h-[calc(100vh-13rem)] space-y-1 overflow-y-auto pr-1">
            {sortedSteps.map((step) => (
              <button
                key={step.id}
                type="button"
                onClick={() => scrollToStep(step)}
                className="group flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-slate-50"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-600 transition group-hover:bg-slate-950 group-hover:text-white">
                  {chapterStepNumbers.get(step.id)}
                </span>
                <span className="pt-0.5 text-sm font-medium leading-5 text-slate-700 group-hover:text-slate-950">
                  {step.title || '未入力のステップ'}
                </span>
              </button>
            ))}
          </div>
        </nav>
        ) : (
          <button
            type="button"
            onClick={() => setShowChapters(true)}
            className="sticky top-24 flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_12px_32px_rgba(15,23,42,0.08)] transition hover:border-slate-300 hover:bg-slate-50"
          >
            <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            目次
          </button>
        )}
      </aside>
    </div>
  );
}

export default function InstructionViewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[50vh]">
          <p className="text-slate-500">読み込み中...</p>
        </div>
      }
    >
      <InstructionViewContent />
    </Suspense>
  );
}
