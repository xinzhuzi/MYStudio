/**
 * AI 镜头语言选择 — 根据每个分镜的对白与画面描述，自动选择 3D 相机运动预设。
 *
 * 设计：
 *  - 主路径：aiManager.text（universalAi 兜底）批量分析整章分镜，输出严格 JSON
 *  - 兜底路径：无 AI 配置/调用失败时，用关键词启发式规则（确定性，不阻塞渲染）
 *  - 校验：非法预设值一律丢弃，缺失分镜回落 dolly-in
 */

import { aiManager } from "@/lib/ai/ai-manager";

export const CINEMATIC_PRESET_IDS = [
  "cinematic-dolly-in",
  "cinematic-dolly-out",
  "cinematic-crane-up",
  "cinematic-crane-down",
  "cinematic-orbit",
  "cinematic-parallax-lr",
  "cinematic-parallax-ud",
  "cinematic-ken-burns-3d",
  "cinematic-handheld",
  "cinematic-dutch-roll",
  "cinematic-vertigo",
  "cinematic-spiral",
  "cinematic-arc-left",
  "cinematic-arc-right",
  "cinematic-reveal-tilt-up",
  "cinematic-drift",
  "cinematic-fall",
  "cinematic-zoom-in",
  "cinematic-zoom-out",
  "cinematic-tilt-down",
  "cinematic-pan-left",
  "cinematic-pan-right",
  "cinematic-whip-pan",
  "cinematic-pedestal-up",
  "cinematic-pedestal-down",
  "cinematic-tracking-left",
  "cinematic-tracking-right",
  "cinematic-fly-through",
  "cinematic-pull-back-reveal",
  "cinematic-crash-zoom",
  "cinematic-slow-push",
  "cinematic-rise-and-pull",
  "cinematic-descend-and-push",
  "cinematic-impact",
  "cinematic-breathing",
] as const;

export type CinematicPresetId = (typeof CINEMATIC_PRESET_IDS)[number];

export const DEFAULT_CINEMATIC_PRESET: CinematicPresetId = "cinematic-dolly-in";

export interface CinematicShotInput {
  shotId: string;
  /** 画面描述（分镜 videoDesc/prompt） */
  description: string;
  /** 角色对白/旁白（ttsSpokenText） */
  dialogue: string;
}

const PRESET_GUIDE: ReadonlyArray<{ id: CinematicPresetId; when: string }> = [
  { id: "cinematic-dolly-in", when: "情绪聚焦、对白紧张、揭示关键主体、特写推进" },
  { id: "cinematic-dolly-out", when: "揭示全景、段落收尾、情绪释放、退场" },
  { id: "cinematic-slow-push", when: "不易察觉的缓慢逼近、访谈凝视、长镜头蓄力" },
  { id: "cinematic-fly-through", when: "强烈穿越纵深、飞入场景内部、沉浸推进" },
  { id: "cinematic-pull-back-reveal", when: "从特写大幅拉开揭示整个世界、结尾定格" },
  { id: "cinematic-crane-up", when: "开场 Establishing、场景全貌、宏大感、俯瞰" },
  { id: "cinematic-crane-down", when: "从高处降落进入场景、神域视角收落、接近地面主体" },
  { id: "cinematic-orbit", when: "环视场景、展示主体多面、空间感、仪式感" },
  { id: "cinematic-spiral", when: "史诗感开场、英雄登场、宏大场景的升格环绕揭示" },
  { id: "cinematic-parallax-lr", when: "横向空间层次、走动叙事、多主体并置" },
  { id: "cinematic-parallax-ud", when: "纵向空间、仰望/俯视、塔楼/深渊等垂直场景" },
  { id: "cinematic-arc-left", when: "主体向左调度、横向跟随、左向拉开" },
  { id: "cinematic-arc-right", when: "主体向右调度、横向跟随、右向拉开" },
  { id: "cinematic-pedestal-up", when: "平稳垂直上升、视线抬升、逐级揭示上方" },
  { id: "cinematic-pedestal-down", when: "平稳垂直下降、沉入场景、压抑下沉" },
  { id: "cinematic-tracking-left", when: "面朝前方向左跟拍、行走并行的稳定横移" },
  { id: "cinematic-tracking-right", when: "面朝前方向右跟拍、行走并行的稳定横移" },
  { id: "cinematic-reveal-tilt-up", when: "仰望揭示（建筑/巨人/天空）、由局部到整体、巍峨" },
  { id: "cinematic-tilt-down", when: "从天空/高处俯摇落到主体、由整体到局部" },
  { id: "cinematic-pan-left", when: "机位固定向左横摇、扫过场景、左向展开信息" },
  { id: "cinematic-pan-right", when: "机位固定向右横摇、右向展开信息" },
  { id: "cinematic-whip-pan", when: "转场切换、节奏爆点、动作衔接的甩镜" },
  { id: "cinematic-vertigo", when: "惊觉、真相揭示的冲击瞬间、现实扭曲、心理震撼" },
  { id: "cinematic-zoom-in", when: "压缩空间聚焦、凝视感、纪实变焦" },
  { id: "cinematic-zoom-out", when: "释放空间、揭示环境、结尾定格" },
  { id: "cinematic-crash-zoom", when: "猛然急推强调、爆点瞬间、喜剧/惊吓强调" },
  { id: "cinematic-rise-and-pull", when: "边升边拉离场、段落终了的上帝视角收尾" },
  { id: "cinematic-descend-and-push", when: "从高处边降边推进入场景内部" },
  { id: "cinematic-ken-burns-3d", when: "平缓叙事、回忆、插画感、节奏舒缓" },
  { id: "cinematic-drift", when: "梦境、恍惚、时间流逝、舒缓空镜" },
  { id: "cinematic-breathing", when: "微妙呼吸感推拉、静观、时间凝滞" },
  { id: "cinematic-handheld", when: "紧张追逐、纪实感、慌乱、战斗" },
  { id: "cinematic-fall", when: "坠落、失重、跌入深渊、下坠视角" },
  { id: "cinematic-impact", when: "爆炸/撞击/落雷瞬间、冲击波震动" },
  { id: "cinematic-dutch-roll", when: "不安、悬疑、心理扭曲、非常态" },
];

