// Project-file URL helpers — renderer-side mirror of the
// `project-file://<projectId>/<relative path>` scheme implemented in
// electron/storage/storage-paths.ts (each path segment encodeURIComponent'd).
// Kept in sync for the upscale flow, which computes sibling output paths from
// an existing image URL before invoking the main-process worker.

export interface ParsedProjectFileUrl {
  projectId: string;
  relativePath: string;
}

export function parseProjectFileUrl(url: string): ParsedProjectFileUrl | null {
  const match = url.match(/^project-file:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  let projectId: string;
  try {
    projectId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const segments = match[2].split("/").map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return "";
    }
  });
  if (!projectId || segments.some((part) => !part || part === "." || part === "..")) return null;
  return { projectId, relativePath: segments.join("/") };
}

/**
 * `project-file://<projectId>/<relative path>` 的全仓唯一渲染端拼装点
 * (08-24 用户裁定:store 一律落本 scheme 拼接路径,绝不写绝对路径,
 * 拼装逻辑不得散落内联模板)。传入已是本项目的 project-file 引用时
 * 原样返回(幂等);属于其他项目则抛错。
 */
export function buildProjectFileUrl(projectId: string, relativePath: string): string {
  const existing = parseProjectFileUrl(relativePath);
  if (existing) {
    if (existing.projectId !== projectId) {
      throw new Error("项目文件引用属于其他项目");
    }
    return relativePath;
  }
  const encoded = relativePath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `project-file://${encodeURIComponent(projectId)}/${encoded}`;
}

/** Sibling output path for an upscaled image: same directory, new filename. */
export function siblingProjectFilePath(relativePath: string, filename: string): string {
  const segments = relativePath.replace(/\\/g, "/").split("/");
  segments[segments.length - 1] = filename;
  return segments.join("/");
}

export interface ParsedLocalImageUrl {
  category: string;
  filename: string;
}

/** `local-image://<category>/<filename>` media reference (imported materials). */
export function parseLocalImageUrl(url: string): ParsedLocalImageUrl | null {
  const match = url.match(/^local-image:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const segments = match[2].split("/");
  if (segments.some((part) => !part || part === "." || part === "..")) return null;
  return { category: match[1], filename: match[2] };
}

export function buildLocalImageUrl(category: string, filename: string): string {
  return `local-image://${encodeURIComponent(category)}/${encodeURIComponent(filename)}`;
}

export function siblingLocalImageUrl(url: string, filename: string): string | null {
  const parsed = parseLocalImageUrl(url);
  if (!parsed) return null;
  return buildLocalImageUrl(parsed.category, filename);
}

/** Either URL/reference kind an upscale input can carry. */
export type UpscaleMediaRef =
  | { kind: "project-file"; projectId: string; relativePath: string }
  | { kind: "local-image"; category: string; filename: string }
  | { kind: "asset-file"; relativePath: string };

/**
 * `asset-file://<category>/<rest>` —— APP 受管资产树虚拟引用的渲染端镜像
 * (主进程权威实现=electron/storage/storage-paths.ts,解析走 asset-file 协议)。
 */
export function buildAssetFileUrl(relativePath: string, options?: { thumb?: boolean }): string {
  const encoded = relativePath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `asset-file://${encoded}${options?.thumb ? "?thumb=1" : ""}`;
}

export function parseAssetFileUrl(url: string): { relativePath: string; thumb: boolean } | null {
  const match = url.match(/^asset-file:\/\/([^?]+)(\?.*)?$/);
  if (!match) return null;
  const segments = match[1].split("/").map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return "";
    }
  });
  if (segments.some((part) => !part || part === "." || part === "..")) return null;
  return { relativePath: segments.join("/"), thumb: /[?&]thumb=1\b/.test(match[2] ?? "") };
}

export function parseUpscaleMediaRef(url: string): UpscaleMediaRef | null {
  if (url.startsWith("local-image://")) {
    const parsed = parseLocalImageUrl(url);
    return parsed ? { kind: "local-image", ...parsed } : null;
  }
  const project = parseProjectFileUrl(url);
  return project ? { kind: "project-file", ...project } : null;
}

/** Build the sibling output reference of the same kind as the input. */
export function siblingOutputRef(input: UpscaleMediaRef, filename: string): string | null {
  if (input.kind === "local-image") return buildLocalImageUrl(input.category, filename);
  if (input.kind === "asset-file") {
    return buildAssetFileUrl(siblingProjectFilePath(input.relativePath, filename));
  }
  return buildProjectFileUrl(input.projectId, siblingProjectFilePath(input.relativePath, filename));
}

/** The request payload path field for a parsed reference (relative path or URL). */
export function mediaRefRequestPath(ref: UpscaleMediaRef): string {
  return ref.kind === "local-image"
    ? buildLocalImageUrl(ref.category, ref.filename)
    : ref.relativePath;
}
