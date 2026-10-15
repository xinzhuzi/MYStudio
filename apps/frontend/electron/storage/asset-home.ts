import fs from "node:fs";
import path from "node:path";

/**
 * 资产/TTS 家解析状态机(1015 资产归域:App 家资产库迁项目域;1016 二段:项目根
 * assets/ 归位 store/assets/)。
 *
 * 权威排序:新根 store/assets/assets.db(真相)> 位置表(真源)> marker(缓存)。
 * - 1016 起资产根=join(项目根,'store','assets'):探针/返回值均 store 形;marker
 *   v2 增 assetsStoreMigrated 布尔(二段完成态;v1 缺字段=undefined≠true,二段例程
 *   据此识别需迁移)。补写 marker 恒升 v2 不降版。
 * - marker 恒住 <userData>/asset-home.json(B-1:与位置表
 *   <userData>/project-locations.json 同住 userData,永不随数据迁移——放新根
 *   则位置表条目丢/损坏时读不到 marker→误判 fallback→旧根已被善后清空→空库
 *   重建原样发生,防线静默失效)。
 * - marker 损坏按无处理(M8):全表探测自愈+补写,不抛异常态。
 * - marker 在而位置表条目丢/新根 db 缺 → ASSET_HOME_ORPHANED 显式异常态
 *   (M1:绝不静默 fallback——否则 initAssetsStorage 空库重建+getManagedSourceRoots
 *   受管根丢失双杀)。
 * - TTS 域同源四态(B-2 统一层级:resolveTtsHomeRoot 返回基路径级——新态=
 *   项目根 location;旧态=旧统一存储基路径级;消费式 ttsRootDir=join(返回值,
 *   'TTS') 恰好一层,本函数不得自带 TTS 段)。
 */

export const ASSET_HOME_ORPHANED = "ASSET_HOME_ORPHANED";
export const ASSET_HOME_LOCATION_TABLE_CORRUPT = "ASSET_HOME_LOCATION_TABLE_CORRUPT";
export const ASSET_HOME_MULTIPLE_CANDIDATES = "ASSET_HOME_MULTIPLE_CANDIDATES";

export class AssetHomeError extends Error {
  readonly code: string;
  readonly lastKnownLocation?: string;

  constructor(code: string, message: string, lastKnownLocation?: string) {
    super(message);
    this.name = "AssetHomeError";
    this.code = code;
    this.lastKnownLocation = lastKnownLocation;
  }
}

export interface AssetHomeMarker {
  version: number;
  projectId?: string;
  lastKnownLocation: string;
  ttsMigrated?: boolean;
  /** 1016 二段:项目根 assets/ 已归位 store/assets/。v1 marker 缺此字段=undefined≠true。 */
  assetsStoreMigrated?: boolean;
  ledgerDir?: string;
}

export interface AssetHomeIo {
  fileExists: (filePath: string) => boolean;
  readTextFile: (filePath: string) => string | null;
  writeTextFile: (filePath: string, text: string) => void;
}

const defaultIo: AssetHomeIo = {
  fileExists: (filePath) => fs.existsSync(filePath),
  readTextFile: (filePath) => (fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null),
  writeTextFile: (filePath, text) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text, "utf-8");
  },
};

/** marker 路径恒 <userData>/asset-home.json(B-1:永不随数据迁移)。 */
export function assetHomeMarkerPath(userDataPath: string): string {
  return path.join(userDataPath, "asset-home.json");
}

function locationTablePath(userDataPath: string): string {
  return path.join(userDataPath, "project-locations.json");
}

/** 读 marker;损坏/缺失按 null 处理(M8:损坏=无,全表探测自愈)。 */
export function readAssetHomeMarker(userDataPath: string, io: AssetHomeIo = defaultIo): AssetHomeMarker | null {
  const raw = io.readTextFile(assetHomeMarkerPath(userDataPath));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AssetHomeMarker>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.lastKnownLocation !== "string" || !parsed.lastKnownLocation) {
      return null;
    }
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : undefined,
      lastKnownLocation: parsed.lastKnownLocation,
      ttsMigrated: parsed.ttsMigrated === true,
      assetsStoreMigrated: parsed.assetsStoreMigrated === true,
      ledgerDir: typeof parsed.ledgerDir === "string" ? parsed.ledgerDir : undefined,
    };
  } catch {
    return null;
  }
}

