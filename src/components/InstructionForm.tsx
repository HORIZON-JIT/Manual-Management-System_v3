'use client';

import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import {
  WorkInstruction,
  Step,
  Condition,
  DEFAULT_CATEGORIES,
  DEPARTMENT_OPTIONS,
  UpdateHistoryEntry,
  InstructionSnapshot,
  InstructionStatus,
  getStepConditionIds,
} from '@/types/instruction';
import { saveInstruction } from '@/lib/storage';
import { buildExcelBuffer, ExcelNavMode } from '@/lib/exportSpreadsheet';
import { uploadAsGoogleSheet, saveFileToDrive, getTargetFolder } from '@/lib/googleDrive';
import { addStepNavLinks, addSheetCheckboxes, addResetScript } from '@/lib/sheetsNavLinks';
import { getViewPageBaseUrl } from '@/lib/shareLink';
import { isGoogleConfigured, getAuthState } from '@/lib/googleAuth';
import { getCustomDepartments, addCustomDepartment } from '@/lib/customDepartments';
import StepEditor from './StepEditor';
import VersionHistoryModal from './VersionHistoryModal';
import FlowchartModal from './FlowchartModal';
import FlowPreview from './FlowPreview';

const LAST_AUTHOR_KEY = 'last_author_name';
const fieldClass =
  'w-full border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100';
const labelClass = 'mb-1.5 block text-sm font-semibold text-slate-700';

interface InstructionFormProps {
  initialData?: WorkInstruction;
}

function createEmptyStep(orderIndex: number): Step {
  return { id: uuidv4(), orderIndex, title: '', description: '' };
}

function getLastAuthorName(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(LAST_AUTHOR_KEY) || '';
}

function saveLastAuthorName(name: string) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(LAST_AUTHOR_KEY, name);
  }
}

