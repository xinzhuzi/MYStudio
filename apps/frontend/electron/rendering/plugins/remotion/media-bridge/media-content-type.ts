/**
 * Media bridge content-type resolution.
 *
 * The bridge serves only assets that were validated and registered by the host,
 * so extension-based lookup is sufficient. Unknown extensions fall back to a
 * generic binary type rather than guessing.
 */

const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
};

export const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * Resolve a Content-Type from an absolute file path's extension.
 * Case-insensitive; returns {@link DEFAULT_CONTENT_TYPE} for unknown extensions.
 */
export function resolveContentType(absolutePath: string): string {
  const dot = absolutePath.lastIndexOf(".");
  if (dot < 0) {
    return DEFAULT_CONTENT_TYPE;
  }
  const ext = absolutePath.slice(dot).toLowerCase();
  return CONTENT_TYPE_BY_EXTENSION[ext] ?? DEFAULT_CONTENT_TYPE;
}
