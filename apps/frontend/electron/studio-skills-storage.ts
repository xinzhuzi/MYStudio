import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type StudioSkillSyncOptions = {
  sourceRoot: string;
  fallbackSourceRoots?: string[];
  storageRoot: string;
};

type StudioSkillManifest = {
  version: 1;
  files: Record<string, { seedHash: string; syncedAt: number }>;
  deleted: Record<string, { deletedAt: number }>;
};

export type StoredStudioSkillFile = {
  relativePath: string;
  filePath: string;
  storagePath: string;
  sourcePath?: string;
  size: number;
  updatedAt: number;
  isCustomized: boolean;
  isDeleted?: boolean;
  deletedAt?: number;
  sourceExists: boolean;
};

const manifestFilename = ".studio-skills-manifest.json";
const agentSkillsDirectory = "agent_skills";
const seedImageFilePattern = /\.(png|jpe?g|gif|webp|svg)$/i;
const blockedSeedDirectoryNames = new Set([
  ".cache",
  "__MACOSX",
  "__pycache__",
  "coverage",
  "node_modules",
]);
const blockedSeedFileNames = new Set([
  ".DS_Store",
]);

export function getStudioSkillStorageRoot(storageBasePath: string) {
  return path.join(storageBasePath, "skills");
}

export function resolveStoredStudioSkillPath(storageRoot: string, relativePath: string) {
  const normalizedPath = getStoredStudioSkillRelativePath(normalizeEditableSkillPath(relativePath));
  const targetPath = path.resolve(storageRoot, normalizedPath);
  assertInsideRoot(storageRoot, targetPath);
  return { storageRoot, targetPath, normalizedPath };
}

let _skillsSyncDone = false;
let _skillsSyncPromise: Promise<void> | null = null;

/** 重置同步标记，下次调用 ensureStudioSkillsSynced 时会重新执行 */
export function resetStudioSkillsSyncState() {
  _skillsSyncDone = false;
  _skillsSyncPromise = null;
}

export async function ensureStudioSkillsSynced(options: StudioSkillSyncOptions) {
  if (_skillsSyncDone) return;
  if (_skillsSyncPromise) return _skillsSyncPromise;
  _skillsSyncPromise = (async () => {
    const { storageRoot } = options;
    await fs.promises.mkdir(storageRoot, { recursive: true });

    const manifest = await readManifest(storageRoot);
    await migrateLegacyRootAgentSkills(storageRoot, manifest);
    for (const root of getSourceRoots(options)) {
      await syncSeedDirectory(root, root, storageRoot, manifest);
    }
    await writeManifest(storageRoot, manifest);
    _skillsSyncDone = true;
  })();
  _skillsSyncPromise.finally(() => { _skillsSyncPromise = null; });
  return _skillsSyncPromise;
}

