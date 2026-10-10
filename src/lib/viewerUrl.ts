/**
 * 閲覧専用ビューア（現場向け）の URL。
 * 作成アプリとビューアは同じサイトの別パスに置かれているため、固定で持つ。
 */
export const VIEWER_URL = 'https://horizon-jit.github.io/Manual-Management-System_v3/viewer/';

/** 作成・編集ができる手順書作成システム（ルート）の URL */
export const EDITOR_URL = 'https://horizon-jit.github.io/Manual-Management-System_v3/';

/** Drive 上の手順書を作成システムの閲覧画面（編集ボタンあり）で開く URL。タスクマスタの手順書URL に使う */
export function editorInstructionUrl(driveFileId: string): string {
  return `${EDITOR_URL}instructions/view?driveFileId=${encodeURIComponent(driveFileId)}`;
}

/** Drive 上の手順書を閲覧専用ビューアで開く URL（QR コードや案内メールに使う） */
export function viewerInstructionUrl(driveFileId: string): string {
  return `${VIEWER_URL}instructions/view?driveFileId=${encodeURIComponent(driveFileId)}`;
}
