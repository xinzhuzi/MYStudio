import fs from "node:fs";
import path from "node:path";
import { sanitizeAssetFolderNameDetailed, usesAssetNameFolder } from "./assets-sqlite";
import {
  STORE_REF_PATTERN,
  defaultSqliteIo,
  walkFiles,
  type MigrationIo,
  type MigrationSqliteIo,
} from "./asset-home-migration";

/**
 * 资产按名分夹存量迁移例程(10-19-asset-name-folders R3:files/<type>/ 平铺 →
 * files/<type>/<安全资产名>/;thumbs 同构镜像;clip/audio 不动)。
 *
 * 复用 asset-store-migration 的相位+核账骨架(1016 先例),纪律锚:
 * - marker 落资产根 `_name-folders-v1.json`(与 assets.db 同层,design §5 P6)——
 *   不落 files/ 内,防污染 P5 文件计数核账与按目录走文件的消费方;
 * - P2 逐文件挪动可重入(目标在=已挪,源在=待挪续跑;P0 从 DB 重建映射续跑);
 * - 目标已存在(异源同名文件)→ 不挪不 roll,留 anomalies,DB/引用保持旧路径
 *   (旧平铺路径读路径天然兼容,resolveAssetManagedPath 支持任意层级);
 * - 核账不通过不落 marker(P5 任一红 → interrupted + 台账留痕,下轮续跑);
 * - 台账/备份恒 <projectRoot>/backups/asset-name-folders-<ts>/(根目录铁令);
 * - 引用改写严格映射表驱动:只改 asset-file://<type>/<file> 且 <type>/<file>
 *   恰为本次挪动映射键的引用(生产实证引用只住 studio-workflow 分片,但 P0 扫描
 *   照跑 <projectRoot>/store 全树 .json/.jsonl 作迁移时点复核,改写面=扫描面,
 *   计数对账口径一致;raw 与 URL 编码双形态均识别)。
 */

export const ASSET_NAME_FOLDERS_MARKER = "_name-folders-v3.json";

const defaultNameFolderIo: MigrationIo = {
  existsSync: (filePath) => fs.existsSync(filePath),
  statSync: (filePath) => fs.statSync(filePath),
  mkdirSync: (dirPath) => fs.mkdirSync(dirPath, { recursive: true }),
  readdirSync: (dirPath) => fs.readdirSync(dirPath),
  readFileSync: (filePath) => fs.readFileSync(filePath, "utf-8"),
  writeFileSync: (filePath, contents) => fs.writeFileSync(filePath, contents, "utf-8"),
  copyFileSync: (from, to) => fs.copyFileSync(from, to),
  renameSync: (from, to) => fs.renameSync(from, to),
  unlinkSync: (filePath) => fs.unlinkSync(filePath),
  rmSync: (dirPath, options) => fs.rmSync(dirPath, options),
  now: () => Date.now(),
};

// === §6 持久化引用改写器(独立可测纯函数) ===

/** 映射表:key=解码态旧相对路径(type/<file> 或改名前任意层级),value=解码态新相对路径。 */
export type AssetFileRefMapping = Map<string, string>;

function encodePathSegments(value: string): string {
  // 与 storage-paths encodeRelativePath 同款逐段 encodeURIComponent(createAssetFileUrl 口径)
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

/**
 * 纯函数改写器:text 中 asset-file://<type>/<rest> 引用,解码后命中映射表 key 即改写为
 * asset-file://<新路径>(编码态输出,?thumb=1 等 query 保留)。新形态/映射外/audio 域
 * 引用天然零命中(幂等)。返回改写后文本与命中计数(出现次数口径,同一引用出现 N 次=N)。
 */
export function rewriteAssetFileRefs(text: string, mapping: AssetFileRefMapping): { text: string; hits: number } {
  if (mapping.size === 0 || !text.includes("asset-file://")) return { text, hits: 0 };
  let hits = 0;
  const result = text.replace(STORE_REF_PATTERN, (match: string, type: string, rest: string) => {
    let decodedRest = rest;
    try {
      decodedRest = decodeURIComponent(rest);
    } catch {
      // 非法百分号序列:按原文比对(映射键为解码态,大概率不命中,保守不动)
    }
    const target = mapping.get(`${type}/${decodedRest}`);
    if (!target) return match;
    hits += 1;
    return `asset-file://${encodePathSegments(target)}`;
  });
  return { text: result, hits };
}

interface RefRewriteIo {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string): string;
  writeFileSync(filePath: string, contents: string): void;
  renameSync(from: string, to: string): void;
  now(): number;
}

