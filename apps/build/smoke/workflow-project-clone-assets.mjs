import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const STORE_LAYOUT_SEGMENTS = new Set([
  "script",
  "director",
  "editing",
  "timeline",
  "self-media",
  "tts",
  "sclass",
  "media",
  "characters",
  "scenes",
  "props",
  "studio-workflow",
  "studio-workflow-store",
  "overview",
  "剧本",
]);

function canonicalPath(input) {
  const unresolved = [];
  let current = resolve(input);
  while (true) {
    try {
      return resolve(realpathSync(current), ...unresolved);
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(input);
      unresolved.unshift(current.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
      current = parent;
    }
  }
}

function isInsideRoot(root, target) {
  const canonicalRoot = canonicalPath(root);
  const canonicalTarget = canonicalPath(target);
  return canonicalTarget === canonicalRoot || canonicalTarget.startsWith(`${canonicalRoot}${sep}`);
}

function normalizeRelativePath(value, label) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error(`Invalid ${label}`);
  }
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

function parseProjectFileUrl(value) {
  const match = value.match(/^project-file:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const projectId = normalizeRelativePath(decodeURIComponent(match[1]), "project id");
  if (projectId.includes("/")) throw new Error("Invalid project id");
  const relativePath = normalizeRelativePath(
    match[2].split("/").map((part) => decodeURIComponent(part)).join("/"),
    "project file path",
  );
  return { projectId, relativePath };
}

function parseAssetFileUrl(value) {
  const withoutQuery = value.split("?")[0] ?? value;
  const match = withoutQuery.match(/^asset-file:\/\/(.+)$/);
  if (!match) return null;
  return {
    relativePath: normalizeRelativePath(
      match[1].split("/").map((part) => decodeURIComponent(part)).join("/"),
      "asset file path",
    ),
    thumb: /[?&]thumb=1\b/.test(value),
  };
}

function collectResourceReferences(documents) {
  const references = new Set();
  const visited = new WeakSet();
  const visit = (value) => {
    if (typeof value === "string") {
      if (value.startsWith("project-file://") || value.startsWith("asset-file://")) {
        references.add(value);
      }
      return;
    }
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const item of Object.values(value)) visit(item);
  };
  for (const document of documents) visit(document);
  return [...references];
}

function prepareTargetFile(cloneRoot, targetRoot, relativePath) {
  mkdirSync(cloneRoot, { recursive: true, mode: 0o700 });
  const cloneRootInfo = lstatSync(cloneRoot);
  if (cloneRootInfo.isSymbolicLink() || !cloneRootInfo.isDirectory()) {
    throw new Error("Clone root is not a directory");
  }
  if ((cloneRootInfo.mode & 0o022) !== 0) {
    throw new Error("Clone root is writable by another user");
  }
  const cloneRootRealPath = realpathSync(cloneRoot);
  const targetRootRelative = relative(resolve(cloneRoot), resolve(targetRoot));
  if (
    isAbsolute(targetRootRelative) ||
    targetRootRelative === ".." ||
    targetRootRelative.startsWith(`..${sep}`)
  ) {
    throw new Error("Target root escapes clone root");
  }
  const targetRootSegments = targetRootRelative ? targetRootRelative.split(sep) : [];
  const segments = [...targetRootSegments, ...relativePath.split("/")];
  const fileName = segments.pop();
  let current = cloneRootRealPath;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (existsSync(current)) {
      const info = lstatSync(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error("Clone target has an unsafe directory");
      }
    } else {
      mkdirSync(current);
    }
  }
  const targetFile = resolve(current, fileName);
  if (existsSync(targetFile)) {
    const info = lstatSync(targetFile);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error("Clone target has an unsafe file");
    }
  }
  return targetFile;
}

function copyReferencedFile({ reference, protocol, cloneRoot, sourceRoot, targetRoot, relativePath }) {
  const sourcePath = resolve(sourceRoot, relativePath);
  if (!isInsideRoot(sourceRoot, sourcePath)) {
    return { reference, protocol, reason: "source-escapes-root" };
  }
  if (!existsSync(sourcePath)) {
    return { reference, protocol, reason: "source-missing" };
  }
  let sourceRealPath;
  try {
    sourceRealPath = realpathSync(sourcePath);
  } catch {
    return { reference, protocol, reason: "source-missing" };
  }
  if (!isInsideRoot(sourceRoot, sourceRealPath)) {
    return { reference, protocol, reason: "source-escapes-root" };
  }
  if (!statSync(sourceRealPath).isFile()) {
    return { reference, protocol, reason: "source-not-file" };
  }
  try {
    const targetPath = prepareTargetFile(cloneRoot, targetRoot, relativePath);
    copyFileSync(sourceRealPath, targetPath);
    return { reference, protocol, sourcePath: sourceRealPath, targetPath };
  } catch (error) {
    return {
      reference,
      protocol,
      reason: "unsafe-target",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveProjectSourceRoot(sourceProjectRoot, relativePath) {
  const firstSegment = relativePath.split("/", 1)[0];
  if (!STORE_LAYOUT_SEGMENTS.has(firstSegment)) return sourceProjectRoot;
  const storeRoot = resolve(sourceProjectRoot, "store");
  return existsSync(storeRoot) ? storeRoot : sourceProjectRoot;
}

export function copyReferencedWorkflowAssets({
  documents,
  cloneRoot,
  projectId,
  sourceProjectRoot,
  sourceAssetsRoot,
  targetProjectRoot,
  targetAssetsRoot,
}) {
  const copied = [];
  const blocked = [];
  const ignored = [];
  const references = collectResourceReferences(documents);
  for (const reference of references) {
    try {
      if (reference.startsWith("project-file://")) {
        const parsed = parseProjectFileUrl(reference);
        if (!parsed) throw new Error("Invalid project file URL");
        if (parsed.projectId !== projectId) {
          ignored.push({ reference, protocol: "project-file", reason: "foreign-project" });
          continue;
        }
        const result = copyReferencedFile({
          reference,
          protocol: "project-file",
          cloneRoot,
          sourceRoot: resolveProjectSourceRoot(sourceProjectRoot, parsed.relativePath),
          targetRoot: targetProjectRoot,
          relativePath: parsed.relativePath,
        });
        if (result.reason) blocked.push(result);
        else copied.push(result);
        continue;
      }

      const parsed = parseAssetFileUrl(reference);
      if (!parsed) throw new Error("Invalid asset file URL");
      const result = copyReferencedFile({
        reference,
        protocol: "asset-file",
        cloneRoot,
        sourceRoot: resolve(sourceAssetsRoot, parsed.thumb ? "thumbs" : "files"),
        targetRoot: resolve(targetAssetsRoot, parsed.thumb ? "thumbs" : "files"),
        relativePath: parsed.relativePath,
      });
      if (result.reason) blocked.push(result);
      else copied.push(result);
    } catch (error) {
      blocked.push({
        reference,
        protocol: reference.startsWith("project-file://") ? "project-file" : "asset-file",
        reason: "invalid-url",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { references, copied, blocked, ignored };
}
