/**
 * アプリの動作モード。
 *
 * NEXT_PUBLIC_VIEWER_ONLY=true でビルド/起動すると「閲覧専用エディション」になり、
 * 新規作成・編集・下書き機能が無効化され、ホームが手順書一覧（閲覧）になる。
 * 未設定（既定）では従来どおり作成・編集が可能な資材課エディションとして動作する。
 *
 * NEXT_PUBLIC_ プレフィックスのため、この値はビルド時にクライアントへ埋め込まれる。
 */
export const VIEWER_ONLY = process.env.NEXT_PUBLIC_VIEWER_ONLY === 'true';
