'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  Step,
  CheckItem,
  StepLink,
  StepJump,
  Condition,
  getStepConditionIds,
  getStepImages,
  END_JUMP_TARGET,
} from '@/types/instruction';
import { getAllInstructions } from '@/lib/storage';
import { compressImage } from '@/lib/compressImage';
import ImageAnnotationEditor from './ImageAnnotationEditor';

interface StepEditorProps {
  step: Step;
  index: number;
  totalSteps: number;
  conditions?: Condition[];
  allSteps?: Step[];
  onChange: (step: Step) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

const inputClass =
  'w-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100';
const labelClass = 'mb-1.5 block text-sm font-semibold text-slate-700';
const AUTO_NEXT_VALUE = '__auto__';
const END_NEXT_VALUE = '__end__';

/** 初心者向け分岐の選択肢（編集用）。dest は AUTO_NEXT_VALUE / END_JUMP_TARGET / stepId / ''（未選択）。 */
type BranchChoice = { id: string; label: string; dest: string };

export default function StepEditor({
  step,
  index,
  totalSteps,
  conditions,
  allSteps,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: StepEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [annotatingIdx, setAnnotatingIdx] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [branchOpen, setBranchOpen] = useState(
    () => (step.jumps?.length ?? 0) > 0 || !!step.jumpDefaultLabel || !!step.branchQuestion,
  );
  const [branchChoices, setBranchChoices] = useState<BranchChoice[]>(() => {
    const list: BranchChoice[] = (step.jumps ?? []).map((jump) => ({
      id: jump.id,
      label: jump.label,
      dest: jump.targetStepId,
    }));
    if (step.jumpDefaultLabel) {
      list.push({ id: '__default__', label: step.jumpDefaultLabel, dest: AUTO_NEXT_VALUE });
    }
    return list;
  });

  const images = getStepImages(step);
  const stepRef = useRef(step);
  const imagesRef = useRef(images);
  const selectedConditionIds = getStepConditionIds(step);
  const selectedConditionSet = new Set(selectedConditionIds);
  const hasConditionGroups = (conditions?.length ?? 0) > 0;
  const selectedConditionLabels = (conditions ?? [])
    .filter((condition) => selectedConditionSet.has(condition.id))
    .map((condition) => condition.label)
    .filter(Boolean);
  const conditionSummary =
    selectedConditionLabels.length > 0 ? selectedConditionLabels.join('、') : '共通';

  useEffect(() => {
    stepRef.current = step;
    imagesRef.current = images;
  }, [step, images]);

  const addImage = useCallback(
    (dataUrl: string) => {
      const currentStep = stepRef.current;
      const currentImages = imagesRef.current;
      const captions = currentStep.imageCaptions ?? [];
      onChange({
        ...currentStep,
        imageDataUrl: undefined,
        imageDataUrls: [...currentImages, dataUrl],
        imageCaptions: [...captions, ''],
      });
    },
    [onChange],
  );

  const removeImage = useCallback(
    (imageIndex: number) => {
      const currentStep = stepRef.current;
      const updatedImages = imagesRef.current.filter((_, i) => i !== imageIndex);
      const updatedCaptions = (currentStep.imageCaptions ?? []).filter(
        (_, i) => i !== imageIndex,
      );
      onChange({
        ...currentStep,
        imageDataUrl: undefined,
        imageDataUrls: updatedImages.length > 0 ? updatedImages : undefined,
        imageCaptions: updatedCaptions.length > 0 ? updatedCaptions : undefined,
      });
    },
    [onChange],
  );

  const moveImage = useCallback(
    (imageIndex: number, direction: 'up' | 'down') => {
      const currentStep = stepRef.current;
      const updatedImages = [...imagesRef.current];
      const captions = [...(currentStep.imageCaptions ?? [])];
      while (captions.length < updatedImages.length) captions.push('');

      const targetIndex = direction === 'up' ? imageIndex - 1 : imageIndex + 1;
      if (targetIndex < 0 || targetIndex >= updatedImages.length) return;

      [updatedImages[imageIndex], updatedImages[targetIndex]] = [
        updatedImages[targetIndex],
        updatedImages[imageIndex],
      ];
      [captions[imageIndex], captions[targetIndex]] = [
        captions[targetIndex],
        captions[imageIndex],
      ];

      onChange({
        ...currentStep,
        imageDataUrl: undefined,
        imageDataUrls: updatedImages,
        imageCaptions: captions.some((caption) => caption) ? captions : undefined,
      });
    },
    [onChange],
  );

  const updateCaption = useCallback(
    (imageIndex: number, caption: string) => {
      const captions = [...(step.imageCaptions ?? [])];
      while (captions.length <= imageIndex) captions.push('');
      captions[imageIndex] = caption;
      onChange({ ...step, imageCaptions: captions });
    },
    [onChange, step],
  );

  const processImageFile = useCallback(
    (file: File) => {
      if (file.size > 20 * 1024 * 1024) {
        alert('画像サイズは20MB以下にしてください。');
        return;
      }

      compressImage(file)
        .then((dataUrl) => addImage(dataUrl))
        .catch(() => alert('画像の処理に失敗しました。'));
    },
    [addImage],
  );

  const handleScreenCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      await new Promise<void>((resolve) => {
        video.onloadeddata = () => resolve();
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0);
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), 'image/png'),
      );
      processImageFile(new File([blob], 'screenshot.png', { type: 'image/png' }));
    } catch {
      // User cancelled screen capture.
    }
  }, [processImageFile]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(processImageFile);
    e.target.value = '';
  };

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) processImageFile(file);
          return;
        }
      }
    },
    [processImageFile],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    element.addEventListener('paste', handlePaste);
    return () => element.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const groupedConditions = (() => {
    const groupOrder: string[] = [];
    const grouped = new Map<string, Condition[]>();
    for (const condition of conditions ?? []) {
      const group = condition.group || '__default';
      if (!grouped.has(group)) {
        grouped.set(group, []);
        groupOrder.push(group);
      }
      grouped.get(group)!.push(condition);
    }
    return { groupOrder, grouped };
  })();

  const conditionOrder = new Map((conditions ?? []).map((condition, idx) => [condition.id, idx]));

  const updateSelectedConditions = (ids: string[]) => {
    const nextIds = [...new Set(ids)].sort(
      (a, b) => (conditionOrder.get(a) ?? 0) - (conditionOrder.get(b) ?? 0),
    );

    onChange({
      ...step,
      conditionId: nextIds[0],
      conditionIds: nextIds.length > 0 ? nextIds : undefined,
      endsBranch: nextIds.length > 0 ? step.endsBranch : undefined,
    });
  };

  const nextStepSelectionValue = step.endsBranch
    ? END_NEXT_VALUE
    : step.nextStepId || AUTO_NEXT_VALUE;

  const handleNextStepSelection = (value: string) => {
    if (value === AUTO_NEXT_VALUE) {
      onChange({ ...step, nextStepId: undefined, endsBranch: undefined });
      return;
    }

    if (value === END_NEXT_VALUE) {
      onChange({
        ...step,
        nextStepId: undefined,
        endsBranch: true,
        jumpDefaultLabel: undefined,
      });
      return;
    }

    onChange({
      ...step,
      nextStepId: value,
      endsBranch: undefined,
    });
  };

  // --- 初心者向け分岐（質問 → 選択肢 → 進み先） ---
  const otherSteps = (allSteps ?? []).filter((item) => item.id !== step.id);
  const stepNumberOf = (id: string) => (allSteps ?? []).findIndex((item) => item.id === id) + 1;

  const commitChoices = (next: BranchChoice[]) => {
    setBranchChoices(next);
    const jumps: StepJump[] = next
      .filter((choice) => choice.dest && choice.dest !== AUTO_NEXT_VALUE)
      .map((choice) => ({
        id: choice.id === '__default__' ? uuidv4() : choice.id,
        label: choice.label.trim() || '選択肢',
        targetStepId: choice.dest,
      }));
    const autoChoice = next.find((choice) => choice.dest === AUTO_NEXT_VALUE);
    onChange({
      ...step,
      jumps: jumps.length > 0 ? jumps : undefined,
      jumpDefaultLabel: autoChoice ? autoChoice.label.trim() || '次へ' : undefined,
    });
  };

  const toggleBranch = () => {
    if (branchOpen) {
      setBranchOpen(false);
      setBranchChoices([]);
      onChange({ ...step, jumps: undefined, jumpDefaultLabel: undefined, branchQuestion: undefined });
    } else {
      setBranchOpen(true);
      if (branchChoices.length === 0) {
        setBranchChoices([{ id: uuidv4(), label: '', dest: '' }]);
      }
    }
  };

  return (
    <section
      ref={containerRef}
      className="rounded-lg border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-sm font-bold text-white">
            {index + 1}
          </span>
          <div>
            <h3 className="font-semibold text-slate-950">ステップ {index + 1}</h3>
            <p className="text-xs text-slate-500">
              {totalSteps}件中 {index + 1}件目
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
            title="上へ移動"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 15l7-7 7 7"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === totalSteps - 1}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30"
            title="下へ移動"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            title="削除"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {hasConditionGroups && (
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="flex w-full items-start justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100"
            >
              <div>
                <p className="text-sm font-semibold text-slate-700">上級者向け（詳細な条件分岐）</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  複数条件の組み合わせやグループ分岐・合流先の指定。表示条件: {conditionSummary}
                </p>
              </div>
              <svg
                className={`mt-0.5 h-5 w-5 text-slate-400 transition ${showAdvanced ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {showAdvanced && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="mb-3 text-xs font-semibold text-slate-600">表示条件</p>
                <button
                  type="button"
                  onClick={() => updateSelectedConditions([])}
                  className={`mb-3 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    selectedConditionIds.length === 0
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  共通（すべての条件で表示）
                </button>

                <div className="space-y-3">
                  {groupedConditions.groupOrder.map((groupId, groupIndex) => (
                    <div key={groupId} className="rounded-lg border border-slate-200 bg-white p-3">
                      {groupedConditions.groupOrder.length > 1 && (
                        <p className="mb-2 text-xs font-semibold text-slate-500">
                          グループ {String.fromCharCode(65 + groupIndex)}
                        </p>
                      )}
                      <div className="space-y-2">
                        {groupedConditions.grouped.get(groupId)!.map((condition, conditionIndex) => {
                          const checked = selectedConditionSet.has(condition.id);
                          return (
                            <label key={condition.id} className="flex cursor-pointer items-start gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  if (event.target.checked) {
                                    updateSelectedConditions([...selectedConditionIds, condition.id]);
                                  } else {
                                    updateSelectedConditions(
                                      selectedConditionIds.filter((id) => id !== condition.id),
                                    );
                                  }
                                }}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm text-slate-700">
                                {condition.label || `条件 ${conditionIndex + 1}`}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-xs leading-5 text-slate-500">
                  複数選ぶと、選んだ条件すべてでこのステップを表示します。何も選ばない場合は共通ステップとして扱います。
                </p>

                <div className="mt-4 border-t border-slate-200 pt-4">
                  <label className={labelClass}>通常の次に進む先</label>
                  <select
                    value={nextStepSelectionValue}
                    onChange={(e) => handleNextStepSelection(e.target.value)}
                    className={inputClass}
                  >
                    <option value={AUTO_NEXT_VALUE}>自動判定</option>
                    <option value={END_NEXT_VALUE}>ここで終了</option>
                    {(allSteps ?? [])
                      .filter((item) => item.id !== step.id)
                      .map((item) => {
                        const realIndex = (allSteps ?? []).findIndex((candidate) => candidate.id === item.id);
                        return (
                          <option key={item.id} value={item.id}>
                            {realIndex + 1}. {item.title || '(未入力)'}
                          </option>
                        );
                      })}
                  </select>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    条件分岐の合流先などを明示したい場合に使います。自動判定は並び順に沿って進み、終了はこのステップでフローを終えます。
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <label className={labelClass}>タイトル</label>
          <input
            type="text"
            value={step.title}
            onChange={(e) => onChange({ ...step, title: e.target.value })}
            className={inputClass}
            placeholder="例: システムにログインする"
          />
        </div>

        <div>
          <label className={labelClass}>説明</label>
          <textarea
            value={step.description}
            onChange={(e) => onChange({ ...step, description: e.target.value })}
            rows={4}
            className={`${inputClass} resize-y`}
            placeholder="手順の詳細を入力してください"
          />
        </div>

        <div>
          <label className={labelClass}>注意事項（任意）</label>
          <textarea
            value={step.caution || ''}
            onChange={(e) => onChange({ ...step, caution: e.target.value })}
            rows={4}
            className={`${inputClass} resize-y`}
            placeholder="注意すべきポイントがあれば入力"
          />
        </div>

        {(allSteps?.length ?? 0) >= 2 && (
          <div className="rounded-lg border border-slate-200 p-4">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={branchOpen}
                onChange={toggleBranch}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                <span className="block text-sm font-semibold text-slate-800">このステップで分岐する（質問して進み先を変える）</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                  質問に対する答えごとに、次に進むステップを決められます。
                </span>
              </span>
            </label>

            {branchOpen && (
              <div className="mt-4 space-y-3">
                <div>
                  <label className={labelClass}>質問文</label>
                  <input
                    type="text"
                    value={step.branchQuestion || ''}
                    onChange={(e) => onChange({ ...step, branchQuestion: e.target.value || undefined })}
                    className={inputClass}
                    placeholder="例: 検査結果は合格ですか？"
                  />
                </div>

                <div className="space-y-2">
                  {branchChoices.map((choice, choiceIndex) => (
                    <div key={choice.id} className="space-y-2 rounded-lg bg-slate-50 p-3">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-xs font-semibold text-slate-500">選択肢{choiceIndex + 1}</span>
                        <input
                          type="text"
                          value={choice.label}
                          onChange={(e) =>
                            commitChoices(
                              branchChoices.map((item) =>
                                item.id === choice.id ? { ...item, label: e.target.value } : item,
                              ),
                            )
                          }
                          className={`${inputClass} flex-1`}
                          placeholder="答え（例: 合格 / 不合格）"
                        />
                        <button
                          type="button"
                          onClick={() => commitChoices(branchChoices.filter((item) => item.id !== choice.id))}
                          className="shrink-0 text-sm text-red-500 hover:text-red-700"
                        >
                          削除
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-xs text-slate-500">進み先</span>
                        <select
                          value={choice.dest}
                          onChange={(e) =>
                            commitChoices(
                              branchChoices.map((item) =>
                                item.id === choice.id ? { ...item, dest: e.target.value } : item,
                              ),
                            )
                          }
                          className={`${inputClass} flex-1`}
                        >
                          <option value="">選択してください…</option>
                          <option value={AUTO_NEXT_VALUE}>次のステップへ進む</option>
                          {otherSteps.map((item) => (
                            <option key={item.id} value={item.id}>
                              {stepNumberOf(item.id)}. {item.title || '(未入力)'}
                            </option>
                          ))}
                          <option value={END_JUMP_TARGET}>ここで終了</option>
                        </select>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => commitChoices([...branchChoices, { id: uuidv4(), label: '', dest: '' }])}
                    className="text-sm font-medium text-blue-700 transition hover:text-blue-900"
                  >
                    + 選択肢を追加
                  </button>
                </div>

                <p className="text-xs leading-5 text-slate-500">
                  閲覧時はこの質問が表示され、選んだ答えに応じて進み先が切り替わります。
                </p>
              </div>
            )}
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                画像・スクリーンショット
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                複数画像、注釈、貼り付けに対応しています。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 shadow-sm transition hover:bg-blue-50"
              >
                画像を追加
              </button>
              <button
                type="button"
                onClick={handleScreenCapture}
                className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-700 shadow-sm transition hover:bg-emerald-50"
              >
                スクショ撮影
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageUpload}
            className="hidden"
          />

          {images.length > 0 ? (
            <div className="space-y-3">
              {images.map((imgUrl, imgIdx) => (
                <div
                  key={imgIdx}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imgUrl}
                    alt={`ステップ ${index + 1} の画像 ${imgIdx + 1}`}
                    className="mx-auto max-h-56 max-w-full object-contain"
                  />
                  <div className="space-y-2 border-t border-slate-200 bg-white p-3">
                    <input
                      type="text"
                      value={(step.imageCaptions ?? [])[imgIdx] ?? ''}
                      onChange={(e) => updateCaption(imgIdx, e.target.value)}
                      className={`${inputClass} py-1.5 text-xs`}
                      placeholder="画像のコメントを入力"
                    />
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-500">
                        画像 {imgIdx + 1} / {images.length}
                      </span>
                      <div className="flex items-center gap-3">
                        {images.length > 1 && (
                          <>
                            <button
                              type="button"
                              onClick={() => moveImage(imgIdx, 'up')}
                              disabled={imgIdx === 0}
                              className="text-slate-500 hover:text-blue-700 disabled:opacity-30"
                            >
                              前へ
                            </button>
                            <button
                              type="button"
                              onClick={() => moveImage(imgIdx, 'down')}
                              disabled={imgIdx === images.length - 1}
                              className="text-slate-500 hover:text-blue-700 disabled:opacity-30"
                            >
                              次へ
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setAnnotatingIdx(imgIdx)}
                          className="font-medium text-violet-700 hover:text-violet-900"
                        >
                          注釈
                        </button>
                        <button
                          type="button"
                          onClick={() => removeImage(imgIdx)}
                          className="font-medium text-red-600 hover:text-red-800"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-5 text-center text-sm text-slate-500">
              画像はまだありません。Ctrl+V で貼り付けることもできます。
            </p>
          )}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-4 md:col-span-2">
            <p className="mb-3 text-sm font-semibold text-slate-800">関連リンク</p>
            <div className="space-y-2">
              {(step.links ?? []).map((link) => (
                <div
                  key={link.id}
                  className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2"
                >
                  <span className="flex-1 truncate text-sm text-slate-700">{link.label}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...step,
                        links: (step.links ?? []).filter((item) => item.id !== link.id),
                      })
                    }
                    className="text-sm text-red-500 hover:text-red-700"
                  >
                    削除
                  </button>
                </div>
              ))}

              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const all = getAllInstructions();
                  const instruction = all.find((item) => item.id === e.target.value);
                  if (!instruction) return;
                  const newLink: StepLink = {
                    id: uuidv4(),
                    type: 'instruction',
                    instructionId: instruction.id,
                    driveFileId: instruction.driveFileId,
                    label: instruction.title,
                  };
                  onChange({ ...step, links: [...(step.links ?? []), newLink] });
                  e.target.value = '';
                }}
                className={`${inputClass} text-xs`}
              >
                <option value="">+ 手順書を追加...</option>
                {getAllInstructions().map((instruction) => (
                  <option key={instruction.id} value={instruction.id}>
                    {instruction.title}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => {
                  const url = prompt('URLを入力してください');
                  if (!url) return;
                  const label =
                    prompt('リンクの表示名を入力してください', url) || url;
                  const newLink: StepLink = {
                    id: uuidv4(),
                    type: 'url',
                    url,
                    label,
                  };
                  onChange({ ...step, links: [...(step.links ?? []), newLink] });
                }}
                className="text-sm font-medium text-blue-700 hover:text-blue-900"
              >
                + URLを追加
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800">チェック項目</p>
            <div className="space-y-2">
              {(step.checkItems ?? []).map((item, itemIndex) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2"
                >
                  <input
                    type="text"
                    value={item.label}
                    onChange={(e) => {
                      const updated = [...(step.checkItems ?? [])];
                      updated[itemIndex] = { ...item, label: e.target.value };
                      onChange({ ...step, checkItems: updated });
                    }}
                    className={`${inputClass} min-w-0 py-1.5`}
                    placeholder="チェック項目名を入力"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const updated = (step.checkItems ?? []).filter(
                        (_, i) => i !== itemIndex,
                      );
                      onChange({
                        ...step,
                        checkItems: updated.length > 0 ? updated : undefined,
                      });
                    }}
                    className="rounded-md px-2 py-2 text-sm text-red-500 transition hover:bg-red-50 hover:text-red-700"
                  >
                    削除
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const newItem: CheckItem = { id: uuidv4(), label: '' };
                  onChange({
                    ...step,
                    checkItems: [...(step.checkItems ?? []), newItem],
                  });
                }}
                className="text-sm font-medium text-blue-700 hover:text-blue-900"
              >
                + チェック項目を追加
              </button>
            </div>
          </div>
        </div>
      </div>

      {annotatingIdx !== null && (
        <ImageAnnotationEditor
          imageDataUrl={images[annotatingIdx]}
          originalImageDataUrl={step.originalImageDataUrls?.[annotatingIdx]}
          onSave={(url) => {
            const updated = [...images];
            const originals = [...(step.originalImageDataUrls ?? [])];
            while (originals.length <= annotatingIdx) originals.push('');
            if (!originals[annotatingIdx]) originals[annotatingIdx] = images[annotatingIdx];
            updated[annotatingIdx] = url;
            onChange({
              ...step,
              imageDataUrl: undefined,
              imageDataUrls: updated,
              originalImageDataUrls: originals,
            });
            setAnnotatingIdx(null);
          }}
          onRestore={() => {
            const originals = step.originalImageDataUrls ?? [];
            if (!originals[annotatingIdx]) return;
            const updated = [...images];
            updated[annotatingIdx] = originals[annotatingIdx];
            const newOriginals = [...originals];
            newOriginals[annotatingIdx] = '';
            onChange({
              ...step,
              imageDataUrl: undefined,
              imageDataUrls: updated,
              originalImageDataUrls: newOriginals.some((item) => item)
                ? newOriginals
                : undefined,
            });
            setAnnotatingIdx(null);
          }}
          onClose={() => setAnnotatingIdx(null)}
        />
      )}
    </section>
  );
}