/** 写 marker(路径恒 <userData>/asset-home.json,B-1)。 */
export function writeAssetHomeMarker(userDataPath: string, marker: AssetHomeMarker, io: AssetHomeIo = defaultIo): void {
  io.writeTextFile(assetHomeMarkerPath(userDataPath), `${JSON.stringify(marker, null, 2)}\n`);
}

/** 位置表原文损坏判定:文件在场但解析不出 locations 对象 → 视为损坏。 */
function parseLocationTableEntries(raw: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(raw) as { locations?: unknown };
    const locations = parsed?.locations;
    if (!locations || typeof locations !== "object" || Array.isArray(locations)) return null;
    const result: Record<string, string> = {};
    for (const [pid, value] of Object.entries(locations as Record<string, unknown>)) {
      if (typeof value === "string" && value) result[pid] = value;
    }
    return result;
  } catch {
    return null;
  }
}

interface HomeContext {
  io: AssetHomeIo;
  marker: AssetHomeMarker | null;
  /** 候选项目根(去重):位置表全部条目 + marker.lastKnownLocation。 */
  candidates: string[];
}

function buildHomeContext(options: {
  userDataPath: string;
  allLocations: () => Record<string, string>;
  io?: AssetHomeIo;
}): HomeContext {
  const io = options.io ?? defaultIo;
  const marker = readAssetHomeMarker(options.userDataPath, io);

  // 位置表损坏 → 异常态(④:位置表是真源,损坏即停,不猜边)。
  const tableRaw = io.readTextFile(locationTablePath(options.userDataPath));
  if (tableRaw !== null && parseLocationTableEntries(tableRaw) === null) {
    throw new AssetHomeError(
      ASSET_HOME_LOCATION_TABLE_CORRUPT,
      "ASSET_HOME_LOCATION_TABLE_CORRUPT:项目位置表(project-locations.json)损坏,资产库位置无法判定,请人工排查",
    );
  }

  const entries = options.allLocations() ?? {};
  const candidates = new Set<string>(Object.values(entries).filter((value) => typeof value === "string" && value));
  if (marker?.lastKnownLocation) candidates.add(marker.lastKnownLocation);
  return { io, marker, candidates: [...candidates] };
}

function assetDbProbe(projectRoot: string): string {
  // 1016 二段:资产库真位=项目根 store/assets/assets.db(旧 flat 形由二段例程
  // 启动期整树归位,解析面只认新形——旧形在场=迁移未完成的中间态)。
  return path.join(projectRoot, "store", "assets", "assets.db");
}

/** 新根 TTS 探针(B-2:基路径级+'TTS'+'runtime'+'tts.sqlite',与旧家派生式同构)。 */
export function ttsDbProbe(basePath: string): string {
  return path.join(basePath, "TTS", "runtime", "tts.sqlite");
}

export interface ResolveAssetHomeOptions {
  userDataPath: string;
  /** 位置表单项目查询(注入 projectLocationStore.get)。 */
  locationStore: (projectId: string) => string | undefined;
  /** 位置表全量(注入 projectLocationStore.all);真源。 */
  allLocations: () => Record<string, string>;
  /** M-A 求值式 fallback:=join(getStorageBasePath(),'store','assets')(1016 改形,与 storage-manager/main-paths 注入保持逐字节等价)。 */
  fallback: () => string;
  /**
   * 1016 补刀·未绑项目回退:旧统一存储 flat 形资产根求值式(=join(base,'assets'),
   * db 在场才非 null;注入方约定 flat 优先)。仅在 marker 缺+fallback 态消费——
   * 未绑项目即用过资产库的 ≤1015 机器,资产住 flat 形;1016 fallback 改形后若无
   * 此回退,该库静默失联(1015 行为回归)。绑定项目后由一段 legacy 双源探测
   * (flat 优先)拾起归位 store/assets,闭环自愈。marker 在场时不参与(ORPHANED
   * 恒 fail-closed,不给静默回退开后门)。
   */
  legacyFlatAssetsRoot?: () => string | null;
  io?: AssetHomeIo;
}

