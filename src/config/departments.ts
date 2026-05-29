/**
 * 課別設定（department configuration）
 *
 * 同一コードを、課ごとの設定だけ変えて動かすための仕組み。
 * どの課の設定で動かすかは環境変数 NEXT_PUBLIC_DEPARTMENT で選ぶ。
 *   例) NEXT_PUBLIC_DEPARTMENT=viewer npm run build
 * 未指定の場合は DEFAULT_DEPARTMENT（資材課）として動作する。
 *
 * 課ごとの違いは下の DepartmentConfig に項目を追加していく。
 * （保存先フォルダの既定値、利用カテゴリ、ロゴ、テーマ既定値など、
 *   差分が必要になったらここに足すだけで全画面に反映できる）
 */
export interface DepartmentConfig {
  /** 識別子（NEXT_PUBLIC_DEPARTMENT に指定する値） */
  key: string;
  /** 課の表示名 */
  name: string;
  /** ヘッダー左上のブランド表記 */
  brandLabel: string;
  /** 閲覧専用エディションか（true で作成・編集・下書きを無効化し、ホームを手順書一覧にする） */
  viewerOnly: boolean;
}

/** 課別設定のレジストリ。課を増やすときはここに追記する。 */
export const DEPARTMENTS = {
  /** 資材課：作成・編集が可能なフル機能版（既定） */
  materials: {
    key: 'materials',
    name: '資材課',
    brandLabel: 'MANUAL SYSTEM',
    viewerOnly: false,
  },
  /** 生産管理：いまは資材課と同等。差分は今後ここで定義する */
  production: {
    key: 'production',
    name: '生産管理',
    brandLabel: 'MANUAL SYSTEM',
    viewerOnly: false,
  },
  /** 現場閲覧：閲覧専用エディション */
  viewer: {
    key: 'viewer',
    name: '現場閲覧',
    brandLabel: 'MANUAL VIEWER',
    viewerOnly: true,
  },
} satisfies Record<string, DepartmentConfig>;

export type DepartmentKey = keyof typeof DEPARTMENTS;

/** 環境変数が未指定・不正なときに使う既定の課 */
export const DEFAULT_DEPARTMENT: DepartmentKey = 'materials';

function resolveDepartment(): DepartmentConfig {
  const key = process.env.NEXT_PUBLIC_DEPARTMENT as DepartmentKey | undefined;
  if (key && key in DEPARTMENTS) return DEPARTMENTS[key];
  return DEPARTMENTS[DEFAULT_DEPARTMENT];
}

/** 現在のビルド/起動で有効な課別設定。 */
export const DEPARTMENT: DepartmentConfig = resolveDepartment();
