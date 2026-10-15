import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readAssetHomeMarker, writeAssetHomeMarker, ttsDbProbe, type AssetHomeIo } from "./asset-home";

/**
 * 资产归域启动期一次性幂等迁移例程(1015:App 家资产库/TTS 归项目域;1016:
 * 一段落点改项目根 store/assets 一次到位+旧家双源探测)。
 *
 * 纪律锚:
 * - fail-closed:预检任一不过=零提交+台账+回落旧根(旧根 db 在场零损失);
 * - 双提交点:资产域=rename assets.db(原子);TTS 域=rename tts.sqlite(最后);
 * - 文件即真相:重入判定全靠探针(新根 store/assets/assets.db / join(base,'TTS',
 *   'runtime','tts.sqlite')),marker 只是缓存(B1 断电窗口靠全表探测自愈+补写);
 * - 旧家双源探测(1016):flat 形 join(base,'assets')(≤1015 机器)优先;
 *   store 形 join(base,'store','assets')(本代新装机未绑项目期经新 fallback
 *   写入)兜底;双源都有 db → fail-closed 不猜边;
 * - 红线:不 import assets-sqlite(避免其模块级 basePath 状态与 ensureDb 建库副作用);
 * - marker 恒 <userData>/asset-home.json(B-1,永不随数据迁移);
 * - 台账/备份恒 <projectRoot>/backups/asset-migration-<ts>/(根目录铁令,严禁塞 store/)。
 */

const execFileAsync = promisify(execFile);

export interface MigrationIo {
  existsSync(filePath: string): boolean;
  statSync(filePath: string): { size: number; dev: number; isDirectory(): boolean };
  mkdirSync(dirPath: string): void;
  readdirSync(dirPath: string): string[];
  readFileSync(filePath: string): string;
  writeFileSync(filePath: string, contents: string): void;
  copyFileSync(from: string, to: string): void;
  renameSync(from: string, to: string): void;
  unlinkSync(filePath: string): void;
  rmSync(dirPath: string, options: { recursive: true; force: true }): void;
  now(): number;
}