/**
 * 资产家解析:返回资产根(=项目根+'/store/assets',1016 二段归位后形态)。
 * 状态机:①真未迁移态→fallback;①b 未绑项目+旧统一存储 flat 形库在场→回退
 * flat 根(1016 补刀:1015 行为等价,防旧库静默失联;marker 在场恒不走此路);
 * ②新根 store/assets db 在场→新根(+补 marker v2);
 * ③marker 在而位置表条目丢/新根 db 缺→ORPHANED;④位置表损坏→异常态;
 * ⑤fallback 态+旧根 db 缺失→软警示(M12)。
 */
export function resolveAssetHomeRoot(options: ResolveAssetHomeOptions): string {
  const { userDataPath, fallback } = options;
  const { io: homeIo, marker, candidates } = buildHomeContext(options);

  // ②新根 db 在场(全表探测,含 marker.lastKnownLocation)。
  const hits = candidates.filter((candidate) => homeIo.fileExists(assetDbProbe(candidate)));
  if (hits.length > 1) {
    throw new AssetHomeError(
      ASSET_HOME_MULTIPLE_CANDIDATES,
      `ASSET_HOME_MULTIPLE_CANDIDATES:多个项目位置同时持有资产库(${hits.join(" ; ")}),状态机中止不猜边,请人工按台账核对后手动去一侧`,
    );
  }

  if (hits.length === 1) {
    const hit = hits[0];
    const projectId = Object.entries(options.allLocations() ?? {}).find(([, location]) => location === hit)?.[0];
    // 补/续 marker:仅在缺 marker/元数据需更新/v1 需升版时写(保留既有 ttsMigrated
    // 等字段;探针即 store 形,命中=assetsStoreMigrated 语义恒 true;恒升 v2 不降版)。
    if (!marker || marker.lastKnownLocation !== hit || marker.projectId !== projectId || marker.assetsStoreMigrated !== true) {
      writeAssetHomeMarker(userDataPath, {
        version: 2,
        projectId,
        lastKnownLocation: hit,
        ttsMigrated: marker?.ttsMigrated === true,
        assetsStoreMigrated: true,
        ledgerDir: marker?.ledgerDir,
      }, homeIo);
    }
    return path.join(hit, "store", "assets");
  }

  // ③marker 在而新根 db 缺(全表探测零命中)→ORPHANED,绝不静默 fallback(M1)。
  if (marker) {
    throw new AssetHomeError(
      ASSET_HOME_ORPHANED,
      `ASSET_HOME_ORPHANED:资产库位置失联(原位置:${marker.lastKnownLocation}),请重新绑定项目文件夹`,
      marker.lastKnownLocation,
    );
  }

  // ①真未迁移态:位置表可读+无 marker+无新根 db。
  // ①b 1016 补刀:旧统一存储 flat 形库在场(未绑项目画像)→回退 flat 根(数据
  // 可达性优先,1015 行为等价);不写 marker(未迁移语义——绑定项目后一段拾起)。
  // warn 会话级去重(getAssetsRoot 每次求值,asset-file:// 高频解析防刷屏)。
  if (options.legacyFlatAssetsRoot) {
    const flatRoot = options.legacyFlatAssetsRoot();
    if (flatRoot) {
      if (!flatWarnedRoots.has(flatRoot)) {
        flatWarnedRoots.add(flatRoot);
        console.warn(
          `[asset-home] 检测到旧统一存储资产库(flat 形,未绑定项目):${flatRoot}——本次会话按旧位服务;绑定项目后将自动归位 store/assets`,
        );
      }
      return flatRoot;
    }
  }
  const fallbackRoot = fallback();
  // ⑤M12:fallback 态+旧根 db 缺失 → 软警示不拦(全新装机正常态也走这里;会话级去重防刷屏)。
  if (!homeIo.fileExists(path.join(fallbackRoot, "assets.db")) && !m12WarnedRoots.has(fallbackRoot)) {
    m12WarnedRoots.add(fallbackRoot);
    console.warn(
      `[asset-home] 资产库旧根缺库(预期全新装机或首次使用):${fallbackRoot}——首次资产写入会在此新建库`,
    );
  }
  return fallbackRoot;
}

