/**
 * アプリの動作モード。
 *
 * 実体は課別設定（src/config/departments.ts）に集約されており、
 * ここではよく使う値を再エクスポートする薄いラッパー。
 * どの課で動くかは環境変数 NEXT_PUBLIC_DEPARTMENT で決まる。
 */
import { DEPARTMENT } from '@/config/departments';

export { DEPARTMENT };

/** 閲覧専用エディションか（作成・編集・下書きを無効化し、ホームを手順書一覧にする）。 */
export const VIEWER_ONLY = DEPARTMENT.viewerOnly;
