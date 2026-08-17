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

// ---------------------------------------------------------------------------
// Per-project external locations (optional, injectable).
//
// When a resolver is injected and a project id hits the location table, all
// `_p/<pid>`-prefixed keys resolve against the external project root instead
// of `<dataRoot>/_p/<pid>`. Without a resolver — or for unknown project ids —
// every function below behaves byte-for-byte like the legacy implementation.
// ---------------------------------------------------------------------------

export type ProjectLocationResolver = (projectId: string) => string | undefined;

// rollup 分包可能把本模块打进多个 chunk（主进程 index 与共享 chunk 各一份），
// 模块级变量会分裂成互不相通的实例——main.ts 注入的 resolver 落不到 handlers
// 用的那份（实测打挂外部位置项目的全部 project-file 解析）。改挂 globalThis
// （Symbol.for 全局单例）保证任何副本共享同一 resolver。
const PROJECT_LOCATION_RESOLVER_KEY = Symbol.for("mystudio.project-location-resolver");
type ResolverGlobal = typeof globalThis & { [PROJECT_LOCATION_RESOLVER_KEY]?: ProjectLocationResolver };

export function setProjectLocationResolver(resolver: ProjectLocationResolver | null): void {
  (globalThis as ResolverGlobal)[PROJECT_LOCATION_RESOLVER_KEY] = resolver ?? undefined;
}

function lookupProjectLocation(projectId: string): string | undefined {
  const resolver = (globalThis as ResolverGlobal)[PROJECT_LOCATION_RESOLVER_KEY];
  if (!resolver) return undefined;
  try {
    const location = resolver(projectId);
    return typeof location === "string" && location ? location : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `_p/{projectId}/...` 虚拟键重定向:已注册外部位置 → {location}/rest;未注册 → 原 dataRoot 相对路径。
 * file-storage / project-file(文本与二进制) 共用的单一转换点,_p 前缀在磁盘上不产生中间目录。
 */
export function redirectProjectScopedKey(
  dataRoot: string,
  normalizedKey: string,
): { root: string; rest: string } {
  const segments = normalizedKey.split("/");
  if (segments[0] !== "_p" || segments.length < 2 || !segments[1]) {
    return { root: dataRoot, rest: normalizedKey };
  }
  const location = lookupProjectLocation(segments[1]);
  if (!location) return { root: dataRoot, rest: normalizedKey };
  return { root: location, rest: segments.slice(2).join("/") };
}

export function resolveDataFilePath(dataRoot: string, key: string) {
  const normalizedKey = normalizeRelativePath(key, "storage key");
  const scope = redirectProjectScopedKey(dataRoot, normalizedKey);
  return assertInsideRoot(scope.root, path.resolve(scope.root, `${scope.rest}.json`), "Storage key");
}

export function resolveDataDirPath(dataRoot: string, prefix: string) {
  const normalizedPrefix = normalizeRelativePath(prefix, "storage prefix");
  const scope = redirectProjectScopedKey(dataRoot, normalizedPrefix);
  return assertInsideRoot(scope.root, path.resolve(scope.root, scope.rest), "Storage prefix");
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
  const location = lookupProjectLocation(normalizedProjectId);
  const resolved = location
    ? path.resolve(location, normalizedRelativePath)
    : path.resolve(dataRoot, "_p", normalizedProjectId, normalizedRelativePath);
  return assertInsideRoot(location ?? dataRoot, resolved, "Project file path");
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
  const location = lookupProjectLocation(normalizedProjectId);
  const resolved = location
    ? path.resolve(location)
    : path.resolve(dataRoot, "_p", normalizedProjectId);

  return assertInsideRoot(location ?? dataRoot, resolved, "Project root path");
}

export function resolveProjectFileUrl(dataRoot: string, projectFileUrl: string) {
  const parsed = parseProjectFileUrl(projectFileUrl);
  if (!parsed) throw new Error("Invalid project file URL");
  return resolveProjectScopedFilePath(dataRoot, parsed.projectId, parsed.relativePath);
}