export async function listStoredStudioSkillFiles(options: StudioSkillSyncOptions): Promise<StoredStudioSkillFile[]> {
  const { storageRoot } = options;
  await ensureStudioSkillsSynced(options);
  if (!fs.existsSync(storageRoot)) return [];

  const manifest = await readManifest(storageRoot);
  const files = await collectMarkdownFiles(storageRoot);
  const records: StoredStudioSkillFile[] = await Promise.all(files.map(async (filePath) => {
    const relativePath = path.relative(storageRoot, filePath).replace(/\\/g, "/");
    const stat = await fs.promises.stat(filePath);
    const sourceRelativePath = getSourceStudioSkillRelativePath(relativePath);
    const sourcePath = findSourcePath(options, sourceRelativePath);
    const isCustomized = sourcePath
      ? await hashFile(filePath) !== await hashFile(sourcePath)
      : true;

    return {
      relativePath,
      filePath,
      storagePath: filePath,
      sourcePath: sourcePath,
      size: stat.size,
      updatedAt: stat.mtimeMs,
      isCustomized,
      isDeleted: false,
      sourceExists: Boolean(sourcePath),
    };
  }));

  const existingPaths = new Set(records.map((record) => record.relativePath));
  for (const root of getSourceRoots(options)) {
    const sourceFiles = await collectMarkdownFiles(root);
    for (const sourcePath of sourceFiles) {
      const sourceRelativePath = path.relative(root, sourcePath).replace(/\\/g, "/");
      const storageRelativePath = getStoredStudioSkillRelativePath(sourceRelativePath);
      const deleted = manifest.deleted[storageRelativePath];
      if (!deleted || existingPaths.has(storageRelativePath)) continue;
      const targetPath = path.join(storageRoot, storageRelativePath);
      records.push({
        relativePath: storageRelativePath,
        filePath: targetPath,
        storagePath: targetPath,
        sourcePath,
        size: 0,
        updatedAt: deleted.deletedAt,
        isCustomized: false,
        isDeleted: true,
        deletedAt: deleted.deletedAt,
        sourceExists: true,
      });
      existingPaths.add(storageRelativePath);
    }
  }

  return records.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function readStoredStudioSkillText(storageRoot: string, relativePath: string) {
  const { targetPath } = resolveStoredStudioSkillPath(storageRoot, relativePath);
  return fs.promises.readFile(targetPath, "utf-8");
}

export async function writeStoredStudioSkillText(storageRoot: string, relativePath: string, value: string) {
  const { targetPath } = resolveStoredStudioSkillPath(storageRoot, relativePath);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, value, "utf-8");
  await clearDeletedManifestEntry(storageRoot, path.relative(storageRoot, targetPath).replace(/\\/g, "/"));
  return fs.promises.stat(targetPath);
}

export async function createStoredStudioSkillFile(storageRoot: string, relativePath: string, value: string) {
  const { targetPath, normalizedPath } = resolveStoredStudioSkillPath(storageRoot, relativePath);
  if (fs.existsSync(targetPath)) {
    throw new Error("Studio skill file already exists");
  }
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, value, "utf-8");
  await clearDeletedManifestEntry(storageRoot, normalizedPath);
  const stat = await fs.promises.stat(targetPath);
  return {
    relativePath: normalizedPath,
    filePath: targetPath,
    storagePath: targetPath,
    size: stat.size,
    updatedAt: stat.mtimeMs,
    isCustomized: true,
    sourceExists: false,
  } satisfies StoredStudioSkillFile;
}

export async function deleteStoredStudioSkillFile(storageRoot: string, relativePath: string) {
  const { targetPath, normalizedPath } = resolveStoredStudioSkillPath(storageRoot, relativePath);
  const manifest = await readManifest(storageRoot);
  manifest.deleted[normalizedPath] = { deletedAt: Date.now() };
  delete manifest.files[normalizedPath];
  await writeManifest(storageRoot, manifest);
  if (!fs.existsSync(targetPath)) return false;
  await fs.promises.unlink(targetPath);
  await pruneEmptyDirectories(path.dirname(targetPath), storageRoot);
  return true;
}

export async function restoreStoredStudioSkillFile(options: StudioSkillSyncOptions, relativePath: string) {
  const { storageRoot } = options;
  await fs.promises.mkdir(storageRoot, { recursive: true });
  const { targetPath, normalizedPath } = resolveStoredStudioSkillPath(storageRoot, relativePath);
  const sourceRelativePath = getSourceStudioSkillRelativePath(normalizedPath);
  const sourcePath = findSourcePath(options, sourceRelativePath);
  if (!sourcePath) {
    throw new Error("Bundled studio skill does not exist");
  }

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.copyFile(sourcePath, targetPath);

  const manifest = await readManifest(storageRoot);
  delete manifest.deleted[normalizedPath];
  manifest.files[normalizedPath] = {
    seedHash: await hashFile(sourcePath),
    syncedAt: Date.now(),
  };
  await writeManifest(storageRoot, manifest);

  const stat = await fs.promises.stat(targetPath);
  return {
    relativePath: normalizedPath,
    filePath: targetPath,
    storagePath: targetPath,
    sourcePath,
    size: stat.size,
    updatedAt: stat.mtimeMs,
    isCustomized: false,
    isDeleted: false,
    sourceExists: true,
  } satisfies StoredStudioSkillFile;
}

