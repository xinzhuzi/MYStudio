import fs from "node:fs";
import path from "node:path";

function canonicalPath(input: string) {
  const unresolved: string[] = [];
  let current = path.resolve(input);
  while (true) {
    try {
      const resolved = fs.realpathSync(current);
      return path.join(resolved, ...unresolved);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(input);
      unresolved.unshift(path.basename(current));
      current = parent;
    }
  }
}

function assertInsideRoot(root: string, target: string, label: string) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  const canonicalRoot = canonicalPath(normalizedRoot);
  const canonicalTarget = canonicalPath(normalizedTarget);
  if (canonicalTarget !== canonicalRoot && !canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(`${label} escapes storage root`);
  }
  return normalizedTarget;
}

function normalizeRelativePath(value: string, label: string) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error(`Invalid ${label}`);
  }
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) {
    throw new Error(`Invalid ${label}`);
  }
  if (normalized.split("/").includes("..")) {
    throw new Error(`${label} escapes storage root`);
  }
  return normalized;
}

function normalizePathSegment(value: string, label: string) {
  const normalized = normalizeRelativePath(value, label);
  if (normalized.includes("/")) {
    throw new Error(`${label} escapes storage root`);
  }
  return normalized;
}

function encodeRelativePath(value: string) {
  return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}

export function resolveDataFilePath(dataRoot: string, key: string) {
  const normalizedKey = normalizeRelativePath(key, "storage key");
  return assertInsideRoot(dataRoot, path.resolve(dataRoot, `${normalizedKey}.json`), "Storage key");
}

export function resolveDataDirPath(dataRoot: string, prefix: string) {
  const normalizedPrefix = normalizeRelativePath(prefix, "storage prefix");
  return assertInsideRoot(dataRoot, path.resolve(dataRoot, normalizedPrefix), "Storage prefix");
}

export function parseLocalMediaPath(localPath: string) {
  const match = localPath.match(/^local-(?:image|video):\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const category = decodeURIComponent(match[1]);
  const filename = decodeURIComponent(match[2]);
  return {
    category: normalizeRelativePath(category, "local media category"),
    filename: normalizeRelativePath(filename, "local media filename"),
  };
}

export function resolveLocalMediaPath(mediaRoot: string, localPath: string) {
  const parsed = parseLocalMediaPath(localPath);
  if (!parsed) throw new Error("Invalid local media path");
  return assertInsideRoot(mediaRoot, path.resolve(mediaRoot, parsed.category, parsed.filename), "Local media path");
}

export function createProjectFileUrl(projectId: string, relativePath: string) {
  const normalizedProjectId = normalizePathSegment(projectId, "project id");
  const normalizedRelativePath = normalizeRelativePath(relativePath, "project file path");
  return `project-file://${encodeURIComponent(normalizedProjectId)}/${encodeRelativePath(normalizedRelativePath)}`;
}

export function parseProjectFileUrl(projectFileUrl: string) {
  const match = projectFileUrl.match(/^project-file:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const projectId = normalizePathSegment(decodeURIComponent(match[1]), "project id");
  const relativePath = normalizeRelativePath(
    match[2].split("/").map((part) => decodeURIComponent(part)).join("/"),
    "project file path",
  );
  return { projectId, relativePath };
}

export function resolveProjectScopedFilePath(dataRoot: string, projectId: string, relativePath: string) {
  const normalizedProjectId = normalizePathSegment(projectId, "project id");
  const normalizedRelativePath = normalizeRelativePath(relativePath, "project file path");
  return assertInsideRoot(
    dataRoot,
    path.resolve(dataRoot, "_p", normalizedProjectId, normalizedRelativePath),
    "Project file path",
  );
}

/**
 * Resolve project root directory path: ${dataRoot}/_p/{normalizedProjectId}
 *
 * SECURITY CRITICAL: Uses realpath containment check via assertInsideRoot().
 * This prevents symlink escape attacks where someone creates:
 *   dataRoot/_p/malicious -> symlink -> /etc/passwd
 *
 * Use this instead of resolveProjectScopedFilePath(..., "") which throws on empty string.
 *
 * @param dataRoot - Base application data directory
 * @param projectId - Normalized project ID string
 * @returns Absolute path to project root directory (_p/{projectId})
 * @throws AssertionError if path escapes dataRoot containment
 */
export function resolveProjectRootPath(dataRoot: string, projectId: string): string {
  const normalizedProjectId = normalizePathSegment(projectId, "project id");
  const resolved = path.resolve(dataRoot, "_p", normalizedProjectId);

  return assertInsideRoot(dataRoot, resolved, "Project root path");
}

export function resolveProjectFileUrl(dataRoot: string, projectFileUrl: string) {
  const parsed = parseProjectFileUrl(projectFileUrl);
  if (!parsed) throw new Error("Invalid project file URL");
  return resolveProjectScopedFilePath(dataRoot, parsed.projectId, parsed.relativePath);
}
