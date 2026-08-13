import type { PhysicalRef } from "@/types/artifacts";
import { getRefPreviewMode } from "./ref-preview-mode";
import { parseProjectFilePath } from "./physical-path";

/**
 * Resolved preview descriptor for a PhysicalRef.
 */
export type ResolvedRefPreview =
  | {
      mode: "image";
      /** data URL (data:mime;base64,...) for inline <img> */
      dataUrl: string;
      mimeType?: string;
      bytes?: number;
    }
  | {
      mode: "markdown" | "json" | "text";
      text: string;
      truncated: boolean;
      bytes?: number;
    }
  | {
      mode: "audio" | "video";
      /** Absolute filesystem path — render as `file://${absolutePath}` for <audio>/<video> */
      absolutePath: string;
    }
  | {
      mode: "binary";
      message: string;
    };

/**
 * Renderer-safe construction of a `project-file://` URL.
 *
 * We deliberately do NOT import storage-paths.ts (it pulls in node:fs).
 * This mirrors the encoding already validated in shot-plan.ts /
 * storyboard-tts-runner.ts: `project-file://${enc(projectId)}/${enc(rel)}`.
 * The main process re-validates containment, so exact encoding only needs to
 * match what createProjectFileUrl produces for ordinary paths.
 */
export function buildProjectFileUrl(projectId: string, relativePath: string): string {
  const parsed = parseProjectFilePath(relativePath);
  if (parsed) {
    if (parsed.projectId !== projectId) {
      throw new Error("项目文件引用属于其他项目");
    }
    return relativePath;
  }
  return `project-file://${encodeURIComponent(projectId)}/${relativePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

/**
 * Convert an absolute filesystem path to a file:// URL for <audio>/<video> src.
 *
 * Windows bare paths (`C:\\Users\\foo\\bar.mp4`) need `file:///C:/...` (three
 * slashes + forward slashes); Unix paths (`/media/x.mp4`) need `file:///x.mp4`.
 * Mirrors the proven transforms in local-media-ipc.ts:220 and
 * local-image.tsx:normalizeImageSrc. See DRY note in lib/io/file-url.ts.
 */
export function toFileUrl(absolutePath: string): string {
  if (absolutePath.startsWith("file://")) return absolutePath;
  const normalized = absolutePath.replace(/\\/g, "/");
  // Windows drive path (C:/...) -> file:///C:/...
  if (/^[a-z]:\//i.test(normalized)) return `file:///${encodeURI(normalized)}`;
  // Unix absolute path (/...) -> file:///...
  return `file://${encodeURI(normalized)}`;
}

/** Routes a PhysicalRef to its preview data using the two preload surfaces. */
export async function resolveRefPreview(
  ref: PhysicalRef,
  projectId: string,
): Promise<ResolvedRefPreview> {
  try {
    return await resolveRefPreviewInner(ref, projectId);
  } catch {
    // Catch-all: any unexpected error during preview resolution (IPC failure,
    // malformed data, parser crash, etc.) degrades to a calm "binary" message
    // instead of propagating an exception that would render a red error UI.
    return { mode: "binary", message: "该内容为二进制格式,无法预览" };
  }
}

async function resolveRefPreviewInner(
  ref: PhysicalRef,
  projectId: string,
): Promise<ResolvedRefPreview> {
  const mode = getRefPreviewMode(ref.path);
  const isLocalMedia = ref.type === "local-media";

  if (mode === "binary") {
    return { mode: "binary", message: "该文件格式无法在应用内预览" };
  }

  if (mode === "image") {
    if (isLocalMedia) {
      const res = await window.imageStorage?.readAsBase64(ref.path);
      if (!res?.success || !res.base64) {
        return { mode: "binary", message: res?.error || "图片读取失败" };
      }
      return { mode: "image", dataUrl: res.base64, mimeType: res.mimeType, bytes: res.size };
    }
    const url = buildProjectFileUrl(projectId, ref.path);
    const res = await window.projectFiles?.readAsBase64(url);
    if (!res?.success || !res.base64) {
      return { mode: "binary", message: res?.error || "图片读取失败" };
    }
    return { mode: "image", dataUrl: res.base64, mimeType: res.mimeType, bytes: res.size };
  }

  if (mode === "audio" || mode === "video") {
    if (isLocalMedia) {
      const abs = await window.imageStorage?.getAbsolutePath(ref.path);
      if (!abs) return { mode: "binary", message: "无法定位媒体文件" };
      return { mode, absolutePath: abs };
    }
    const url = buildProjectFileUrl(projectId, ref.path);
    const abs = await window.projectFiles?.getAbsolutePath(url);
    if (!abs) return { mode: "binary", message: "无法定位媒体文件" };
    return { mode, absolutePath: abs };
  }

  // markdown / json / text — read via project-file-read-text (object payload)
  if (isLocalMedia) {
    return { mode: "binary", message: "媒体库文件不支持文本预览" };
  }
  const parsed = parseProjectFilePath(ref.path);
  if (parsed && parsed.projectId !== projectId) {
    return { mode: "binary", message: "项目文件引用属于其他项目" };
  }
  const res = await window.projectFiles?.readText({
    projectId: parsed?.projectId ?? projectId,
    relativePath: parsed?.relativePath ?? ref.path,
  });
  if (!res?.success || res.text === undefined) {
    return { mode: "binary", message: res?.error || "文本读取失败" };
  }

  // Content sniffing: validate that .json files actually contain JSON.
  // The preview mode is derived from the file extension (ref-preview-mode.ts),
  // but a .json store file may embed free-form agent-workflow output strings
  // (e.g. "__弓妍静_____年龄___不详_____性别___女___1779988670440") that are not
  // valid JSON. Feeding such content into CodeMirror's json() language parser
  // crashes the preview. If JSON.parse fails, treat the content as
  // unrecognizable and decline to preview rather than crashing.
  if (mode === "json") {
    try {
      JSON.parse(res.text);
    } catch {
      return { mode: "binary", message: "该内容为二进制格式,无法预览" };
    }
  }

  return {
    mode,
    text: res.text,
    truncated: res.truncated ?? false,
    bytes: res.size,
  };
}
