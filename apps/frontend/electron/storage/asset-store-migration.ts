import fs from "node:fs";
import path from "node:path";
import { readAssetHomeMarker, writeAssetHomeMarker, ttsDbProbe, type AssetHomeIo } from "./asset-home";
import {
  defaultSqliteIo,
  rewriteProfilePrefixColumns,
  walkFiles,
  STORE_REF_PATTERN,
  type MigrationIo,
  type MigrationSqliteIo,
} from "./asset-home-migration";

/**
 * 资产二段归位启动期一次性幂等迁移例程(1016:项目根 assets/ → store/assets/)。
 *
 * 独立文件于一段(asset-home-migration)之外:一段=App 家→项目根(1015),
 * 二段=项目根/assets→项目根/store/assets(1016);复用一段 MigrationIo/
 * MigrationSqliteIo 类型与 profiles 前缀改写公用函数。
 *
 * 纪律锚:
 * - 判定全文件即真相(marker 只是缓存):storeAssetsDb=root/store/assets/assets.db、
 *   rootAssetsDb=root/assets/assets.db 五分支(见 runAssetStoreMigration);
 * - fail-closed(限例程内:预检不过=零提交):任一阶段 throw→台账落 error→
 *   interrupted 返回;不吞、不在例程内 fallback;下次启动幂等续跑;
 * - P2 提交点=单次 renameSync(root/assets→store/assets) 同卷整树原子:
 *   crash 前=零触碰可重试,crash 后=树已迁,续跑只补 P3/P5/P7(不回滚——
 *   回滚制造二次半态);
 * - 台账/备份恒 <projectRoot>/backups/asset-store-migration-<ts>/(根目录铁令,
 *   严禁塞 store/);15230 文件不备实体(同一段同策),db 原件 copy+manifest 记全量;
 * - 二段异常不拦启动(『失败不拦启动』使启动序列 throw 不被根健康闸感知——
 *   根健康闸只拦 resolveAssetHomeRoot 异常态),一律台账留痕+console.warn+下轮续跑;
 * - TTS 留守 <root>/TTS 不迁;二段唯一 DB 改写面=tts.sqlite profiles 绝对前缀平移。
 */

