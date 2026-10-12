/**
 * 「動画から作成」は検証中のため、簡易なパスワードで入口を絞る。
 * 静的サイトなので厳重な認証ではなく、検証担当だけが入るための扉。
 * 解除状態はタブ単位（sessionStorage）で、タブを閉じると再び求める。
 */
export const FROM_VIDEO_PASSWORD = '5858';
const KEY = 'from_video_unlocked';

export function isFromVideoUnlocked(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function unlockFromVideo(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // 保存できない環境では毎回入力してもらう
  }
}

export function checkFromVideoPassword(input: string): boolean {
  return input.trim() === FROM_VIDEO_PASSWORD;
}
