'use client';

import { VIEWER_ONLY } from '@/lib/appMode';

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

const sections = [
  {
    id: 'overview',
    badge: '1',
    color: 'bg-blue-100 text-blue-700',
    title: 'このアプリでできること',
    items: [
      '手順書の新規作成、ブラウザ内への下書き保存、Drive 上の JSON の再編集・閲覧ができます。',
      '画像、条件分岐、チェック項目、関連リンク、ジャンプを含む手順書を作成できます。',
      '完成した手順書は Google Drive に JSON として保存し、必要に応じて Excel も同時に出力できます。',
      '複数の手順書に対する一括設定、バックアップ、Excel 出力、一覧出力も利用できます。',
      'ヘッダーの「Viwer」から、閲覧専用の手順書ビューアを別タブで開けます。',
    ],
  },
  {
    id: 'header',
    badge: '2',
    color: 'bg-amber-100 text-amber-700',
    title: '画面上部の使い方',
    items: [
      '左上のロゴ: トップページへ戻ります。',
      '「Viwer」: 公開されている閲覧専用ビューアを別タブで開きます。',
      '月・太陽のボタン: ライトモードとダークモードを切り替えます。',
      '「?」ボタン: この使い方ガイドを開きます。',
      '「Google Drive」: Google アカウントでログインします。Drive の読み込み・保存前に必要です。',
      'フォルダボタン: 保存先フォルダを選択します。マイドライブ、共有ドライブ、共有アイテムから選べます。',
      '閲覧画面の検索ボタン: 条件分岐で非表示のステップも含め、手順書全体を検索します。',
    ],
  },
  {
    id: 'home',
    badge: '3',
    color: 'bg-emerald-100 text-emerald-700',
    title: 'トップページのメニュー',
    items: [
      '「作成・編集」: 新規作成、保存済みの下書きからの編集を行います。',
      '「Drive」: Drive 上の JSON を読み込み、編集または閲覧します。',
      '「一括設定」: 複数の手順書の部署、カテゴリ、読み飛ばし防止設定をまとめて変更します。',
      '「出力・保存」: Drive へのバックアップ、Excel 出力、手順書一覧出力を行います。',
      'メニューはクリックに加え、左右キーでカテゴリ、上下キーで項目を選び、Enter キーで開けます。',
    ],
  },
  {
    id: 'basic',
    badge: '4',
    color: 'bg-violet-100 text-violet-700',
    title: '手順書の基本情報',
    items: [
      'タイトル: 手順書名です。完成保存時に必須です。',
      'カテゴリ: 登録済みのカテゴリを選ぶか、新しいカテゴリを追加できます。',
      '部署: 登録済みの部署を選ぶか、新しい部署を追加できます。完成保存時に必須です。',
      '作成者名 / 更新者名: 完成保存時に必須です。前回入力した名前は再利用されます。',
      '概要とキーワード: 手順書の目的、対象業務、検索に使う語句を登録できます。',
      '更新履歴に追記する: 編集時に変更前の内容を履歴として残し、更新メモを付けられます。',
    ],
  },
  {
    id: 'conditions',
    badge: '5',
    color: 'bg-cyan-100 text-cyan-700',
    title: '条件分岐の設定',
    items: [
      '条件グループを追加すると、利用者の選択によって表示するステップを切り替えられます。',
      '各条件グループには複数の選択肢を追加でき、各ステップに表示条件を割り当てられます。',
      '親条件を設定すると、特定の回答を選んだ場合だけ次の条件グループを表示できます。',
      '条件を設定していないステップは共通ステップとして、すべてのルートで表示されます。',
    ],
  },
  {
    id: 'steps',
    badge: '6',
    color: 'bg-rose-100 text-rose-700',
    title: 'ステップ編集の詳細',
    items: [
      '各ステップには、タイトル、説明、注意事項、表示条件、通常の次の移動先を設定できます。',
      'ステップは追加、上下移動、途中挿入、削除ができます。最低 1 ステップは必要です。',
      '画像は複数登録でき、自動圧縮、コメント入力、並び替え、削除、画像への注記に対応しています。',
      'スクリーンショット撮影、OS のスクリーンショットの貼り付け、Ctrl+V の貼り付けも利用できます。',
      '関連リンクには、別の手順書へのリンクと通常の URL を追加できます。',
      'ジャンプを使うと、選択肢ごとに別のステップへ進む流れを作れます。',
      'チェック項目は、閲覧時に確認用のチェックボックスとして表示されます。',
    ],
  },
  {
    id: 'save',
    badge: '7',
    color: 'bg-yellow-100 text-yellow-700',
    title: '保存と完成時の出力',
    items: [
      '「作成中のフローチャートを表示」: 保存前に手順全体の流れを確認します。',
      '「下書き保存して継続」: ブラウザ内に一時保存し、そのまま編集を続けます。',
      '「下書き保存して終了」: ブラウザ内に保存して下書き一覧へ戻ります。',
      '「完成してDriveへ保存」: 選択済みの Drive フォルダへ JSON を保存します。',
      'Excel 出力は「出力無し」「ステップ別シート」「スクロール」から選べます。',
      '読み飛ばし防止モードを有効にすると、閲覧時は「次へ」で 1 ステップずつ表示されます。',
    ],
  },
  {
    id: 'drafts',
    badge: '8',
    color: 'bg-emerald-100 text-emerald-700',
    title: '下書きと Drive 読み込み',
    items: [
      '下書き一覧では、ブラウザ内に保存した下書きを再開、削除できます。',
      '下書きが複数ある場合は、一覧からまとめて削除できます。',
      '手元の JSON ファイルを読み込み、編集画面へ取り込むこともできます。',
      'Drive から編集・閲覧する場合は、保存先フォルダ内の JSON を選びます。',
      'Drive の一覧では、ファイル名検索、並び替え、作成者・更新者による絞り込みができます。',
    ],
  },
  {
    id: 'bulk',
    badge: '9',
    color: 'bg-indigo-50 text-indigo-700',
    title: '一括設定・バックアップ・一覧出力',
    items: [
      '部署、カテゴリ、読み飛ばし防止設定は、複数の JSON を選んでまとめて変更できます。',
      '一括設定では更新日時を変えずに管理項目だけを更新します。',
      'バックアップは、選択した手順書を Drive のバックアップ用フォルダへコピーします。',
      'Excel 出力は、選択した JSON から手順書形式の Excel を作成します。',
      '手順書一覧出力は、作成者、更新者、作成日、更新日、改版などの一覧を Excel で出力します。',
    ],
  },
  {
    id: 'view',
    badge: '10',
    color: 'bg-slate-200 text-slate-700',
    title: '閲覧画面と手順書ビューア',
    items: [
      '閲覧画面では、概要、条件分岐、各ステップ、関連リンク、チェック項目を確認できます。',
      '読み飛ばし防止モードが有効な手順書は、「次へ」で 1 ステップずつ進みます。',
      '閲覧画面では、アプリ閲覧 URL のコピー、更新履歴、フローチャート、印刷、編集を利用できます。',
      'フローチャートは画面で確認でき、SVG または Mermaid ファイルとしてダウンロードできます。',
      '「Viwer」から開く閲覧専用ビューアでは、ログイン後に Drive 上の手順書を一覧から選べます。',
      '閲覧専用ビューアでは、ファイル検索、本文検索、カテゴリ・部署の絞り込み、並び替え、表示形式の変更ができます。',
    ],
  },
  {
    id: 'tips',
    badge: '11',
    color: 'bg-neutral-200 text-neutral-700',
    title: '困ったときの確認ポイント',
    items: [
      'Drive 操作ができない場合は、先に Google Drive ボタンでログインしてください。',
      '完成保存でエラーになる場合は、保存先フォルダが選択されているか確認してください。',
      '下書きはブラウザ内に保存されます。別の PC や別のブラウザには自動で引き継がれません。',
      '画像が多い場合はブラウザの保存容量に近づくことがあります。不要な下書きは定期的に整理してください。',
    ],
  },
];