const defaultRefRewriteIo: RefRewriteIo = {
  existsSync: (filePath) => fs.existsSync(filePath),
  readFileSync: (filePath) => fs.readFileSync(filePath, "utf-8"),
  writeFileSync: (filePath, contents) => fs.writeFileSync(filePath, contents, "utf-8"),
  renameSync: (from, to) => fs.renameSync(from, to),
  now: () => Date.now(),
};

/** 文件级应用器:命中才写盘;tmp+rename 原子换文(半写不留损坏件)。返回命中数。 */
export function applyAssetFileRefRewrite(filePath: string, mapping: AssetFileRefMapping, io: RefRewriteIo = defaultRefRewriteIo): number {
  if (mapping.size === 0) return 0;
  let text: string;
  try {
    text = io.readFileSync(filePath);
  } catch {
    return 0;
  }
  const { text: next, hits } = rewriteAssetFileRefs(text, mapping);
  if (hits === 0) return 0;
  const tmpPath = `${filePath}.tmp-${process.pid}-${io.now()}`;
  io.writeFileSync(tmpPath, next);
  io.renameSync(tmpPath, filePath);
  return hits;
}

/**
 * R5 改名联动定向改写(F1,10-19 修复批):扫全 store 树 .json/.jsonl(与迁移 P3
 * 同扫描面)——characters.json 缩略/分镜 keyframes 等持久化 asset-file:// 同在
 * 改写面;raw 与 URL 编码双形态由 applyAssetFileRefRewrite 处理。输入=挪动映射表。
 */
export function rewriteAssetRefsInStoreTree(
  projectRoot: string,
  mapping: AssetFileRefMapping,
  io: RefRewriteIo & Pick<MigrationIo, "readdirSync" | "statSync"> = {
    ...defaultRefRewriteIo,
    readdirSync: (dirPath) => fs.readdirSync(dirPath),
    statSync: (filePath) => fs.statSync(filePath),
  },
): number {
  if (mapping.size === 0) return 0;
  const storeDir = path.join(projectRoot, "store");
  if (!io.existsSync(storeDir)) return 0;
  let hits = 0;
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = io.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let isDir = false;
      try {
        isDir = io.statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full);
        continue;
      }
      if (!/\.(json|jsonl)$/.test(name) || name.includes(".db")) continue;
      hits += applyAssetFileRefRewrite(full, mapping, io);
    }
  };
  walk(storeDir);
  return hits;
}

/**
 * R6 删除守卫(10-20 独孤剑尘悬空案):relPath 在 store 树持久化 asset-file:// 引用中的
 * 出现次数(P0/P3 同扫描面;raw 与 URL 编码双形态,pattern 不含 query 天然剥离)。
 * >0 = 画布分片/角色卡等仍引用该文件,删除路径须保盘(留孤儿)仅动 DB。
 */
export function countAssetFileRefsInStoreTree(projectRoot: string, relPath: string): number {
  if (!relPath) return 0;
  const scan = scanStoreRefs(path.join(projectRoot, "store"), defaultNameFolderIo);
  return scan.refs.filter((r) => r.ref === relPath).length;
}

/**
 * R5 改名联动定向改写(旧实现,留档兼容):只扫 studio-workflow 分片。
 */
export function rewriteAssetRefsInImageWorkflowShardsLegacy(
  projectRoot: string,
  mapping: AssetFileRefMapping,
  io: RefRewriteIo = defaultRefRewriteIo,
): number {
  if (mapping.size === 0) return 0;
  const shardDir = path.join(projectRoot, "store", "studio-workflow");
  const manifestPath = path.join(shardDir, "manifest.json");
  if (!io.existsSync(manifestPath)) return 0; // 无分片索引=无持久化引用面
  let manifest: { shards?: unknown };
  try {
    manifest = JSON.parse(io.readFileSync(manifestPath)) as { shards?: unknown };
  } catch {
    return 0;
  }
  if (!Array.isArray(manifest?.shards)) return 0;
  let hits = 0;
  for (const shard of manifest.shards) {
    if (typeof shard !== "string" || !path.basename(shard).startsWith("image-workflows")) continue;
    // 分片名防穿越(manifest 是数据文件):拒绝绝对/上跳/反斜杠形态
    if (shard.includes("\\") || shard.split("/").includes("..") || path.isAbsolute(shard)) continue;
    hits += applyAssetFileRefRewrite(path.join(shardDir, shard), mapping, io);
  }
  return hits;
}