const m12WarnedRoots = new Set<string>();
const flatWarnedRoots = new Set<string>();

export interface ResolveTtsHomeOptions {
  userDataPath: string;
  locationStore: (projectId: string) => string | undefined;
  allLocations: () => Record<string, string>;
  /** 旧统一存储基路径(getStorageBasePath);旧家探针=join(它,'TTS','runtime','tts.sqlite')。 */
  legacyBasePath: () => string;
  io?: AssetHomeIo;
}

/**
 * TTS 家解析【B-2 统一层级】:返回基路径级(新态=项目根;旧态=旧统一存储基路径)。
 * 消费式 ttsRootDir=join(返回值,'TTS')——本函数不得自带 TTS 段(否则拼出
 * MA/TTS/TTS,探针恒 miss→恒判未迁→旧家已清→两侧都无恒炸)。
 * 四态:①新根探针在场→项目根;②旧家探针在场→旧基路径;③两侧都无→无 TTS 史
 * 合法态(绑定项目→项目根让 Python 建库,未绑→旧基路径=旧行为等价);④两侧都
 * 在→新根生效(旧家件交善后甄别移台账);⑤ORPHANED/位置表损坏→throw。
 */
export function resolveTtsHomeRoot(options: ResolveTtsHomeOptions): string {
  const { legacyBasePath } = options;
  const { io: homeIo, candidates } = buildHomeContext(options);

  const newHits = candidates.filter((candidate) => homeIo.fileExists(ttsDbProbe(candidate)));
  const legacyBase = legacyBasePath();
  const legacyHit = homeIo.fileExists(ttsDbProbe(legacyBase));

  if (newHits.length > 1) {
    throw new AssetHomeError(
      ASSET_HOME_MULTIPLE_CANDIDATES,
      `ASSET_HOME_MULTIPLE_CANDIDATES:多个项目位置同时持有 TTS 库(${newHits.join(" ; ")}),状态机中止不猜边,请人工按台账核对后手动去一侧`,
    );
  }
  // ①/④:新根在场优先(两侧都在=新根生效,旧家件由善后甄别移台账留档)。
  if (newHits.length === 1) return newHits[0];
  // ②旧家生效(失败会话增量写旧家真库,续迁整体 rename 天然合并,良性)。
  if (legacyHit) return legacyBase;
  // ③两侧都无=无 TTS 史合法态——迁移例程对『旧根无 assets.db+旧家无 tts.sqlite』
  // 恒 noop 且不写 marker(见 asset-home-migration 无资产史分支;写 marker 会因
  // lastKnownLocation 必填把资产域误打成 ORPHANED)。若此态仍 throw,绑定项目的
  // 新用户/未绑项目用户 TTS 首用即炸且重启死循环(B2 复审修复)。落点按绑定态:
  // - candidates 非空(marker.ttsMigrated=true 空迁移与本分支同式)→项目根,新库
  //   建在项目域(链B:MA/TTS/runtime/);将来资产入库触发全量迁移时,TTS 段对
  //   『旧家无件/新根库在场』组合天然幂等(P3 搬空+P4 改写),闭环不破。
  // - candidates 空(未绑项目)→旧家基路径,与未注入 provider 的旧行为
  //   join(storageBasePath(),'TTS') 逐字节等价;将来绑定项目+迁移时旧家 TTS
  //   件被搬走,闭环成立。
  if (candidates.length > 0) return candidates[0];
  return legacyBase;
}