const defaultStoreIo: MigrationIo = {
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

export interface RunAssetStoreMigrationOptions {
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

export type AssetStoreMigrationRunResult = {
  status: "migrated" | "noop" | "interrupted" | "error";
  ledgerDir: string | null;
  reason?: string;
  /** 失败分级语义:P2 提交点(整树 rename)是否已过。true=资产库已在 store/assets,
   * 绝不回滚(下次启动只续 TTS 改写/marker);false=未提交,root/assets 原样零损失。 */
  storeCommitted?: boolean;
};

type StoreLedger = {
  version: number;
  startedAt: number;
  finishedAt?: number;
  interrupted?: boolean;
  error?: string;
  projectId?: string;
  projectRoot?: string;
  phases: Array<{ name: string; ms: number; status: "ok" | "failed" }>;
  baseline?: {
    fileCount?: number;
    dbRows?: number;
    ttsOldPrefixRows?: number;
    brokenRefs?: string[];
  };
  anomalies: string[];
};

class StoreMigrationInterrupted extends Error {}

export async function runAssetStoreMigration(options: RunAssetStoreMigrationOptions): Promise<AssetStoreMigrationRunResult> {
  const io: MigrationIo = { ...defaultStoreIo, ...options.io };
  const sqliteIo = options.sqliteIo ?? defaultSqliteIo;
  const log = options.log ?? ((message: string) => { console.warn(`[asset-store-migration] ${message}`); });

  const legacyBase = options.getStorageBasePath();
  const locations = options.locationStore.all() ?? {};
  const projectIds = Object.keys(locations);
  if (projectIds.length > 1) {
    log(`异常态:多个项目位置(${projectIds.join(",")})——二段状态机中止不猜边`);
    return { status: "error", ledgerDir: null, reason: "多项目位置并存,需人工按台账核对" };
  }
  const projectId = projectIds[0];
  const projectRoot = projectId ? locations[projectId] : undefined;
  if (!projectRoot) {
    return { status: "noop", ledgerDir: null, reason: "无外部项目位置,二段无事项" };
  }

  const rootAssetsRoot = path.join(projectRoot, "assets");
  const storeAssetsRoot = path.join(projectRoot, "store", "assets");
  const rootAssetsDb = path.join(rootAssetsRoot, "assets.db");
  const storeAssetsDb = path.join(storeAssetsRoot, "assets.db");
  const ttsDbPath = ttsDbProbe(projectRoot);

  const markerIo: AssetHomeIo = {
    fileExists: io.existsSync,
    readTextFile: (filePath) => (io.existsSync(filePath) ? io.readFileSync(filePath) : null),
    writeTextFile: (filePath, text) => {
      io.mkdirSync(path.dirname(filePath));
      io.writeFileSync(filePath, text);
    },
  };

  const ledger: StoreLedger = {
    version: 1,
    startedAt: io.now(),
    phases: [],
    anomalies: [],
    projectId,
    projectRoot,
  };
  let ledgerDir: string | null = null;
  const ensureLedgerDir = (): string => {
    if (!ledgerDir) {
      ledgerDir = path.join(projectRoot, "backups", `asset-store-migration-${new Date(io.now()).toISOString().replace(/[:.]/g, "-")}`);
      io.mkdirSync(ledgerDir);
    }
    return ledgerDir;
  };
  const writeLedger = () => {
    const dir = ensureLedgerDir();
    io.writeFileSync(path.join(dir, "migration-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
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

  const ttsPrefixMappings = (): Array<[string, string]> => ([
    [`${rootAssetsRoot}${path.sep}files${path.sep}`, `${storeAssetsRoot}${path.sep}files${path.sep}`],
  ]);

  const countProfileRowsWithPrefix = async (dbPath: string, prefix: string): Promise<number> => {
    if (!io.existsSync(dbPath)) return 0;
    if (!(await sqliteIo.tableExists(dbPath, "profiles"))) return 0;
    const rows = await sqliteIo.readTable(dbPath, "profiles");
    let count = 0;
    for (const row of rows) {
      const hit = Object.entries(row).some(
        ([column, value]) => column !== "__rowid__" && typeof value === "string" && value.startsWith(prefix),
      );
      if (hit) count += 1;
    }
    return count;
  };

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
        const inSource = io.existsSync(path.join(rootAssetsRoot, "files", relative));
        const inTarget = io.existsSync(path.join(storeAssetsRoot, "files", relative));
        if (!inSource && !inTarget) broken.add(relative);
      }
    }
    return { refs, broken };
  };

  /** heal/续迁补齐:P3 幂等重放+TTS 旧前缀归零复核+marker v2 保全既有字段。 */
  const healToV2 = async (): Promise<void> => {
    await phase("heal-tts-rewrite", () => rewriteProfilePrefixColumns(sqliteIo, io.existsSync, ttsDbPath, ttsPrefixMappings()));
    await phase("heal-verify", async () => {
      const oldNow = await countProfileRowsWithPrefix(ttsDbPath, `${rootAssetsRoot}${path.sep}files${path.sep}`);
      if (oldNow !== 0) {
        throw new StoreMigrationInterrupted(`续迁复核失败:TTS profiles 旧前缀残留 ${oldNow} 行(P3 改写未见效)`);
      }
    });
    await phase("P7-write-marker", async () => {
      const existing = readAssetHomeMarker(options.userDataPath, markerIo);
      writeAssetHomeMarker(options.userDataPath, {
        version: 2,
        projectId: existing?.projectId ?? projectId,
        lastKnownLocation: existing?.lastKnownLocation ?? projectRoot,
        ttsMigrated: existing?.ttsMigrated === true,
        assetsStoreMigrated: true,
        ledgerDir: existing?.ledgerDir,
      }, markerIo);
    });
  };

  const storePresent = io.existsSync(storeAssetsDb);
  const rootPresent = io.existsSync(rootAssetsDb);

  // ===== 五分支判定(文件即真相;marker 只是缓存)=====

  // a) 已迁态:store db 在+root/assets 缺。
  if (storePresent && !rootPresent) {
    const marker = readAssetHomeMarker(options.userDataPath, markerIo);
    if (marker?.assetsStoreMigrated === true) {
      return { status: "noop", ledgerDir: null, reason: "资产库已在 store/assets,marker v2 在场" };
    }
    // P2 后中断(marker 未写/TTS 未改完)→ 续跑补 P3/P5(可复核部分)/P7。
    try {
      await healToV2();
      ledger.finishedAt = io.now();
      writeLedger();
      return { status: "migrated", ledgerDir, reason: "续迁补齐(heal)" };
    } catch (error) {
      ledger.interrupted = true;
      ledger.error = String(error);
      ledger.finishedAt = io.now();
      writeLedger();
      log(`二段续迁中断(store 已提交不回滚,下次启动重试):${String(error)}`);
      return { status: "interrupted", ledgerDir, reason: String(error), storeCommitted: true };
    }
  }

  // b) 双库并存→不 throw 不拦:按已迁态处理,anomalies 留痕+root/assets 整树
  // 原地保留不动(人工按台账甄别);serving 面由 resolveAssetHomeRoot 探针天然
  // 选边 store/assets(与一段 P8 对旧根 assets.db 再现=roll 留档+anomalies 选边
  // 不拦的现行哲学对齐,但二段对 root/assets 整树更保守——不 roll)。
  if (storePresent && rootPresent) {
    ledger.anomalies.push(`双库并存:${rootAssetsRoot} 疑似旧库残留,人工按台账甄别;serving 面已选边 ${storeAssetsRoot}`);
    log(`双库并存:${rootAssetsRoot} 疑似旧库残留(原地保留不动),serving 已选边 ${storeAssetsRoot},请人工甄别`);
    const marker = readAssetHomeMarker(options.userDataPath, markerIo);
    if (marker?.assetsStoreMigrated === true) {
      return { status: "noop", ledgerDir: null, reason: "双库并存(旧库残留),已按 store/assets 服务;请人工甄别 root/assets" };
    }
    try {
      await healToV2();
      ledger.finishedAt = io.now();
      writeLedger();
      return { status: "noop", ledgerDir, reason: "双库并存:按 store/assets 服务并补写 marker,旧库原地保留待人工甄别" };
    } catch (error) {
      ledger.interrupted = true;
      ledger.error = String(error);
      ledger.finishedAt = io.now();
      writeLedger();
      log(`二段双库并存 heal 中断:${String(error)}`);
      return { status: "interrupted", ledgerDir, reason: String(error), storeCommitted: true };
    }
  }

  // e) 双缺:一段域负责(未跑过 1015 的机器由一段直接落 store/assets)。
  if (!storePresent && !rootPresent) {
    return { status: "noop", ledgerDir: null, reason: "项目根无资产库(一段域负责)" };
  }

  // c/d) store 缺+root assets 在场:c=marker v1 在场(1015 完成态,真机即此);
  // d=marker 缺(一段 P6 后 P7 前断电遗留)→照常搬迁+一次写 v2 marker 补齐。
  let storeCommitted = false;
  try {
    const baseline: NonNullable<StoreLedger["baseline"]> = {};
    ledger.baseline = baseline;

    await phase("P0-precheck", async () => {
      if (!io.existsSync(projectRoot) || !io.statSync(projectRoot).isDirectory()) {
        throw new StoreMigrationInterrupted(`项目位置不可用:${projectRoot}`);
      }
      // 同卷判定(异卷 rename 变跨盘语义,拒迁;store 在 projectRoot 内恒同卷,
      // 防御 root 为 symlink 怪态——锚取在场则 store,否则 projectRoot)。
      const sourceStat = io.statSync(rootAssetsRoot);
      const anchorPath = io.existsSync(path.join(projectRoot, "store")) ? path.join(projectRoot, "store") : projectRoot;
      const anchorStat = io.statSync(anchorPath);
      if (sourceStat.dev !== anchorStat.dev) {
        throw new StoreMigrationInterrupted(`异卷拒迁(源 dev=${sourceStat.dev} 锚 dev=${anchorStat.dev})`);
      }
      // 目标位防 TOCTOU 再验:store/assets 不得非空在场(空壳目录可清)。
      if (io.existsSync(storeAssetsRoot)) {
        const leftovers = walkFiles(storeAssetsRoot, io);
        if (leftovers.length > 0) {
          throw new StoreMigrationInterrupted(`目标位 store/assets 非空(${leftovers.length} 文件),疑似异常态,人工甄别`);
        }
        io.rmSync(storeAssetsRoot, { recursive: true, force: true });
      }
      // 基线:文件计数+db 行数+TTS 旧前缀行数+store 引用断链快照(M10)。
      baseline.fileCount = walkFiles(rootAssetsRoot, io).length;
      baseline.dbRows = (await sqliteIo.tableExists(rootAssetsDb, "assets"))
        ? (await sqliteIo.readTable(rootAssetsDb, "assets")).length
        : 0;
      baseline.ttsOldPrefixRows = await countProfileRowsWithPrefix(ttsDbPath, `${rootAssetsRoot}${path.sep}files${path.sep}`);
      baseline.brokenRefs = [...collectStoreRefs().broken].sort();
    });

    await phase("P1-backup", async () => {
      const dir = ensureLedgerDir();
      io.copyFileSync(rootAssetsDb, path.join(dir, "assets.db.orig"));
      io.writeFileSync(
        path.join(dir, "files-manifest.json"),
        `${JSON.stringify({
          files: walkFiles(rootAssetsRoot, io).map((file) => ({
            relative: path.relative(rootAssetsRoot, file),
            size: io.statSync(file).size,
          })),
        }, null, 2)}\n`,
      );
      io.writeFileSync(path.join(dir, "README.md"), [
        "# 资产二段归位迁移台账(1016:项目根 assets/ → store/assets/)",
        "",
        "## 人工数据回滚(强制顺序,一次做完,全程 App 退出)",
        "前置条件:代码已回退到探 root/assets 形态(开发机=git revert 1016 二段提交;",
        "装机用户=整包降级回 1016 版,降级包须在数据回滚【前】装好但 App 不启动)。",
        "1. 退出 App;2. 代码回退(装完不启动);",
        `3. rename ${storeAssetsRoot} → ${rootAssetsRoot};`,
        "4. sqlite3 <root>/TTS/runtime/tts.sqlite 执行反向 UPDATE(仅旧代码形态下):",
        `   UPDATE profiles SET reference_audio_path = replace(reference_audio_path,`,
        `     '${storeAssetsRoot}/files/', '${rootAssetsRoot}/files/')`,
        `   WHERE reference_audio_path LIKE '${storeAssetsRoot}/files/%';`,
        "5. 删 <userData>/asset-home.json——仅旧代码(探 root/assets 形态)下自愈;",
        "   新代码下删 marker=全表探测零命中→ORPHANED,严禁。",
        "6. 本台账 assets.db.orig 为 db 级最后兜底(永不删除)。",
        "",
        "- P2 提交(整树 rename)后的中断不回滚:续跑补 TTS 改写/marker,自愈闭环。",
        "- 双库并存(root/assets 残留)时 serving 已选边 store/assets;root/assets 请人工甄别。",
        "",
      ].join("\n"));
    });

    await phase("P2-commit-rename", async () => {
      // 二段唯一提交点:同卷单次 renameSync 整树原子(15230 文件一次搬,
      // 非逐文件——目标恒空可整体搬)。crash 前=零触碰可重试;crash 后=树已迁。
      io.mkdirSync(path.join(projectRoot, "store"));
      io.renameSync(rootAssetsRoot, storeAssetsRoot);
    });
    storeCommitted = true;

    await phase("P3-rewrite-tts-db", () => rewriteProfilePrefixColumns(sqliteIo, io.existsSync, ttsDbPath, ttsPrefixMappings()));

    await phase("P5-verify", async () => {
      const fileCount = walkFiles(storeAssetsRoot, io).length;
      if (fileCount !== baseline.fileCount) {
        throw new StoreMigrationInterrupted(`文件计数核账失败(基线 ${baseline.fileCount} / 现有 ${fileCount})`);
      }
      const dbRowsNow = (await sqliteIo.tableExists(storeAssetsDb, "assets"))
        ? (await sqliteIo.readTable(storeAssetsDb, "assets")).length
        : 0;
      if (dbRowsNow !== baseline.dbRows) {
        throw new StoreMigrationInterrupted(`db 行数核账失败(基线 ${baseline.dbRows} / 现有 ${dbRowsNow})`);
      }
      // 抽样(≤20 行):filePath 须在 store/assets/files 可解析或在断链基线内
      const brokenBaseline = new Set(baseline.brokenRefs ?? []);
      if (await sqliteIo.tableExists(storeAssetsDb, "assets")) {
        const rows = (await sqliteIo.readTable(storeAssetsDb, "assets"))
          .filter((row) => typeof row.filePath === "string" && row.filePath)
          .slice(0, 20);
        for (const row of rows) {
          const relative = String(row.filePath);
          if (io.existsSync(path.join(storeAssetsRoot, "files", relative)) || brokenBaseline.has(relative)) continue;
          throw new StoreMigrationInterrupted(`DB 抽样核账失败:filePath=${relative} 既不在 store/assets 也不在断链基线`);
        }
      }
      // store 引用断链 ⊆ 基线(M10 不新增断链)
      const brokenNow = collectStoreRefs().broken;
      for (const broken of brokenNow) {
        if (!brokenBaseline.has(broken)) {
          throw new StoreMigrationInterrupted(`迁移引入新断链:${broken}(基线外)`);
        }
      }
      // TTS 旧前缀=0 且新前缀==基线
      const oldNow = await countProfileRowsWithPrefix(ttsDbPath, `${rootAssetsRoot}${path.sep}files${path.sep}`);
      if (oldNow !== 0) {
        throw new StoreMigrationInterrupted(`TTS 旧前缀残留 ${oldNow} 行`);
      }
      const newNow = await countProfileRowsWithPrefix(ttsDbPath, `${storeAssetsRoot}${path.sep}files${path.sep}`);
      if (newNow !== baseline.ttsOldPrefixRows) {
        throw new StoreMigrationInterrupted(`TTS 新前缀计数失守(基线 ${baseline.ttsOldPrefixRows} / 现有 ${newNow})`);
      }
    });

    await phase("P7-write-marker", async () => {
      const existing = readAssetHomeMarker(options.userDataPath, markerIo);
      writeAssetHomeMarker(options.userDataPath, {
        version: 2,
        projectId: existing?.projectId ?? projectId,
        lastKnownLocation: existing?.lastKnownLocation ?? projectRoot,
        ttsMigrated: existing?.ttsMigrated === true,
        assetsStoreMigrated: true,
        ledgerDir: ensureLedgerDir(),
      }, markerIo);
    });

    await phase("P8-aftercare", async () => {
      // 旧家 App 家 MIGRATED-README.txt 追加一行新根指引(在场才写,append 不重写历史)。
      const legacyReadme = path.join(legacyBase, "assets", "MIGRATED-README.txt");
      if (io.existsSync(legacyReadme)) {
        const current = io.readFileSync(legacyReadme);
        if (!current.includes(storeAssetsRoot)) {
          io.writeFileSync(legacyReadme, `${current}${current.endsWith("\n") ? "" : "\n"}资产库已于 ${new Date(io.now()).toISOString()} 进一步归位 ${storeAssetsRoot}(1016 store/ 形态)\n`);
        }
      }
    });

    ledger.finishedAt = io.now();
    writeLedger();
    return { status: "migrated", ledgerDir };
  } catch (error) {
    ledger.interrupted = true;
    ledger.error = String(error);
    ledger.finishedAt = io.now();
    writeLedger();
    log(storeCommitted
      ? `二段中断(store 已提交不回滚,续跑补 TTS 改写/marker):${String(error)}`
      : `二段中断(未提交,root/assets 原样零损失):${String(error)}`);
    return { status: "interrupted", ledgerDir, reason: String(error), storeCommitted };
  }
}