function buildPrompt(shots: CinematicShotInput[]): string {
  const guide = PRESET_GUIDE.map((g) => `- ${g.id}: ${g.when}`).join("\n");
  const list = shots
    .map((s, i) => `${i + 1}. shotId=${s.shotId}\n   画面: ${s.description || "(无)"}\n   对白: ${s.dialogue || "(无)"}`)
    .join("\n");
  return `你是电影摄影指导。为每个分镜选择 3D 相机运动预设，依据画面的叙事意图与对白情绪。

可选预设（仅限这些值）：
${guide}

分镜列表：
${list}

要求：
1. 结合画面描述与对白情绪选择最贴合的预设；同一预设可重复使用
2. 全章镜头语言要有节奏变化，避免连续多镜完全相同（除非叙事确实连贯）
3. 只输出 JSON，格式：{"presets": [{"shotId": "...", "preset": "..."}], "default": "整章默认预设"}
4. 不要输出任何解释文字`;
}

export function isCinematicPreset(value: unknown): value is CinematicPresetId {
  return typeof value === "string" && (CINEMATIC_PRESET_IDS as readonly string[]).includes(value);
}

/** 解析 AI 返回的 JSON（容忍 markdown 代码块/前后杂文），校验每个条目。 */
export function parseCinematicPresetResponse(
  raw: string,
  shotIds: Set<string>,
): { presets: Record<string, CinematicPresetId>; default: CinematicPresetId } {
  const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const parsed = JSON.parse(slice) as {
    presets?: Array<{ shotId?: unknown; preset?: unknown }>;
    default?: unknown;
  };
  const presets: Record<string, CinematicPresetId> = {};
  if (Array.isArray(parsed.presets)) {
    for (const entry of parsed.presets) {
      if (!entry || typeof entry !== "object") continue;
      const shotId = (entry as { shotId?: unknown }).shotId;
      const preset = (entry as { preset?: unknown }).preset;
      if (typeof shotId === "string" && shotIds.has(shotId) && isCinematicPreset(preset)) {
        presets[shotId] = preset;
      }
    }
  }
  const fallbackDefault = isCinematicPreset(parsed.default) ? parsed.default : DEFAULT_CINEMATIC_PRESET;
  return { presets, default: fallbackDefault };
}

/** 关键词启发式兜底（无 AI 时的确定性选择）。 */
export function heuristicCinematicPresets(shots: CinematicShotInput[]): {
  presets: Record<string, CinematicPresetId>;
  default: CinematicPresetId;
} {
  const presets: Record<string, CinematicPresetId> = {};
  for (const shot of shots) {
    const text = `${shot.description}\n${shot.dialogue}`;
    presets[shot.shotId] = matchPresetByKeywords(text);
  }
  return { presets, default: DEFAULT_CINEMATIC_PRESET };
}

