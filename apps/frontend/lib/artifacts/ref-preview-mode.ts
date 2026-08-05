/**
 * Preview-mode classification for a PhysicalRef by file path.
 *
 * A PhysicalRef has no mimeType field, so the preview mode is derived from the
 * path extension. This map is the single source of truth for "which extensions
 * can be previewed and how" — the IPC layer relies on it indirectly (binary
 * mode = no read attempt).
 *
 * Modes:
 *  - image     : inline <img> via base64
 *  - markdown  : react-markdown render
 *  - json      : CodeMirror readOnly (json())
 *  - text      : CodeMirror readOnly (plain)
 *  - audio     : <audio> via absolute path
 *  - video     : <video> via absolute path
 *  - binary    : not previewable (show "无法预览")
 */

export type PreviewMode =
  | "image"
  | "markdown"
  | "json"
  | "text"
  | "audio"
  | "video"
  | "binary";

const EXT_MAP: Record<string, PreviewMode> = {
  // images
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  svg: "image",
  // markdown
  md: "markdown",
  markdown: "markdown",
  // json (structured text)
  json: "json",
  jsonl: "json",
  geojson: "json",
  // audio
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
  flac: "audio",
  aac: "audio",
  // video
  mp4: "video",
  webm: "video",
  mov: "video",
  mkv: "video",
  avi: "video",
  // plain text (broad set — these are read via project-file-read-text)
  txt: "text",
  log: "text",
  csv: "text",
  tsv: "text",
  ini: "text",
  toml: "text",
  yaml: "text",
  yml: "text",
  srt: "text",
  vtt: "text",
  html: "text",
  htm: "text",
  css: "text",
  js: "text",
  ts: "text",
  tsx: "text",
  jsx: "text",
  py: "text",
  sh: "text",
  env: "text",
};

/**
 * Extract the lowercased extension (without dot) from a path. Handles protocol
 * URLs (e.g. "local-image://...png", "project-file://pid/rel/path.JSON") and
 * query strings.
 */
export function getPathExtension(inputPath: string): string {
  // Strip protocol scheme and query/hash so extension detection works on
  // local-image://, local-video:// and project-file:// URLs alike.
  const cleaned = inputPath
    .replace(/^[a-zA-Z]+:\/\//, "")
    .split("?")[0]
    .split("#")[0];
  const dot = cleaned.lastIndexOf(".");
  if (dot < 0 || dot === cleaned.length - 1) return "";
  const ext = cleaned.slice(dot + 1).toLowerCase();
  // Guard against directory-ish trailing dots or weird extensions.
  return /^[a-z0-9]+$/.test(ext) ? ext : "";
}

/**
 * Resolve the preview mode for a file path. Unknown / no-extension / executable
 * files fall back to "binary" (not previewable).
 */
export function getRefPreviewMode(inputPath: string): PreviewMode {
  const ext = getPathExtension(inputPath);
  if (!ext) return "binary";
  return EXT_MAP[ext] ?? "binary";
}

/**
 * Whether a mode is previewable at all (binary is not).
 */
export function isPreviewable(mode: PreviewMode): boolean {
  return mode !== "binary";
}
