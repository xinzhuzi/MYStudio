import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CLEANUP_MANIFEST_SCHEMA_VERSION = 1;
export const SHARED_SCOPE_ID = "__shared__";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx", ".py"]);
const PROJECT_FILE_EXTENSIONS = new Set([
  ".json", ".jsonl", ".mp4", ".mov", ".m4a", ".wav", ".mp3", ".png", ".jpg", ".jpeg", ".webp",
]);
const SOURCE_SKIP_DIRS = new Set([".git", "node_modules", ".cache", "out", "release", "output"]);

export const LEGACY_CODE_TARGETS = [
  {
    id: "legacy-ffmpeg-renderer",
    relativePath: "apps/frontend/electron/rendering/runtime/ffmpeg/ffmpeg-renderer-adapter.ts",
    producer: "legacy FFmpeg renderer",
    pattern: /ffmpeg-renderer-adapter|createFfmpegRendererAdapter/g,
  },
  {
    id: "legacy-timeline-ffmpeg-command",
    relativePath: "apps/frontend/electron/rendering/timeline-ffmpeg-command.ts",
    producer: "legacy timeline/concat command",
    pattern: /from ["'][^"']*timeline-ffmpeg-command["']|buildTimelineFfmpegCommand/g,
  },
  {
    id: "legacy-editing-workbench",
    relativePath: "apps/frontend/components/panels/studio/EditingWorkbench.tsx",
    producer: "legacy self-built editing workbench",
    pattern: /\bEditingWorkbench\b/g,
  },
];

const DELETION_PREREQUISITES = [
  "fresh Remotion StoryboardShot and ChapterVideo evidence",
  "callerCount=0 and no normal-flow selector/import",
  "protected=false and one project scope",
  "not a current Remotion output/evidence or source asset",
];

export function buildCleanupInventory({
  repoRoot,
  dataDir,
  generatedAt = Date.now(),
  sourceRoots = [path.join(repoRoot, "apps", "frontend"), path.join(repoRoot, "apps", "build")],
} = {}) {
  const resolvedRepoRoot = requireAbsoluteDirectory(repoRoot, "repoRoot");
  const resolvedDataDir = requireAbsoluteDirectory(dataDir, "dataDir");
  const sourceFiles = collectFiles(sourceRoots, (filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath)));
  const sourceTexts = sourceFiles.map((filePath) => ({
    filePath,
    relativePath: relativeSafe(resolvedRepoRoot, filePath),
    text: readText(filePath),
  }));
  const sharedItems = LEGACY_CODE_TARGETS.map((target) => {
    const targetPath = path.resolve(resolvedRepoRoot, target.relativePath);
    const callerSources = sourceTexts.filter(({ filePath, text }) => (
      path.resolve(filePath) !== targetPath
      && isCallerSource(filePath)
      && target.pattern.test(resetRegex(target.pattern, text))
    ));
    const callers = callerSources.filter(({ filePath }) => !isTestSource(filePath));
    return createItem({
      id: target.id,
      projectId: SHARED_SCOPE_ID,
      absolutePath: path.resolve(resolvedRepoRoot, target.relativePath),
      relativePath: target.relativePath,
      kind: "legacy-code",
      producer: target.producer,
      protected: false,
      protectedReason: undefined,
      currentCallerCount: callers.length,
      testCallerCount: callerSources.length - callers.length,
      fingerprint: undefined,
      revision: undefined,
      deletionBlockedReason: callers.length > 0 ? "仍存在代码/import/caller 命中" : undefined,
    });
  });

  const projectIds = discoverProjectIds(resolvedDataDir);
  const projects = projectIds.map((projectId) => {
    const projectRoot = path.join(resolvedDataDir, "_p", projectId);
    const items = collectFiles([projectRoot], (filePath) => PROJECT_FILE_EXTENSIONS.has(path.extname(filePath)))
      .map((filePath) => classifyProjectFile({ filePath, projectRoot, dataDir: resolvedDataDir, projectId, sourceTexts }));
    return { projectId, items };
  });
  const allItems = [...sharedItems, ...projects.flatMap((project) => project.items)];
  const summary = {
    projects: projects.length,
    items: allItems.length,
    protected: allItems.filter((item) => item.protected).length,
    deletionEligible: allItems.filter((item) => item.deletionEligible).length,
    callerBlocked: allItems.filter((item) => item.currentCallerCount > 0).length,
    unknownKind: allItems.filter((item) => item.kind === "unknown").length,
  };
  return {
    schemaVersion: CLEANUP_MANIFEST_SCHEMA_VERSION,
    generatedAt,
    mode: "read-only",
    repoRoot: resolvedRepoRoot,
    dataDir: resolvedDataDir,
    protectedBoundaries: [
      "script/storyboard text and prompts",
      "original/imported/generated source assets",
      "current Remotion workspace, job, evidence and output",
    ],
    shared: { projectId: SHARED_SCOPE_ID, items: sharedItems },
    projects,
    summary,
  };
}

