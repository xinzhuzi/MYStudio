import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
// 权威模板原样进包（vite raw 内联）；CLI（vite-node）与主进程（rollup）均支持
import readmeTemplate from "../../assets/docs/studio-workflow/README.md?raw";
import {
  isSafeShardFileName,
  STUDIO_WORKFLOW_SHARD_DIR,
  mergeStudioWorkflowShards,
  parseStudioWorkflowShardManifest,
  planStudioWorkflowShards,
} from "../../lib/storage/studio-workflow-shards";
import { resolveDataFilePath, resolveProjectRootPath } from "./storage-paths";
import { storeLayoutBase } from "./project-store-layout";

/**
 * studio-workflow store 的分片感知读写器（纯 fs，无 electron 依赖——主进程与
 * apps/build 的 vite-node CLI 共用；渲染进程走 fileStorage IPC 的
 * createStudioWorkflowShardedStorage，两者读写同一 `studio-workflow/` 布局）。
 *
 * 读取优先级：分片 manifest → 项目级旧单文件（含 .bak-sharded-* 前置代）→ null。
 * 写入 = 纯 CLI 写回路径（update-storyboards-voice / regenerate-scoped-storyboard-tts
 * 等离线脚本），与渲染进程写回协议一致：先写全部分片 → manifest 最后换新 →
 * 旧单文件改名保留 → 清孤儿。CLI 运行时应用不应同时写该 store（脚本自带 CAS 拒写）。
 */

const STUDIO_WORKFLOW_STORE_FILE = "studio-workflow-store.json";

export interface StudioWorkflowStoreEnvelope {
  /** 规范化信封串 `{"state":{...},"version":N}`（分片模式为合并重建串） */
  raw: string;
  state: Record<string, unknown>;
  version: number;
  source: "sharded" | "legacy";
}

function shardDirFor(dataRoot: string, projectId: string): string {
  // store 布局 v1：已迁移项目分片目录在 <root>/store/studio-workflow（08-18-project-store-layout）
  return path.join(storeLayoutBase(resolveProjectRootPath(dataRoot, projectId)), STUDIO_WORKFLOW_SHARD_DIR);
}

function legacyStorePathFor(dataRoot: string, projectId: string): string {
  return resolveDataFilePath(dataRoot, `_p/${projectId}/studio-workflow-store`);
}