// 閲覧専用ビューア向けのヘルプ内容
const viewerSections = [
  {
    id: 'v-overview',
    badge: '1',
    color: 'bg-blue-100 text-blue-700',
    title: 'このビューアでできること',
    items: [
      'Google Drive 上に保存された手順書を、一覧から選んで閲覧できます。',
      '閲覧専用のため、手順書の作成・編集はできません（編集は手順書作成システムで行います）。',
      'ファイル名や本文での検索、部署・カテゴリでの絞り込み、並び替え、表示形式の切り替えができます。',
    ],
  },
  {
    id: 'v-login',
    badge: '2',
    color: 'bg-amber-100 text-amber-700',
    title: 'ログインと保存先フォルダ',
    items: [
      '右上の「サインイン」から Google アカウントでログインします。手順書の読み込みに必要です。',
      'ログイン後、右上のフォルダボタンで閲覧する手順書フォルダを選択します。',
      '一度選んだフォルダはこの端末に記録され、次回も同じフォルダが開きます。',
    ],
  },
  {
    id: 'v-list',
    badge: '3',
    color: 'bg-emerald-100 text-emerald-700',
    title: '一覧の使い方',
    items: [
      '「手順書をさがす」: ファイル名で検索します。「ファイル内容も検索」を有効にすると手順の中身も対象になります。',
      '部署・カテゴリのボタン: 押すとその分類で絞り込めます。「すべて」で解除します。',
      '並び順: 名前順・更新が新しい順・よく見る順から選べます（初期は名前順）。',
      '表示形式: 右上のボタンでリスト表示とグリッド表示を切り替えられます。',
      '再読み込み（↻）: カテゴリ・部署を最新の内容で読み直します。分類を変更した直後に反映されます。',
    ],
  },
  {
    id: 'v-view',
    badge: '4',
    color: 'bg-violet-100 text-violet-700',
    title: '閲覧画面の使い方',
    items: [
      '一覧で手順書を選ぶと、概要・条件分岐・各ステップ・関連リンク・チェック項目を確認できます。',
      '条件分岐がある手順書は、選択に応じて表示されるステップが切り替わります。',
      '読み飛ばし防止モードの手順書は、「次へ」で 1 ステップずつ進みます。',
      '上部の検索ボタンで、非表示のステップも含めて手順書全体を検索できます。',
      'フローチャート表示や印刷も利用できます。',
    ],
  },
  {
    id: 'v-theme',
    badge: '5',
    color: 'bg-cyan-100 text-cyan-700',
    title: '画面まわりの操作',
    items: [
      '左上のロゴ: 手順書の一覧（トップ）へ戻ります。',
      '月・太陽のボタン: ライトモードとダークモードを切り替えます。設定は次回以降も保持されます。',
      '「?」ボタン: この使い方ガイドを開きます。',
    ],
  },
  {
    id: 'v-tips',
    badge: '6',
    color: 'bg-neutral-200 text-neutral-700',
    title: '困ったときの確認ポイント',
    items: [
      '手順書が表示されない場合は、先に「サインイン」でログインし、保存先フォルダを選んでください。',
      '一覧が空のときは、選択中のフォルダに手順書（JSON）があるか確認してください。',
      'カテゴリや部署を変更したのに反映されない場合は、再読み込み（↻）を押してください。',
    ],
  },
];