function matchPresetByKeywords(text: string): CinematicPresetId {
  const rules: ReadonlyArray<{ preset: CinematicPresetId; keywords: readonly string[] }> = [
    { preset: "cinematic-impact", keywords: ["爆炸", "撞击", "轰", "震颤", "冲击波"] },
    { preset: "cinematic-crash-zoom", keywords: ["猛然", "急促", "骤然", "猛地"] },
    { preset: "cinematic-fly-through", keywords: ["飞入", "穿越", "冲进"] },
    { preset: "cinematic-whip-pan", keywords: ["甩", "猛地转头", "骤然转向"] },
    { preset: "cinematic-fall", keywords: ["坠落", "失重", "跌落", "下坠"] },
    { preset: "cinematic-vertigo", keywords: ["眩晕", "真相大白", "现实崩塌", "惊觉", "脊背发凉"] },
    { preset: "cinematic-tilt-down", keywords: ["俯摇", "俯瞰下移", "落到", "由上至下"] },
    { preset: "cinematic-crane-down", keywords: ["降落", "下沉", "缓缓下降"] },
    { preset: "cinematic-reveal-tilt-up", keywords: ["仰望", "抬头", "高耸", "巍峨"] },
    { preset: "cinematic-drift", keywords: ["梦境", "恍惚", "岁月", "流逝", "空镜"] },
    { preset: "cinematic-spiral", keywords: ["史诗", "登场", "苏醒", "崛起"] },
    { preset: "cinematic-slow-push", keywords: ["长镜头", "访谈", "静观"] },
    { preset: "cinematic-rise-and-pull", keywords: ["落幕", "上帝视角", "渐行渐远"] },
    { preset: "cinematic-pull-back-reveal", keywords: ["拉开全景", "整个世界", "全貌浮现"] },
    { preset: "cinematic-zoom-in", keywords: ["凝视", "注视", "盯紧"] },
    { preset: "cinematic-crane-up", keywords: ["全景", "俯瞰", "全貌", "城市", "山脉", "establishing", "开场"] },
    { preset: "cinematic-dolly-out", keywords: ["远离", "退场", "结束", "离去", "消失", "告别", "尾声"] },
    { preset: "cinematic-handheld", keywords: ["追逐", "逃跑", "战斗", "慌乱", "紧张", "颤抖", "追逐战"] },
    { preset: "cinematic-dutch-roll", keywords: ["诡异", "不安", "扭曲", "幻觉", "恐惧", "异常", "悬疑"] },
    { preset: "cinematic-orbit", keywords: ["环绕", "环视", "旋转", "打量", "端详", "仪式"] },
    { preset: "cinematic-parallax-lr", keywords: ["走向", "穿过", "并肩", "走廊", "街道", "左右"] },
    { preset: "cinematic-parallax-ud", keywords: ["俯视", "塔", "深渊", "升起", "天空"] },
    { preset: "cinematic-dolly-in", keywords: ["特写", "靠近", "爆发", "发现", "惊", "盯着"] },
  ];
  for (const rule of rules) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) return rule.preset;
  }
  return "cinematic-ken-burns-3d";
}

/**
 * AI 批量选择分镜相机预设。
 * 返回 source 标注来源：ai / heuristic / empty（无分镜时）。
 */
export async function selectCinematicPresets(
  shots: CinematicShotInput[],
): Promise<{ presets: Record<string, CinematicPresetId>; default: CinematicPresetId; source: "ai" | "heuristic" | "empty" }> {
  if (shots.length === 0) {
    return { presets: {}, default: DEFAULT_CINEMATIC_PRESET, source: "empty" };
  }
  const shotIds = new Set(shots.map((s) => s.shotId));
  try {
    const result = await aiManager.text({
      binding: { agent: "universalAi" },
      messages: [
        { role: "system", content: "你是专业电影摄影指导，只输出严格 JSON。" },
        { role: "user", content: buildPrompt(shots) },
      ],
      temperature: 0.3,
      maxTokens: 4096,
    });
    if (!result.success || !result.text) throw new Error(result.error || "AI 调用失败");
    const parsed = parseCinematicPresetResponse(result.text, shotIds);
    if (Object.keys(parsed.presets).length === 0) throw new Error("AI 未返回有效预设");
    return { ...parsed, source: "ai" };
  } catch {
    return { ...heuristicCinematicPresets(shots), source: "heuristic" };
  }
}