export async function markStoredStudioSkillPathDeleted(storageRoot: string, relativePath: string) {
  const normalizedPath = normalizeStoredSkillAssetPath(relativePath);
  const targetPath = path.resolve(storageRoot, normalizedPath);
  assertInsideRoot(storageRoot, targetPath);
  const manifest = await readManifest(storageRoot);
  manifest.deleted[normalizedPath] = { deletedAt: Date.now() };
  delete manifest.files[normalizedPath];
  await writeManifest(storageRoot, manifest);
}

async function syncSeedDirectory(root: string, current: string, storageRoot: string, manifest: StudioSkillManifest) {
  const entries = await fs.promises.readdir(current, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const sourcePath = path.join(current, entry.name);
    const sourceRelativePath = path.relative(root, sourcePath).replace(/\\/g, "/");
    const storageRelativePath = getStoredStudioSkillRelativePath(sourceRelativePath);
    const targetPath = path.join(storageRoot, storageRelativePath);

    if (entry.isDirectory()) {
      if (!shouldWalkStudioSkillSeedDirectory(sourceRelativePath)) return;
      await fs.promises.mkdir(targetPath, { recursive: true });
      await syncSeedDirectory(root, sourcePath, storageRoot, manifest);
      return;
    }

    if (!entry.isFile()) return;
    if (!shouldSyncStudioSkillSeedFile(sourceRelativePath)) return;

    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    const sourceHash = await hashFile(sourcePath);
    if (manifest.deleted[storageRelativePath]) return;

    if (!fs.existsSync(targetPath)) {
      await fs.promises.copyFile(sourcePath, targetPath);
      manifest.files[storageRelativePath] = { seedHash: sourceHash, syncedAt: Date.now() };
      return;
    }

    manifest.files[storageRelativePath] = { seedHash: sourceHash, syncedAt: Date.now() };
  }));
}

async function collectMarkdownFiles(current: string): Promise<string[]> {
  const entries = await fs.promises.readdir(current, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(entryPath);
    if (!entry.isFile() || !entry.name.endsWith(".md")) return [];
    return [entryPath];
  }));
  return files.flat();
}

function shouldWalkStudioSkillSeedDirectory(relativePath: string) {
  return !relativePath.split("/").some((part) => blockedSeedDirectoryNames.has(part));
}

function shouldSyncStudioSkillSeedFile(relativePath: string) {
  const filename = path.posix.basename(relativePath);
  if (blockedSeedFileNames.has(filename)) return false;
  if (filename.endsWith(".tmp") || filename.endsWith(".bak")) return false;
  if (filename.endsWith(".map") || filename.endsWith(".tsbuildinfo")) return false;
  return filename.endsWith(".md") || seedImageFilePattern.test(filename);
}

async function readManifest(storageRoot: string): Promise<StudioSkillManifest> {
  const manifestPath = path.join(storageRoot, manifestFilename);
  try {
    const raw = await fs.promises.readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StudioSkillManifest>;
    if (parsed.version === 1 && parsed.files && typeof parsed.files === "object") {
      return {
        version: 1,
        files: parsed.files,
        deleted: parsed.deleted && typeof parsed.deleted === "object" ? parsed.deleted : {},
      };
    }
  } catch {
  }
  return { version: 1, files: {}, deleted: {} };
}

function getSourceRoots(options: StudioSkillSyncOptions) {
  const roots = [options.sourceRoot, ...(options.fallbackSourceRoots ?? [])]
    .map((root) => path.resolve(root))
    .filter((root) => fs.existsSync(root));
  return [...new Set(roots)];
}

function findSourcePath(options: StudioSkillSyncOptions, relativePath: string) {
  for (const root of getSourceRoots(options)) {
    const sourcePath = path.resolve(root, relativePath);
    assertInsideRoot(root, sourcePath);
    if (fs.existsSync(sourcePath)) return sourcePath;
  }
  return undefined;
}

async function writeManifest(storageRoot: string, manifest: StudioSkillManifest) {
  await fs.promises.writeFile(
    path.join(storageRoot, manifestFilename),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
}

async function hashFile(filePath: string) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.promises.readFile(filePath));
  return hash.digest("hex");
}

