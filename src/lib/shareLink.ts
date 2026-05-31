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