export default function InstructionForm({ initialData }: InstructionFormProps) {
  const router = useRouter();
  const isEdit = !!initialData;

  const [title, setTitle] = useState(initialData?.title || '');
  const [category, setCategory] = useState(initialData?.category || DEFAULT_CATEGORIES[0]);
  const [showCustomCategory, setShowCustomCategory] = useState(
    !!initialData?.category &&
      !DEFAULT_CATEGORIES.includes(initialData.category as (typeof DEFAULT_CATEGORIES)[number]),
  );
  const [customCategory, setCustomCategory] = useState(
    initialData?.category &&
      !DEFAULT_CATEGORIES.includes(initialData.category as (typeof DEFAULT_CATEGORIES)[number])
      ? initialData.category
      : '',
  );
  const [department, setDepartment] = useState(initialData?.department || '');
  const [customDepartments, setCustomDepartments] = useState<string[]>([]);
  const [showAddDepartment, setShowAddDepartment] = useState(false);
  const [newDepartment, setNewDepartment] = useState('');
  const [description, setDescription] = useState(initialData?.description || '');
  const [steps, setSteps] = useState<Step[]>(
    initialData?.steps?.length
      ? [...initialData.steps].sort((a, b) => a.orderIndex - b.orderIndex)
      : [createEmptyStep(0)],
  );
  const [authorName, setAuthorName] = useState(
    initialData?.updatedBy || initialData?.createdBy || getLastAuthorName(),
  );
  const [updateNote, setUpdateNote] = useState('');
  const [addHistory, setAddHistory] = useState(false);
  const [keywordsText, setKeywordsText] = useState(initialData?.keywords?.join(', ') || '');
  const [excelNavMode, setExcelNavMode] = useState<ExcelNavMode>('none');
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showFlowchart, setShowFlowchart] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(true);
  const [showStepIndex, setShowStepIndex] = useState(false);
  const [showDescriptionGuide, setShowDescriptionGuide] = useState(false);
  const [showSidebarConditions, setShowSidebarConditions] = useState(false);
  const [showSaveSettings, setShowSaveSettings] = useState(false);
  const [conditions, setConditions] = useState<Condition[]>(() => {
    const raw = initialData?.conditions ?? [];
    if (raw.length === 0) return [];
    if (raw.some((c) => c.group)) return raw;
    const defaultGroup = uuidv4();
    return raw.map((c) => ({ ...c, group: defaultGroup }));
  });
  const [groupParents, setGroupParents] = useState<Record<string, string | undefined>>(() => {
    const parents: Record<string, string | undefined> = {};
    for (const cg of initialData?.conditionGroups ?? []) {
      if (cg.parentConditionId) parents[cg.id] = cg.parentConditionId;
    }
    return parents;
  });
  const [sequential, setSequential] = useState<boolean>(initialData?.sequential ?? false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ text: string; type: 'error'; folderUrl?: string } | null>(null);
  const [saveSuccessModal, setSaveSuccessModal] = useState<{
    folderName: string;
    folderUrl?: string;
    viewUrl?: string;
    excelExported: boolean;
  } | null>(null);
  const [viewUrlCopied, setViewUrlCopied] = useState(false);
  const [draftSaveMessage, setDraftSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    setCustomDepartments(getCustomDepartments());
  }, []);

  // 既定の部署＋追加された部署＋編集中データの部署を重複なくまとめる
  const departmentOptions = Array.from(
    new Set(
      [...DEPARTMENT_OPTIONS, ...customDepartments, initialData?.department].filter(
        (d): d is string => !!d,
      ),
    ),
  );

  const handleAddDepartment = () => {
    const name = newDepartment.trim();
    if (!name) return;
    setCustomDepartments(addCustomDepartment(name));
    setDepartment(name);
    setNewDepartment('');
    setShowAddDepartment(false);
  };

  const hasRestorableVersions =
    isEdit && initialData?.updateHistory?.some((entry) => !!entry.snapshot);

  const handleRestoreVersion = (snapshot: InstructionSnapshot) => {
    setTitle(snapshot.title);
    setCategory(snapshot.category);
    if (
      !DEFAULT_CATEGORIES.includes(snapshot.category as (typeof DEFAULT_CATEGORIES)[number])
    ) {
      setShowCustomCategory(true);
      setCustomCategory(snapshot.category);
    } else {
      setShowCustomCategory(false);
      setCustomCategory('');
    }
    setDescription(snapshot.description);
    setSteps(snapshot.steps);
    setKeywordsText(snapshot.keywords?.join(', ') || '');
    setShowVersionHistory(false);
  };

  const handleAddStep = () => setSteps([...steps, createEmptyStep(steps.length)]);

  const handleInsertStep = (afterIndex: number) => {
    const newSteps = [...steps];
    newSteps.splice(afterIndex + 1, 0, createEmptyStep(afterIndex + 1));
    setSteps(newSteps.map((step, index) => ({ ...step, orderIndex: index })));
  };

  const handleStepChange = (index: number, updatedStep: Step) => {
    const newSteps = [...steps];
    newSteps[index] = updatedStep;
    setSteps(newSteps);
  };

  const scrollToEditStep = (stepId: string) => {
    document.getElementById(`edit-step-${stepId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
    setShowStepIndex(false);
  };

  const handleRemoveStep = (index: number) => {
    if (steps.length <= 1) {
      alert('ステップは1件以上必要です。');
      return;
    }
    setSteps(steps.filter((_, i) => i !== index).map((step, i) => ({ ...step, orderIndex: i })));
  };

  const handleMoveStep = (index: number, direction: 'up' | 'down') => {
    const newSteps = [...steps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSteps.length) return;
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
    setSteps(newSteps.map((step, i) => ({ ...step, orderIndex: i })));
  };

  const addGroup = () => {
    const groupId = uuidv4();
    setConditions((prev) => [...prev, { id: uuidv4(), label: '', group: groupId }]);
  };

  const addConditionToGroup = (groupId: string) => {
    setConditions((prev) => [...prev, { id: uuidv4(), label: '', group: groupId }]);
  };

  const removeCondition = (condId: string) => {
    setConditions((prev) => prev.filter((c) => c.id !== condId));
    setSteps((prev) =>
      prev.map((step) => {
        const remainingConditionIds = getStepConditionIds(step).filter((id) => id !== condId);
        if (remainingConditionIds.length === 0) {
          return {
            ...step,
            conditionId: undefined,
            conditionIds: undefined,
            endsBranch: undefined,
          };
        }
        return {
          ...step,
          conditionId: remainingConditionIds[0],
          conditionIds: remainingConditionIds,
        };
      }),
    );
    setGroupParents((prev) => {
      const updated = { ...prev };
      for (const [groupId, parentId] of Object.entries(updated)) {
        if (parentId === condId) delete updated[groupId];
      }
      return updated;
    });
  };

  const removeGroup = (groupId: string) => {
    const condIds = new Set(conditions.filter((c) => c.group === groupId).map((c) => c.id));
    setConditions((prev) => prev.filter((c) => c.group !== groupId));
    setSteps((prev) =>
      prev.map((step) => {
        const remainingConditionIds = getStepConditionIds(step).filter((id) => !condIds.has(id));
        if (remainingConditionIds.length === 0) {
          return {
            ...step,
            conditionId: undefined,
            conditionIds: undefined,
            endsBranch: undefined,
          };
        }
        return {
          ...step,
          conditionId: remainingConditionIds[0],
          conditionIds: remainingConditionIds,
        };
      }),
    );
    setGroupParents((prev) => {
      const updated = { ...prev };
      delete updated[groupId];
      for (const [gid, parentId] of Object.entries(updated)) {
        if (parentId && condIds.has(parentId)) delete updated[gid];
      }
      return updated;
    });
  };

  const buildPreviewInstruction = (): WorkInstruction => {
    const parsedKeywords = keywordsText
      .split(/[,\s]+/)
      .map((keyword) => keyword.trim())
      .filter(Boolean);
    const now = new Date().toISOString();

    return {
      id: initialData?.id || 'preview',
      title: title.trim() || '作成中の手順書',
      category,
      department: department || undefined,
      description: description.trim(),
      steps,
      createdAt: initialData?.createdAt || now,
      updatedAt: now,
      createdBy: initialData?.createdBy || authorName.trim() || undefined,
      updatedBy: isEdit && authorName.trim() ? authorName.trim() : initialData?.updatedBy,
      keywords: parsedKeywords.length > 0 ? parsedKeywords : undefined,
      conditions: conditions.length > 0 ? conditions : undefined,
      conditionGroups: (() => {
        const groups = Object.entries(groupParents)
          .filter((entry): entry is [string, string] => !!entry[1])
          .map(([id, parentConditionId]) => ({ id, parentConditionId }));
        return groups.length > 0 ? groups : undefined;
      })(),
      sequential: sequential || undefined,
    };
  };

  const buildInstruction = (status: InstructionStatus): WorkInstruction | null => {
    if (!title.trim()) {
      alert('タイトルを入力してください。');
      return null;
    }

    if (status === 'completed') {
      if (steps.some((step) => !step.title.trim())) {
        alert('空欄のステップ名があります。すべて入力してください。');
        return null;
      }
      if (!authorName.trim()) {
        alert(isEdit ? '更新者名を入力してください。' : '作成者名を入力してください。');
        return null;
      }
      if (!department) {
        alert('部署名を選択してください。');
        return null;
      }
    }

    const trimmedName = authorName.trim();
    if (trimmedName) saveLastAuthorName(trimmedName);

    const now = new Date().toISOString();
    let updateHistory: UpdateHistoryEntry[] = initialData?.updateHistory || [];
    if (isEdit && trimmedName && addHistory) {
      const snapshot: InstructionSnapshot = {
        title: initialData!.title,
        category: initialData!.category,
        description: initialData!.description,
        steps: initialData!.steps,
        keywords: initialData!.keywords,
        createdBy: initialData!.createdBy,
      };
      const entry: UpdateHistoryEntry = {
        updatedBy: trimmedName,
        updatedAt: now,
        snapshot,
      };
      if (updateNote.trim()) entry.note = updateNote.trim();
      updateHistory = [...updateHistory, entry];
    }

    const parsedKeywords = keywordsText
      .split(/[,\s]+/)
      .map((keyword) => keyword.trim())
      .filter(Boolean);

    return {
      id: initialData?.id || uuidv4(),
      title: title.trim(),
      category,
      department: department || undefined,
      description: description.trim(),
      steps,
      createdAt: initialData?.createdAt || now,
      updatedAt: now,
      createdBy: initialData?.createdBy || trimmedName || undefined,
      updatedBy: isEdit && trimmedName ? trimmedName : initialData?.updatedBy,
      updateHistory: updateHistory.length > 0 ? updateHistory : undefined,
      status,
      keywords: parsedKeywords.length > 0 ? parsedKeywords : undefined,
      conditions: conditions.length > 0 ? conditions : undefined,
      conditionGroups: (() => {
        const groups = Object.entries(groupParents)
          .filter((entry): entry is [string, string] => !!entry[1])
          .map(([id, parentConditionId]) => ({ id, parentConditionId }));
        return groups.length > 0 ? groups : undefined;
      })(),
      sequential: sequential || undefined,
    };
  };

  const handleDraftSave = (continueEditing: boolean) => {
    const instruction = buildInstruction('draft');
    if (!instruction) return;

    try {
      saveInstruction(instruction);
    } catch (error) {
      alert(error instanceof Error ? error.message : '下書き保存に失敗しました。');
      return;
    }

    if (continueEditing) {
      setDraftSaveMessage('下書きを保存しました。');
      setTimeout(() => setDraftSaveMessage(null), 3000);
    } else {
      router.push('/instructions/drafts');
    }
  };

  const saveToFolder = async (instruction: WorkInstruction) => {
    setSaving(true);
    setSaveMessage(null);

    try {
      let scriptAttached = false;
      const excelExported = excelNavMode !== 'none';

      if (excelExported) {
        const { buffer: excelBuffer, stepNavRows, indexNavRows, checkboxCells } =
          await buildExcelBuffer(instruction, excelNavMode);
        const sheetName = `${instruction.title}_手順書`;
        const spreadsheetId = await uploadAsGoogleSheet(excelBuffer, sheetName);

        if (excelNavMode === 'jump') {
          await addStepNavLinks(spreadsheetId, instruction, stepNavRows, indexNavRows);
        }

        if (checkboxCells.length > 0) {
          await addSheetCheckboxes(spreadsheetId, checkboxCells);
          scriptAttached = await addResetScript(spreadsheetId);
        }
      }

      const jsonStr = JSON.stringify(instruction, null, 2);
      const jsonBuffer = new TextEncoder().encode(jsonStr).buffer;
      const driveFileId = await saveFileToDrive(
        jsonBuffer,
        `${instruction.title}.json`,
        'application/json',
      );
      const targetFolder = getTargetFolder();
      const folderName = targetFolder?.name || 'WorkInstructions';
      const folderUrl = targetFolder?.id
        ? `https://drive.google.com/drive/folders/${targetFolder.id}`
        : undefined;
      const viewUrl = `${getViewPageBaseUrl()}?driveFileId=${driveFileId}`;

      try {
        saveInstruction({ ...instruction, driveFileId });
      } catch {}

      setSaveSuccessModal({ folderName, folderUrl, viewUrl, excelExported });
      void scriptAttached;
    } catch (error) {
      console.error('Drive save error:', error);
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'result' in error
            ? JSON.stringify((error as { result: unknown }).result)
            : String(error);
      setSaveMessage({
        text: `Driveへの保存に失敗しました: ${message}`,
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteClick = () => {
    const instruction = buildInstruction('completed');
    if (!instruction) return;

    if (!isGoogleConfigured() || !getAuthState().isSignedIn) {
      alert('Google にサインインしてから Google Drive 保存を実行してください。');
      return;
    }

    if (!getTargetFolder()) {
      alert('Drive の保存先フォルダが未設定です。先に保存先を選択してください。');
      return;
    }

    void saveToFolder(instruction);
  };

  const groupedConditions = (() => {
    const groupOrder: string[] = [];
    const grouped = new Map<string, Condition[]>();
    for (const condition of conditions) {
      const groupId = condition.group || '__default';
      if (!grouped.has(groupId)) {
        grouped.set(groupId, []);
        groupOrder.push(groupId);
      }
      grouped.get(groupId)!.push(condition);
    }
    return { groupOrder, grouped };
  })();

  const renderConditionPanel = (compact: boolean, visibilityClass: string) => (
    <section className={`${visibilityClass} rounded-lg border border-slate-200 bg-white p-5 shadow-sm`}>
      <div
        className={`flex gap-3 ${
          compact ? 'items-start justify-between' : 'mb-4 flex-wrap items-center justify-between'
        }`}
      >
        <div>
          <h2 className="text-base font-semibold text-slate-950">条件分岐</h2>
          {(!compact || showSidebarConditions) && (
            <p className="mt-1 text-sm text-slate-500">
              条件ごとの手順をグループ単位で整理できます。
            </p>
          )}
        </div>
        {compact ? (
          <button
            type="button"
            onClick={() => setShowSidebarConditions((shown) => !shown)}
            aria-expanded={showSidebarConditions}
            className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            title={showSidebarConditions ? '折りたたむ' : '展開する'}
          >
            <svg
              className={`h-4 w-4 transition ${showSidebarConditions ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={addGroup}
            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
          >
            グループを追加
          </button>
        )}
      </div>

      {compact && !showSidebarConditions ? (
        <p className="mt-2 text-xs text-slate-500">
          {groupedConditions.groupOrder.length > 0
            ? `${groupedConditions.groupOrder.length} グループを設定中`
            : '未設定'}
        </p>
      ) : (
        <div className={compact ? 'mt-4' : ''}>
          {compact && (
            <button
              type="button"
              onClick={addGroup}
              className="mb-4 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
            >
              グループを追加
            </button>
          )}
          {groupedConditions.groupOrder.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
              条件分岐はまだ設定されていません。
            </p>
          ) : (
            <div className={`space-y-3 ${compact ? 'max-h-64 overflow-y-auto pr-1' : ''}`}>
          {groupedConditions.groupOrder.map((groupId, groupIndex) => {
            const otherConditions = conditions.filter((condition) => condition.group !== groupId);
            return (
              <div
                key={groupId}
                className={`rounded-lg border border-blue-100 bg-blue-50/50 ${compact ? 'p-3' : 'p-4'}`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-blue-800">
                    グループ {String.fromCharCode(65 + groupIndex)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeGroup(groupId)}
                    className="text-xs font-medium text-red-600 hover:text-red-800"
                  >
                    削除
                  </button>
                </div>

                {otherConditions.length > 0 && (
                  <div className="mb-3">
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      親条件
                    </label>
                    <select
                      value={groupParents[groupId] ?? ''}
                      onChange={(event) =>
                        setGroupParents((previous) => ({
                          ...previous,
                          [groupId]: event.target.value || undefined,
                        }))
                      }
                      className={`${fieldClass} py-1.5 text-xs`}
                    >
                      <option value="">なし（単独で表示）</option>
                      {otherConditions.map((condition) => (
                        <option key={condition.id} value={condition.id}>
                          {condition.label || '(未入力)'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-2">
                  {groupedConditions.grouped.get(groupId)!.map((condition) => (
                    <div key={condition.id} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={condition.label}
                        onChange={(event) =>
                          setConditions((previous) =>
                            previous.map((current) =>
                              current.id === condition.id
                                ? { ...current, label: event.target.value }
                                : current,
                            ),
                          )
                        }
                        className={`${fieldClass} min-w-0 py-2`}
                        placeholder="例: Aの場合"
                      />
                      <button
                        type="button"
                        onClick={() => removeCondition(condition.id)}
                        className="rounded-lg px-2 py-1 text-lg leading-none text-red-500 hover:bg-red-50"
                        title="条件を削除"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => addConditionToGroup(groupId)}
                  className="mt-3 text-sm font-medium text-blue-700 hover:text-blue-900"
                >
                  + 条件を追加
                </button>
              </div>
            );
          })}
            </div>
          )}
        </div>
      )}
    </section>
  );

  return (
    <>
      <form
        className="mx-auto max-w-6xl px-4 py-8"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold tracking-[0.16em] text-blue-700">
              {isEdit ? 'EDIT MANUAL' : 'NEW MANUAL'}
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
              {isEdit ? '手順書の編集' : '新規手順書の作成'}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              基本情報、条件分岐、各ステップを入力してDriveへ保存します。
            </p>
          </div>
          <LinkButton href="/" label="ホームへ戻る" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="space-y-6">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5">
                <h2 className="text-base font-semibold text-slate-950">基本情報</h2>
                <p className="mt-1 text-sm text-slate-500">
                  検索や共有時に表示される情報です。
                </p>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className={labelClass}>
                    タイトル <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className={fieldClass}
                    placeholder="例: 出荷伝票の作成手順"
                    required
                  />
                </div>

                <div>
                  <label className={labelClass}>
                    カテゴリ <span className="text-red-500">*</span>
                  </label>
                  {showCustomCategory ? (
                    <div>
                      <input
                        type="text"
                        value={customCategory}
                        onChange={(event) => {
                          setCustomCategory(event.target.value);
                          setCategory(event.target.value);
                        }}
                        className={`${fieldClass} h-12`}
                        placeholder="カテゴリ名を入力"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setShowCustomCategory(false);
                          setCustomCategory('');
                          setCategory(DEFAULT_CATEGORIES[0]);
                        }}
                        className="mt-2 text-xs font-medium text-slate-500 transition hover:text-slate-950"
                      >
                        既存カテゴリに戻す
                      </button>
                    </div>
                  ) : (
                    <div>
                      <select
                        value={category}
                        onChange={(event) => setCategory(event.target.value)}
                        className={`${fieldClass} h-12`}
                      >
                        {DEFAULT_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setShowCustomCategory(true)}
                        className="mt-2 text-xs font-medium text-slate-500 transition hover:text-slate-950"
                      >
                        + カテゴリを追加
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label className={labelClass}>
                    部署名 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={department}
                    onChange={(event) => setDepartment(event.target.value)}
                    className={`${fieldClass} h-12`}
                  >
                    <option value="">選択してください</option>
                    {departmentOptions.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                  {showAddDepartment ? (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={newDepartment}
                        onChange={(event) => setNewDepartment(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            handleAddDepartment();
                          }
                        }}
                        className={`${fieldClass} h-11`}
                        placeholder="部署名を入力"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleAddDepartment}
                        className="shrink-0 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                      >
                        追加
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddDepartment(false);
                          setNewDepartment('');
                        }}
                        className="shrink-0 text-xs font-medium text-slate-500 transition hover:text-slate-950"
                      >
                        やめる
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowAddDepartment(true)}
                      className="mt-2 text-xs font-medium text-slate-500 transition hover:text-slate-950"
                    >
                      + 部署を追加
                    </button>
                  )}
                </div>

                <div>
                  <label className={labelClass}>
                    {isEdit ? '更新者名' : '作成者名'} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={authorName}
                    onChange={(event) => setAuthorName(event.target.value)}
                    className={`${fieldClass} h-12`}
                    placeholder={isEdit ? '更新者の名前を入力' : '作成者の名前を入力'}
                  />
                </div>

                <div className="md:col-span-2">
                  <div className="mb-1.5 flex items-center gap-2">
                    <label className="block text-sm font-semibold text-slate-700">概要</label>
                    <button
                      type="button"
                      onClick={() => setShowDescriptionGuide((current) => !current)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-bold text-slate-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                      aria-expanded={showDescriptionGuide}
                      aria-label="概要欄の説明を表示"
                      title="概要欄の説明"
                    >
                      ?
                    </button>
                  </div>
                  {showDescriptionGuide && (
                    <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm leading-6 text-slate-700">
                      <p className="font-semibold text-slate-900">
                        「なんのためにこの作業を行うのか、作業の意味と目的」の概要を記載してください。
                      </p>
                      <p className="mt-2 text-slate-600">
                        ※例.オーダーリリース
                        <br />
                        確定した計画に基づき、現場や部品出庫へ正しい製造指示を毎朝タイムリーに発行するためです。
                        <br />
                        事前に異常のあるオーダーを検知・周知することで、現場の誤着手や不要な部品出庫といった混乱を防ぐ役割もあります。
                      </p>
                    </div>
                  )}
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={3}
                    className={`${fieldClass} resize-y`}
                    placeholder="「なんのためにこの作業を行うのか、作業の意味と目的」の概要を記載してください。"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className={labelClass}>
                    キーワード <span className="font-normal text-slate-400">任意</span>
                  </label>
                  <input
                    type="text"
                    value={keywordsText}
                    onChange={(event) => setKeywordsText(event.target.value)}
                    className={fieldClass}
                    placeholder="例: 出荷, 伝票, 物流"
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    カンマまたはスペース区切りで入力してください。
                  </p>
                </div>
              </div>

              {isEdit && (
                <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={addHistory}
                      onChange={(event) => setAddHistory(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-semibold text-slate-700">
                      更新履歴に追記する
                    </span>
                    <span className="text-xs text-slate-500">
                      大きな変更があった場合にチェックしてください
                    </span>
                  </label>

                  {addHistory && (
                    <input
                      type="text"
                      value={updateNote}
                      onChange={(event) => setUpdateNote(event.target.value)}
                      className={`${fieldClass} mt-3`}
                      placeholder="例: 手順の順番を見直し"
                    />
                  )}

                  {hasRestorableVersions && (
                    <button
                      type="button"
                      onClick={() => setShowVersionHistory(true)}
                      className="mt-3 text-sm font-medium text-blue-700 hover:text-blue-900"
                    >
                      更新履歴を見る
                    </button>
                  )}
                </div>
              )}
            </section>

            {renderConditionPanel(false, 'lg:hidden')}

            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">手順ステップ</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    必要な順番に沿ってステップを追加します。
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">
                  {steps.length} ステップ
                </span>
              </div>

              {steps.map((step, index) => (
                <Fragment key={step.id}>
                  <div id={`edit-step-${step.id}`} className="scroll-mt-24">
                    <StepEditor
                      step={step}
                      index={index}
                      totalSteps={steps.length}
                      conditions={conditions}
                      allSteps={steps}
                      onChange={(updatedStep) => handleStepChange(index, updatedStep)}
                      onRemove={() => handleRemoveStep(index)}
                      onMoveUp={() => handleMoveStep(index, 'up')}
                      onMoveDown={() => handleMoveStep(index, 'down')}
                    />
                  </div>
                  {index < steps.length - 1 && (
                    <button
                      type="button"
                      onClick={() => handleInsertStep(index)}
                      className="w-full rounded-lg border border-dashed border-slate-300 bg-white py-2 text-sm font-medium text-slate-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                    >
                      + ここにステップを挿入
                    </button>
                  )}
                </Fragment>
              ))}

              <button
                type="button"
                onClick={handleAddStep}
                className="w-full rounded-lg border border-dashed border-blue-300 bg-blue-50 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
              >
                + ステップを追加
              </button>
            </section>
          </div>

          <aside className="h-fit space-y-4 lg:sticky lg:top-24">
            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setShowLivePreview((prev) => !prev)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <span className="text-sm font-semibold text-slate-800">フロー図プレビュー</span>
                <svg
                  className={`h-5 w-5 text-slate-400 transition ${showLivePreview ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showLivePreview && (
                <div className="border-t border-slate-200 p-3">
                  <FlowPreview instruction={buildPreviewInstruction()} onNodeClick={scrollToEditStep} />
                </div>
              )}
            </section>
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm lg:hidden">
              <h2 className="text-base font-semibold text-slate-950">保存設定</h2>

              <label className="mt-4 flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={sequential}
                  onChange={(event) => setSequential(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-700">
                    読み飛ばし防止モード
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">
                    閲覧時に「次へ」ボタンで1ステップずつ表示します。
                  </span>
                </span>
              </label>

              <div className="mt-5 border-t border-slate-200 pt-4">
                <p className="mb-2 text-sm font-semibold text-slate-700">Excel出力</p>
                {[
                  { value: 'none', label: '出力無し' },
                  { value: 'jump', label: 'ステップ別シート' },
                  { value: 'scroll', label: 'スクロール（従来通り）' },
                ].map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-600">
                    <input
                      type="radio"
                      name="excelNavMode-mobile"
                      value={option.value}
                      checked={excelNavMode === option.value}
                      onChange={() => setExcelNavMode(option.value as ExcelNavMode)}
                      className="accent-blue-600"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </section>
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="space-y-3">
                {draftSaveMessage && (
                  <p className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-sm font-medium text-emerald-700">
                    {draftSaveMessage}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => setShowFlowchart(true)}
                  className="w-full rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                >
                  作成中のフローチャートを表示
                </button>
                <button
                  type="button"
                  onClick={() => handleDraftSave(true)}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  下書き保存して継続
                </button>
                <button
                  type="button"
                  onClick={() => handleDraftSave(false)}
                  disabled={saving}
                  className="w-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
                >
                  下書き保存して終了
                </button>
                <button
                  type="button"
                  onClick={handleCompleteClick}
                  disabled={saving}
                  className="w-full rounded-lg bg-slate-950 px-4 py-3 text-base font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? '保存中...' : '完成してDriveへ保存'}
                </button>
                {saveMessage && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {saveMessage.text}
                  </p>
                )}
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-500">
                完成時は、指定した Google Drive フォルダに JSON を保存します。Excel出力を選んだ場合のみ、
                スプレッドシートも保存します。
              </p>
            </section>
            {renderConditionPanel(true, 'hidden lg:block')}
            <section className="hidden rounded-lg border border-slate-200 bg-white p-5 shadow-sm lg:block">
              <button
                type="button"
                onClick={() => setShowSaveSettings((shown) => !shown)}
                aria-expanded={showSaveSettings}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <span>
                  <span className="block text-base font-semibold text-slate-950">保存設定</span>
                  {!showSaveSettings && (
                    <span className="mt-2 block text-xs text-slate-500">
                      Excel: {excelNavMode === 'none' ? '出力無し' : excelNavMode === 'jump' ? 'ステップ別シート' : 'スクロール'}
                    </span>
                  )}
                </span>
                <span className="rounded-lg border border-slate-200 p-2 text-slate-500">
                  <svg
                    className={`h-4 w-4 transition ${showSaveSettings ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </button>

              {showSaveSettings && (
                <>
                  <label className="mt-4 flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={sequential}
                      onChange={(event) => setSequential(event.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-700">
                        読み飛ばし防止モード
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">
                        閲覧時に「次へ」ボタンで1ステップずつ表示します。
                      </span>
                    </span>
                  </label>

                  <div className="mt-5 border-t border-slate-200 pt-4">
                    <p className="mb-2 text-sm font-semibold text-slate-700">Excel出力</p>
                    <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-600">
                      <input
                        type="radio"
                        name="excelNavMode-desktop"
                        value="none"
                        checked={excelNavMode === 'none'}
                        onChange={() => setExcelNavMode('none')}
                        className="accent-blue-600"
                      />
                      出力無し
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-600">
                      <input
                        type="radio"
                        name="excelNavMode-desktop"
                        value="jump"
                        checked={excelNavMode === 'jump'}
                        onChange={() => setExcelNavMode('jump')}
                        className="accent-blue-600"
                      />
                      ステップ別シート
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 py-1 text-sm text-slate-600">
                      <input
                        type="radio"
                        name="excelNavMode-desktop"
                        value="scroll"
                        checked={excelNavMode === 'scroll'}
                        onChange={() => setExcelNavMode('scroll')}
                        className="accent-blue-600"
                      />
                      スクロール（従来通り）
                    </label>
                  </div>
                </>
              )}
            </section>
          </aside>
        </div>
      </form>

      <div className="fixed left-6 top-24 z-30 hidden xl:block">
        {showStepIndex ? (
          <nav className="w-60 rounded-lg border border-slate-200 bg-white p-4 shadow-[0_18px_44px_rgba(15,23,42,0.10)]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Chapter</p>
                <h2 className="mt-2 text-base font-semibold text-slate-900">ステップ一覧</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowStepIndex(false)}
                className="text-slate-400 transition hover:text-slate-700"
                aria-label="目次を閉じる"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="max-h-[calc(100vh-12rem)] space-y-1 overflow-y-auto pr-1">
              {steps.map((step, index) => (
                <button
                  type="button"
                  key={step.id}
                  onClick={() => scrollToEditStep(step.id)}
                  className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                    {index + 1}
                  </span>
                  <span className="pt-0.5 leading-5">{step.title.trim() || '(タイトル未入力)'}</span>
                </button>
              ))}
            </div>
          </nav>
        ) : (
          <button
            type="button"
            onClick={() => setShowStepIndex(true)}
            className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-[0_12px_32px_rgba(15,23,42,0.08)] transition hover:border-slate-300 hover:bg-slate-50"
          >
            <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            目次
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowStepIndex(true)}
        className="fixed bottom-6 left-6 z-30 flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-lg xl:hidden"
      >
        <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        目次
      </button>

      {showStepIndex && (
        <div className="fixed inset-0 z-40 flex items-end bg-slate-950/25 p-4 xl:hidden">
          <nav className="w-full rounded-lg bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">ステップ一覧</h2>
              <button type="button" onClick={() => setShowStepIndex(false)} className="px-2 py-1 text-slate-500">
                閉じる
              </button>
            </div>
            <div className="max-h-[55vh] space-y-1 overflow-y-auto">
              {steps.map((step, index) => (
                <button
                  type="button"
                  key={step.id}
                  onClick={() => scrollToEditStep(step.id)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold">{index + 1}</span>
                  {step.title.trim() || '(タイトル未入力)'}
                </button>
              ))}
            </div>
          </nav>
        </div>
      )}

      {saveSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <div>
                <p className="font-bold text-slate-950">保存しました</p>
                <p className="text-sm text-slate-500">
                  保存先:{' '}
                  {saveSuccessModal.folderUrl ? (
                    <a
                      href={saveSuccessModal.folderUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-700 underline"
                    >
                      {saveSuccessModal.folderName}
                    </a>
                  ) : (
                    <span className="font-medium text-slate-700">
                      {saveSuccessModal.folderName}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {saveSuccessModal.excelExported
                    ? 'JSON と Excel を保存しました'
                    : 'JSON のみ保存しました'}
                </p>
              </div>
            </div>

            {saveSuccessModal.viewUrl && (
              <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="mb-2 text-xs font-bold text-blue-900">
                  閲覧リンク（Googleログインで開けます）
                </p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={saveSuccessModal.viewUrl}
                    className="min-w-0 flex-1 border border-blue-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none"
                    onClick={(event) => (event.target as HTMLInputElement).select()}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(saveSuccessModal.viewUrl!);
                      setViewUrlCopied(true);
                      setTimeout(() => setViewUrlCopied(false), 2000);
                    }}
                    className="shrink-0 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-800"
                  >
                    {viewUrlCopied ? 'コピー済み' : 'コピー'}
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => router.push('/')}
              className="w-full rounded-lg bg-slate-950 py-3 font-bold text-white transition hover:bg-slate-800"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {showFlowchart && (
        <FlowchartModal
          instruction={buildPreviewInstruction()}
          onClose={() => setShowFlowchart(false)}
        />
      )}

      {showVersionHistory && initialData?.updateHistory && (
        <VersionHistoryModal
          history={initialData.updateHistory}
          onRestore={handleRestoreVersion}
          onClose={() => setShowVersionHistory(false)}
        />
      )}
    </>
  );
}

function LinkButton({ href, label }: { href: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = href;
      }}
      className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
    >
      {label}
    </button>
  );
}