function classifyProjectFile({ filePath, projectRoot, dataDir, projectId, sourceTexts }) {
  const relativePath = relativeSafe(dataDir, filePath);
  const normalized = relativePath.split(path.sep).join("/");
  const baseName = path.basename(filePath).toLowerCase();
  const escaped = !isInside(dataDir, filePath);
  const isBackup = normalized.includes("/backups/") || normalized.startsWith("backups/");
  const isRemotion = normalized.includes("/remotion/") || normalized.includes("/outputs/") || normalized.includes("/evidence/");
  const mixedWorkflow = baseName === "studio-workflow-store.json";
  const isEditing = baseName === "editing.json";
  const kind = escaped ? "path-escape" : isBackup ? "protected-backup" : isRemotion ? classifyRemotionFile(baseName) : mixedWorkflow ? "legacy-workflow-state" : isEditing ? "legacy-editing-store" : classifyLegacyFile(normalized);
  const protectedReason = escaped
    ? "路径逃逸，禁止进入删除批次"
    : isBackup
      ? "备份/连续性来源受保护"
      : isRemotion
        ? "当前 Remotion workspace/output/evidence 受保护"
        : mixedWorkflow
          ? "混合持久化文件包含 storyboard 文本、提示词和素材引用，必须先完成字段迁移"
          : kind === "unknown"
            ? "无法分类，必须人工复核"
            : undefined;
  const protectedItem = Boolean(protectedReason);
  const callerCounts = countPathCallers(sourceTexts, relativePath, path.basename(filePath));
  const parsed = readJson(filePath);
  const revision = findNumber(parsed, ["revision", "outputVersion"]);
  const fingerprint = findString(parsed, ["sourceFingerprint", "inputHash", "sourceSnapshotHash"]);
  return createItem({
    id: `${projectId}:${normalized}`,
    projectId,
    absolutePath: path.resolve(filePath),
    relativePath,
    kind,
    producer: producerForKind(kind),
    protected: protectedItem,
    protectedReason,
    currentCallerCount: callerCounts.normal,
    testCallerCount: callerCounts.test,
    fingerprint,
    revision,
    deletionBlockedReason: protectedReason || callerCounts.normal > 0 ? protectedReason || "仍存在代码引用" : undefined,
  });
}

function createItem({ id, projectId, absolutePath, relativePath, kind, producer, protected: protectedItem, protectedReason, currentCallerCount, testCallerCount = 0, fingerprint, revision, deletionBlockedReason }) {
  const deletionEligible = !protectedItem && kind !== "unknown" && kind !== "path-escape" && currentCallerCount === 0 && isSafeRelativePath(relativePath);
  return {
    id,
    projectId,
    absolutePath,
    relativePath,
    kind,
    producer,
    currentCallerCount,
    testCallerCount,
    fingerprint: fingerprint ?? null,
    revision: revision ?? null,
    protected: protectedItem,
    protectedReason: protectedReason ?? null,
    deletionPrerequisites: [...DELETION_PREREQUISITES],
    deletionEligible,
    deletionBlockedReason: deletionEligible ? null : deletionBlockedReason || "删除前置未满足",
  };
}

function discoverProjectIds(dataDir) {
  const projectRoot = path.join(dataDir, "_p");
  if (!fs.existsSync(projectRoot)) return [];
  return fs.readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isSafeId(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function collectFiles(roots, predicate) {
  const files = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    walk(root, predicate, files);
  }
  return files.sort();
}

function walk(root, predicate, files) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SOURCE_SKIP_DIRS.has(entry.name)) continue;
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) walk(filePath, predicate, files);
    else if (entry.isFile() && predicate(filePath)) files.push(filePath);
  }
}

