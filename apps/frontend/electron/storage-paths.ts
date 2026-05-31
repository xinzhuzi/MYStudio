import path from "node:path";

function assertInsideRoot(root: string, target: string, label: string) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(normalizedRoot + path.sep)) {
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
