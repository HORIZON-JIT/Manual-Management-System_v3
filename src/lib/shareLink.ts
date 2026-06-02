import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { WorkInstruction } from '@/types/instruction';

const SHARE_PREFIX = 'share=';
const URL_MAX_LENGTH = 100_000;

export interface ShareResult {
  url: string;
  imagesIncluded: boolean;
}

export function generateShareUrl(
  instruction: WorkInstruction,
  baseUrl: string,
): ShareResult {
  // Attempt with full data including images
  const fullJson = JSON.stringify(instruction);
  const fullCompressed = compressToEncodedURIComponent(fullJson);
  const fullUrl = `${baseUrl}#${SHARE_PREFIX}${fullCompressed}`;

  if (fullUrl.length <= URL_MAX_LENGTH) {
    return { url: fullUrl, imagesIncluded: true };
  }

  // Fallback: strip images
  const stripped: WorkInstruction = {
    ...instruction,
    steps: instruction.steps.map((step) => {
      const strippedStep = { ...step };
      delete strippedStep.imageDataUrl;
      delete strippedStep.imageDataUrls;
      delete strippedStep.imageCaptions;
      return strippedStep;
    }),
  };
  const strippedJson = JSON.stringify(stripped);
  const strippedCompressed = compressToEncodedURIComponent(strippedJson);
  const strippedUrl = `${baseUrl}#${SHARE_PREFIX}${strippedCompressed}`;

  return { url: strippedUrl, imagesIncluded: false };
}

export function parseShareData(hash: string): WorkInstruction | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw.startsWith(SHARE_PREFIX)) return null;

  const encoded = raw.slice(SHARE_PREFIX.length);
  try {
    const json = decompressFromEncodedURIComponent(encoded);
    if (!json) return null;
    return JSON.parse(json) as WorkInstruction;
  } catch {
    return null;
  }
}

export function getViewPageBaseUrl(): string {
  const origin = window.location.origin;
  const basePath = process.env.NEXT_PUBLIC_REPO_NAME
    ? `/${process.env.NEXT_PUBLIC_REPO_NAME}`
    : '';
  return `${origin}${basePath}/instructions/view`;
}

/**
 * basePath（NEXT_PUBLIC_REPO_NAME ＋ NEXT_PUBLIC_BASE_SUBPATH。next.config.ts と同じ）を反映した
 * /instructions/<subRoute> の絶対URLを返す。別ウィンドウを window.open する際などに使う（client専用）。
 */
export function getInstructionsBaseUrl(subRoute: string): string {
  const origin = window.location.origin;
  const repo = process.env.NEXT_PUBLIC_REPO_NAME ? `/${process.env.NEXT_PUBLIC_REPO_NAME}` : '';
  const sub = process.env.NEXT_PUBLIC_BASE_SUBPATH ? `/${process.env.NEXT_PUBLIC_BASE_SUBPATH}` : '';
  const basePath = repo ? `${repo}${sub}` : '';
  return `${origin}${basePath}/instructions/${subRoute}`;
}
