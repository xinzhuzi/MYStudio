/**
 * Renderer-safe helpers for physical artifact references.
 *
 * Persisted workflow records may store a project file as either a relative
 * path (the inventory representation) or a `project-file://` URL (the live
 * Zustand representation).  The artifact tree needs the relative path, while
 * preview/reveal calls need the URL without wrapping it a second time.
 */

export interface ParsedProjectFilePath {
  projectId: string;
  relativePath: string;
}

function normalizeRelativePath(value: string): string | null {
  if (!value || value.includes("\0")) return null;
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (!normalized || normalized === ".") return null;
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "..")) return null;
  return segments.join("/");
}

/** Parse a project-file URL without importing Electron/node storage code. */
export function parseProjectFilePath(value: string): ParsedProjectFilePath | null {
  const match = /^project-file:\/\/([^/]+)\/(.+)$/i.exec(value);
  if (!match) return null;
  try {
    const projectId = decodeURIComponent(match[1]!);
    const relativePath = normalizeRelativePath(
      match[2]!
        .split("/")
        .map((segment) => decodeURIComponent(segment))
        .join("/"),
    );
    if (!projectId || projectId.includes("/") || projectId.includes("\\") || !relativePath) {
      return null;
    }
    return { projectId, relativePath };
  } catch {
    return null;
  }
}

/**
 * Return a project-relative path for a tree/ref action.
 *
 * Absolute paths and non-project protocols are intentionally rejected: they
 * belong to the local-media/OS boundary and must not be projected into a
 * project's local file tree.
 */
export function normalizeArtifactPhysicalPath(
  value: string,
  expectedProjectId?: string,
): string | null {
  const parsed = parseProjectFilePath(value);
  if (parsed) {
    return expectedProjectId && parsed.projectId !== expectedProjectId
      ? null
      : parsed.relativePath;
  }
  if (value.includes("://") || /^\/(?:\/)?|^[A-Za-z]:[\\/]/.test(value)) return null;
  return normalizeRelativePath(value);
}

export function getArtifactPhysicalDirectory(
  value: string,
  expectedProjectId?: string,
): string | null {
  const normalized = normalizeArtifactPhysicalPath(value, expectedProjectId);
  if (!normalized) return null;
  const separator = normalized.lastIndexOf("/");
  return separator === -1 ? "" : normalized.slice(0, separator);
}