function readJsonIfExists(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * 读取 studio-workflow store：分片优先，legacy 单文件兜底。
 * 返回 null 表示项目尚无该 store（两种布局都不存在）。
 */
export function readStudioWorkflowStore(dataRoot: string, projectId: string): StudioWorkflowStoreEnvelope | null {
  const shardDir = shardDirFor(dataRoot, projectId);
  const manifestRaw = readJsonIfExists(path.join(shardDir, "manifest.json"));
  if (manifestRaw) {
    const manifest = parseStudioWorkflowShardManifest(manifestRaw);
    if (!manifest) throw new Error(`studio-workflow manifest 无法解析: ${shardDir}/manifest.json`);
    const contents: string[] = [];
    for (const shardName of manifest.shards) {
      if (!isSafeShardFileName(shardName)) {
        throw new Error(`studio-workflow manifest 含非法分片名: ${shardName}`);
      }
      const raw = readJsonIfExists(path.join(shardDir, shardName));
      if (raw === null) throw new Error(`studio-workflow 分片缺失: ${shardDir}/${shardName}`);
      contents.push(raw);
    }
    const merged = mergeStudioWorkflowShards(contents);
    return {
      raw: JSON.stringify({ state: merged.state, version: manifest.version }),
      state: merged.state,
      version: manifest.version,
      source: "sharded",
    };
  }

  const legacyRaw = readJsonIfExists(legacyStorePathFor(dataRoot, projectId));
  if (legacyRaw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(legacyRaw);
  } catch (error) {
    throw new Error(`studio-workflow 旧单文件无法解析: ${String(error)}`);
  }
  const envelope = (parsed ?? {}) as { state?: unknown; version?: unknown };
  const state = envelope.state && typeof envelope.state === "object" && !Array.isArray(envelope.state)
    ? envelope.state as Record<string, unknown>
    : {};
  return {
    raw: legacyRaw,
    state,
    version: typeof envelope.version === "number" ? envelope.version : 0,
    source: "legacy",
  };
}

export interface WriteStudioWorkflowStoreResult {
  shardNames: string[];
  oversizedFiles: string[];
  legacyBackupPath: string | null;
}

/**
 * 把完整信封串按分片布局写入项目 `studio-workflow/` 目录（CLI 写回路径）。
 * envelopeRaw 不是合法信封时抛错，不触碰任何现有文件。
 */
export function writeStudioWorkflowStore(
  dataRoot: string,
  projectId: string,
  envelopeRaw: string,
): WriteStudioWorkflowStoreResult {
  const plan = planStudioWorkflowShards(envelopeRaw);
  const shardDir = shardDirFor(dataRoot, projectId);
  fs.mkdirSync(shardDir, { recursive: true });

  const writeAtomic = (targetPath: string, content: string) => {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(tempPath, content, "utf-8");
      fs.renameSync(tempPath, targetPath);
    } finally {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    }
  };

  for (const file of plan.files) {
    if (!isSafeShardFileName(file.name)) {
      throw new Error(`分片文件名非法: ${file.name}`);
    }
    writeAtomic(path.join(shardDir, file.name), file.content);
  }
  writeAtomic(path.join(shardDir, "manifest.json"), JSON.stringify(plan.manifest, null, 2));

  // 旧单文件改名保留（只改名不删）
  const legacyPath = legacyStorePathFor(dataRoot, projectId);
  let legacyBackupPath: string | null = null;
  if (fs.existsSync(legacyPath)) {
    legacyBackupPath = `${legacyPath}.bak-sharded-${Date.now()}`;
    fs.renameSync(legacyPath, legacyBackupPath);
  }

  // 递归清理未被 manifest 列出的孤儿分片（上一代 stamp 文件，含嵌套章目录），并剪除空目录
  const listed = new Set([...plan.manifest.shards, "manifest.json"]);
  const pruneDir = (dirPath: string) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        pruneDir(fullPath);
      } else if (entry.name.endsWith(".json")
        && !listed.has(path.relative(shardDir, fullPath).split(path.sep).join("/"))) {
        fs.rmSync(fullPath, { force: true });
      }
    }
    if (path.resolve(dirPath) !== path.resolve(shardDir) && fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
    }
  };
  if (fs.existsSync(shardDir)) pruneDir(shardDir);

  // 目录自述文档守护：与仓内权威模板逐字一致——缺失/漂移（md5 不符）即覆盖修复
  try {
    const readmePath = path.join(shardDir, "README.md");
    const current = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf-8") : null;
    if (current !== readmeTemplate) {
      if (current !== null) {
        console.warn(
          `[studio-workflow] README.md 与权威模板不一致(md5: 现场=${crypto.createHash("md5").update(current).digest("hex")} 模板=${crypto.createHash("md5").update(readmeTemplate).digest("hex")})，覆盖修复`
        );
      }
      fs.writeFileSync(readmePath, readmeTemplate, "utf-8");
    }
  } catch {
    // best-effort：下次写盘再修
  }

  return {
    shardNames: plan.manifest.shards,
    oversizedFiles: plan.oversizedFiles,
    legacyBackupPath,
  };
}

/** 兼容旧脚本语义：项目根下的旧单文件路径（可能已改名不存在）。 */
export function legacyStudioWorkflowStorePath(dataRoot: string, projectId: string): string {
  return legacyStorePathFor(dataRoot, projectId);
}

export function studioWorkflowStoreExists(dataRoot: string, projectId: string): boolean {
  if (fs.existsSync(path.join(shardDirFor(dataRoot, projectId), "manifest.json"))) return true;
  return fs.existsSync(legacyStorePathFor(dataRoot, projectId));
}

export { STUDIO_WORKFLOW_STORE_FILE };
