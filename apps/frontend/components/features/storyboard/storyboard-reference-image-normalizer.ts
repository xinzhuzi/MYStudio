interface NormalizeStoryboardReferenceImagesOptions {
  readLocalImage: (url: string) => Promise<string | null | undefined>;
  max?: number;
  validateLocalDataUri?: boolean;
  onReadError?: (url: string, error: unknown) => void;
}

function isImageDataUri(value: string): boolean {
  return value.startsWith("data:image/") && value.includes(";base64,");
}

export async function normalizeStoryboardReferenceImages(
  references: readonly string[],
  {
    readLocalImage,
    max,
    validateLocalDataUri = false,
    onReadError,
  }: NormalizeStoryboardReferenceImagesOptions,
): Promise<string[]> {
  const normalized: string[] = [];
  const limitedReferences = max === undefined ? references : references.slice(0, max);

  for (const url of limitedReferences) {
    if (!url) continue;
    if (url.startsWith("http://") || url.startsWith("https://") || isImageDataUri(url)) {
      normalized.push(url);
      continue;
    }
    if (!url.startsWith("local-image://")) continue;

    try {
      const base64 = await readLocalImage(url);
      if (base64 && (!validateLocalDataUri || isImageDataUri(base64))) normalized.push(base64);
    } catch (error) {
      onReadError?.(url, error);
    }
  }

  return normalized;
}
