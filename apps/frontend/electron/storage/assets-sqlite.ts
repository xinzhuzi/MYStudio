import fs from "node:fs";
import path from "node:path";
import type { AssetImage, StudioAssetSummary } from "../../types/studio-assets";
import { createAssetFileUrl } from "./storage-paths";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

/**
 * 资产库 sqlite 运行器族——init/路径族/exec-json 运行器/锁重试/escape/where 构建器/JSON 迁移/行映射。file-size-reduction zustand 专批拆出,体逐字保留。
 */
const execFileAsync = promisify(execFile);
const SQLITE_BUSY_TIMEOUT_MS = 5000;
const SQLITE_LOCK_RETRY_DELAYS_MS = [80, 160, 320, 640, 1000];

export interface SqliteCliResolutionOptions {
  platform?: NodeJS.Platform;
  /** 打包应用的 resources 目录;未打包/node 环境下为 undefined */
  resourcesPath?: string;
  fileExists?: (filePath: string) => boolean;
}

/**
 * 解析资产库 SQLite CLI 可执行文件。
 * Windows 没有系统 sqlite3 命令(CI 的 ubuntu runner 与 macOS 自带,掩盖了该缺口),
 * 因此 Windows 安装包内捆绑 sqlite3.exe(extraResources:<resources>/sqlite3/),
 * 运行时优先使用;其余平台/开发模式回退 PATH 上的 sqlite3。
 * 参数可注入以便单测。
 */
export function resolveSqliteCli(options: SqliteCliResolutionOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const fileExists = options.fileExists ?? fs.existsSync;
  if (platform === "win32" && typeof resourcesPath === "string" && resourcesPath.length > 0) {
    const bundled = path.join(resourcesPath, "sqlite3", "sqlite3.exe");
    if (fileExists(bundled)) {
      return bundled;
    }
  }
  return "sqlite3";
}

/** 每次解析(含一次 existsSync,开销可忽略),避免模块级缓存与测试相互干扰。 */
function sqliteCliExecutable(): string {
  return resolveSqliteCli();
}

export interface StoredAssetImage {
  name: string;
  filePath: string;
  /** 10-24 图片展示规范批2:图片类型持久值(住 images[] JSON 条目内,db schema 不加列,
   *  PRD Round 2 A 裁定);缺省=老图,读路按命名规则派生(classifyAssetImage 三层解析)。 */
  kind?: string;
}

interface AssetDbRow {
  id: string;
  type: StudioAssetSummary["type"];
  name: string;
  description?: string;
  prompt?: string;
  setting?: string;
  remark?: string;
  tags?: string;
  filePath?: string;
  images?: string;
}

let basePath: string = "";

/**
 * 1015 资产归域+1016 二段:参数语义=assetsRoot(资产根本身,由 asset-library-ipc
 * 传 getAssetsRoot() 解析结果(=<项目根>/store/assets);旧语义 storageBasePath
 * 内含 join(…,'assets') 派生已上移到调用方)。getAssetsDir 返回 basePath 本身;
 * 派生函数族不变,studio-assets-storage 全部写入点(getFilesDir 等)零改。
 */
export function initAssetsStorage(assetsRoot: string) {
  basePath = assetsRoot;
  const assetsDir = getAssetsDir();
  fs.mkdirSync(assetsDir, { recursive: true });
  // L11(10-19 修复批):五个类型目录不再预建——全部写入点按需 mkdir(名夹父目录
  // 亦然),盘上不再留空置平铺目录;只保资产根与 files 根。
  fs.mkdirSync(path.join(assetsDir, "files"), { recursive: true });
  ensureDb();
}

export function getAssetsDir() {
  return basePath;
}

export function getDbPath() {
  return path.join(getAssetsDir(), "assets.db");
}

export function getFilesDir() {
  return path.join(getAssetsDir(), "files");
}

export function getThumbsDir() {
  return path.join(getAssetsDir(), "thumbs");
}

export function resolveAssetManagedPath(root: string, relativePath: string) {
  const normalizedRoot = path.resolve(root);
  const normalizedRelativePath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedRelativePath || normalizedRelativePath.includes("\0") || normalizedRelativePath.split("/").includes("..")) {
    throw new Error("Asset path escapes managed root");
  }
  const targetPath = path.resolve(normalizedRoot, normalizedRelativePath);
  if (targetPath !== normalizedRoot && !targetPath.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Asset path escapes managed root");
  }
  return targetPath;
}

export function shouldCreateAssetThumbnail(type: string) {
  return type !== "audio" && type !== "clip";
}

// === 资产名分夹(10-19-asset-name-folders) ===

/** R1 分夹域:role/scene/tool 三类图片按资产名分夹;clip/audio 保持平铺(prd R1)。 */
export function usesAssetNameFolder(type: string) {
  return type === "role" || type === "scene" || type === "tool";
}

