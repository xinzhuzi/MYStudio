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
  faction: {
    members: Record<string, string>;
    palette: Record<string, { person: string; scene: string; prop?: string }>;
  },
): string {
  const pick = (names: string[] | undefined, track: "person" | "scene" | "prop") => {
    for (const name of names ?? []) {
      const factionName = faction.members[name.trim()];
      const combo = factionName ? faction.palette[factionName] : undefined;
      const text = combo?.[track];
      if (text) return `(${factionName}·${track === "person" ? "人物" : track === "scene" ? "场景" : "道具"})${text}`;
    }
    return "";
  };
  const personPart = pick(input.personNames, "person");
  const scenePart = pick(input.sceneNames, "scene");
  const propApplicability = input.propFactionColorApplicability ?? "not_applicable";
  const propPart = input.propFocus && propApplicability === "applicable"
    ? pick(input.propNames, "prop")
    : "";
  return [personPart, scenePart, propPart].filter(Boolean).length
    ? `【色彩】阵营色彩职责 ${[personPart, scenePart, propPart].filter(Boolean).join(";")}`
    : "";
}

/**
 * 按手册装配顺序组装分镜帧正文:【画面】题材事实 +【构图】模板要点(+【色彩】阵营职责)。
 * 风格 token 由调用方(withActiveVisualManualStoryboardStyleTokens)追加,负面词
 * 走 Negative Prompt,均不在本函数重复。手册未预热(无模板)时退化为裸描述。
 */
export function buildStoryboardFramePrompt(input: {
  description: string;
  lines?: string;
  template: StoryboardFrameTemplate | null;
  colorSection?: string;
}): string {
  const description = input.description.trim();
  if (!input.template) return description;
  const dialogueHint = input.lines?.trim()
    ? `\n【台词语境】${input.lines.trim().slice(0, 80)}`
    : "";
  const colorPart = input.colorSection?.trim() ? `\n${input.colorSection.trim()}` : "";
  return [
    `【画面】${description}`,
    `【构图】${input.template.brief.replace(/\n+/g, " ")}`,
    colorPart.trim(),
    dialogueHint.trim(),
  ].filter(Boolean).join("\n");
}
