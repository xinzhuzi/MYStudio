/**
 * 分镜帧生图提示词装配 — ma-gongbi-v1 手册资产的运行时消费层。
 *
 * 数据全部来自道劫视觉手册 art_prompt/art_storyboard_video.md(fail-empty):
 * - 成片模板速查(`### NN. 标题` + 段落,契约测试 daojie-manual-contract 保证结构)
 * - prefix.md「提示词装配顺序」的正文段结构:【画面】题材正文 +【构图】景别/画幅要点
 * - 风格 token 与五类负面词由 visual-manual-style-tokens 单独注入,本模块不重复
 *
 * 装配原则(手册三段式):题材正文只写事实与构图,负面全部进 Negative Prompt 段;
 * 长度天然收敛(画面 50-120 + 模板要点 + 风格 token 落在 300-800 目标)。
 */

export interface StoryboardFrameTemplate {
  id: string;
  title: string;
  /** 模板要点段(适用/要点/画幅,原样注入【构图】)。 */
  brief: string;
}

/** 解析手册「成片模板速查」:`### NN. 标题` 标题 + 后续段落(到下一个标题止)。 */
export function parseStoryboardFrameTemplates(content: string): StoryboardFrameTemplate[] {
  const lines = content.split(/\r?\n/);
  const templates: StoryboardFrameTemplate[] = [];
  let current: { id: string; title: string; briefLines: string[] } | null = null;
  for (const line of lines) {
    const match = /^###\s+(\d+)\.\s*(.+)$/.exec(line.trim());
    if (match) {
      if (current) templates.push(finishTemplate(current));
      current = { id: match[1]!, title: match[2]!.trim(), briefLines: [] };
      continue;
    }
    if (current) {
      if (line.startsWith('#')) {
        templates.push(finishTemplate(current));
        current = null;
        continue;
      }
      current.briefLines.push(line);
    }
  }
  if (current) templates.push(finishTemplate(current));
  return templates.filter((template) => template.brief);
}

function finishTemplate(current: { id: string; title: string; briefLines: string[] }): StoryboardFrameTemplate {
  return {
    id: current.id,
    title: current.title,
    brief: current.briefLines.join("\n").replace(/\n{2,}/g, "\n").trim(),
  };
}

/** 镜头文本(画面描述+台词)→ 模板选型规则;命中顺序=优先级,缺省回落 07 国风漫剧电影帧。 */
const TEMPLATE_RULES: Array<{ id: string; pattern: RegExp }> = [
  { id: "26", pattern: /(谈判|对峙|师徒|质问|密谈|低声|耳语|问道|喝道|回道|说道|答道|：[^"\n]{2,})/ },
  { id: "21", pattern: /(劈|斩|掌击|挥鞭|皮鞭|拔剑|出剑|冲杀|搏|交手|击中|闪身|暴起|拳头)/ },
  { id: "31", pattern: /(灵气|丹田|剑光|灵光|经脉|气息|修为|境界|灵根|灵矿|法印|符箓)/ },
  { id: "09", pattern: /(雨夜|夜雨|冷雨|暴雨|雨幕)/ },
  { id: "13", pattern: /(官府|官像|威压|殿堂|审判|戒律|监工)/ },
  { id: "28", pattern: /(卷轴|古籍|档案|书信|地图|账册|令牌文字)/ },
  { id: "30", pattern: /(孤影|独行|独自一人|独自|只身)/ },
  { id: "02", pattern: /(长卷|山河|远山|江面|全境|群山)/ },
];
const DEFAULT_TEMPLATE_ID = "07";

export function selectStoryboardFrameTemplate(
  frameText: string,
  templates: StoryboardFrameTemplate[],
): StoryboardFrameTemplate | null {
  if (!templates.length) return null;
  const byId = new Map(templates.map((template) => [template.id, template]));
  for (const rule of TEMPLATE_RULES) {
    if (rule.pattern.test(frameText)) {
      const hit = byId.get(rule.id);
      if (hit) return hit;
    }
  }
  return byId.get(DEFAULT_TEMPLATE_ID) ?? null;
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
 * 逐镜配色锚(08-28 两套色彩系统衔接):为成片 AI 选卡(LUT)提供本镜阵营色方向。
 * 人物轨=visibleCharacterNames;场景轨=assetNames 中能命中阵营表且不与人物名重叠者
 * (复合名分段互斥)。输出不带【色彩】头的紧凑串,无命中空串(fail-empty,
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
  const body = [
    pickFactionTrackLine(persons, "person", faction),
    pickFactionTrackLine(scenes, "scene", faction),
  ].filter(Boolean).join("; ");
  return body;
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
 * 构图模板人物数自适应(08-28 R18 根修):手册模板要点常写死「只有角色 A 与 B…
 * 双人中景」,三人镜(S21)/单人镜(S35)被套双人模板 → 模型每轮按 2 人画、丢角色
 * 丢身份(跨数月同失败形态实证)。按 shotSemantics.visibleCharacters 的人数改写
 * 人物数约束;人数=2 或缺省不改(fail-safe,无语义数据的旧镜保持原行为)。
 * 幂等:不含「只有角色 A 与 B」条款的模板原样返回。
 */
export function adaptTemplateBriefToCastCount(
  brief: string,
  castNames?: string[],
): string {
  if (!brief.includes("只有角色 A 与 B")) return brief;
  const names = (castNames ?? []).map((name) => name.trim()).filter(Boolean);
  const count = names.length;
  if (count === 0 || count === 2) return brief;
  if (count === 1) {
    return brief
      .replace("只有角色 A 与 B", `只有${names[0]}一人`)
      .replace("双人中景", "单人中景");
  }
  const nameList = names.slice(0, 4).join("、") + (count > 4 ? "等" : "");
  return brief
    .replace("只有角色 A 与 B", `${nameList}共${count}名角色同框`)
    .replace("双人中景", `${count}人中景`);
}

/**
 * 按手册装配顺序组装分镜帧正文:【画面】题材事实 +【构图】模板要点(+【色彩】阵营职责)。
 * 模板要点先经 adaptTemplateBriefToCastCount 按画面人物数自适应(08-28 R18)。
 * 风格 token 由调用方(withActiveVisualManualStoryboardStyleTokens)追加,负面词
 * 走 Negative Prompt,均不在本函数重复。手册未预热(无模板)时退化为裸描述。
 */
export function buildStoryboardFramePrompt(input: {
  description: string;
  lines?: string;
  template: StoryboardFrameTemplate | null;
  colorSection?: string;
  /** 画面可见角色名(shotSemantics.visibleCharacters);缺省不做人物数自适应 */
  castNames?: string[];
}): string {
  const description = input.description.trim();
  if (!input.template) return description;
  const dialogueHint = input.lines?.trim()
    ? `\n【台词语境】${input.lines.trim().slice(0, 80)}`
    : "";
  const colorPart = input.colorSection?.trim() ? `\n${input.colorSection.trim()}` : "";
  return [
    `【画面】${description}`,
    `【构图】${adaptTemplateBriefToCastCount(input.template.brief.replace(/\n+/g, " "), input.castNames)}`,
    colorPart.trim(),
    dialogueHint.trim(),
  ].filter(Boolean).join("\n");
}
