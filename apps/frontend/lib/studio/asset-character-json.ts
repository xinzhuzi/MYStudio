import { getStudioSkillsBridge } from "@/lib/bridge/studio-skills";

/**
 * 提示词真源 JSON 域(10-26 用户令:弹窗完整展示+可编辑真源 JSON;10-27 接线扩
 * store 位:项目库资产与 repo 手工真源同待遇)。
 *
 * 读取次序(10-27 单一裁定):项目库 store/assets/files/prompts/<资产名>.json 优先
 * (projectFiles.readText 桥,raw 免 2MB/截断)→ repo glob 兜底
 * (apps/frontend/assets/studio-manuals/art_skills/<技能包>/json/<角色名>.json,
 * 如 daojie_ink_guofeng/json/晏燎.json——十境主体词/编辑指令/海报三视图指令所在)。
 * repo 层内部再分:桌面技能存储副本(用户编辑保护)→ 内置种子(import.meta.glob)。
 * 写/恢复恒写 store 位(projectFiles.writeText 虚拟键,先例 project-store README 预写)。
 * 跨类型撞名(如 蛟龙 role+tool)落 `<名>@<type>.json`,读写两路同规则。
 */

const characterJsonModules = import.meta.glob("../../assets/studio-manuals/art_skills/*/json/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

export type AssetPromptJsonType = "role" | "scene" | "tool";

/** 项目库提示词真源目录(相对项目根;桥 readText/writeText 的 relativePath 基准)。 */
export const STORE_PROMPTS_RELATIVE = "store/assets/files/prompts";

/**
 * store 位真源相对路径(读/探/写三路共用;写路不得写死平铺名):
 * 撞名者(跨类型同名,如 蛟龙 role+tool)`<名>@<type>.json`,否则平铺 `<名>.json`。
 * 撞名判定来自 store 探测(平铺位被异型占用即撞),见 probeStorePrompt。
 */
export function buildStorePromptRelativePath(
  name: string,
  type?: AssetPromptJsonType,
  colliding = false,
): string {
  const suffix = colliding && type ? `@${type}` : "";
  return `${STORE_PROMPTS_RELATIVE}/${name}${suffix}.json`;
}

export interface CharacterJsonInfo {
  characterName: string;
  /** 技能存储相对路径(= bridge readText/writeText 的 relativePath)。 */
  relativePath: string;
  /** 内置种子文本(2 空格缩进;桌面存储不可用时的展示兜底)。 */
  bundledText: string;
}

export type CharacterJsonLoad =
  | {
      status: "ready";
      /** store=项目库 store 位(10-27 接线新增);storage=桌面技能存储副本;bundle=内置种子。 */
      source: "store" | "storage" | "bundle";
      text: string;
      relativePath: string;
      /** repo glob 命中(有内置种子可恢复);store-only 生成角色=false。 */
      seedAvailable?: boolean;
    }
  | { status: "missing" };

const infoCache = new Map<string, CharacterJsonInfo | null>();

/** 按角色名解析真源 JSON(文件名去扩展 = 角色名精确匹配;无则 null,UI 不出按钮)。 */
export function getCharacterJsonInfo(characterName: string | null | undefined): CharacterJsonInfo | null {
  const key = characterName?.trim() ?? "";
  if (!key) return null;
  if (infoCache.has(key)) return infoCache.get(key) ?? null;
  let info: CharacterJsonInfo | null = null;
  for (const [modulePath, value] of Object.entries(characterJsonModules)) {
    const filename = modulePath.split("/").at(-1) ?? "";
    if (filename !== `${key}.json`) continue;
    const anchor = modulePath.indexOf("art_skills/");
    const relativePath = anchor >= 0
      ? modulePath.slice(anchor)
      : modulePath.replace(/^(\.\.\/)+assets\/studio-manuals\//, "");
    info = {
      characterName: key,
      relativePath,
      bundledText: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    };
    break;
  }
  infoCache.set(key, info);
  return info;
}

// ---------------------------------------------------------------------------
// store 位探测(10-27 接线):projectFiles.readText({projectId, relativePath, raw:true})
// —— raw 语义=台账专用通道(16MB 上限/免 256KB 截断/免 NUL 预检,project-file-ipc);
// projectId 取法照 visual-manual-style-tokens.ts 动态 import 先例。
// ---------------------------------------------------------------------------

interface StoreIoContext {
  projectId: string;
  readText: (payload: { projectId: string; relativePath: string; raw?: boolean }) => Promise<{
    success: boolean;
    text?: string;
    error?: string;
  }>;
  writeText?: (key: string, value: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
}

/** 动态取项目 IO 上下文(无桥/无活跃项目/异常= null,store 位整链按未命中处理)。 */
async function getStoreIoContext(): Promise<StoreIoContext | null> {
  try {
    const projectStore = (await import("@/stores/project/project-store")).useProjectStore.getState();
    const projectId = projectStore.activeProjectId;
    if (!projectId) return null;
    const bridge = (await import("@/lib/bridge/project-files")).getProjectFilesBridge();
    if (!bridge?.readText) return null;
    return { projectId, readText: bridge.readText, writeText: bridge.writeText };
  } catch {
    return null;
  }
}

/**
 * asset_type 校验(store 位收件规则):
 * - 文档有 asset_type 且 === 入参 type → 收(骨架/回填件恒带);
 * - 无 asset_type(晏燎级旧手工件)→ 仅 type==='role' 或 type 缺省时收
 *   (loadCharacterSubject 旧路按 role 语义;scene/tool 视为不匹配)。
 */
function assetTypeMatches(doc: Record<string, unknown>, type?: AssetPromptJsonType): boolean {
  const declared = doc.asset_type;
  if (typeof declared === "string") return declared === type;
  return type === "role" || type === undefined;
}

type StoreReadInspection = { state: "hit"; text: string } | { state: "mismatch" } | { state: "absent" };

async function inspectStorePath(io: StoreIoContext, relativePath: string, type?: AssetPromptJsonType): Promise<StoreReadInspection> {
  try {
    const result = await io.readText({ projectId: io.projectId, relativePath, raw: true });
    const text = result?.success ? result.text : null;
    if (!text || !text.trim()) return { state: "absent" };
    try {
      const doc = JSON.parse(text);
      if (typeof doc === "object" && doc !== null && assetTypeMatches(doc as Record<string, unknown>, type)) {
        return { state: "hit", text };
      }
    } catch {
      // 非法 JSON:按占位不收(撞名信号,继续 @type 位探测)
    }
    return { state: "mismatch" };
  } catch {
    return { state: "absent" };
  }
}

export interface StorePromptProbe {
  /** 写路目标(平铺或 <名>@<type>;save/restore 恒写此路径,不得写死平铺名)。 */
  relativePath: string;
  /** store 位命中且通过 asset_type 校验。 */
  hit: boolean;
  text: string | null;
}

/**
 * store 位探测:平铺位先行;平铺位被异型占用(mismatch)或缺失时有 type 再探
 * `<名>@<type>.json`(回填对撞名双方恒落 @type 位,平铺位永不落件)。type 缺省
 * (loadCharacterSubject 旧路)= 仅平铺名探测+旧件按 role 收。
 * 返回 null=环境不可用(无桥/无活跃项目),整链按未命中处理。
 */
async function probeStorePrompt(
  characterName: string | null | undefined,
  type?: AssetPromptJsonType,
): Promise<StorePromptProbe | null> {
  const name = characterName?.trim() ?? "";
  if (!name) return null;
  const io = await getStoreIoContext();
  if (!io) return null;

  const flatPath = buildStorePromptRelativePath(name);
  const flat = await inspectStorePath(io, flatPath, type);
  if (flat.state === "hit") return { relativePath: flatPath, hit: true, text: flat.text };
  if (type) {
    const typedPath = buildStorePromptRelativePath(name, type, true);
    const typed = await inspectStorePath(io, typedPath, type);
    if (typed.state === "hit") return { relativePath: typedPath, hit: true, text: typed.text };
    // 平铺位被异型占用=撞名:写路锚 @type 位(读写同路)
    if (flat.state === "mismatch") return { relativePath: typedPath, hit: false, text: null };
  }
  return { relativePath: flatPath, hit: false, text: null };
}

// ---------------------------------------------------------------------------
// 真源位置信息(10-27 接线:弹窗门控从「repo glob 命中」放开为「任一位有 JSON」)
// ---------------------------------------------------------------------------

export interface AssetPromptJsonInfo {
  origin: "store" | "repo" | null;
}

const assetPromptInfoCache = new Map<string, AssetPromptJsonInfo | null>();

/** 清空真源位置缓存(save/restore 写盘后调用;测试也用)。 */
export function invalidateAssetPromptInfoCache(): void {
  assetPromptInfoCache.clear();
}

/** 探明该资产的提示词真源位置:store 位命中→'store';repo glob 命中→'repo';皆无→null。 */
export async function resolveAssetPromptJsonInfo(
  characterName: string | null | undefined,
  type?: AssetPromptJsonType,
): Promise<AssetPromptJsonInfo> {
  const name = characterName?.trim() ?? "";
  if (!name) return { origin: null };
  const cacheKey = `${type ?? "_"}:${name}`;
  if (assetPromptInfoCache.has(cacheKey)) return assetPromptInfoCache.get(cacheKey) ?? { origin: null };
  const probe = await probeStorePrompt(name, type);
  const info: AssetPromptJsonInfo = probe?.hit
    ? { origin: "store" }
    : getCharacterJsonInfo(name)
      ? { origin: "repo" }
      : { origin: null };
  assetPromptInfoCache.set(cacheKey, info);
  return info;
}

/**
 * 载入提示词真源 JSON 文本:store 位优先(项目库,含用户编辑)→ repo 层
 * (技能存储副本→内置种子)。store/repo 皆无才 missing;store 位必须前置于
 * repo info 判定(顺序错误=store-only 资产全链失效)。
 */
export async function loadCharacterJsonText(
  characterName: string | null | undefined,
  type?: AssetPromptJsonType,
): Promise<CharacterJsonLoad> {
  const probe = await probeStorePrompt(characterName, type);
  if (probe?.hit && probe.text) {
    return {
      status: "ready",
      source: "store",
      text: probe.text,
      relativePath: probe.relativePath,
      seedAvailable: getCharacterJsonInfo(characterName) !== null,
    };
  }
  const info = getCharacterJsonInfo(characterName);
  if (!info) return { status: "missing" };
  const bridge = getStudioSkillsBridge();
  if (bridge?.readText) {
    try {
      const result = await bridge.readText(info.relativePath);
      if (result?.success && typeof result.content === "string" && result.content.trim()) {
        return { status: "ready", source: "storage", text: result.content, relativePath: info.relativePath, seedAvailable: true };
      }
    } catch {
      // 读失败(如测试环境/桥异常)→ 回内置种子展示
    }
  }
  return { status: "ready", source: "bundle", text: info.bundledText, relativePath: info.relativePath, seedAvailable: true };
}

export type CharacterJsonSaveResult =
  | { ok: true; updatedAt?: number }
  | { ok: false; error: string };

/**
 * 保存提示词真源 JSON:先本地 JSON.parse 校验,再写项目库 store 位
 * (writeText 虚拟键 `_p/{pid}/store/assets/files/prompts/…`,先例 project-store
 * README 预写)。门控=store 探测命中或 repo info 任一(store-only 资产可存)。
 */
export async function saveCharacterJsonText(
  characterName: string | null | undefined,
  text: string,
  type?: AssetPromptJsonType,
): Promise<CharacterJsonSaveResult> {
  const probe = await probeStorePrompt(characterName, type);
  const info = getCharacterJsonInfo(characterName);
  if (!probe && !info) return { ok: false, error: "该资产没有提示词真源 JSON" };
  try {
    JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `JSON 格式无效:${error instanceof Error ? error.message : String(error)}` };
  }
  const io = await getStoreIoContext();
  if (!io?.writeText) return { ok: false, error: "当前环境不支持编辑,请在桌面版中打开" };
  const relativePath = probe?.relativePath ?? buildStorePromptRelativePath(characterName?.trim() ?? "", type);
  try {
    const result = await io.writeText(`_p/${io.projectId}/${relativePath}`, text);
    if (!result?.success) return { ok: false, error: result?.error || "保存失败" };
    invalidateAssetPromptInfoCache();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 恢复内置种子版本(丢弃用户编辑;恢复后由调用方重新 load):
 * repo-glob 角色=写 bundledText 进 store 同路径(种子覆写,绕开技能存储
 * restoreText 体系);store-only 生成角色无种子→明确报错。
 */
export async function restoreCharacterJsonText(
  characterName: string | null | undefined,
  type?: AssetPromptJsonType,
): Promise<CharacterJsonSaveResult> {
  const info = getCharacterJsonInfo(characterName);
  if (!info) return { ok: false, error: "该 JSON 无内置种子" };
  const io = await getStoreIoContext();
  if (!io?.writeText) return { ok: false, error: "当前环境不支持恢复,请在桌面版中打开" };
  const probe = await probeStorePrompt(characterName, type);
  const relativePath = probe?.relativePath ?? buildStorePromptRelativePath(characterName?.trim() ?? "", type);
  try {
    const result = await io.writeText(`_p/${io.projectId}/${relativePath}`, info.bundledText);
    if (!result?.success) return { ok: false, error: result?.error || "恢复失败" };
    invalidateAssetPromptInfoCache();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// 主体句真源接线(10-26 用户令:晏燎明明有主体词在真源 JSON 里,弹窗必须呈现)
// ---------------------------------------------------------------------------

/** 境界键名对齐选择器值:剥数字前缀(「2.筑基期」→「筑基期」)+ 炼/练归一(JSON
 *  首境键作「炼气期」,实库阶段段与 REALM_LADDER 作「练气期」——两写法并存于真源
 *  与实库,取归一化相等)。 */
function normalizeRealmKey(key: string): string {
  return key.replace(/^\d+\./, "").replace(/炼/g, "练");
}

/**
 * 从真源 JSON 文本派生主体句:
 * - stage 命中某境界 → 该境 `主体词_独立t2i备用`(stage-aware 出图主体);
 * - 无 stage / 未命中 / 该境缺字段 → `body_base.主体词`(人物基底主体);
 * - 文本损坏/结构缺失 → null(调用方回退既有 DB 行为,fail-safe)。
 */
export function deriveSubjectFromCharacterJson(
  text: string,
  stage: string | null | undefined,
): string | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) return null;
  const root = doc as Record<string, unknown>;
  if (stage) {
    const stages = root.stages as Record<string, unknown> | undefined;
    const realms = stages?.境界 as Record<string, unknown> | undefined;
    if (realms && typeof realms === "object") {
      const wanted = stage.replace(/炼/g, "练");
      for (const [key, value] of Object.entries(realms)) {
        if (normalizeRealmKey(key) !== wanted) continue;
        const subject = (value as Record<string, unknown> | null)?.["主体词_独立t2i备用"];
        if (typeof subject === "string" && subject.trim()) return subject.trim();
        break;
      }
    }
  }
  const base = (root.body_base as Record<string, unknown> | undefined)?.主体词;
  return typeof base === "string" && base.trim() ? base.trim() : null;
}

/** 载入真源(store 位优先)并派生主体句;无真源/派生失败返回 null。
 * (type 缺省=旧路:仅平铺名探测,无 asset_type 旧件按 role 收;生产零消费,仅测试引用。) */
export async function loadCharacterSubject(
  characterName: string | null | undefined,
  stage: string | null | undefined,
  type?: AssetPromptJsonType,
): Promise<string | null> {
  const load = await loadCharacterJsonText(characterName, type);
  if (load.status !== "ready") return null;
  return deriveSubjectFromCharacterJson(load.text, stage);
}

// ---------------------------------------------------------------------------
// 人物提示词目录(10-26 用户令:提示词应由 JSON 数据化呈现,逐条标注文生图/图生图)
// 路由真源=晏燎.json 自带语义:body_base.出图配方.通道=「文生图(唯一一次;此后十境
// 全部图生图)」;正视图指令=双参考标签体(<image1>+<image2> 换衣编辑);海报/三视图
// =单参考自然指称;主体词_独立t2i备用=独立文生图直出。
// ---------------------------------------------------------------------------

export type CharacterPromptRoute = "t2i" | "i2i";

export interface CharacterPromptEntry {
  /** 稳定键(展开态等组件态用)。 */
  key: string;
  route: CharacterPromptRoute;
  /** 路由细注(如「双参考换衣编辑」「单参考」),渲染进徽标 title。 */
  routeNote: string;
  title: string;
  text: string;
}

export interface CharacterPromptRealm {
  /** 归一化境界名(与阶段选择器值对齐,炼/练已归一)。 */
  stage: string;
  /** JSON 原键(如「2.筑基期」)。 */
  rawKey: string;
  entries: CharacterPromptEntry[];
}

export interface CharacterPromptCatalog {
  faceBase: CharacterPromptEntry | null;
  bodyBase: CharacterPromptEntry | null;
  realms: CharacterPromptRealm[];
}

function pickText(source: unknown): string {
  return typeof source === "string" ? source.trim() : "";
}

/** 目录化解析真源 JSON 文本;结构缺失/损坏返回 null(调用方回退既有 UI)。 */
export function parseCharacterPromptCatalog(text: string): CharacterPromptCatalog | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) return null;
  const root = doc as Record<string, unknown>;

  const faceSubject = pickText((root.hd_face_base as Record<string, unknown> | undefined)?.主体词);
  const bodySubject = pickText((root.body_base as Record<string, unknown> | undefined)?.主体词);
  if (!faceSubject && !bodySubject) return null;

  const realms: CharacterPromptRealm[] = [];
  const realmRoot = (root.stages as Record<string, unknown> | undefined)?.境界;
  if (realmRoot && typeof realmRoot === "object") {
    for (const [rawKey, value] of Object.entries(realmRoot)) {
      if (typeof value !== "object" || value === null) continue;
      const realm = value as Record<string, unknown>;
      const stage = normalizeRealmKey(rawKey);
      const stageEntries: CharacterPromptEntry[] = [];
      const push = (field: string, route: CharacterPromptRoute, routeNote: string, title: string) => {
        const body = pickText(realm[field]);
        if (body) stageEntries.push({ key: `${stage}:${field}`, route, routeNote, title, text: body });
      };
      push("主体词_独立t2i备用", "t2i", "独立直出(无参考图)", `${stage}·独立主体词`);
      push("编辑指令", "i2i", "单参考换装编辑(以图中人物为基准)", `${stage}·换装编辑指令`);
      push("正视图指令", "i2i", "双参考换衣编辑(<image1>基底+<image2>本境)", `${stage}·正视图指令`);
      push("海报指令", "i2i", "单参考(以本境正视图为唯一参考)", `${stage}·海报指令`);
      push("三视图指令", "i2i", "单参考(正/侧/背等高同衣同脸)", `${stage}·三视图指令`);
      realms.push({ stage, rawKey, entries: stageEntries });
    }
  }

  return {
    faceBase: faceSubject
      ? { key: "hd_face_base", route: "t2i", routeNote: "人脸基准正射(t2i)", title: "人脸基准", text: faceSubject }
      : null,
    bodyBase: bodySubject
      ? { key: "body_base", route: "t2i", routeNote: "素体基底(十境链唯一次文生图)", title: "人物基底·素体", text: bodySubject }
      : null,
    realms,
  };
}

/** 按选择器值找境目录(炼/练已在归一键上对齐);未命中 null。 */
export function findCharacterPromptRealm(
  catalog: CharacterPromptCatalog | null,
  stage: string | null | undefined,
): CharacterPromptRealm | null {
  if (!catalog || !stage) return null;
  const wanted = stage.replace(/炼/g, "练");
  return catalog.realms.find((realm) => realm.stage === wanted) ?? null;
}

// ---------------------------------------------------------------------------
// 型区分派生(10-26 用户令:点「无衣物定妆」出带衣图实录):「无衣物定妆」=素体型,
// 主体句恒走 body_base 素体主体词(不吃阶段);无真源且兜底句带衣物→阻断(禁发
// 带衣人设句出带衣错图——衣物系该型之后 i2i 注入的变量,素体是该型的定义)。
// ---------------------------------------------------------------------------

/** 无衣物定妆型名(AssetImageKind 字面量之一)。 */
export const BARE_TYPE_KIND = "无衣物定妆";

/** 素体型主体句闸:返回该型应派发的主体句与阻断消息(二者至多其一)。 */
export function resolveBareTypeSubjectGate(input: {
  kind: string;
  /** 真源 body_base 素体主体词(无真源/结构缺失=null)。 */
  bodyBaseSubject: string | null;
  /** 无槽覆盖时的兜底主体句(镜像或 DB)。 */
  fallback: string;
  /** 用户显式本型槽句(最优先,填了就直接用)。 */
  slot?: string;
}): { subject?: string; block?: string; derived?: boolean } {
  const { kind, bodyBaseSubject, fallback, slot } = input;
  if (kind !== BARE_TYPE_KIND) return {};
  if (slot?.trim()) return { subject: slot.trim() };
  if (bodyBaseSubject) return { subject: bodyBaseSubject };
  const text = (fallback ?? "").trim();
  // 10-26 闸漏洞修正(小杂役实录):「赤足/裸足」=光脚≠无衣物(乞丐/杂役穿破衣
  // 光脚是常见形象)——带衣句仅在显式「全身素体」级声明才豁免
  const declaresBare = /素体|全身无衣|通身无衣|通身素体/.test(text);
  const hasClothing = /衣|袍|装|裙|衫|服|褐|裤|甲|帔|靴|鞋|履/.test(text);
  if (text && hasClothing && !declaresBare) {
    // 10-27 用户令「不可以自动生成之类的吗」:阻断改自动派生——剥衣物段留身份,
    // 套素体基准尾;派发即用,落「无衣物定妆」本型槽(调用方负责)
    const derived = deriveBareSubjectFromClothed(text);
    if (derived) return { subject: derived, derived: true };
    return {
      block:
        "「无衣物定妆」需要素体主体句(全身无衣物);当前主体句含衣物描述且自动剥除失败。请在「角色真源JSON」补素体主体词(body_base.主体词)",
    };
  }
  return {};
}

/** 衣物段判定:该句段含衣物/穿戴词即剥(腰束/缀补丁等穿戴语同判;发型草绳不算)。 */
const CLOTHING_SEGMENT =
  /衣|袍|装|裙|衫|服|褐|裤|甲|帔|靴|鞋|履|袜|腰束|腰带|腰间|佩戴|缀补丁|持物|手持|握|持一|背景|场景|构图|四视图|三视图|多视图|视图|横幅|并排|散光|人像特写|自头顶至/;

/** 自动派生素体主体句:按句号/分号切段,剥衣物/持物/背景段,保留身份·面容·发型·
 * 姿态段,套与真源 body_base 同构的素体基准尾(含引擎门禁「素体」豁免词)。 */
export function deriveBareSubjectFromClothed(text: string): string | null {
  const segments = text
    .split(/[。;；\n]/)
    .map((seg) => seg.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;
  let kept = segments.filter((seg) => !CLOTHING_SEGMENT.test(seg));
  if (kept.length === 0) {
    // 单句混排(身份+衣物同段)兜底:降级到逗号子句级剥除,保身份子句
    const clauses = segments[0]!.split(/[,，]/).map((c) => c.trim()).filter(Boolean);
    kept = clauses.filter((clause) => clause && !CLOTHING_SEGMENT.test(clause));
  }
  if (kept.length === 0) return null;
  const head = kept.join(",");
  const tail =
    "通身素体呈现,肌肤匀净,全身人体比例与解剖结构清晰可读;正面直立站姿,双臂自然垂于身侧,双手放松自然,足部赤裸(素体基准态,鞋履后注入);头顶至足底全身完整入画;图为带透明通道的RGBA透明底素材图,背景全透明";
  return `${head}。${tail}。`;
}
