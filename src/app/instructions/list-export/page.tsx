'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { WorkInstruction, getApprovalStatus, getCategoryLabel } from '@/types/instruction';
import { downloadDriveFile, getTargetFolder, listJsonFilesInFolder, saveFileToDrive } from '@/lib/googleDrive';
import { addAuthListener, getAuthState, GoogleAuthState, initGoogleAuth, isGoogleConfigured, signIn } from '@/lib/googleAuth';
import { buildInstructionListExcel, exportInstructionList } from '@/lib/exportSpreadsheet';
import { VIEWER_ONLY } from '@/lib/appMode';
import EditorOnlyNotice from '@/components/EditorOnlyNotice';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
type Destination = 'local' | 'drive';

function fmtDate(value?: string): string {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('ja-JP');
}

function ListExportTool() {
  const [auth, setAuth] = useState<GoogleAuthState>(getAuthState());
  const [instructions, setInstructions] = useState<WorkInstruction[]>([]);
  const [folderName, setFolderName] = useState('');
  const [loading, setLoading] = useState(false);
  const [destination, setDestination] = useState<Destination>('local');
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ message: string; url?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const configured = isGoogleConfigured();

  useEffect(() => {
    if (!configured) return;
    initGoogleAuth().catch(() => {});
    return addAuthListener(setAuth);
  }, [configured]);

  const load = useCallback(() => {
    const folder = getTargetFolder();
    if (!folder) {
      setError('保存先の Drive フォルダが未設定です。右上のフォルダボタンから設定してください。');
      setInstructions([]);
      return;
    }
    setFolderName(folder.name);
    setError(null);
    setResult(null);
    setLoading(true);
    listJsonFilesInFolder(folder.id)
      .then(async (files) => {
        const loaded = await Promise.all(
          files.map(async (file) => {
            try {
              const json = JSON.parse(await downloadDriveFile(file.id)) as WorkInstruction;
              // Drive メタデータでフォールバック
              if (!json.createdBy) json.createdBy = file.ownerName;
              if (!json.updatedBy) json.updatedBy = file.lastModifyingUserName;
              if (!json.updatedAt && file.modifiedTime) json.updatedAt = file.modifiedTime;
              if (!json.title) json.title = file.name.replace(/\.json$/i, '');
              return json;
            } catch {
              return null;
            }
          }),
        );
        const valid = loaded.filter((x): x is WorkInstruction => !!x);
        setInstructions(valid);
        if (valid.length === 0) setError('このフォルダに手順書がありません。');
      })
      .catch(() => setError('一覧の取得に失敗しました。'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (configured && !auth.isSignedIn) return;
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [auth.isSignedIn, configured, load]);

  const handleExport = async () => {
    if (instructions.length === 0) {
      alert('出力できる手順書がありません。');
      return;
    }
    setExporting(true);
    setResult(null);
    setError(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `手順書一覧_${stamp}.xlsx`;
      if (destination === 'local') {
        await exportInstructionList(instructions, filename);
        setResult({ message: `${instructions.length} 件をローカルにダウンロードしました。` });
      } else {
        const buffer = await buildInstructionListExcel(instructions);
        await saveFileToDrive(buffer, filename, XLSX_MIME);
        const folder = getTargetFolder();
        const url = folder?.id ? `https://drive.google.com/drive/folders/${folder.id}` : undefined;
        setResult({ message: `${instructions.length} 件を Google ドライブに保存しました（${filename}）。`, url });
      }
    } catch (err) {
      console.error('list export failed', err);
      setError(err instanceof Error ? err.message : '出力に失敗しました。');
    } finally {
      setExporting(false);
    }
  };

  if (configured && !auth.isSignedIn) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <BackLink />
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
          <p className="text-sm font-semibold text-slate-900">Google Drive にログインしてください</p>
          <button onClick={signIn} className="mt-4 rounded-lg bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            Googleでログイン
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <BackLink />
      <h1 className="text-3xl font-bold tracking-tight text-slate-950">手順書一覧出力</h1>
      <p className="mt-2 text-sm text-slate-500">
        フォルダ内の手順書の作成者・更新者・作成日・更新日・改版などの一覧を Excel 形式で出力します。
        {folderName && `（フォルダ: ${folderName}）`}
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <span className="mb-1.5 block text-xs font-medium text-slate-500">出力先</span>
          <div className="flex gap-2">
            <DestButton active={destination === 'local'} onClick={() => setDestination('local')}>
              ローカル（ダウンロード）
            </DestButton>
            <DestButton active={destination === 'drive'} onClick={() => setDestination('drive')}>
              Google ドライブ
            </DestButton>
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || loading || instructions.length === 0}
          className="ml-auto rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {exporting ? '出力中...' : `${instructions.length} 件を出力`}
        </button>
      </div>

      {result && (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {result.message}
          {result.url && (
            <>
              {' '}
              <a href={result.url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                フォルダを開く
              </a>
            </>
          )}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 text-xs text-slate-500">
          <span>{loading ? '読み込み中...' : `${instructions.length} 件`}</span>
          <button onClick={load} disabled={loading || exporting} className="font-medium hover:text-slate-900">
            再読み込み
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">タイトル</th>
                <th className="px-3 py-2 font-medium">カテゴリ</th>
                <th className="px-3 py-2 font-medium">承認</th>
                <th className="px-3 py-2 font-medium">承認日</th>
                <th className="px-3 py-2 font-medium">作成者</th>
                <th className="px-3 py-2 font-medium">更新者</th>
                <th className="px-3 py-2 font-medium">作成日</th>
                <th className="px-3 py-2 font-medium">更新日</th>
                <th className="px-3 py-2 text-center font-medium">改版</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {instructions.map((inst) => {
                const updater = inst.updatedBy || inst.updateHistory?.[inst.updateHistory.length - 1]?.updatedBy || '';
                const approvalStatus = getApprovalStatus(inst);
                const approvalLabel = approvalStatus === 'approved' ? '承認済み' : approvalStatus === 'needs_reapproval' ? '要再承認' : '未承認';
                const approvalClass =
                  approvalStatus === 'approved'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : approvalStatus === 'needs_reapproval'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-slate-200 bg-slate-50 text-slate-500';
                return (
                  <tr key={inst.id} className="hover:bg-slate-50">
                    <td className="max-w-xs truncate px-3 py-2.5 text-slate-900">{inst.title}</td>
                    <td className="px-3 py-2.5 text-slate-600">{getCategoryLabel(inst.category)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${approvalClass}`}>
                        {approvalStatus === 'approved' && (
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {approvalLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{fmtDate(inst.approval?.current?.approvedAt) || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{inst.createdBy || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{updater || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{fmtDate(inst.createdAt) || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{fmtDate(inst.updatedAt) || '—'}</td>
                    <td className="px-3 py-2.5 text-center text-slate-600">{inst.updateHistory?.length ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/" className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-900">
      ← ホームへ戻る
    </Link>
  );
}

function DestButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
        active
          ? 'border-slate-950 bg-slate-950 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

export default function ListExportPage() {
  if (VIEWER_ONLY) return <EditorOnlyNotice />;
  return <ListExportTool />;
}
