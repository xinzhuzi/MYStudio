import { getStudioSkillsBridge } from "@/lib/bridge/studio-skills";

/**
 * 角色真源 JSON 域(10-26 用户令:角色弹窗完整展示+可编辑角色真源 JSON)。
 *
 * 真源文件 = `apps/frontend/assets/studio-manuals/art_skills/<技能包>/json/<角色名>.json`
 * (如 daojie_ink_guofeng/json/晏燎.json,十境主体词/编辑指令/海报三视图指令所在)。
 * 双层取数:
 * - 展示兜底 = 渲染器内置副本(import.meta.glob 编译进包);
 * - 编辑真身 = 桌面技能存储副本(window.studioSkills 读写,主进程种子同步:
 *   用户改动静默保护、内置更新自动传播、可恢复种子——与手册编辑同一套体系)。
 * 存储副本与内置种子不逐字节同步是特性不是 bug:用户编辑以存储为准。
 */

const characterJsonModules = import.meta.glob("../../assets/studio-manuals/art_skills/*/json/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

export interface CharacterJsonInfo {
  characterName: string;
  /** 技能存储相对路径(= bridge readText/writeText 的 relativePath)。 */
  relativePath: string;
  /** 内置种子文本(2 空格缩进;桌面存储不可用时的展示兜底)。 */
  bundledText: string;
}

export type CharacterJsonLoad =
  | { status: "ready"; source: "storage" | "bundle"; text: string; relativePath: string }
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

/** 载入角色真源 JSON 文本:桌面存储副本优先(含用户编辑),无桥/读失败回内置种子。 */
export async function loadCharacterJsonText(
  characterName: string | null | undefined,
): Promise<CharacterJsonLoad> {
  const info = getCharacterJsonInfo(characterName);
  if (!info) return { status: "missing" };
  const bridge = getStudioSkillsBridge();
  if (bridge?.readText) {
    try {
      const result = await bridge.readText(info.relativePath);
      if (result?.success && typeof result.content === "string" && result.content.trim()) {
        return { status: "ready", source: "storage", text: result.content, relativePath: info.relativePath };
      }
    } catch {
      // 读失败(如测试环境/桥异常)→ 回内置种子展示
    }
  }
  return { status: "ready", source: "bundle", text: info.bundledText, relativePath: info.relativePath };
}

export type CharacterJsonSaveResult =
  | { ok: true; updatedAt?: number }
  | { ok: false; error: string };

/** 保存角色真源 JSON:先本地 JSON.parse 校验,再走技能存储写入。 */
export async function saveCharacterJsonText(
  characterName: string | null | undefined,
  text: string,
): Promise<CharacterJsonSaveResult> {
  const info = getCharacterJsonInfo(characterName);
  if (!info) return { ok: false, error: "该角色没有真源 JSON" };
  try {
    JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `JSON 格式无效:${error instanceof Error ? error.message : String(error)}` };
  }
  const bridge = getStudioSkillsBridge();
  if (!bridge?.writeText) return { ok: false, error: "当前环境不支持编辑,请在桌面版中打开" };
  try {
    const result = await bridge.writeText(info.relativePath, text);
    if (!result?.success) return { ok: false, error: result?.error || "保存失败" };
    return { ok: true, updatedAt: result.updatedAt };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 恢复内置种子版本(丢弃用户编辑;恢复后由调用方重新 load)。 */
export async function restoreCharacterJsonText(
  characterName: string | null | undefined,
): Promise<CharacterJsonSaveResult> {
  const info = getCharacterJsonInfo(characterName);
  if (!info) return { ok: false, error: "该角色没有真源 JSON" };
  const bridge = getStudioSkillsBridge();
  if (!bridge?.restoreText) return { ok: false, error: "当前环境不支持恢复,请在桌面版中打开" };
  try {
    const result = await bridge.restoreText(info.relativePath);
    if (!result?.success) return { ok: false, error: result?.error || "恢复失败" };
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

/** 载入真源(存储副本优先)并派生主体句;无真源/派生失败返回 null。 */
export async function loadCharacterSubject(
  characterName: string | null | undefined,
  stage: string | null | undefined,
): Promise<string | null> {
  const load = await loadCharacterJsonText(characterName);
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