// === §5 存量迁移相位机 P0-P6 ===

export interface RunAssetNameFolderMigrationOptions {
  /** 旧统一存储基路径(内部 _p/* 项目根枚举用;assetRoots 注入时可缺省)。 */
  getStorageBasePath?: () => string;
  locationStore?: {
    get(projectId: string): string | undefined;
    set(projectId: string, dir: string): void;
    delete(projectId: string): void;
    all(): Record<string, string>;
  };
  /** 覆写资产根枚举(演练/测试);缺省=位置表外部位置 + 内部 _p/*。 */
  assetRoots?: () => string[];
  sqliteIo?: MigrationSqliteIo;
  io?: Partial<MigrationIo>;
  log?: (message: string) => void;
}

export interface AssetNameFolderRootResult {
  root: string;
  status: "migrated" | "noop" | "interrupted";
  reason?: string;
  ledgerDir: string | null;
  movedFiles: number;
  rewrittenRefs: number;
  anomalies: string[];
}

export interface AssetNameFolderMigrationResult {
  status: "migrated" | "noop" | "interrupted";
  roots: AssetNameFolderRootResult[];
}

type NameFolderLedger = {
  version: 3;
  startedAt: number;
  finishedAt?: number;
  interrupted?: boolean;
  error?: string;
  assetRoot: string;
  projectRoot: string;
  phases: Array<{ name: string; ms: number; status: "ok" | "failed" }>;
  baseline?: {
    fileCount?: number;
    dbRows?: number;
    /** 命中计划映射的旧引用出现清单(文件+解码路径,保留重复出现) */
    assetRefs?: Array<{ file: string; ref: string }>;
    /** 基线断链引用(解码路径,去重排序) */
    brokenRefs?: string[];
    /** 基线 DB 断链路径(filePath/images 元素,解码路径) */
    dbBrokenPaths?: string[];
  };
  files?: { moved: number; alreadyMoved: number; conflicts: string[]; missing: string[] };
  refs?: { rewritten: number; expected: number };
  anomalies: string[];
};

class NameFolderMigrationInterrupted extends Error {}

/** 家段(首「_」前,空段回落整名)——10-19 用户终裁「一族一夹」:行名
 * `${实体名}_${修饰…}` 首段=归属实体;基行(如 晏燎)无下划线即本身。 */
function familyHead(name: string): string {
  // 10-19 序号目录修正:跳过前导纯数字段与目录编码段(R-1234/炼-123/丹-303),
  // 与 assets-sqlite.assetFamilyHead 同款规则(避免循环依赖就地复刻)。
  const segments = String(name ?? "").split("_");
  const CODE = /^(\d+|[A-Za-z]{1,3}-\d+|[\u4e00-\u9fa5]{1,2}-\d+)$/;
  for (const seg of segments) {
    if (!CODE.test(seg)) return seg;
  }
  return String(name ?? "");
}

/** 剪空壳目录(家夹收敛后旧行名夹清空即删;自底向上 best-effort,非空留待下轮)。 */
function pruneEmptyDirsUnder(root: string, io: MigrationIo): void {
  let entries: string[];
  try {
    entries = io.readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries) {
    const child = path.join(root, name);
    let isDir = false;
    try {
      isDir = io.statSync(child).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    pruneEmptyDirsUnder(child, io);
    try {
      // Node rmSync 对目录恒需 recursive(空目录亦拒 EISDIR);删除前已核空,
      // 启动期 Electron 单例锁保证无并发写入。
      if (io.readdirSync(child).length === 0) io.rmSync(child, { recursive: true, force: true });
    } catch {
      // 非空或并发写入:留待下轮
    }
  }
}

function rowRelativePaths(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof row.filePath === "string" && row.filePath) out.push(row.filePath);
  if (typeof row.images === "string" && row.images) {
    try {
      const parsed = JSON.parse(row.images);
      if (Array.isArray(parsed)) {
        for (const img of parsed) {
          if (img && typeof img === "object" && typeof (img as { filePath?: unknown }).filePath === "string") {
            out.push((img as { filePath: string }).filePath);
          }
        }
      }
    } catch {
      // images 非法 JSON:按无多图处理,不动 images 列
    }
  }
  return out;
}

interface StoreRefScan {
  /** 扫描面 .json/.jsonl 清单(P0 与 P3/P5 改写复核同口径) */
  files: string[];
  /** 每处 asset-file:// 引用出现(文件+解码路径,保留重复出现) */
  refs: Array<{ file: string; ref: string }>;
}