const ASSET_FOLDER_NAME_MAX_CHARS = 80;
const ASSET_FOLDER_NAME_MAX_BYTES = 240;
const WINDOWS_RESERVED_FOLDER_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/** sanitizeAssetFolderName 明细结果:truncated 供迁移/改名链路落 anomalies 台账(design §2 第5条)。 */
export interface AssetFolderNameSanitizeResult {
  folderName: string;
  truncated: boolean;
}

/**
 * 资产名安全化为子文件夹名(单一真源,design §2):
 * 1) trim;2) 非法字符 [/\\:*?"<>|]→_(沿用 :117/:145 先例)并去除控制字符;
 * 3) 去首尾空格与点号(macOS 合法但 Windows 致命的尾点/尾空格形态);
 * 4) Windows 保留名(大小写不敏感)尾缀 _;5) 截断至 ≤80 字符且 UTF-8 ≤240 字节(逐码点回退);
 * 6) 空结果兜底「未命名」(生产 empty_name=0,纯防御)。
 */
export function sanitizeAssetFolderNameDetailed(name: string): AssetFolderNameSanitizeResult {
  let value = String(name ?? "").trim();
  // eslint-disable-next-line no-control-regex -- 夹名安全化必须剔除控制字符(先例 scene-segments.ts:271)
  value = value.replace(/[/\\:*?"<>|]/g, "_").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  value = value.replace(/^[. ]+|[. ]+$/g, "");
  if (WINDOWS_RESERVED_FOLDER_NAME.test(value)) value = `${value}_`;

  let truncated = false;
  const codePoints = Array.from(value);
  let cut = codePoints.length;
  while (
    cut > 0 &&
    (cut > ASSET_FOLDER_NAME_MAX_CHARS ||
      Buffer.byteLength(codePoints.slice(0, cut).join(""), "utf8") > ASSET_FOLDER_NAME_MAX_BYTES)
  ) {
    truncated = true;
    cut -= 1;
  }
  if (cut < codePoints.length) value = codePoints.slice(0, cut).join("");
  // L2(10-19 修复批):截断可能切在尾点/尾空格上,Windows 致命形态在截断后重新
  // 出现——截断后重跑尾剥与保留名复查(审查发现#7 实锤复现 endsWithDot/endsWithSpace)。
  value = value.replace(/^[. ]+|[. ]+$/g, "");
  if (WINDOWS_RESERVED_FOLDER_NAME.test(value)) value = `${value}_`;

  if (!value) return { folderName: "未命名", truncated };
  return { folderName: value, truncated };
}

/** 简式:写入点落盘用;明细/truncated 信号走 sanitizeAssetFolderNameDetailed。 */
export function sanitizeAssetFolderName(name: string) {
  return sanitizeAssetFolderNameDetailed(name).folderName;
}

/**
 * 家夹键(10-19 用户终裁:一族一夹,「晏燎就晏燎一个文件夹」)——行名首个「_」前
 * 的主体段做夹名;无下划线名(基行,如 晏燎)即本身。生成链命名约定
 * `${角色名}_${阶段}_${视图}` 天然携带家前缀,故首段=归属实体;共享名资产
 * (「李先生;管事」分号形态)不含下划线不受扰。首段空(如名以_开头)回落整名。
 */
export function assetFamilyFolderKey(name: string) {
  return sanitizeAssetFolderName(assetFamilyHead(name));
}

/** 家段(10-19 序号目录修正):跳过前导纯数字段(01/0002)与目录编码段
 * (R-1234/炼-123/丹-303),取首个实体名段——「01_人皇苍_海报」家=人皇苍,
 * 「0002_R-3239_回元丹」家=回元丹;全段皆序号/编码回落整名(audio 纯号名不建夹)。 */
export function assetFamilyHead(name: string): string {
  const segments = String(name ?? "").split("_");
  const CODE = /^(\d+|[A-Za-z]{1,3}-\d+|[\u4e00-\u9fa5]{1,2}-\d+)$/;
  for (const seg of segments) {
    if (!CODE.test(seg)) return seg;
  }
  return String(name ?? "");
}

/** 展示名基(文件名用):剥前导纯数字序号段——「01_人皇苍_x」→「人皇苍_x」。 */
export function assetDisplayName(name: string): string {
  return String(name ?? "").replace(/^\d+_/, "") || String(name ?? "");
}

/** 中文日期名(10-19 命名裁定):`xxxx年xx月xx日`,图生图/一键生成结果名后缀。 */
export function formatChineseDateNow(): string {
  const now = new Date();
  return `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, "0")}月${String(now.getDate()).padStart(2, "0")}日`;
}

/** 缩略图生成队列：限制并发，避免一次性 spawn 数千个 sips 进程导致主进程卡死 */
let thumbActive = 0;
const thumbQueue: Array<() => void> = [];
const thumbQueued = new Set<string>();
function pumpThumbQueue() {
  while (thumbActive < 4 && thumbQueue.length > 0) {
    const job = thumbQueue.shift()!;
    thumbActive++;
    job();
  }
}
function enqueueThumb(srcPath: string, thumbPath: string) {
  if (thumbQueued.has(thumbPath)) return;
  thumbQueued.add(thumbPath);
  thumbQueue.push(() => {
    execFile("sips", ["-z", "200", "200", srcPath, "--out", thumbPath], () => {
      thumbActive--;
      thumbQueued.delete(thumbPath);
      pumpThumbQueue();
    });
  });
  pumpThumbQueue();
}

/** 获取缩略图路径，不存在则异步生成 */
export function getThumbUrl(filePath: string | undefined, type: string): string | undefined {
  if (!filePath) return undefined;
  if (!shouldCreateAssetThumbnail(type)) {
    const srcPath = resolveAssetManagedPath(getFilesDir(), filePath);
    return fs.existsSync(srcPath) ? createAssetFileUrl(filePath) : undefined;
  }
  const thumbPath = resolveAssetManagedPath(getThumbsDir(), filePath);
  if (fs.existsSync(thumbPath)) return createAssetFileUrl(filePath, { thumb: true });
  // 异步生成缩略图（限流，不阻塞返回）
  const srcPath = resolveAssetManagedPath(getFilesDir(), filePath);
  if (!fs.existsSync(srcPath)) return undefined;
  const thumbDir = path.dirname(thumbPath);
  fs.mkdirSync(thumbDir, { recursive: true });
  enqueueThumb(srcPath, thumbPath);
  // 首次返回原图 URL，下次就有缩略图了
  return createAssetFileUrl(filePath);
}

export function resolveManagedAssetPathOrUndefined(relativePath: string | undefined) {
  if (!relativePath) return undefined;
  try {
    return resolveAssetManagedPath(getFilesDir(), relativePath);
  } catch {
    return undefined;
  }
}

// === SQLite helpers ===

export function ensureDb() {
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) return;
  // 创建表
  const schema = `
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  prompt TEXT DEFAULT '',
  setting TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  filePath TEXT,
  images TEXT DEFAULT '[]',
  source TEXT DEFAULT 'manying-local',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);
`;
  runSqliteSync(dbPath, schema);

  // 如果旧 db.json 存在，自动迁移
  const jsonPath = path.join(getAssetsDir(), "db.json");
  if (fs.existsSync(jsonPath)) {
    migrateFromJson(jsonPath, dbPath);
  }
}

export function runSqliteSync(dbPath: string, sql: string) {
  runSqliteInput(dbPath, sql, { maxBuffer: 50 * 1024 * 1024 });
}

export async function runSqliteJson<T>(dbPath: string, query: string): Promise<T> {
  const { stdout } = await runSqliteJsonProcess(dbPath, query);
  const trimmed = stdout.trim();
  if (!trimmed) return [] as T;
  return JSON.parse(trimmed) as T;
}

export function runSqliteExec(dbPath: string, sql: string) {
  runSqliteInput(dbPath, sql, { maxBuffer: 50 * 1024 * 1024 });
}

export function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}
export function escapeSqlLike(value: string): string {
  return escapeSql(value).replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** 构建 assets 查询的 WHERE 子句（按类型/搜索/分类标签过滤）。导出以便单测。 */
export function buildAssetWhere(type: string, search?: string, category?: string): string {
  const conds = [`type='${escapeSql(type)}'`];
  if (search) conds.push(`(name LIKE '%${escapeSqlLike(search)}%' ESCAPE '\\' OR prompt LIKE '%${escapeSqlLike(search)}%' ESCAPE '\\')`);
  if (category) conds.push(`tags LIKE '%"${escapeSql(category)}"%'`);
  return `WHERE ${conds.join(" AND ")}`;
}

export function buildAssetNameCandidateCondition(name: string): string {
  const exact = escapeSql(name);
  const like = escapeSqlLike(name);
  return `(name='${exact}' OR name LIKE '%${like}%' ESCAPE '\\' OR remark LIKE '%${like}%' ESCAPE '\\')`;
}

/** 执行可能包含长文本的 SQL */
export function runSqliteExecSafe(dbPath: string, sql: string) {
  runSqliteInput(dbPath, sql, { maxBuffer: 50 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}

export function runSqliteJsonSync<T>(dbPath: string, query: string): T {
  const stdout = runSqliteSyncProcess(["-cmd", `.timeout ${SQLITE_BUSY_TIMEOUT_MS}`, "-json", dbPath, query], {
    maxBuffer: 10 * 1024 * 1024,
  }).toString().trim();
  if (!stdout) return [] as T;
  return JSON.parse(stdout) as T;
}

export function runSqliteInput(dbPath: string, sql: string, options: { maxBuffer: number; stdio?: ["pipe", "pipe", "pipe"] }) {
  return runSqliteSyncProcess([dbPath], {
    ...options,
    input: `.timeout ${SQLITE_BUSY_TIMEOUT_MS}\n${sql}`,
  });
}

export function runSqliteSyncProcess(args: string[], options: { input?: string; maxBuffer: number; stdio?: ["pipe", "pipe", "pipe"] }) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= SQLITE_LOCK_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return execFileSync(sqliteCliExecutable(), args, options);
    } catch (error) {
      lastError = error;
      if (!isSqliteLockedError(error) || attempt === SQLITE_LOCK_RETRY_DELAYS_MS.length) break;
      sleepSync(SQLITE_LOCK_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

async function runSqliteJsonProcess(dbPath: string, query: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= SQLITE_LOCK_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await execFileAsync(sqliteCliExecutable(), ["-cmd", `.timeout ${SQLITE_BUSY_TIMEOUT_MS}`, "-json", dbPath, query], {
        maxBuffer: 20 * 1024 * 1024,
      });
    } catch (error) {
      lastError = error;
      if (!isSqliteLockedError(error) || attempt === SQLITE_LOCK_RETRY_DELAYS_MS.length) break;
      await sleep(SQLITE_LOCK_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

export function isSqliteLockedError(error: unknown) {
  const err = error as { message?: string; stderr?: Buffer | string };
  const text = `${err?.message || ""}\n${Buffer.isBuffer(err?.stderr) ? err.stderr.toString() : err?.stderr || ""}`;
  return /database is locked|SQLITE_BUSY|locked \(5\)/i.test(text);
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function migrateFromJson(jsonPath: string, dbPath: string) {
  try {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const data = JSON.parse(raw);
    const assets = data.assets || [];
    if (!assets.length) return;

    // 批量插入
    const batchSize = 200;
    for (let i = 0; i < assets.length; i += batchSize) {
      const batch = assets.slice(i, i + batchSize);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const values = batch.map((a: any) => {
        const id = a.id || randomUUID();
        const tags = JSON.stringify(a.tags || []);
        const images = JSON.stringify(a.images || []);
        const now = a.createdAt || new Date().toISOString();
        return `('${escapeSql(id)}','${escapeSql(a.type || "")}','${escapeSql(a.name || "")}','${escapeSql(a.description || "")}','${escapeSql(a.prompt || "")}','${escapeSql(a.setting || "")}','${escapeSql(a.remark || "")}','${escapeSql(tags)}','${escapeSql(a.filePath || "")}','${escapeSql(images)}','${escapeSql(a.source || "manying-local")}','${escapeSql(now)}','${escapeSql(now)}')`;
      }).join(",\n");
      const sql = `INSERT OR IGNORE INTO assets (id,type,name,description,prompt,setting,remark,tags,filePath,images,source,createdAt,updatedAt) VALUES\n${values};`;
      runSqliteExec(dbPath, sql);
    }

    // 迁移完成后重命名旧文件
    fs.renameSync(jsonPath, jsonPath + ".migrated");
  } catch (e) {
    console.error("migrateFromJson failed:", e);
  }
}

// === CRUD ===


export function rowToSummary(row: AssetDbRow): StudioAssetSummary {
  const absPath = resolveManagedAssetPathOrUndefined(row.filePath);
  const previewUrl = absPath ? createAssetFileUrl(row.filePath!) : undefined;
  let images: AssetImage[] | undefined;
  try {
    const parsed = JSON.parse(row.images || "[]");
    if (parsed.length) {
      images = parsed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((img: any) => {
          const imagePath = resolveManagedAssetPathOrUndefined(img.filePath);
          if (!imagePath) return null;
          return {
            name: img.name,
            filePath: img.filePath,
            url: createAssetFileUrl(img.filePath),
            // 10-24 批2:kind 持久值透传(非法串透传后在视图层被 classifyAssetImage
            // 的 isAssetImageKind 校验拦下走命名派生,此处不阻断投影)
            ...(typeof img.kind === "string" ? { kind: img.kind as AssetImage["kind"] } : {}),
          };
        })
        .filter((img: AssetImage | null): img is AssetImage => Boolean(img));
    }
  } catch {}

  return {
    id: row.id,
    source: "manying-local",
    type: row.type,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    setting: row.setting,
    remark: row.remark,
    tags: (() => { try { return JSON.parse(row.tags || "[]"); } catch { return []; } })(),
    thumbnailUrl: absPath ? getThumbUrl(row.filePath, row.type) : undefined,
    previewUrl,
    filePath: row.filePath,
    sourcePath: absPath,
    state: "success",
    images,
  };
}

/** 清除缓存（用于测试或热重载） */