export default function HelpModal({ open, onClose }: HelpModalProps) {
  if (!open) return null;

  const sectionsToShow = VIEWER_ONLY ? viewerSections : sections;
  const guideTitle = VIEWER_ONLY ? '手順書ビューア 使い方ガイド' : '手順書作成システム 使い方ガイド';
  const guideSubtitle = VIEWER_ONLY
    ? 'ログイン、一覧での検索・絞り込み、手順書の閲覧方法をまとめています。'
    : '作成、Drive 連携、一括設定、出力、閲覧専用ビューアまで、現在利用できる機能をまとめています。';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="brand-panel flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-neutral-200 shadow-[0_28px_80px_rgba(15,23,42,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-neutral-200 px-6 py-5 sm:px-8">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="brand-text-muted text-[11px] font-semibold tracking-[0.22em]">
                HELP GUIDE
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
                {guideTitle}
              </h2>
              <p className="mt-2 text-sm leading-6 text-neutral-500">
                {guideSubtitle}
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-400 transition hover:text-neutral-700"
              aria-label="閉じる"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
          <div className="grid gap-4 lg:grid-cols-2">
            {sectionsToShow.map((section) => (
              <section
                key={section.id}
                className="rounded-2xl border border-neutral-200 bg-white px-5 py-5 shadow-sm"
              >
                <div className="mb-3 flex items-center gap-3">
                  <span
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${section.color}`}
                  >
                    {section.badge}
                  </span>
                  <h3 className="text-base font-semibold text-neutral-900">{section.title}</h3>
                </div>
                <ul className="space-y-2.5 pl-5 text-sm leading-6 text-neutral-600">
                  {section.items.map((item) => (
                    <li key={item} className="list-disc">
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>

        <div className="border-t border-neutral-200 px-6 py-4 sm:px-8">
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900"
            >
              閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
