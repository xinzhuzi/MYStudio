// 字幕驱动音效（08-19 效果缺口任务3）：字幕句语义分类 → Kenney CC0 音效资产。
// 与已停用的转场音效（transitionSfxEnabled，转场≠音效）严格隔离——本模块
// 只做「音效随文字诉说」：按字幕 cue 帧派生，叙事内容驱动（剑击配金铁/雷鸣配轰）。
//
// 资产闭集 = frontend/assets/sfx 的 8 个 Kenney CC0 ogg（boom/flash/soft/warm/
// whoosh/zoom/glitch/dissolve，许可清单 assets/sfx/LICENSES.md）。
// 语义类约 16 种：有资产的 12 种进 AI 指南与规则命中；雨/脚步/钟声/火焰
// 无对应资产 → asset=null，分类可识别但派生时跳过（不扩库下载，缺类标注制）。

export type SubtitleSfxCategoryId =
  | "sword"
  | "explosion"
  | "thunder"
  | "impact"
  | "wind"
  | "swoosh"
  | "water"
  | "lightning"
  | "magic"
  | "illusion"
  | "charge"
  | "heartbeat"
  | "footsteps"
  | "bell"
  | "fire"
  | "rain";

export interface SubtitleSfxCategory {
  id: SubtitleSfxCategoryId;
  /** 中文语义标签（AI 指南展示）。 */
  label: string;
  /** 关键词兜底规则（规则路径与 AI 路径共用同一词表语义）。 */
  keywords: RegExp;
  /** 资产名（sfx-<name>.ogg 的 <name>）；null=库内无对应资产，派生跳过。 */
  asset: string | null;
}

/** 分类表顺序即命中优先级（具体声学事件在前，氛围在后）。 */
export const SUBTITLE_SFX_CATEGORIES: readonly SubtitleSfxCategory[] = [
  { id: "explosion", label: "爆炸/轰鸣", keywords: /爆|炸|轰|巨响|塌|崩/, asset: "boom" },
  { id: "thunder", label: "雷鸣", keywords: /雷|霹雳|惊蛰|雷霆/, asset: "boom" },
  { id: "sword", label: "刀剑/金铁", keywords: /剑|刀|刃|出鞘|斩|劈|戈|锋/, asset: "flash" },
  { id: "impact", label: "重击/碰撞", keywords: /砸|撞|击|捶|踹|碎|鞭/, asset: "boom" },
  { id: "lightning", label: "闪电/白光", keywords: /闪电|电光|白光|强光|骤亮/, asset: "flash" },
  { id: "water", label: "水声/滴落", keywords: /水|滴|溪|河|湖|海|泼|雨/, asset: "dissolve" },
  { id: "wind", label: "风声", keywords: /风|呼啸|沙沙|簌簌|飒/, asset: "whoosh" },
  { id: "swoosh", label: "挥掠/疾行", keywords: /掠|窜|腾|跃|疾|驰|闪身|破空/, asset: "whoosh" },
  { id: "magic", label: "灵法/仙术", keywords: /灵|法术|仙|阵|咒|符|玄功|真元/, asset: "warm" },
  { id: "illusion", label: "幻境/结界", keywords: /幻|梦|境|结界|虚|蜃/, asset: "glitch" },
  { id: "charge", label: "蓄势/凝聚", keywords: /蓄|凝|聚|运气|真气|酝酿/, asset: "zoom" },
  { id: "heartbeat", label: "心跳/悸动", keywords: /心跳|悸|忐忑|心口|胸口一紧|屏息/, asset: "soft" },
  // ── 以下类别库内无对应资产：分类可识别，派生跳过（不自动扩库）──
  { id: "footsteps", label: "脚步", keywords: /脚步|踏|行走|踱|步履/, asset: null },
  { id: "bell", label: "钟声/磬", keywords: /钟|磬|铃/, asset: null },
  { id: "fire", label: "火焰/燃烧", keywords: /火|焰|燃|灼|焚/, asset: null },
  { id: "rain", label: "雨声", keywords: /雨|霖|淅沥/, asset: null },
];

const CATEGORY_BY_ID: ReadonlyMap<string, SubtitleSfxCategory> = new Map(
  SUBTITLE_SFX_CATEGORIES.map((category) => [category.id, category]),
);

export function isSubtitleSfxCategoryId(value: unknown): value is SubtitleSfxCategoryId {
  return typeof value === "string" && CATEGORY_BY_ID.has(value);
}

/** 有资产的类别（AI 指南只给这些——选了也派生不出的类不给 AI 浪费决策）。 */
export function availableSubtitleSfxCategories(): readonly SubtitleSfxCategory[] {
  return SUBTITLE_SFX_CATEGORIES.filter((category) => category.asset !== null);
}

/** 类别 → 资产名；未知类别或无资产返回 null（派生端跳过）。 */
export function subtitleSfxAssetFor(categoryId: string): string | null {
  return CATEGORY_BY_ID.get(categoryId)?.asset ?? null;
}

/** 关键词兜底分类（AI 不可用时与 AI 路径共用同一张表；无命中返回 null）。 */
export function classifySubtitleSfx(text: string): SubtitleSfxCategoryId | null {
  for (const category of SUBTITLE_SFX_CATEGORIES) {
    if (category.keywords.test(text)) return category.id;
  }
  return null;
}

// ── 派生参数（音量克制纪律）──
/** sfx 增益（0.3~0.5 克制区间取中）。 */
export const SUBTITLE_SFX_VOLUME = 0.4;
/** 相对字幕 cue 起点的偏移帧（文字出现即刻出声，留 2 帧起振）。 */
export const SUBTITLE_SFX_OFFSET_FRAMES = 2;
/** 单条 sfx 时长帧（短 one-shot，与转场音效口径一致）。 */
export const SUBTITLE_SFX_DURATION_FRAMES = 15;