const defaultIo: MigrationIo = {
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

/** 语义化 sqlite io:不解析 SQL,测试注入 fake;默认实现走 sqlite3 CLI。 */
export interface MigrationSqliteIo {
  tableExists(dbPath: string, table: string): Promise<boolean>;
  readTable(dbPath: string, table: string): Promise<Array<Record<string, unknown>>>;
  updateRows(
    dbPath: string,
    table: string,
    updates: Array<{ rowid: number; column: string; value: string | null }>,
  ): Promise<void>;
}

// 1016 真机回归:sqlite3 CLI 全表 -json dump 的 stdout 可达数十 MB(7282 行实库
// 曾炸 Node 默认 1MB 帽→P0 预检 RangeError fail-closed),统一抬到 256MB。
const SQLITE_IO_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

export const defaultSqliteIoForTest = {
  tableExists: (dbPath: string, table: string) => defaultSqliteIo.tableExists(dbPath, table),
  readTable: (dbPath: string, table: string) => defaultSqliteIo.readTable(dbPath, table),
};

function resolveSqlite3Cli(): string {
  if (process.env.MY_SQLITE3_CLI) return process.env.MY_SQLITE3_CLI; // 测试缝(1016)
  // 与 storage/assets-sqlite.ts resolveSqliteCli 同款策略(红线:不得 import 它,此处复刻):
  // Windows 打包内 <resources>/sqlite3/sqlite3.exe 优先,其余回退 PATH。
  if (process.platform === "win32" && typeof process.resourcesPath === "string") {
    const bundled = path.join(process.resourcesPath, "sqlite3", "sqlite3.exe");
    if (fs.existsSync(bundled)) return bundled;
  }
  return "sqlite3";
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export const defaultSqliteIo: MigrationSqliteIo = {
  async tableExists(dbPath, table) {
    try {
      const { stdout } = await execFileAsync(resolveSqlite3Cli(), [
        dbPath,
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${escapeSqlLiteral(table)}';`,
      ], { maxBuffer: SQLITE_IO_MAX_BUFFER_BYTES });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  },
  async readTable(dbPath, table) {
    const { stdout } = await execFileAsync(resolveSqlite3Cli(), [
      "-json",
      dbPath,
      `SELECT rowid AS __rowid__, * FROM ${table};`,
    ], { maxBuffer: SQLITE_IO_MAX_BUFFER_BYTES });
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    return JSON.parse(trimmed) as Array<Record<string, unknown>>;
  },
  async updateRows(dbPath, table, updates) {
    if (!updates.length) return;
    const statements = updates.map((update) => (
      update.value === null
        ? `UPDATE ${table} SET "${update.column}"=NULL WHERE rowid=${update.rowid};`
        : `UPDATE ${table} SET "${update.column}"='${escapeSqlLiteral(update.value)}' WHERE rowid=${update.rowid};`
    ));
    await execFileAsync(resolveSqlite3Cli(), [dbPath, statements.join("\n")], { maxBuffer: SQLITE_IO_MAX_BUFFER_BYTES });
  },
};

/** P4′ 公用:profiles 全列旧前缀→新前缀扫描改写(不猜 schema;幂等:已改写行不再命中)。一段/二段共用。 */
export async function rewriteProfilePrefixColumns(
  sqliteIo: Pick<MigrationSqliteIo, "tableExists" | "readTable" | "updateRows">,
  existsSync: (filePath: string) => boolean,
  dbPath: string,
  prefixMappings: Array<[string, string]>,
): Promise<void> {
  if (!existsSync(dbPath)) return;
  if (!(await sqliteIo.tableExists(dbPath, "profiles"))) return;
  const rows = await sqliteIo.readTable(dbPath, "profiles");
  const updates: Array<{ rowid: number; column: string; value: string | null }> = [];
  for (const row of rows) {
    const rowid = Number(row.__rowid__);
    for (const [column, value] of Object.entries(row)) {
      if (column === "__rowid__" || typeof value !== "string") continue;
      let next = value;
      for (const [from, to] of prefixMappings) {
        if (next.startsWith(from)) {
          next = `${to}${next.slice(from.length)}`;
          break;
        }
      }
      if (next !== value) updates.push({ rowid, column, value: next });
    }
  }
  await sqliteIo.updateRows(dbPath, "profiles", updates);
}

export interface RunAssetHomeMigrationOptions {
  userDataPath: string;
  getStorageBasePath: () => string;
  locationStore: {
    get(projectId: string): string | undefined;
    set(projectId: string, dir: string): void;
    delete(projectId: string): void;
    all(): Record<string, string>;
  };
  sqliteIo?: MigrationSqliteIo;
  io?: Partial<MigrationIo>;
  log?: (message: string) => void;
}

export type MigrationRunResult = {
  status: "migrated" | "noop" | "interrupted" | "error";
  ledgerDir: string | null;
  reason?: string;
  /** 失败分级语义(补刀):中断时资产域是否已过 P6 提交点。true=资产库已在新根,
   * 绝不回落(下次启动只续 TTS/善后);false=未提交,旧根 db 在场零损失回落。 */
  assetCommitted?: boolean;
};

/** M17 已知残留白名单(顶层文件名模式;命中才可删,其余一律台账留档)。 */
function isKnownTopLevelResidue(name: string): boolean {
  return (
    name === "MIGRATED-README.txt"
    || name === "assets.db"
    || /^assets\.db\.bak-/.test(name)
    || /shezhi/i.test(name)
  );
}

type Ledger = {
  version: number;
  startedAt: number;
  finishedAt?: number;
  interrupted?: boolean;
  error?: string;
  projectId?: string;
  projectRoot?: string;
  phases: Array<{ name: string; ms: number; status: "ok" | "failed" }>;
  baseline?: {
    assets?: Record<string, number>;
    profiles?: { ids: string[] };
    generations?: { ttsRuntimeAudio: number; legacyTtsRuntimeAudio: number };
    fileUnionCount?: number;
    brokenRefs?: string[];
  };
  files?: { moved: number; skippedSameSize: number; conflicts: string[] };
  generations?: { ttsRuntimeAudio: number; legacyTtsRuntimeAudio: number };
  rolls: Array<{ from: string; to: string; reason: string }>;
  anomalies: string[];
};

class MigrationInterrupted extends Error {}

/** M10 截断字符集(一段/二段共用):URL 后逐字符消费至终止集。 */
export const STORE_REF_PATTERN = /asset-file:\/\/(role|scene|tool|clip|audio)\/([^\s"'\\?()[\]{},:;、；：，。？！“”‘’《》【】·—…]+)/g;

export function walkFiles(root: string, io: MigrationIo): string[] {
  if (!io.existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of io.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (io.statSync(full).isDirectory()) visit(full);
      else out.push(full);
    }
  };
  visit(root);
  return out;
}

export async function runAssetHomeMigration(options: RunAssetHomeMigrationOptions): Promise<MigrationRunResult> {
  const io: MigrationIo = { ...defaultIo, ...options.io };
  const sqliteIo = options.sqliteIo ?? defaultSqliteIo;
  const log = options.log ?? ((message: string) => { console.warn(`[asset-migration] ${message}`); });

  const legacyBase = options.getStorageBasePath();
  // 1016 双源探测:旧家 flat 形(≤1015 机器,真实例=Windows 机)优先;store 形
  // (本代新装机未绑项目期经新 fallback 写入)兜底;双源都有 db → fail-closed
  // 不猜边(闭合 main-paths fallback 改形环)。
  const legacyAssetsFlatRoot = path.join(legacyBase, "assets");
  const legacyAssetsStoreRoot = path.join(legacyBase, "store", "assets");
  const legacyAssetsFlatDb = path.join(legacyAssetsFlatRoot, "assets.db");
  const legacyAssetsStoreDb = path.join(legacyAssetsStoreRoot, "assets.db");
  const legacyTtsRuntimeDir = path.join(legacyBase, "TTS", "runtime");
  const legacyTtsDbPath = ttsDbProbe(legacyBase);

  const locations = options.locationStore.all() ?? {};
  const projectIds = Object.keys(locations);
  if (projectIds.length > 1) {
    log(`异常态:多个项目位置(${projectIds.join(",")})——状态机中止不猜边,不迁移不建库`);
    return { status: "error", ledgerDir: null, reason: "多项目位置并存,需人工按台账核对" };
  }
  const projectId = projectIds[0];
  const projectRoot = projectId ? locations[projectId] : undefined;
  if (!projectRoot) {
    return { status: "noop", ledgerDir: null, reason: "无外部项目位置,资产住统一存储旧根" };
  }
  if (io.existsSync(legacyAssetsFlatDb) && io.existsSync(legacyAssetsStoreDb)) {
    log(`异常态:旧家 flat 与 store 形资产库并存(${legacyAssetsFlatRoot} ; ${legacyAssetsStoreRoot})——fail-closed 不迁移不建库`);
    return { status: "error", ledgerDir: null, reason: "旧家双形资产库并存,需人工按台账核对" };
  }
  // flat 目录在场即优先(不只看 db):P6 后断电半态 flat db 已迁走而 files 残留,
  // 按 db 选根会误入 store 形致续迁/善后找不到残留。store 形仅在 flat 目录
  // 整体缺位(新装机未绑项目期经新 fallback 写入)时命中。
  const legacyAssetsRoot = io.existsSync(legacyAssetsFlatRoot) ? legacyAssetsFlatRoot : legacyAssetsStoreRoot;
  const legacyAssetDbPath = path.join(legacyAssetsRoot, "assets.db");

  // 1016 二段:一段落点重定=项目根 store/assets(未跑过 1015 的机器一次到位,
  // 不再产生 <root>/assets 中间态;P0/P2/P5/P6/P7/collectStoreRefs/resume/B3/
  // 善后全由该变量派生机械随动)。
  const newAssetsRoot = path.join(projectRoot, "store", "assets");
  const newAssetDbPath = path.join(newAssetsRoot, "assets.db");
  const newTtsRuntimeDir = path.join(projectRoot, "TTS", "runtime");
  const newTtsDbPath = ttsDbProbe(projectRoot);

  const markerIo: AssetHomeIo = {
    fileExists: io.existsSync,
    readTextFile: (filePath) => (io.existsSync(filePath) ? io.readFileSync(filePath) : null),
    writeTextFile: (filePath, text) => {
      io.mkdirSync(path.dirname(filePath));
      io.writeFileSync(filePath, text);
    },
  };

  const ledger: Ledger = {
    version: 1,
    startedAt: io.now(),
    phases: [],
    rolls: [],
    anomalies: [],
    projectId,
    projectRoot,
  };
  let ledgerDir: string | null = null;
  const ensureLedgerDir = (): string => {
    if (!ledgerDir) {
      ledgerDir = path.join(projectRoot, "backups", `asset-migration-${new Date(io.now()).toISOString().replace(/[:.]/g, "-")}`);
      io.mkdirSync(ledgerDir);
      io.mkdirSync(path.join(ledgerDir, "rolls"));
    }
    return ledgerDir;
  };
  const writeLedger = () => {
    const dir = ensureLedgerDir();
    io.writeFileSync(path.join(dir, "migration-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
  };
  const roll = (from: string, reason: string) => {
    const dir = ensureLedgerDir();
    const target = path.join(dir, "rolls", `${ledger.rolls.length}-${path.basename(from)}`);
    io.mkdirSync(path.dirname(target));
    io.renameSync(from, target);
    ledger.rolls.push({ from, to: target, reason });
    log(`台账留档(${reason}):${from} → ${target}`);
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

  // 旧根 db 缺+新根 db 缺=全新装机无资产史:无库可迁(资产首次写入仍落旧根,
  // 下次启动检测到旧根库即自动全量迁移,自愈闭环)。
  const assetMigrated = io.existsSync(newAssetDbPath);
  // 失败分级语义:仅全量迁移路径有 P6 提交点;续迁路径进来时资产域恒已提交。
  let assetCommitted = assetMigrated;
  if (!assetMigrated && !io.existsSync(legacyAssetDbPath)) {
    log("旧根与新根均无 assets.db(无资产史):资产段跳过");
    if (io.existsSync(legacyTtsDbPath)) {
      // 仅 TTS 有史:搬 TTS 件(不写 marker——资产域未定,防 ORPHANED 误报)
      try {
        await phase("TTS-only-move", async () => {
          io.mkdirSync(newTtsRuntimeDir);
          io.mkdirSync(path.join(newTtsRuntimeDir, "audio"));
          const legacyAudioDir = path.join(legacyTtsRuntimeDir, "audio");
          for (const file of walkFiles(legacyAudioDir, io)) {
            const target = path.join(newTtsRuntimeDir, "audio", path.relative(legacyAudioDir, file));
            if (!io.existsSync(target)) {
              io.mkdirSync(path.dirname(target));
              io.renameSync(file, target);
            }
          }
          const legacyConfig = path.join(legacyTtsRuntimeDir, "config.json");
          if (io.existsSync(legacyConfig) && !io.existsSync(path.join(newTtsRuntimeDir, "config.json"))) {
            io.renameSync(legacyConfig, path.join(newTtsRuntimeDir, "config.json"));
          }
          if (!io.existsSync(newTtsDbPath)) io.renameSync(legacyTtsDbPath, newTtsDbPath);
        });
        writeLedger();
      } catch (error) {
        ledger.interrupted = true;
        ledger.error = String(error);
        writeLedger();
        return { status: "interrupted", ledgerDir, reason: String(error) };
      }
    }
    return { status: "noop", ledgerDir, reason: "无资产库可迁" };
  }

  const collectStoreRefs = (): { refs: Set<string>; broken: Set<string> } => {
    const refs = new Set<string>();
    const broken = new Set<string>();
    const storeDir = path.join(projectRoot, "store");
    for (const file of walkFiles(storeDir, io)) {
      if (!file.endsWith(".json") && !file.endsWith(".jsonl")) continue;
      let text: string;
      try {
        text = io.readFileSync(file);
      } catch {
        continue;
      }
      for (const match of text.matchAll(STORE_REF_PATTERN)) {
        let relative: string;
        try {
          relative = decodeURIComponent(`${match[1]}/${match[2]}`);
        } catch {
          relative = `${match[1]}/${match[2]}`;
        }
        if (refs.has(relative)) continue;
        refs.add(relative);
        const inOld = io.existsSync(path.join(legacyAssetsRoot, "files", relative));
        const inNew = io.existsSync(path.join(newAssetsRoot, "files", relative));
        if (!inOld && !inNew) broken.add(relative);
      }
    }
    return { refs, broken };
  };

  const readProfilesBaseline = async (dbPath: string): Promise<string[]> => {
    if (!io.existsSync(dbPath)) return [];
    if (!(await sqliteIo.tableExists(dbPath, "profiles"))) return [];
    const rows = await sqliteIo.readTable(dbPath, "profiles");
    return rows.map((row) => String(row.id ?? "")).filter(Boolean);
  };

  const rewriteTtsDb = async (dbPath: string): Promise<void> => {
    // P4′:profiles 旧前缀→新前缀(通用列扫描,不猜 schema);generations 双前缀置 NULL。
    // 1016 双映射(拷问1轮·major 补刀):资产前缀 flat/store 两形并列——双源命中
    // store 形旧家时,指向旧家 store 形资产前缀的行同样改写,杜绝漏改断链且无台账。
    const prefixMappings: Array<[string, string]> = [
      [`${legacyTtsRuntimeDir}${path.sep}`, `${newTtsRuntimeDir}${path.sep}`],
      [`${legacyAssetsFlatRoot}${path.sep}files${path.sep}`, `${path.join(newAssetsRoot, "files")}${path.sep}`],
      [`${legacyAssetsStoreRoot}${path.sep}files${path.sep}`, `${path.join(newAssetsRoot, "files")}${path.sep}`],
    ];
    await rewriteProfilePrefixColumns(sqliteIo, io.existsSync, dbPath, prefixMappings);
    // generations 双前缀置 NULL(M4:两目录实测 0 文件全死,计数分列入台账)
    ledger.generations = { ttsRuntimeAudio: 0, legacyTtsRuntimeAudio: 0 };
    if (io.existsSync(dbPath) && await sqliteIo.tableExists(dbPath, "generations")) {
      const rows = await sqliteIo.readTable(dbPath, "generations");
      const prefixes: Array<[string, "ttsRuntimeAudio" | "legacyTtsRuntimeAudio"]> = [
        [`${legacyTtsRuntimeDir}${path.sep}audio${path.sep}`, "ttsRuntimeAudio"],
        [`${path.join(legacyBase, "tts-runtime")}${path.sep}audio${path.sep}`, "legacyTtsRuntimeAudio"],
      ];
      const updates: Array<{ rowid: number; column: string; value: string | null }> = [];
      for (const row of rows) {
        const rowid = Number(row.__rowid__);
        for (const [column, value] of Object.entries(row)) {
          if (column === "__rowid__" || typeof value !== "string") continue;
          for (const [prefix, counter] of prefixes) {
            if (value.startsWith(prefix)) {
              ledger.generations[counter] += 1;
              updates.push({ rowid, column, value: null });
              break;
            }
          }
        }
      }
      if (updates.length) await sqliteIo.updateRows(dbPath, "generations", updates);
    }
  };

  /** P3′:搬 TTS(audio 逐件→config→tts.sqlite 最后=提交点)+B3 甄别。 */
  const migrateTtsSegment = async (baselineProfileIds: string[]): Promise<void> => {
    await phase("P3-move-tts", async () => {
      io.mkdirSync(newTtsRuntimeDir);
      io.mkdirSync(path.join(newTtsRuntimeDir, "audio"));
      // audio/ 逐件(三态:目标无→rename;同 size→跳;异 size→旧件留档)
      const legacyAudioDir = path.join(legacyTtsRuntimeDir, "audio");
      for (const file of walkFiles(legacyAudioDir, io)) {
        const target = path.join(newTtsRuntimeDir, "audio", path.relative(legacyAudioDir, file));
        if (!io.existsSync(target)) {
          io.mkdirSync(path.dirname(target));
          io.renameSync(file, target);
        } else if (io.statSync(file).size !== io.statSync(target).size) {
          roll(file, "TTS audio 目标冲突留档");
        }
      }
      // config.json(目标在→旧件留档;config.json.bak-* 善后处理)
      const legacyConfig = path.join(legacyTtsRuntimeDir, "config.json");
      if (io.existsSync(legacyConfig)) {
        const targetConfig = path.join(newTtsRuntimeDir, "config.json");
        if (!io.existsSync(targetConfig)) io.renameSync(legacyConfig, targetConfig);
        else roll(legacyConfig, "config.json 目标在场留档");
      }
      for (const bak of walkFiles(legacyTtsRuntimeDir, io)) {
        if (path.basename(bak).startsWith("config.json.bak")) roll(bak, "config 备份件留档");
      }
      // tts.sqlite 最后 rename=TTS 提交点;新根已有→B3 甄别
      if (io.existsSync(legacyTtsDbPath) && !io.existsSync(newTtsDbPath)) {
        io.renameSync(legacyTtsDbPath, newTtsDbPath);
      }
    });

    // B3 甄别:新根 tts.sqlite 在场但 ttsMigrated≠true——真库半态 vs 分叉空库
    if (io.existsSync(newTtsDbPath) && io.existsSync(legacyTtsDbPath)) {
      await phase("B3-discriminate", async () => {
        const newIds = new Set(await readProfilesBaseline(newTtsDbPath));
        const baselineCovered = baselineProfileIds.length > 0
          && baselineProfileIds.every((id) => newIds.has(id));
        if (!baselineCovered) {
          roll(newTtsDbPath, "分叉空库留档(用户失败会话增量可人工合并)");
          io.renameSync(legacyTtsDbPath, newTtsDbPath);
          ledger.anomalies.push("B3:新根库为分叉空库,旧家真库已补位");
        } else {
          ledger.anomalies.push("B3:新根库为真库半态,幂等续跑改写");
        }
      });
    }

    await phase("P4-rewrite-tts-db", () => rewriteTtsDb(newTtsDbPath));
  };

  const aftercare = async (): Promise<boolean> => {
    // P8 善后:返回是否有动作(残留处理)。绝不删未知文件/新生成 wav——一律 rolls 留档。
    let acted = false;
    await phase("P8-aftercare", async () => {
      // ①旧 assets 壳
      if (io.existsSync(legacyAssetsRoot)) {
        for (const zoneRoot of [path.join(legacyAssetsRoot, "files"), path.join(legacyAssetsRoot, "thumbs")]) {
          for (const file of walkFiles(zoneRoot, io)) {
            roll(file, "旧根 files/thumbs 残留留档(同 size 冗余/未知文件,绝不删)");
            acted = true;
          }
        }
        for (const entry of io.readdirSync(legacyAssetsRoot)) {
          const full = path.join(legacyAssetsRoot, entry);
          if (io.statSync(full).isDirectory()) continue;
          if (entry === "assets.db") {
            // 资产 db 再现:双库并存异常态不猜边,人工按台账甄别(不删不覆盖)
            roll(full, "旧根 assets.db 再现留档(双库并存,人工甄别)");
            ledger.anomalies.push("M16/双库并存:旧根再现 assets.db,已留档待人工甄别");
            acted = true;
          } else if (isKnownTopLevelResidue(entry)) {
            if (entry !== "MIGRATED-README.txt") {
              io.unlinkSync(full);
              acted = true;
            }
          } else {
            roll(full, "未知文件留档(不在已知残留白名单,绝不删)");
            acted = true;
          }
        }
      }
      // M16:旧根警示件(资产域归域完成后恒在场;探针判定覆盖全量完成与本就绪两种态)
      const readmePath = path.join(legacyAssetsRoot, "MIGRATED-README.txt");
      if (io.existsSync(newAssetDbPath) && !io.existsSync(readmePath)) {
        io.mkdirSync(legacyAssetsRoot);
        io.writeFileSync(readmePath, [
          `资产库已于 ${new Date(io.now()).toISOString()} 迁至 ${newAssetsRoot}`,
          "旧版 App 请勿在此重建库;人工排查指引见 backups/asset-migration-*/README",
          "",
        ].join("\n"));
        acted = true;
      }
      // ②旧家 TTS/runtime
      if (io.existsSync(legacyTtsRuntimeDir)) {
        const legacyAudioDir = path.join(legacyTtsRuntimeDir, "audio");
        const audioFiles = walkFiles(legacyAudioDir, io);
        if (audioFiles.length > 0) {
          // M14:任何 wav=失败会话新生成——整目录留档不删
          roll(legacyTtsRuntimeDir, "旧家 TTS/runtime 含新生成 audio,整目录留档");
          acted = true;
        } else if (io.existsSync(legacyTtsDbPath)) {
          roll(legacyTtsDbPath, "旧家 tts.sqlite 再现留档(不覆盖不清删)");
          acted = true;
        } else {
          const leftovers = walkFiles(legacyTtsRuntimeDir, io);
          if (leftovers.length > 0) {
            for (const file of leftovers) roll(file, "旧家 TTS 残件留档");
            acted = true;
          }
          // 空壳目录保留不删(M17 精神:目录可重建无害,保守不动)
        }
      }
      // ③App 家根层 0 字节 assets.db
      const rootLevelDb = path.join(legacyBase, "assets.db");
      if (io.existsSync(rootLevelDb) && io.statSync(rootLevelDb).size === 0) {
        io.unlinkSync(rootLevelDb);
        acted = true;
      }
      return acted;
    });
    return acted;
  };

  try {
    if (!assetMigrated) {
      // ===== 真未迁移态:全量迁移 P0→P8 =====
      const baseline: NonNullable<Ledger["baseline"]> = {};
      ledger.baseline = baseline;

      await phase("P0-precheck", async () => {
        if (!io.existsSync(projectRoot) || !io.statSync(projectRoot).isDirectory()) {
          throw new MigrationInterrupted(`项目位置不可用:${projectRoot}`);
        }
        // 同卷判定(异卷 rename 变跨盘语义,拒迁回落)
        const sourceStat = io.statSync(legacyAssetsRoot);
        const targetStat = io.statSync(projectRoot);
        if (sourceStat.dev !== targetStat.dev) {
          throw new MigrationInterrupted(`异卷拒迁(源 dev=${sourceStat.dev} 目标 dev=${targetStat.dev})`);
        }
        // 资产 db 基线计数
        const assetCounts: Record<string, number> = {};
        if (await sqliteIo.tableExists(legacyAssetDbPath, "assets")) {
          for (const row of await sqliteIo.readTable(legacyAssetDbPath, "assets")) {
            const type = String(row.type ?? "unknown");
            assetCounts[type] = (assetCounts[type] ?? 0) + 1;
          }
        }
        baseline.assets = assetCounts;
        // TTS 基线:profiles id 快照+generations 双前缀计数
        baseline.profiles = { ids: await readProfilesBaseline(legacyTtsDbPath) };
        // 文件并集基线(旧根+新根现有,含孤品)
        baseline.fileUnionCount = walkFiles(path.join(legacyAssetsRoot, "files"), io).length
          + walkFiles(path.join(legacyAssetsRoot, "thumbs"), io).length
          + walkFiles(path.join(newAssetsRoot, "files"), io).length
          + walkFiles(path.join(newAssetsRoot, "thumbs"), io).length;
        // 存量断链基线(M10)
        baseline.brokenRefs = [...collectStoreRefs().broken].sort();
        // 全量文件名冲突预扫描(旧根文件 vs 新根同名异 size)
        const conflicts: string[] = [];
        for (const source of ["files", "thumbs"]) {
          const legacySourceRoot = path.join(legacyAssetsRoot, source);
          const newSourceRoot = path.join(newAssetsRoot, source);
          for (const file of walkFiles(legacySourceRoot, io)) {
            const relative = path.relative(legacySourceRoot, file);
            const target = path.join(newSourceRoot, relative);
            if (io.existsSync(target) && io.statSync(file).size !== io.statSync(target).size) {
              conflicts.push(`${source}/${relative}`);
            }
          }
        }
        if (conflicts.length) {
          throw new MigrationInterrupted(`文件名冲突(异 size):${conflicts.join("; ")}`);
        }
      });

      await phase("P1-backup", async () => {
        const dir = ensureLedgerDir();
        io.copyFileSync(legacyAssetDbPath, path.join(dir, "assets.db.orig"));
        if (io.existsSync(legacyTtsDbPath)) io.copyFileSync(legacyTtsDbPath, path.join(dir, "tts.sqlite.orig"));
        io.writeFileSync(
          path.join(dir, "files-manifest.json"),
          `${JSON.stringify({
            legacyFiles: walkFiles(legacyAssetsRoot, io).map((file) => ({
              relative: path.relative(legacyAssetsRoot, file),
              size: io.statSync(file).size,
            })),
            existingNewRootFiles: walkFiles(newAssetsRoot, io).map((file) => path.relative(newAssetsRoot, file)),
          }, null, 2)}\n`,
        );
        io.writeFileSync(path.join(dir, "README.md"), [
          "# 资产归域迁移台账",
          "",
          "## 回滚(数据回旧根)",
          "1. 退出 App;2. 资产域逐文件反向 rename(新根 files/thumbs→旧根,目标在=跳过);",
          "3. rename 新根 assets.db→旧根;4. TTS 域反向(audio/config→旧家,tts.sqlite 最后);",
          "5. 删 <userData>/asset-home.json;6. 台账两 db 原件是最后兜底(永不删除)。",
          "",
          "- M8:marker 损坏/误删即自愈——删 marker,按新根 db 真相重写。",
          "- M12:marker 是失联开关,删除前须知会;双丢盲区有软警示。",
          "- M16:迁移后勿降级安装旧版;若已降级,资产在项目域完好,重新升级即恢复。",
          "- M-C:重装勿清 App 家支持目录;若已清,手工把 <userData>/project-locations.json 的条目指回项目根,marker 可删。",
          "",
        ].join("\n"));
      });

      const files = { moved: 0, skippedSameSize: 0, conflicts: [] as string[] };
      ledger.files = files;

      await phase("P2-move-files", async () => {
        for (const source of ["files", "thumbs"]) {
          const legacySourceRoot = path.join(legacyAssetsRoot, source);
          const newSourceRoot = path.join(newAssetsRoot, source);
          io.mkdirSync(newSourceRoot);
          for (const file of walkFiles(legacySourceRoot, io)) {
            const relative = path.relative(legacySourceRoot, file);
            const target = path.join(newSourceRoot, relative);
            if (!io.existsSync(target)) {
              io.mkdirSync(path.dirname(target));
              io.renameSync(file, target);
              files.moved += 1;
            } else if (io.statSync(file).size === io.statSync(target).size) {
              files.skippedSameSize += 1;
            } else {
              files.conflicts.push(`${source}/${relative}`);
            }
          }
        }
        if (files.conflicts.length) {
          throw new MigrationInterrupted(`搬移冲突(异 size):${files.conflicts.join("; ")}`);
        }
      });

      await phase("P5-verify-files", async () => {
        // 并集计数:旧根剩余+新根现有=P0 基线(含孤品)
        const currentUnion = walkFiles(path.join(legacyAssetsRoot, "files"), io).length
          + walkFiles(path.join(legacyAssetsRoot, "thumbs"), io).length
          + walkFiles(path.join(newAssetsRoot, "files"), io).length
          + walkFiles(path.join(newAssetsRoot, "thumbs"), io).length;
        if (currentUnion !== baseline.fileUnionCount) {
          throw new MigrationInterrupted(
            `文件并集核账失败(基线 ${baseline.fileUnionCount} / 现有 ${currentUnion})——迁移期间文件集漂移`,
          );
        }
        // DB 抽样(≤20 行):filePath 指向的文件须在新根或在基线断链集合内
        const brokenBaseline = new Set(baseline.brokenRefs ?? []);
        if (await sqliteIo.tableExists(legacyAssetDbPath, "assets")) {
          const rows = (await sqliteIo.readTable(legacyAssetDbPath, "assets"))
            .filter((row) => typeof row.filePath === "string" && row.filePath)
            .slice(0, 20);
          for (const row of rows) {
            const relative = String(row.filePath);
            if (io.existsSync(path.join(newAssetsRoot, "files", relative)) || brokenBaseline.has(relative)) continue;
            throw new MigrationInterrupted(`DB 抽样核账失败:filePath=${relative} 既不在新根也不在断链基线`);
          }
        }
        // store 引用全量重跑:断链集合 ⊆ P0 基线(M10『不新增断链』)
        const brokenNow = collectStoreRefs().broken;
        for (const broken of brokenNow) {
          if (!brokenBaseline.has(broken)) {
            throw new MigrationInterrupted(`迁移引入新断链:${broken}(基线外)`);
          }
        }
      });

      await phase("P6-commit-asset-db", async () => {
        io.mkdirSync(newAssetsRoot);
        io.renameSync(legacyAssetDbPath, newAssetDbPath);
      });
      // P6 提交点已过:此后任何中断都不得描述为「回落旧根」(资产库已在新根)。
      assetCommitted = true;

      const baselineProfileIds = baseline.profiles?.ids ?? [];
      await migrateTtsSegment(baselineProfileIds);

      await phase("P7-write-marker", async () => {
        writeAssetHomeMarker(options.userDataPath, {
          version: 2,
          projectId,
          lastKnownLocation: projectRoot,
          ttsMigrated: true,
          assetsStoreMigrated: true,
          ledgerDir: ensureLedgerDir(),
        }, markerIo);
      });

      await aftercare();
      ledger.finishedAt = io.now();
      writeLedger();
      return { status: "migrated", ledgerDir };
    }
  } catch (error) {
    ledger.interrupted = true;
    ledger.error = String(error);
    ledger.finishedAt = io.now();
    writeLedger();
    // 分级日志(补刀):P6 前中断=真回落旧根;P6 后中断=资产已提交新根,绝不回落,
    // 下次启动自动续迁 TTS/善后——此前恒报「回落旧根」对 P6 后是撒谎,误导人工排查。
    log(assetCommitted
      ? `迁移中断(资产域已提交新根不回落,TTS/善后未完,下次启动续迁):${String(error)}`
      : `迁移中断(资产未提交,回落旧根):${String(error)}`);
    return { status: "interrupted", ledgerDir, reason: String(error), assetCommitted };
  }

  // ===== 资产域已迁:续迁 files 半迁态 + TTS 段判定 + 善后 =====
  try {
    // B1 断电窗口:db 已提交+files 半迁→幂等续迁(per-file 三态;冲突留档不中断)
    const resumed = { moved: 0, skippedSameSize: 0 };
    await phase("resume-files", async () => {
      for (const source of ["files", "thumbs"]) {
        const legacySourceRoot = path.join(legacyAssetsRoot, source);
        const newSourceRoot = path.join(newAssetsRoot, source);
        if (!io.existsSync(legacySourceRoot)) continue;
        for (const file of walkFiles(legacySourceRoot, io)) {
          const relative = path.relative(legacySourceRoot, file);
          const target = path.join(newSourceRoot, relative);
          if (!io.existsSync(target)) {
            io.mkdirSync(path.dirname(target));
            io.renameSync(file, target);
            resumed.moved += 1;
          } else if (io.statSync(file).size === io.statSync(target).size) {
            resumed.skippedSameSize += 1;
          } else {
            roll(file, "续迁冲突留档(异 size,不覆盖新根)");
          }
        }
      }
      if (resumed.moved + resumed.skippedSameSize > 0) {
        ledger.files = { moved: resumed.moved, skippedSameSize: resumed.skippedSameSize, conflicts: [] };
      }
    });

    const marker = readAssetHomeMarker(options.userDataPath, markerIo);
    const ttsMigrated = marker?.ttsMigrated === true;

    if (!ttsMigrated && io.existsSync(newTtsDbPath) && io.existsSync(legacyTtsDbPath)) {
      // ④B3 甄别态(两侧都在)
      const baselineIds = await readProfilesBaseline(legacyTtsDbPath);
      await migrateTtsSegment(baselineIds);
      await phase("P7-write-marker", async () => {
        writeAssetHomeMarker(options.userDataPath, {
          version: 2,
          projectId,
          lastKnownLocation: projectRoot,
          ttsMigrated: true,
          assetsStoreMigrated: true,
          ledgerDir: marker?.ledgerDir ?? ensureLedgerDir(),
        }, markerIo);
      });
      await aftercare();
      ledger.finishedAt = io.now();
      writeLedger();
      return { status: "migrated", ledgerDir };
    }

    if (!ttsMigrated && !io.existsSync(newTtsDbPath)) {
      // ③资产迁+TTS 未迁→只跑 TTS 段
      const baselineIds = await readProfilesBaseline(legacyTtsDbPath);
      await migrateTtsSegment(baselineIds);
      await phase("P7-write-marker", async () => {
        writeAssetHomeMarker(options.userDataPath, {
          version: 2,
          projectId,
          lastKnownLocation: projectRoot,
          ttsMigrated: true,
          assetsStoreMigrated: true,
          ledgerDir: marker?.ledgerDir ?? ensureLedgerDir(),
        }, markerIo);
      });
      await aftercare();
      ledger.finishedAt = io.now();
      writeLedger();
      return { status: "migrated", ledgerDir };
    }

    if (!ttsMigrated && io.existsSync(newTtsDbPath)) {
      // 新根 tts.sqlite 在场+旧家不在(B2 断电半态)→幂等改写+marker
      await phase("P4-rewrite-tts-db", () => rewriteTtsDb(newTtsDbPath));
      await phase("P7-write-marker", async () => {
        writeAssetHomeMarker(options.userDataPath, {
          version: 2,
          projectId,
          lastKnownLocation: projectRoot,
          ttsMigrated: true,
          assetsStoreMigrated: true,
          ledgerDir: marker?.ledgerDir ?? ensureLedgerDir(),
        }, markerIo);
      });
      await aftercare();
      ledger.finishedAt = io.now();
      writeLedger();
      return { status: "migrated", ledgerDir };
    }

    // ttsMigrated=true:②只补善后(有残留才动)
    const acted = await aftercare();
    if (acted || ledger.rolls.length > 0) {
      ledger.finishedAt = io.now();
      writeLedger();
      return { status: "noop", ledgerDir };
    }
    return { status: "noop", ledgerDir: null, reason: "资产+TTS 均已迁移,旧域无残留" };
  } catch (error) {
    ledger.interrupted = true;
    ledger.error = String(error);
    ledger.finishedAt = io.now();
    writeLedger();
    log(`续迁/善后中断(资产域已在新根,下次启动重试):${String(error)}`);
    return { status: "interrupted", ledgerDir, reason: String(error), assetCommitted };
  }
}