/** 全量扫描(不做映射过滤):基线断链守全树,计数口径由使用方按映射过滤。 */
function scanStoreRefs(storeDir: string, io: MigrationIo): StoreRefScan {
  const files: string[] = [];
  const refs: Array<{ file: string; ref: string }> = [];
  if (!io.existsSync(storeDir)) return { files, refs };
  for (const file of walkFiles(storeDir, io)) {
    if (!file.endsWith(".json") && !file.endsWith(".jsonl")) continue;
    files.push(file);
    let text: string;
    try {
      text = io.readFileSync(file);
    } catch {
      continue;
    }
    if (!text.includes("asset-file://")) continue;
    for (const match of text.matchAll(STORE_REF_PATTERN)) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(`${match[1]}/${match[2]}`);
      } catch {
        decoded = `${match[1]}/${match[2]}`;
      }
      refs.push({ file, ref: decoded });
    }
  }
  return { files, refs };
}

/** 默认资产根枚举:位置表外部位置 + 内部 <storageBase>/_p/*,去重后各取 store/assets。 */
function enumerateDefaultAssetRoots(
  getStorageBasePath: () => string,
  locationStore: { all(): Record<string, string> },
  io: MigrationIo,
): string[] {
  const projectRoots = new Set<string>();
  for (const dir of Object.values(locationStore.all() ?? {})) {
    if (typeof dir === "string" && dir) projectRoots.add(path.resolve(dir));
  }
  const internalProjects = path.join(getStorageBasePath(), "_p");
  if (io.existsSync(internalProjects)) {
    // L5(10-19 修复批):readdir 包兜底——裸抛会逃出逐根兜底中断启动序(无窗口假死)
    let internalEntries: string[] = [];
    try {
      internalEntries = io.readdirSync(internalProjects);
    } catch (error) {
      console.warn(`[asset-name-folders] 内部项目枚举失败(跳过):${String(error)}`);
    }
    for (const entry of internalEntries) {
      const full = path.join(internalProjects, entry);
      try {
        if (io.statSync(full).isDirectory()) projectRoots.add(path.resolve(full));
      } catch {
        // 枚举容错:坏条目跳过
      }
    }
  }
  return [...projectRoots].map((root) => path.join(root, "store", "assets"));
}

export async function runAssetNameFolderMigration(options: RunAssetNameFolderMigrationOptions): Promise<AssetNameFolderMigrationResult> {
  const io: MigrationIo = { ...defaultNameFolderIo, ...options.io };
  const sqliteIo = options.sqliteIo ?? defaultSqliteIo;
  const log = options.log ?? ((message: string) => { console.warn(`[asset-name-folders] ${message}`); });
  if (!options.assetRoots && (!options.getStorageBasePath || !options.locationStore)) {
    throw new Error("asset-name-folders:assetRoots 未注入时须提供 getStorageBasePath 与 locationStore");
  }
  const roots = options.assetRoots
    ? options.assetRoots()
    : enumerateDefaultAssetRoots(options.getStorageBasePath!, options.locationStore!, io);

  const results: AssetNameFolderRootResult[] = [];
  for (const assetRoot of roots) {
    try {
      results.push(await migrateAssetRoot(assetRoot, sqliteIo, io, log));
    } catch (error) {
      log(`资产根迁移异常(${assetRoot}):${String(error)}`);
      results.push({ root: assetRoot, status: "interrupted", reason: String(error), ledgerDir: null, movedFiles: 0, rewrittenRefs: 0, anomalies: [String(error)] });
    }
  }
  const anyInterrupted = results.some((root) => root.status === "interrupted");
  const anyMigrated = results.some((root) => root.status === "migrated");
  return { status: anyInterrupted ? "interrupted" : anyMigrated ? "migrated" : "noop", roots: results };
}

