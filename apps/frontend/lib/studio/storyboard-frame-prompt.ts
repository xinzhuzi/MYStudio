/**
 * 分镜色彩/温感工具 — 阵营配色与温感判定的运行时消费层。
 *
 * 1116 换线正典(PRD 11-16-storyboard-canonical-line §4.4):本模块的帧装配路
 * (成片模板解析/选型、【画面】+【构图】段装配、行进镜/人数自适应、画外音过滤)
 * 整链退役——分镜主体句改由正典生成器(storyboard-canonical-prompt.ts)产出,
 * 底座/类型句/负面由引擎正典装配链注入。保留件=仍被下游消费的色彩/温感工具:
 * - 阵营色明文行(正典主体句的落点色锚来源,§4.2 色锚=明文设定色级)
 * - 逐镜配色锚/温感投票/主导阵营(成片调色冲突检测 chapter-grade-conflict、
 *   章自动成片 useChapterAutoVideoActions 消费)
 */

/**
 * 复合资产名拆分(08-28 无色根修):资产标题常为「李先生;管事」「监工赵四;赵四」
 * 复合记法,阵营表键是单名——按半/全角分号拆开逐段匹配,先整名后分段。
 */
export function splitCompoundAssetName(name: string): string[] {
  return name.split(/[;；]/).map((part) => part.trim()).filter(Boolean);
}

export function resolveAssetFaction(
  name: string,
  members: Record<string, string>,
): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  if (members[trimmed]) return members[trimmed];
  for (const part of splitCompoundAssetName(trimmed)) {
    if (members[part]) return members[part];
  }
  return undefined;
}

type FactionData = {
  members: Record<string, string>;
  palette: Record<string, { person: string; scene: string; prop?: string }>;
};

/** 轨道首次命中行「(阵营·轨道)五职责串」;未命中空串。 */
function pickFactionTrackLine(
  names: string[] | undefined,
  track: "person" | "scene" | "prop",
  faction: FactionData,
): string {
  for (const name of names ?? []) {
    const factionName = resolveAssetFaction(name, faction.members);
    const combo = factionName ? faction.palette[factionName] : undefined;
    const text = combo?.[track];
    if (text) return `(${factionName}·${track === "person" ? "人物" : track === "scene" ? "场景" : "道具"})${text}`;
  }
  return "";
}

/**
 * 阵营色彩职责段(ma-faction-palette-v1):场景名→scene 轨、角色名→person 轨、
 * 道具名→prop 轨(条件注入·弱倾向:材质色优先+小纹样,对齐 MA faction_visual_locks 政策),
 * 各自去重取一(同轨多阵营时取首个命中),拼「【色彩】(阵营·轨道):五职责串」。
 * prop 仅在分镜明确提供道具资产名时注入,不为「三轨齐全」无条件补齐;
 * 数据未预热/无命中 → 空串(prefix 通用配色五职责已覆盖,不重复注入)。
 */
export function buildStoryboardFactionColorSection(
  input: {
    sceneNames?: string[];
    personNames?: string[];
    propNames?: string[];
    /** 缺省为 not_applicable；仅明确的道具聚焦镜头可请求 prop 阵营色。 */
    propFactionColorApplicability?: "not_applicable" | "applicable";
    /** 防止仅因关联资产含道具就把 prop 色自动拼入普通分镜。 */
    propFocus?: boolean;
  },
  faction: FactionData,
): string {
  const personPart = pickFactionTrackLine(input.personNames, "person", faction);
  const scenePart = pickFactionTrackLine(input.sceneNames, "scene", faction);
  const propApplicability = input.propFactionColorApplicability ?? "not_applicable";
  const propPart = input.propFocus && propApplicability === "applicable"
    ? pickFactionTrackLine(input.propNames, "prop", faction)
    : "";
  const body = [personPart, scenePart, propPart].filter(Boolean).join(";");
  return body ? `【色彩】阵营色彩职责 ${body}` : "";
}

/**
 * 压缩五职责串为 主/辅/点睛 三职责(配色锚紧凑形态,08-28 蓝图样例口径):
 * 底色跨阵营恒为纸白系、墨线恒为浓/淡墨,对 LUT 选向零区分度,只占 prompt 字数
 * (82 镜全带锚时省 ~40% 字符,防撑爆输入上限逼 AI 链静默跌落启发式)。
 */
function compactFactionDutyText(text: string): string {
  return text
    .split("+")
    .filter((segment) => !segment.startsWith("底色") && !segment.startsWith("墨线"))
    .join("+");
}

/**
 * 逐镜配色锚(08-28 两套色彩系统衔接):为成片 AI 选卡(LUT)提供本镜阵营色方向。
 * 人物轨=visibleCharacterNames;场景轨=assetNames 中能命中阵营表且不与人物名重叠者
 * (复合名分段互斥)。输出不带【色彩】头的紧凑三职责串,如
 * "(人族·场景)主色赭石+辅色栗褐+点睛藤黄";无命中空串(fail-empty,
 * 未预热/旧镜无语义数据时提示词零变化)。
 */
