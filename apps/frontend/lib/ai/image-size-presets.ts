export const IMAGE_ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "21:9",
  "9:21",
] as const;

export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;

export type ImageAspectRatio = typeof IMAGE_ASPECT_RATIOS[number];
export type ImageResolution = typeof IMAGE_RESOLUTIONS[number];
export type HorizontalVerticalImageAspectRatio = Extract<ImageAspectRatio, "16:9" | "9:16">;

export const DEFAULT_IMAGE_ASPECT_RATIO: ImageAspectRatio = "16:9";
export const DEFAULT_IMAGE_RESOLUTION: ImageResolution = "2K";
export const DEFAULT_COMPATIBILITY_RETRY_ASPECT_RATIO: ImageAspectRatio = "1:1";
export const DEFAULT_COMPATIBILITY_RETRY_RESOLUTION: ImageResolution = "1K";

export type ImageRequestTemplateName = "openai-size" | "provider-extension";

export interface ResolveImageSizeInput {
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
}

const GPT_IMAGE_MAX_EDGE = 3840;
const GPT_IMAGE_MIN_PIXELS = 655_360;
const GPT_IMAGE_MAX_PIXELS = 8_294_400;
const GPT_IMAGE_MAX_RATIO = 3;

export const GPT_IMAGE_SIZE_MAP: Record<ImageAspectRatio, Record<ImageResolution, string>> = {
  "1:1": { "1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880" },
  "16:9": { "1K": "1280x720", "2K": "2048x1152", "4K": "3840x2160" },
  "9:16": { "1K": "720x1280", "2K": "1152x2048", "4K": "2160x3840" },
  "4:3": { "1K": "1152x864", "2K": "2048x1536", "4K": "3264x2448" },
  "3:4": { "1K": "864x1152", "2K": "1536x2048", "4K": "2448x3264" },
  "3:2": { "1K": "1248x832", "2K": "2016x1344", "4K": "3520x2352" },
  "2:3": { "1K": "832x1248", "2K": "1344x2016", "4K": "2352x3520" },
  "21:9": { "1K": "1280x544", "2K": "2048x880", "4K": "3840x1648" },
  "9:21": { "1K": "544x1280", "2K": "880x2048", "4K": "1648x3840" },
};

export function normalizeImageAspectRatio(aspectRatio?: string): ImageAspectRatio {
  return IMAGE_ASPECT_RATIOS.includes(aspectRatio as ImageAspectRatio)
    ? aspectRatio as ImageAspectRatio
    : DEFAULT_IMAGE_ASPECT_RATIO;
}

export function normalizeImageResolution(resolution?: string): ImageResolution {
  const normalized = (resolution || DEFAULT_IMAGE_RESOLUTION).toUpperCase();
  return IMAGE_RESOLUTIONS.includes(normalized as ImageResolution)
    ? normalized as ImageResolution
    : DEFAULT_IMAGE_RESOLUTION;
}

export function normalizeHorizontalVerticalAspectRatio(
  aspectRatio?: string,
  fallback: HorizontalVerticalImageAspectRatio = "9:16",
): HorizontalVerticalImageAspectRatio {
  return aspectRatio === "16:9" || aspectRatio === "9:16" ? aspectRatio : fallback;
}

export function parseImageSize(size: string): { width: number; height: number } | undefined {
  const match = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!match) return undefined;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function validateGptImageSize(size: string): { valid: true } | { valid: false; reason: string } {
  const parsed = parseImageSize(size);
  if (!parsed) return { valid: false, reason: "size must use WIDTHxHEIGHT format" };
  const { width, height } = parsed;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { valid: false, reason: "size dimensions must be positive numbers" };
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    return { valid: false, reason: "width and height must be multiples of 16" };
  }
  if (Math.max(width, height) > GPT_IMAGE_MAX_EDGE) {
    return { valid: false, reason: "size edge exceeds 3840" };
  }
  if (Math.max(width, height) / Math.min(width, height) > GPT_IMAGE_MAX_RATIO) {
    return { valid: false, reason: "aspect ratio exceeds 3:1" };
  }
  const pixels = width * height;
  if (pixels < GPT_IMAGE_MIN_PIXELS || pixels > GPT_IMAGE_MAX_PIXELS) {
    return { valid: false, reason: "pixel count is outside gpt-image range" };
  }
  return { valid: true };
}

export function resolveGptImageSize(input: ResolveImageSizeInput): { size: string; templateName: "openai-size" } {
  const explicitSize = input.width && input.height ? `${input.width}x${input.height}` : undefined;
  if (explicitSize && validateGptImageSize(explicitSize).valid) {
    return { size: explicitSize, templateName: "openai-size" };
  }
  const aspectRatio = normalizeImageAspectRatio(input.aspectRatio);
  const resolution = normalizeImageResolution(input.resolution);
  return { size: GPT_IMAGE_SIZE_MAP[aspectRatio][resolution], templateName: "openai-size" };
}

export function getImageSizeLabel(input: ResolveImageSizeInput): string {
  return resolveGptImageSize(input).size;
}

export function resolveImageDimensions(input: ResolveImageSizeInput): { width: number; height: number } | undefined {
  return parseImageSize(resolveGptImageSize(input).size);
}