async function migrateAssetRoot(
  assetRoot: string,
  sqliteIo: MigrationSqliteIo,
  io: MigrationIo,
  log: (message: string) => void,
): Promise<AssetNameFolderRootResult> {
  const projectRoot = path.resolve(assetRoot, "..", "..");
  const storeDir = path.dirname(path.resolve(assetRoot));
  const dbPath = path.join(assetRoot, "assets.db");
  const markerPath = path.join(assetRoot, ASSET_NAME_FOLDERS_MARKER);
  const filesRoot = path.join(assetRoot, "files");
  const thumbsRoot = path.join(assetRoot, "thumbs");

  const noop = (reason: string): AssetNameFolderRootResult => ({ root: assetRoot, status: "noop", reason, ledgerDir: null, movedFiles: 0, rewrittenRefs: 0, anomalies: [] });

  // P0 前置:marker 在场=已迁;资产根/库缺=无事项。
  if (io.existsSync(markerPath)) return noop("marker v3 在场,家夹已收敛");
  if (!io.existsSync(assetRoot)) return noop("资产根不存在");
  if (!io.existsSync(dbPath)) return noop("无 assets.db");

  const ledger: NameFolderLedger = {
    version: 3,
    startedAt: io.now(),
    assetRoot,
    projectRoot,
    phases: [],
    anomalies: [],
  };
  let ledgerDir: string | null = null;
  const ensureLedgerDir = (): string => {
    if (!ledgerDir) {
      ledgerDir = path.join(projectRoot, "backups", `asset-name-folders-${new Date(io.now()).toISOString().replace(/[:.]/g, "-")}`);
      io.mkdirSync(ledgerDir);
    }
    return ledgerDir;
  };
  const writeLedger = () => {
    io.writeFileSync(path.join(ensureLedgerDir(), "migration-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
  };
  const phase = async <T>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const start = io.now();
    try {
      const result = await fn();
      ledger.phases.push({ name, ms: io.now() - start, status: "ok" });
      return result;
    } catch (error) {
      ledger.phases.push({ name, ms: io.now() - start, status: "failed" });
      throw error;
    }
  };

  const readAssetRows = async (): Promise<Array<Record<string, unknown>>> => {
    if (!(await sqliteIo.tableExists(dbPath, "assets"))) return [];
    return sqliteIo.readTable(dbPath, "assets");
  };

  try {
    // ===== P0 预检:基线(文件数/DB 行数/断链集/旧引用计数)+ 映射计划 =====
    const baseline: NonNullable<NameFolderLedger["baseline"]> = {};
    ledger.baseline = baseline;
    let planRows: Array<Record<string, unknown>> = [];
    let scan: StoreRefScan = { files: [], refs: [] };
    const dbBroken = new Set<string>();
    // 多行共享同一平铺路径的目标分歧清单(P0 预检):同一 rel 被不同安全名映射两次时,
    // 后写 mapping.set 会静默覆盖先写——文件挪进先发行名夹而 DB 全部改向后发行名夹;
    // 首跑 P5③ 虽 fail-closed,但 P4 已改写的损坏 DB 会让重跑的 dbBroken 基线失真,
    // 被蒙蔽收敛为 migrated+marker(永久断链无自愈)。故 P0 先检出分歧 rel,P2 整体
    // 排除:不挪不映射,DB/引用保持旧平铺路径(resolveAssetManagedPath 天然兼容),
    // anomalies 留痕——与「异源同名冲突」同款 keep-flat 纪律,且排除态幂等稳定。
    // 同安全名共夹(name+type 合并键)目标一致不属分歧,不受此排除。
    const sharedFlatRels = new Map<string, string[]>();

    await phase("P0-precheck", async () => {
      planRows = await readAssetRows();
      scan = scanStoreRefs(storeDir, io);
      baseline.fileCount = walkFiles(filesRoot, io).length + walkFiles(thumbsRoot, io).length;
      baseline.dbRows = planRows.length;
      baseline.assetRefs = scan.refs;
      // 基线断链:引用文件不在 files 树 + DB 路径不在 files 树
      const broken = new Set<string>();
      for (const { ref } of scan.refs) {
        if (!io.existsSync(path.join(filesRoot, ref))) broken.add(ref);
      }
      baseline.brokenRefs = [...broken].sort();
      for (const row of planRows) {
        for (const rel of rowRelativePaths(row)) {
          if (rel && !io.existsSync(path.join(filesRoot, rel))) dbBroken.add(rel);
        }
      }
      baseline.dbBrokenPaths = [...dbBroken].sort();
      // 共享平铺路径分歧预检(映射计划静态推导,先于 P2 任何挪动)
      const relTargets = new Map<string, Set<string>>();
      for (const row of planRows) {
        const rowType = String(row.type ?? "");
        if (!usesAssetNameFolder(rowType)) continue;
        const folderName = sanitizeAssetFolderNameDetailed(familyHead(String(row.name ?? ""))).folderName;
        const desiredDir = `${rowType}/${folderName}`;
        for (const rel of rowRelativePaths(row)) {
          if (!rel.startsWith(`${rowType}/`)) continue;
          const slash = rel.lastIndexOf("/");
          if (rel.slice(0, slash) === desiredDir) continue;
          const fileName = rel.slice(slash + 1);
          const newRel = `${desiredDir}/${fileName}`;
          if (newRel === rel) continue;
          const targets = relTargets.get(rel);
          if (targets) targets.add(newRel);
          else relTargets.set(rel, new Set([newRel]));
        }
      }
      for (const [rel, targets] of relTargets) {
        if (targets.size > 1) sharedFlatRels.set(rel, [...targets].sort());
      }
    });

    // ===== P1 备份:db 原件 + 全量清单 + 回滚 README(先例台账铁令) =====
    await phase("P1-backup", async () => {
      const dir = ensureLedgerDir();
      io.copyFileSync(dbPath, path.join(dir, "assets.db.orig"));
      io.writeFileSync(
        path.join(dir, "files-manifest.json"),
        `${JSON.stringify({
          files: walkFiles(assetRoot, io).map((file) => ({
            relative: path.relative(assetRoot, file),
            size: io.statSync(file).size,
          })),
        }, null, 2)}\n`,
      );
      io.writeFileSync(path.join(dir, "README.md"), [
        "# 资产按家夹迁移台账(10-19 v2:files/<type>/ 任意旧形态 → files/<type>/<家键>/,一族一夹)",
        "",
        "## 人工数据回滚(强制顺序,一次做完,全程 App 退出)",
        `1. 退出 App;2. 按 move-map.json 反向逐文件 rename(files 与 thumbs 双树:`,
        "   value → key,目标在=跳过);3. 恢复 assets.db(本台账 assets.db.orig 覆盖);",
        "4. 引用改写反向同表:store 树 asset-file://<value> → asset-file://<key>",
        "   (move-map.json 同一张表反向用);5. 删资产根 _name-folders-v3.json。",
        "- marker 删除后重跑即重新迁移判定(幂等闭环);",
        "- 异源同名冲突件(anomalies 留痕)从未被挪动,回滚无需处理;",
        "- 本台账 assets.db.orig 为 db 级最后兜底(永不删除)。",
        "",
      ].join("\n"));
      writeLedger();
    });

    // ===== P2 挪移:逐行算安全名 → files/thumbs 双树逐文件挪动(可重入) =====
    const mapping: AssetFileRefMapping = new Map();
    const files = { moved: 0, alreadyMoved: 0, conflicts: [] as string[], missing: [] as string[] };
    ledger.files = files;

    await phase("P2-move-files", async () => {
      for (const row of planRows) {
        const type = String(row.type ?? "");
        if (!usesAssetNameFolder(type)) continue;
        const detail = sanitizeAssetFolderNameDetailed(familyHead(String(row.name ?? "")));
        if (detail.truncated) {
          ledger.anomalies.push(`截断:资产 ${row.id} 名「${row.name}」→ 家夹名「${detail.folderName}」(≤80字符/240字节)`);
        }
        for (const rel of rowRelativePaths(row)) {
          if (!rel.startsWith(`${type}/`)) continue;
          const slash = rel.lastIndexOf("/");
          if (rel.slice(0, slash) === `${type}/${detail.folderName}`) continue;
          const fileName = rel.slice(slash + 1);
          const newRel = `${type}/${detail.folderName}/${fileName}`;
          if (newRel === rel) continue;
          // 多行共享平铺路径(目标分歧,P0 预检):不挪不 roll,与异源同名冲突同款
          // keep-flat 纪律——半迁(文件进一方名夹/DB 指另一方)即重跑蒙蔽源,整 rel
          // 原地不动是唯一可重入且盘/库互证不破的稳定终态。
          const divergentTargets = sharedFlatRels.get(rel);
          if (divergentTargets) {
            files.conflicts.push(rel);
            ledger.anomalies.push(`多行共享平铺路径:${rel}(映射目标分歧:${divergentTargets.join(" | ")},保持平铺不动)`);
            continue;
          }
          // files 树四态判定的源真相(目标在=已挪/异源,源在=待挪,双缺=缺失)
          const src = path.join(filesRoot, rel);
          const dst = path.join(filesRoot, newRel);
          const srcIn = io.existsSync(src);
          const dstIn = io.existsSync(dst);
          if (srcIn && dstIn) {
            // 异源同名文件:不挪不 roll,DB/引用保持旧路径
            files.conflicts.push(rel);
            ledger.anomalies.push(`异源同名冲突:${rel} → ${newRel}(目标已在场,保持平铺不动)`);
            continue;
          }
          if (!srcIn && !dstIn) {
            files.missing.push(rel);
            ledger.anomalies.push(`文件缺失:${rel}(files 树源缺,DB/引用照改写到 ${newRel},断链保持)`);
          } else if (srcIn) {
            io.mkdirSync(path.dirname(dst));
            io.renameSync(src, dst);
            files.moved += 1;
          } else {
            files.alreadyMoved += 1; // 中断续跑:上轮已挪
          }
          // thumbs 镜像:best-effort 同挪(派生层,缺失/冲突不阻断)
          const thumbSrc = path.join(thumbsRoot, rel);
          const thumbDst = path.join(thumbsRoot, newRel);
          if (io.existsSync(thumbSrc) && !io.existsSync(thumbDst)) {
            io.mkdirSync(path.dirname(thumbDst));
            io.renameSync(thumbSrc, thumbDst);
          }
          mapping.set(rel, newRel);
        }
      }
      // 挪动清单落台账(P2 后中断的回滚真源;先于 P3/P4 写)
      io.writeFileSync(path.join(ensureLedgerDir(), "move-map.json"), `${JSON.stringify(Object.fromEntries(mapping), null, 2)}\n`);
      // 家夹收敛后旧行名夹清空即剪枝(空壳目录不留盘面)
      for (const root of [filesRoot, thumbsRoot]) {
        pruneEmptyDirsUnder(root, io);
      }
      writeLedger();
    });

    // ===== P3 引用改写:映射表驱动,扫描面=P0 同款 store 树 .json/.jsonl =====
    let rewrittenRefs = 0;
    await phase("P3-rewrite-refs", async () => {
      for (const file of scan.files) {
        rewrittenRefs += applyAssetFileRefRewrite(file, mapping, {
          existsSync: io.existsSync,
          readFileSync: io.readFileSync,
          writeFileSync: io.writeFileSync,
          renameSync: io.renameSync,
          now: io.now,
        });
      }
      ledger.refs = { rewritten: rewrittenRefs, expected: 0 };
      writeLedger();
    });

    // ===== P4 DB 改写:filePath 与 images[] 按映射表批量 UPDATE =====
    await phase("P4-rewrite-db", async () => {
      const updates: Array<{ rowid: number; column: string; value: string | null }> = [];
      for (const row of planRows) {
        const rowid = Number(row.__rowid__);
        let changed = false;
        let filePath = typeof row.filePath === "string" ? row.filePath : undefined;
        if (filePath !== undefined && mapping.has(filePath)) {
          filePath = mapping.get(filePath);
          changed = true;
        }
        let imagesJson: string | undefined;
        if (typeof row.images === "string" && row.images) {
          try {
            const parsed = JSON.parse(row.images);
            if (Array.isArray(parsed)) {
              let imagesChanged = false;
              for (const img of parsed) {
                if (img && typeof img === "object" && typeof (img as { filePath?: unknown }).filePath === "string") {
                  const target = mapping.get((img as { filePath: string }).filePath);
                  if (target) {
                    (img as { filePath: string }).filePath = target;
                    imagesChanged = true;
                  }
                }
              }
              if (imagesChanged) {
                imagesJson = JSON.stringify(parsed);
                changed = true;
              }
            }
          } catch {
            // images 非法 JSON:整列不动
          }
        }
        if (!changed) continue;
        if (filePath !== undefined) updates.push({ rowid, column: "filePath", value: filePath });
        if (imagesJson !== undefined) updates.push({ rowid, column: "images", value: imagesJson });
      }
      // 分批提交:默认 sqlite IO 单次 execFile 拼一条 argv(生产 7317 行≈MB 级逼近
      // macOS ARG_MAX),500 条/批防御 E2BIG;批间幂等可重入(P0 重建映射续跑)。
      // L3(10-19 修复批):批失败(E2BIG/argv 溢出)自适应对半分批递归重试,
      // 单条失败照常上抛——收口「固定批不可分割→迁移永久 interrupted 循环」。
      const submit = async (batch: Array<{ rowid: number; column: string; value: string | null }>): Promise<void> => {
        if (batch.length === 0) return;
        try {
          await sqliteIo.updateRows(dbPath, "assets", batch);
        } catch (error) {
          if (batch.length === 1) throw error;
          const mid = Math.floor(batch.length / 2);
          await submit(batch.slice(0, mid));
          await submit(batch.slice(mid));
        }
      };
      const BATCH = 500;
      for (let index = 0; index < updates.length; index += BATCH) {
        await submit(updates.slice(index, index + BATCH));
      }
    });

    // ===== P5 核账:五重核账,任一红 → interrupted 不落 marker =====
    await phase("P5-verify", async () => {
      // ① 文件计数 == 基线(挪动保数)
      const fileCountNow = walkFiles(filesRoot, io).length + walkFiles(thumbsRoot, io).length;
      if (fileCountNow !== baseline.fileCount) {
        throw new NameFolderMigrationInterrupted(`文件计数核账失败(基线 ${baseline.fileCount} / 现有 ${fileCountNow})`);
      }
      // ② DB 行数 == 基线
      const rowsNow = await readAssetRows();
      if (rowsNow.length !== baseline.dbRows) {
        throw new NameFolderMigrationInterrupted(`DB 行数核账失败(基线 ${baseline.dbRows} / 现有 ${rowsNow.length})`);
      }
      // ③ 全量 filePath/images 可解析(或属基线断链——映射前形态按逆映射回看)
      const inverse = new Map<string, string>();
      for (const [from, to] of mapping) inverse.set(to, from);
      for (const row of rowsNow) {
        for (const rel of rowRelativePaths(row)) {
          if (io.existsSync(path.join(filesRoot, rel))) continue;
          const preForm = inverse.get(rel) ?? rel;
          if (dbBroken.has(preForm) || dbBroken.has(rel)) continue;
          throw new NameFolderMigrationInterrupted(`P5 核账失败:filePath 不可解析且不在基线断链集:${rel}`);
        }
      }
      // ④ 引用断链 ⊆ 基线(全量重扫;基线断链经映射平移后并入允许集)
      const allowedBroken = new Set<string>();
      for (const broken of baseline.brokenRefs ?? []) {
        allowedBroken.add(broken);
        allowedBroken.add(mapping.get(broken) ?? broken);
      }
      const rescan = scanStoreRefs(storeDir, io);
      const brokenNow = new Set<string>();
      for (const { ref } of rescan.refs) {
        if (!io.existsSync(path.join(filesRoot, ref))) brokenNow.add(ref);
      }
      for (const broken of brokenNow) {
        if (!allowedBroken.has(broken)) {
          throw new NameFolderMigrationInterrupted(`迁移引入新断链:${broken}(基线外)`);
        }
      }
      // ⑤ 引用改写计数对账:零漏(命中映射的旧形态引用重扫=0)零误(P3 计数==P0 口径重算)
      const expected = (baseline.assetRefs ?? []).filter((entry) => mapping.has(entry.ref)).length;
      ledger.refs = { rewritten: rewrittenRefs, expected };
      if (rewrittenRefs !== expected) {
        throw new NameFolderMigrationInterrupted(`引用改写计数失守(P3 ${rewrittenRefs} / P0 口径 ${expected})`);
      }
      const remaining = rescan.refs.filter((entry) => mapping.has(entry.ref));
      if (remaining.length !== 0) {
        throw new NameFolderMigrationInterrupted(`旧形态引用残留 ${remaining.length} 处(如 ${remaining[0]!.ref})`);
      }
    });

    // ===== P6 marker:落资产根(与 assets.db 同层;核账已绿) =====
    await phase("P6-write-marker", async () => {
      for (const legacy of ["_name-folders-v1.json", "_name-folders-v2.json"]) {
      const legacyMarker = path.join(assetRoot, legacy);
      if (io.existsSync(legacyMarker)) io.rmSync(legacyMarker, { recursive: true, force: true });
      }
      io.writeFileSync(markerPath, `${JSON.stringify({
        version: 3,
        familyFolders: true,
        finishedAt: new Date(io.now()).toISOString(),
        ledgerDir: ensureLedgerDir(),
        movedFiles: files.moved,
        rewrittenRefs,
        anomalyCount: ledger.anomalies.length,
      }, null, 2)}\n`);
    });

    ledger.finishedAt = io.now();
    writeLedger();
    return {
      root: assetRoot,
      status: "migrated",
      ledgerDir,
      movedFiles: files.moved,
      rewrittenRefs,
      anomalies: ledger.anomalies,
    };
  } catch (error) {
    ledger.interrupted = true;
    ledger.error = String(error);
    ledger.finishedAt = io.now();
    writeLedger();
    log(`资产按名分夹迁移中断(不落 marker,下轮续跑):${String(error)}`);
    return {
      root: assetRoot,
      status: "interrupted",
      reason: String(error),
      ledgerDir,
      movedFiles: ledger.files?.moved ?? 0,
      rewrittenRefs: ledger.refs?.rewritten ?? 0,
      anomalies: ledger.anomalies,
    };
  }
}