export function buildShotColorMoodLine(
  input: {
    assetNames?: string[];
    visibleCharacterNames?: string[];
  },
  faction: FactionData,
): string {
  const persons = (input.visibleCharacterNames ?? []).map((name) => name.trim()).filter(Boolean);
  const personParts = new Set(persons.flatMap((name) => [name, ...splitCompoundAssetName(name)]));
  const scenes = (input.assetNames ?? [])
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => {
      const parts = [name, ...splitCompoundAssetName(name)];
      return !parts.some((part) => personParts.has(part))
        && resolveAssetFaction(name, faction.members) !== undefined;
    });
  const compactTrackLine = (line: string): string => {
    const close = line.indexOf(")");
    return close < 0 ? compactFactionDutyText(line) : line.slice(0, close + 1) + compactFactionDutyText(line.slice(close + 1));
  };
  return [
    pickFactionTrackLine(persons, "person", faction),
    pickFactionTrackLine(scenes, "scene", faction),
  ]
    .filter(Boolean)
    .map(compactTrackLine)
    .join("; ");
}

export type PaletteTemperature = "warm" | "cool" | "neutral";

const WARM_COLOR_WORDS = ["黄", "朱", "红", "金", "栗", "褐", "赭", "橙", "胭", "藤", "檀"] as const;
const COOL_COLOR_WORDS = ["青", "蓝", "绿", "黛", "碧", "翠"] as const;

/**
 * 阵营盘温感(确定性关键词投票,禁 NLP 猜词):对若干五职责串取「主色/点睛」
 * 色名段投票——暖词(黄朱红金栗褐赭橙胭藤檀) vs 冷词(青蓝绿黛碧翠),
 * 紫灰黑白不计票;平票或零票=neutral。例:人族场景盘(主色赭石+点睛藤黄)=warm,
 * 万劫圣宗新盘(靛蓝+朱砂+石青+赭石 各半)=neutral。
 */
export function classifyFactionPaletteTemperature(combos: string[]): PaletteTemperature {
  let warm = 0;
  let cool = 0;
  for (const combo of combos) {
    for (const match of combo.matchAll(/(?:主色|点睛)([^+;；]+)/g)) {
      const token = match[1]!.trim();
      if (WARM_COLOR_WORDS.some((word) => token.includes(word))) warm += 1;
      else if (COOL_COLOR_WORDS.some((word) => token.includes(word))) cool += 1;
    }
  }
  if (warm === 0 && cool === 0) return "neutral";
  if (warm > cool) return "warm";
  if (cool > warm) return "cool";
  return "neutral";
}

/**
 * 本章主导阵营(逐镜 associateAssetsNames 命中阵营的众数;每镜每阵营至多计一次,
 * 平票取镜头数多者、再平取首见,确定性)。用于钉死调色卡的冷暖冲突提示。
 */
export function dominantChapterFaction(
  shots: Array<{ associateAssetsNames?: string[] }>,
  faction: FactionData,
): string | undefined {
  const counts = new Map<string, number>();
  for (const shot of shots) {
    const seen = new Set<string>();
    for (const name of shot.associateAssetsNames ?? []) {
      const factionName = resolveAssetFaction(name, faction.members);
      if (factionName) seen.add(factionName);
    }
    for (const factionName of seen) {
      counts.set(factionName, (counts.get(factionName) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [factionName, count] of counts) {
    if (count > bestCount) {
      best = factionName;
      bestCount = count;
    }
  }
  return best;
}

/**
 * 主导阵营盘温感(person+scene 两轨合并投票):供 UI 与选卡指南判定
 * 「钉死 LUT 是否反向压色」。无主导阵营/盘缺失=neutral(永不误报)。
 */
export function chapterFactionTemperature(
  shots: Array<{ associateAssetsNames?: string[] }>,
  faction: FactionData,
): { faction?: string; temperature: PaletteTemperature } {
  const dominant = dominantChapterFaction(shots, faction);
  const combo = dominant ? faction.palette[dominant] : undefined;
  if (!dominant || !combo) return { temperature: "neutral" };
  return {
    faction: dominant,
    temperature: classifyFactionPaletteTemperature([combo.person, combo.scene]),
  };
}

/**
 * 构图模板镜头类型自适应(08-29 S04 类根修)与人物数自适应(08-28 R18)、
 * 台词语境画外音过滤、【画面】+【构图】段装配(buildStoryboardFramePrompt)、
 * 成片模板解析/选型(parseStoryboardFrameTemplates/selectStoryboardFrameTemplate)
 * ——1116 换线正典(PRD §4.4)整链退役,真源移除;分镜主体句改由
 * storyboard-canonical-prompt.ts 生成器产出。
 */