async function pruneEmptyDirectories(current: string, stopAt: string) {
  const normalizedStop = path.resolve(stopAt);
  let next = path.resolve(current);
  while (next !== normalizedStop && next.startsWith(normalizedStop + path.sep)) {
    const entries = await fs.promises.readdir(next).catch(() => []);
    if (entries.length > 0) return;
    await fs.promises.rmdir(next).catch(() => {});
    next = path.dirname(next);
  }
}

async function clearDeletedManifestEntry(storageRoot: string, relativePath: string) {
  const manifest = await readManifest(storageRoot);
  if (!manifest.deleted[relativePath]) return;
  delete manifest.deleted[relativePath];
  await writeManifest(storageRoot, manifest);
}

function normalizeEditableSkillPath(relativePath: string) {
  const rawPath = relativePath.replace(/\\/g, "/");
  if (path.posix.isAbsolute(rawPath)) {
    throw new Error("Invalid studio skill path");
  }

  const normalizedPath = path.posix.normalize(rawPath).replace(/^\/+/, "");
  if (
    !normalizedPath ||
    normalizedPath === "." ||
    normalizedPath.startsWith("../") ||
    normalizedPath.includes("/../") ||
    !normalizedPath.endsWith(".md")
  ) {
    throw new Error("Invalid studio skill path");
  }
  return normalizedPath;
}

function normalizeStoredSkillAssetPath(relativePath: string) {
  const rawPath = relativePath.replace(/\\/g, "/");
  if (path.posix.isAbsolute(rawPath)) {
    throw new Error("Invalid studio skill path");
  }

  const normalizedPath = path.posix.normalize(rawPath).replace(/^\/+/, "");
  if (
    !normalizedPath ||
    normalizedPath === "." ||
    normalizedPath.startsWith("../") ||
    normalizedPath.includes("/../") ||
    normalizedPath === manifestFilename ||
    normalizedPath.endsWith(`/${manifestFilename}`)
  ) {
    throw new Error("Invalid studio skill path");
  }
  return normalizedPath;
}

function getStoredStudioSkillRelativePath(relativePath: string) {
  if (!relativePath.includes("/") && relativePath.endsWith(".md")) {
    return `${agentSkillsDirectory}/${relativePath}`;
  }
  return relativePath;
}

function getSourceStudioSkillRelativePath(relativePath: string) {
  if (relativePath.startsWith(`${agentSkillsDirectory}/`)) {
    return relativePath.slice(agentSkillsDirectory.length + 1);
  }
  return relativePath;
}

async function migrateLegacyRootAgentSkills(storageRoot: string, manifest: StudioSkillManifest) {
  const entries = await fs.promises.readdir(storageRoot, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".md")) return;

    const legacyPath = path.join(storageRoot, entry.name);
    const targetPath = path.join(storageRoot, agentSkillsDirectory, entry.name);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

    if (!fs.existsSync(targetPath)) {
      await fs.promises.rename(legacyPath, targetPath);
      migrateManifestEntry(manifest, entry.name, `${agentSkillsDirectory}/${entry.name}`);
      return;
    }

    const legacyHash = await hashFile(legacyPath);
    const targetHash = await hashFile(targetPath);
    if (legacyHash === targetHash) {
      await fs.promises.unlink(legacyPath);
      migrateManifestEntry(manifest, entry.name, `${agentSkillsDirectory}/${entry.name}`);
      return;
    }

    const parsed = path.parse(entry.name);
    const conflictName = `${parsed.name}.legacy-${Date.now()}${parsed.ext}`;
    await fs.promises.rename(legacyPath, path.join(storageRoot, agentSkillsDirectory, conflictName));
    migrateManifestEntry(manifest, entry.name, `${agentSkillsDirectory}/${conflictName}`);
  }));
}

function migrateManifestEntry(manifest: StudioSkillManifest, from: string, to: string) {
  if (manifest.files[from]) {
    manifest.files[to] = manifest.files[from];
    delete manifest.files[from];
  }
  if (manifest.deleted[from]) {
    manifest.deleted[to] = manifest.deleted[from];
    delete manifest.deleted[from];
  }
}

function assertInsideRoot(root: string, targetPath: string) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(targetPath);
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Studio skill path escapes storage root");
  }
}