function countPathCallers(sourceTexts, relativePath, baseName) {
  const matches = sourceTexts.filter(({ filePath, text }) => (
    isCallerSource(filePath)
    && (text.includes(relativePath) || text.includes(baseName))
  ));
  return {
    normal: matches.filter(({ filePath }) => !isTestSource(filePath)).length,
    test: matches.filter(({ filePath }) => isTestSource(filePath)).length,
  };
}

function isCallerSource(filePath) {
  const baseName = path.basename(filePath);
  return baseName !== "cleanup-inventory.mjs";
}

function isTestSource(filePath) {
  return /(?:^|[.])test[.][^.]+$|(?:^|[/\\])__tests__(?:[/\\]|$)/.test(filePath)
    || /(?:^|[/\\])[^/\\]+[.]test[.]/.test(filePath);
}

function classifyRemotionFile(baseName) {
  if (baseName.includes("evidence")) return "remotion-evidence";
  if (baseName.includes("job")) return "remotion-job";
  if (baseName.endsWith(".mp4")) return "remotion-output";
  return "remotion-workspace";
}

function classifyLegacyFile(relativePath) {
  if (/candidate|track/.test(relativePath)) return "legacy-candidate-or-track";
  if (/timeline|concat|ffmpeg|render/.test(relativePath)) return "legacy-render-artifact";
  return "unknown";
}

function producerForKind(kind) {
  if (kind === "legacy-workflow-state") return "legacy studio workflow/candidate chain";
  if (kind === "legacy-editing-store") return "legacy EditingProject/timeline chain";
  if (kind === "legacy-candidate-or-track") return "legacy VideoCandidate/production track";
  if (kind === "legacy-render-artifact") return "legacy timeline/concat renderer";
  if (kind.startsWith("remotion-")) return "Remotion current chain";
  return "unclassified project artifact";
}

function readText(filePath) {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
}

function readJson(filePath) {
  if (!filePath.endsWith(".json")) return undefined;
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return undefined; }
}

function findString(value, keys) {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) if (typeof value[key] === "string" && value[key].trim()) return value[key];
  for (const nested of Object.values(value)) {
    const result = findString(nested, keys);
    if (result) return result;
  }
  return undefined;
}

function findNumber(value, keys) {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) if (Number.isSafeInteger(value[key])) return value[key];
  for (const nested of Object.values(value)) {
    const result = findNumber(nested, keys);
    if (result !== undefined) return result;
  }
  return undefined;
}

function requireAbsoluteDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || !fs.existsSync(value) || !fs.statSync(value).isDirectory()) {
    throw new Error(`${label} 必须是存在的绝对目录`);
  }
  return path.resolve(value);
}

function relativeSafe(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative || ".";
}

function isInside(root, target) {
  const relative = relativeSafe(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function isSafeRelativePath(relativePath) {
  return relativePath !== "." && !path.isAbsolute(relativePath) && !relativePath.split(path.sep).includes("..");
}

function isSafeId(value) {
  return Boolean(value) && value !== "." && value !== ".." && !/[\\/\0]/.test(value);
}

function resetRegex(regex, text) {
  regex.lastIndex = 0;
  return text;
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith("--")) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${key} 需要值`);
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

export function runCleanupInventoryCli(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(options["repo-root"] || path.join(scriptRoot, "../../.."));
  if (!options["data-dir"]) throw new Error("必须提供 --data-dir（项目 data root），脚本只读扫描，不猜测用户数据路径");
  const output = path.resolve(options.output || path.join(repoRoot, ".trellis", "tasks", "07-29-remotion-project-workspace-pipeline", "research", "m1-cleanup-inventory.json"));
  const manifest = buildCleanupInventory({ repoRoot, dataDir: path.resolve(options["data-dir"]) });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { output, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { output, manifest } = runCleanupInventoryCli();
    console.log(`Remotion cleanup inventory 已生成: ${output} (projects=${manifest.summary.projects}, items=${manifest.summary.items}, eligible=${manifest.summary.deletionEligible})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
