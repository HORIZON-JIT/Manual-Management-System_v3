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
      '手順書を作成し、Google Drive に保存します。編集中の内容は自動で端末内の下書きに残ります。',
      '分岐（質問と答え）は「図で分岐を組み立てる」で流れ図を描くように作れ、「試し読み」で閲覧者と同じ操作を再現して確かめられます。',
      '完成した手順書は Excel や、会社規定の作業手順書（様式6-3号）の Word としても出力できます。',
      '複数の手順書に対する一括設定、バックアップ、手順書一覧出力、承認依頼・改版通知のメール作成ができます。',
      'ヘッダーの「Viwer」から、閲覧専用の手順書ビューアを別タブで開けます。',
    ],
  },
  {
    id: 'header',
    badge: '2',
    color: 'bg-amber-100 text-amber-700',
    title: '画面上部（ヘッダー）',
    items: [
      '左上のロゴ: トップページへ戻ります。',
      '「Viwer」: 閲覧専用ビューアを別タブで開きます。月・太陽のボタンでライト／ダークを切り替え、「?」でこのガイドを開きます。',
      '「Google Drive」: Google アカウントでログインします。Drive の読み込み・保存に必要です。ログインは自動で延長され、延長できなかったときだけ「再ログイン」ボタンが出ます。',
      'フォルダボタン: 保存先フォルダを選びます。マイドライブ・共有ドライブ・共有アイテムから選べ、一度選んだフォルダは「よく使うフォルダ」に残って 1 クリックで切り替えられます（★でピン留め、✕で一覧から外す）。',
    ],
  },
  {
    id: 'home',
    badge: '3',
    color: 'bg-emerald-100 text-emerald-700',
    title: 'トップページのメニュー',
    items: [
      '4 つのカテゴリ（作成・編集／Drive／一括設定／出力・共有）が横に並び、各カテゴリの項目はすべて表示されています。押すとその画面が開きます。',
      '「作成・編集」: 新規作成、既存の手順書から作成（Drive の手順書をひな形にして複製）、下書きから編集。',
      '「Drive」: Drive の手順書を編集・表示、承認を依頼、手順書作成/改版を通知（Gmail の下書きを作ります）。',
      '「一括設定」: 部署・カテゴリ・読み飛ばし防止をまとめて変更。「出力・共有」: バックアップ、Excel で出力、QR コードを出力、手順書一覧出力。',
      'キーボードでも操作できます: ← → でカテゴリ、↑ ↓ で項目、Enter で開く。',
    ],
  },
  {
    id: 'basic',
    badge: '4',
    color: 'bg-violet-100 text-violet-700',
    title: '手順書の基本情報',
    items: [
      'タイトル・カテゴリ・部署名・作成者名は完成保存時に必須です。下書きはタイトルが空でも保存できます。',
      'カテゴリと部署は「＋〇〇を追加」で新しく作れます。前回入力した作成者名は次回も自動で入ります。',
      '概要: 「なんのためにこの作業を行うのか」作業の意味と目的を書きます。ビューアで最初に表示されます。',
      'キーワード: 検索に使う語句をカンマまたはスペース区切りで入れます。',
      '更新履歴に追記する: Drive の手順書を編集して保存するとき、変更前の内容を履歴として残し、更新メモを付けられます。大きく内容が変わったときに使います。',
    ],
  },
  {
    id: 'steps',
    badge: '5',
    color: 'bg-rose-100 text-rose-700',
    title: 'ステップの書き方',
    items: [
      '各ステップにはタイトル、説明、注意事項（任意）、画像、関連リンク、チェック項目、詳細説明（任意）を入力できます。',
      '説明は「〜を行う」「〜を確認する」のように言い切りで、一文に一つの作業を書きます。「可能な限り」などあいまいな表現や、チェックの内容は書きません（チェック項目へ）。',
      '画像は「画像を追加」「スクショ撮影」のほか、ステップ編集欄を一度クリックしてから Ctrl+V でも貼り付けられます。複数登録でき、コメント、並び替え、表示サイズの指定ができます。',
      '「注釈」では矢印・直線・丸・四角・ハイライト・番号・文字のほか、名前などを隠すモザイク／塗りつぶし、切り抜きが使えます。Ctrl＋ホイールで拡大、スペース＋ドラッグで移動、Ctrl+Z で元に戻す、Delete で削除です。',
      '関連リンクには「Driveの手順書から追加」「URLを追加」「パスを追加」が使えます。チェック項目は閲覧時にチェックボックスとして表示されます。',
      'ステップは追加・途中挿入・上下移動・削除ができます。左上の「目次」からステップ一覧を開いて移動できます。',
    ],
  },
  {
    id: 'branch',
    badge: '6',
    color: 'bg-cyan-100 text-cyan-700',
    title: '分岐を作る（図で分岐を組み立てる）',
    items: [
      '右カラムの「図で分岐を組み立てる」を押すと流れ図が開きます。箱を押すと右に操作が出て、変更はすぐ手順ステップに反映されます。',
      'ステップの箱: 「次はどこ？」で進み先（既にある箱を選ぶと合流、前の箱を選ぶと「↩ 戻る」、「終了」で終える）、「＋ 次に新しいステップを追加」、「？ ここで分岐（質問を入れる）」。',
      '質問（ひし形）: 質問文は YES／NO で答えられる形にします。答えは「＋ 答えを増やす」で 3 つ以上にもできます。答えの先の「＋ 次を追加」で、ステップか次の質問を置きます。',
      '「作成中のフローチャートを表示」で全体を確認し、SVG として保存できます。',
      '「試し読み（分岐を確認）」: 閲覧者と同じように答えを押して流れを確かめます。たどり着けないステップ、進み先が未設定の答え、終了できない流れがあると一覧とボタンの件数で知らせ、該当ステップの編集欄へ移動できます。',
      '従来の「条件グループ」方式の手順書を開くと、図の方式に変換できるか調べて案内します。変換は、どの選び方でも手順の流れが変わらない場合だけ行えます。',
    ],
  },
  {
    id: 'save',
    badge: '7',
    color: 'bg-yellow-100 text-yellow-700',
    title: '保存',
    items: [
      '自動保存: 入力が止まって数秒後に端末内の下書きへ自動で保存されます（右カラムに「自動保存: 時刻」）。新規作成を開くと「前回の続き」から再開できます。',
      '「下書き保存」: 端末内に保存して編集を続けます。「保存して終了」: 保存して下書き一覧へ戻ります。下書きは別の PC やブラウザには引き継がれません。',
      '「完成してDriveへ保存」: 保存先フォルダに「タイトル.json」を保存します。保存に失敗しても編集内容は下書きに残り、「再ログインして保存をやり直す」で続きから保存できます。',
      '保存設定: 読み飛ばし防止モード（閲覧時に「次へ」で 1 ステップずつ）、Excel 出力（出力無し／ステップ別シート／スクロール）、上長承認（ログイン中のアカウントを承認者として記録）。',
      '下書きの残り容量は右カラムに表示されます。画像の多い手順書は Drive に完成保存してから下書きを消すと容量が戻ります。',
    ],
  },
  {
    id: 'output',
    badge: '8',
    color: 'bg-orange-100 text-orange-700',
    title: '出力',
    items: [
      '「社内規定作業手順書で出力」: 会社規定の作業手順書（様式6-3号）の Word を作ります。「Gemini で文章を書き直す」で指示文つきの文章をコピーして Gemini を開き、返ってきた文章を貼り付けると、である調の文体に整った Word になります。',
      '文書番号と承認・審査の欄は空欄、改訂履歴は更新履歴から入ります。「各ステップの画像」のチェックを外すと画像なしで出力します。',
      'Excel 出力: 完成保存時に保存設定で選ぶか、トップの「Excelで出力」で Drive の手順書から作成します。',
      '手順書一覧出力: タイトル・カテゴリ・作成者・作成日・更新者・更新日・改版・承認状況の一覧を Excel で出力します。',
      'バックアップを作成: 選択した手順書を Drive の「バックアップ/日付」フォルダへコピーするか、この端末に ZIP（1 件なら JSON）でダウンロードします。',
    ],
  },
  {
    id: 'drafts',
    badge: '9',
    color: 'bg-emerald-100 text-emerald-700',
    title: '下書き一覧・Drive の手順書・複製',
    items: [
      '下書き一覧では、端末内の下書きを「編集を再開」「複製」「削除」できます。「JSONから読み込む」で手元の JSON を取り込めます。',
      '「既存の手順書から作成」（トップ）と下書きの「複製」は、内容をそのままに、id・Drive の紐づけ・更新履歴・承認・作成者を引き継がない新しい手順書を作ります。部署の標準ひな形を Drive に置いておくと便利です。',
      '「Driveの手順書を編集」は同じファイルに上書き保存されます。一覧ではファイル名検索、並び替え、作成者・更新者・カテゴリ・部署・承認状態で絞り込めます。',
      '一覧は保存時に手順書へ付けた情報で表示するため速く開きます。古い手順書は一度開くか一括設定を通すと、次回から同じように速くなります。',
    ],
  },
  {
    id: 'bulk',
    badge: '10',
    color: 'bg-indigo-50 text-indigo-700',
    title: '一括設定・承認・通知',
    items: [
      '部署・カテゴリ・読み飛ばし防止は、複数の手順書を選んでまとめて変更できます。更新日時は変わりません。',
      '上長承認: 承認者が自分のアカウントでログインし、保存設定の「この版を承認済みにする」にチェックして完成保存します。承認後に内容が変わると「要再承認」になります。',
      '「承認を依頼」「手順書作成/改版を通知」: 完成済みの手順書を選ぶと、Gmail の作成画面に本文（手順書名と閲覧 URL）が入ります。',
    ],
  },
  {
    id: 'view',
    badge: '11',
    color: 'bg-slate-200 text-slate-700',
    title: '閲覧画面と手順書ビューア',
    items: [
      '閲覧画面では、概要・各ステップ・関連リンク・チェック項目を確認し、質問の答えを押すとその先の手順だけが表示されます。戻る答えを押すと、戻った先から答えを選び直します。',
      '左上の「目次」でステップ一覧、ヘッダーの検索ボタンで非表示のステップも含めた手順書内検索、「フロー図」で全体の流れを確認できます。',
      '閲覧画面からも「社内規定作業手順書」の Word 出力、更新履歴、承認履歴、ビューアの URL のコピー、「QRコード」（スマートフォンで読むとビューアで開く。PNG 保存・印刷可）ができます。完成保存の直後やトップの「QRコードを出力」からも同じ QR を出せます。',
      '「Viwer」から開く閲覧専用ビューアでは、ログイン後に Drive の手順書を一覧から選べます。ファイル名・本文の検索、部署・カテゴリの絞り込み、並び替え、表示形式の切り替えができます。',
    ],
  },
  {
    id: 'tips',
    badge: '12',
    color: 'bg-neutral-200 text-neutral-700',
    title: '困ったときの確認ポイント',
    items: [
      'Drive の操作ができない: 先にヘッダーの「Google Drive」でログインしてください。「再ログイン」が出ているときは押してください（1 クリックで続きから使えます）。',
      '完成保存でエラーになる: 保存先フォルダと必須項目（タイトル・カテゴリ・部署名・作成者名）を確認してください。失敗した内容は下書きに残っています。',
      '図で分岐を組み立てるに変換できない: 条件の選び方によって表示されないステップがある手順書は変換できません。表示される理由を確認してください。',
      'Gemini のタブが開かない: ポップアップがブロックされています。文章はコピー済みなので、Gemini を自分で開いて貼り付けてください。',
      '下書き容量が少ない: 下書き一覧で不要な下書きを削除してください。下書きは端末内にしか保存されません。',
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
      'ログインは自動で延長されます。延長できなかったときだけヘッダーに「再ログイン」が出るので押してください。',
      '右上のフォルダボタンで閲覧する手順書フォルダを選びます。一度選んだフォルダはこの端末に記録され、「よく使うフォルダ」から 1 クリックで切り替えられます。',
    ],
  },
  {
    id: 'v-list',
    badge: '3',
    color: 'bg-emerald-100 text-emerald-700',
    title: '一覧の使い方',
    items: [
      '「手順書をさがす」: ファイル名であいまい検索します。「ファイル内容も検索」を有効にすると手順の中身も対象になります。',
      '部署・カテゴリのボタン: 押すとその分類で絞り込めます。「すべて」で解除します。',
      '並び順: 名前順・更新が新しい順・よく見る順から選べます。表示形式は右上のボタンでリストとグリッドを切り替えられます。',
      '再読み込み（↻）: 一覧を最新の内容で読み直します。',
    ],
  },
  {
    id: 'v-view',
    badge: '4',
    color: 'bg-violet-100 text-violet-700',
    title: '閲覧画面の使い方',
    items: [
      '上部に概要、下にステップが番号順に並びます。注意事項は黄色の枠、チェック項目は青い枠で表示されます。',
      '質問のあるステップでは答えを押すと、その先の手順だけが表示されます。答えを選び直すとその先が切り替わり、戻る答えを押したときは戻った先から選び直します。',
      '左上の「目次」でステップ一覧、ヘッダーの検索ボタンで非表示のステップも含めた手順書内検索ができます。',
      '「フロー図」で全体の流れを確認し、「社内規定作業手順書」で会社規定の Word として出力できます。',
      '読み飛ばし防止モードの手順書は、「次へ」で 1 ステップずつ進みます。印刷はブラウザの印刷（Ctrl+P）を使います。',
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
      '手順書が表示されない: 先に「サインイン」でログインし、右上のフォルダボタンで保存先フォルダを選んでください。',
      '「ログインの有効期限が切れました」と出る: 「再ログイン」を押してください。手順書はそのまま読み直されます。',
      '一覧が空: 選択中のフォルダに手順書（JSON）があるか確認し、違うフォルダならフォルダボタンから選び直してください。',
      '探している手順が見当たらない: 分岐で非表示になっている可能性があります。ヘッダーの検索で手順書全体を検索するか、答えを選び直してください。',
    ],
  },
];

export default function HelpModal({ open, onClose }: HelpModalProps) {
  if (!open) return null;

  const sectionsToShow = VIEWER_ONLY ? viewerSections : sections;
  const guideTitle = VIEWER_ONLY ? '手順書ビューア 使い方ガイド' : '手順書作成システム 使い方ガイド';
  const guideSubtitle = VIEWER_ONLY
    ? 'ログイン、一覧での検索・絞り込み、手順書の閲覧方法をまとめています。'
    : '作成から分岐の組み立て、保存、出力、Drive 連携、閲覧専用ビューアまで、現在利用できる機能を作業の順にまとめています。';

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
