/**
 * 字幕字体注册表 —— 烧录字幕的字体唯一事实源。
 *
 * 每个候选字体都以 unicode-range 子集离线打进固定 bundle
 * （SubtitleTrack 静态 import CSS，fontsource 与 lxgw-wenkai-webfont
 * 同为按需加载子集），渲染期不依赖网络。值保持 primitive（字符串 id）：
 * 字段跨 editing.json / plan / composition props 的 JSON 持久化边界，
 * 白名单校验在 editing validation 与 composition-props-validation
 * 两侧各自执行。
 */

export const SUBTITLE_FONT_IDS = [
  "ma-shan-zheng",
  "zhi-mang-xing",
  "long-cang",
  "lxgw-wenkai",
  "liu-jian-mao-cao",
  "noto-serif-sc",
  "noto-sans-sc",
] as const;

export type SubtitleFontId = (typeof SUBTITLE_FONT_IDS)[number];

/** 源码级默认：毛笔楷书（仙侠武侠片题字质感，用户 08-18 拍板）。 */
export const DEFAULT_SUBTITLE_FONT_ID: SubtitleFontId = "liu-jian-mao-cao";

/** 风格分组：设置页按此分组展示。 */
export const SUBTITLE_FONT_CATEGORIES = ["calligraphy", "modern", "custom"] as const;
export type SubtitleFontCategory = (typeof SUBTITLE_FONT_CATEGORIES)[number];

export const SUBTITLE_FONT_CATEGORY_LABELS: Readonly<Record<SubtitleFontCategory, string>> = {
  calligraphy: "书法 · 仙侠武侠",
  modern: "现代 · 正文",
  custom: "自定义",
};

/** 自定义字体 id 形态：custom:<slug>（slug=文件名净化，含中文）。 */
const CUSTOM_FONT_ID_PREFIX = "custom:";
const CUSTOM_SLUG_PATTERN = /^custom:[\w\u4e00-\u9fff][\w\u4e00-\u9fff-]{0,63}$/;

/** 自定义字体的 @font-face 家族名（渲染端与 UI 端按 id 同式推导）。 */
export function customFontFamilyForId(id: string): string {
  return `MYStudioCustom ${id.slice(CUSTOM_FONT_ID_PREFIX.length)}`;
}

/** 由文件名推导自定义字体 id（slug 净化：字母数字中文与连字符）。 */
export function customSubtitleFontIdForFileName(fileName: string): string {
  const base = fileName.replace(/\.(ttf|otf|woff2)$/i, "");
  const slug = base.replace(/[^\w\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "font";
  return `${CUSTOM_FONT_ID_PREFIX}${slug}`;
}

export function isCustomSubtitleFontId(value: unknown): value is string {
  return typeof value === "string" && CUSTOM_SLUG_PATTERN.test(value);
}

/** 自定义字体在设置页的展示名（去扩展名；id 去前缀）。 */
export function customFontLabelForId(id: string): string {
  return id.slice(CUSTOM_FONT_ID_PREFIX.length);
}

export interface SubtitleFontStyle {
  /** 设置页展示名。 */
  label: string;
  /** 设置页一句话适用场景。 */
  description: string;
  category: SubtitleFontCategory;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: string;
  color: string;
  /** 八方向描边厚度(px)；书法单字重笔画细的字体（草书）收敛防糊。 */
  outlinePx: number;
}

export const SUBTITLE_FONT_STYLES: Readonly<Record<SubtitleFontId, SubtitleFontStyle>> = {
  // 马善政毛笔楷书：单字重 400——禁合成加粗（伪粗会糊掉笔锋），粗细交给笔画。
  "ma-shan-zheng": {
    label: "毛笔楷书",
    description: "毛笔楷书，仙侠武侠片题字质感（默认）。",
    category: "calligraphy",
    fontFamily: "'Ma Shan Zheng', 'Kaiti SC', 'STKaiti', 'Noto Sans SC', 'PingFang SC', sans-serif",
    fontSize: 58,
    fontWeight: 400,
    letterSpacing: "0.08em",
    color: "#fdfaf2",
    outlinePx: 3,
  },
  // 志莽行书：连笔行书、笔势开张——对决、快节奏、江湖告示感。
  "zhi-mang-xing": {
    label: "志莽行书",
    description: "连笔行书，江湖侠气——对决与快节奏段落。",
    category: "calligraphy",
    fontFamily: "'Zhi Mang Xing', 'Xingkai SC', 'Kaiti SC', 'Noto Sans SC', 'PingFang SC', sans-serif",
    fontSize: 56,
    fontWeight: 400,
    letterSpacing: "0.06em",
    color: "#fdfaf2",
    outlinePx: 3,
  },
  // 龙藏：手写楷意、字形瘦长飘逸——回忆、书信、旁白独白。
  "long-cang": {
    label: "龙藏",
    description: "手写楷意，飘逸清瘦——回忆、书信、独白。",
    category: "calligraphy",
    fontFamily: "'Long Cang', 'Kaiti SC', 'STKaiti', 'Noto Sans SC', 'PingFang SC', sans-serif",
    fontSize: 58,
    fontWeight: 400,
    letterSpacing: "0.08em",
    color: "#fdfaf2",
    outlinePx: 3,
  },
  // 霞鹜文楷（Regular 400，用户拍板——字幕首要可读）：文楷活字、书卷气，
  // 长句最耐读——仙侠正剧首选。OFL-1.1，包内自带 OFL.txt。
  "lxgw-wenkai": {
    label: "霞鹜文楷",
    description: "文楷活字，书卷仙气，长句最耐读——正剧首选。",
    category: "calligraphy",
    fontFamily: "'LXGW WenKai', 'Kaiti SC', 'Songti SC', 'Noto Serif SC', 'PingFang SC', sans-serif",
    fontSize: 56,
    fontWeight: 400,
    letterSpacing: "0.06em",
    color: "#fdfaf2",
    outlinePx: 3,
  },
  // 柳建毛草：狂草几乎不可快速阅读（用户拍板入册，限题字场景）——
  // 片头题字/章名单帧大字；做正文字幕有阅读风险，描边收敛防糊。
  "liu-jian-mao-cao": {
    label: "柳建毛草",
    description: "狂草题字风，仅建议片头题字/章名大字场景。",
    category: "calligraphy",
    fontFamily: "'Liu Jian Mao Cao', 'Xingkai SC', 'Kaiti SC', 'Noto Sans SC', 'PingFang SC', sans-serif",
    fontSize: 56,
    fontWeight: 400,
    letterSpacing: "0.1em",
    color: "#fdfaf2",
    outlinePx: 2,
  },
  "noto-serif-sc": {
    label: "思源宋体",
    description: "思源宋体，端正典雅的书卷气。",
    category: "modern",
    fontFamily: "'Noto Serif SC', 'Songti SC', 'Noto Sans SC', 'PingFang SC', sans-serif",
    fontSize: 54,
    fontWeight: 900,
    letterSpacing: "0.04em",
    color: "#ffffff",
    outlinePx: 3,
  },
  "noto-sans-sc": {
    label: "思源黑体",
    description: "思源黑体，现代干净的阅读体。",
    category: "modern",
    fontFamily: "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', sans-serif",
    fontSize: 54,
    fontWeight: 900,
    letterSpacing: "0.02em",
    color: "#ffffff",
    outlinePx: 3,
  },
};

export function isSubtitleFontId(value: unknown): value is SubtitleFontId {
  return typeof value === "string" && (SUBTITLE_FONT_IDS as readonly string[]).includes(value);
}

/** 全量 id 校验：静态白名单 + 自定义字体 id 形态（持久化边界两侧共用）。 */
export function isKnownSubtitleFontId(value: unknown): value is string {
  return isSubtitleFontId(value) || isCustomSubtitleFontId(value);
}

/** 未知/缺省 id 一律回落默认字体（fail-open 到默认值，缺字不缺字幕）；
 * 自定义 id（custom:*)解析为单字重书法类样式，字体家族由渲染端注入。 */
export function resolveSubtitleFontStyle(fontId: string | undefined): SubtitleFontStyle {
  if (isSubtitleFontId(fontId)) return SUBTITLE_FONT_STYLES[fontId];
  if (isCustomSubtitleFontId(fontId)) {
    return {
      label: customFontLabelForId(fontId),
      description: "自定义导入字体。",
      category: "custom",
      fontFamily: `'${customFontFamilyForId(fontId)}', 'Kaiti SC', 'Noto Sans SC', 'PingFang SC', sans-serif`,
      fontSize: 56,
      fontWeight: 400,
      letterSpacing: "0.06em",
      color: "#fdfaf2",
      outlinePx: 3,
    };
  }
  return SUBTITLE_FONT_STYLES[DEFAULT_SUBTITLE_FONT_ID];
}

/**
 * 八方向硬描边 + 底部投影（比 -webkit-text-stroke 稳：描边不侵蚀笔画
 * 内侧）。px 为描边厚度；烧录用注册表 outlinePx，设置页样张按字号缩放取小值。
 */
export function subtitleTextShadow(px: number): string {
  return [
    ...[-1, 0, 1].flatMap((y) => [-1, 0, 1].map((x) => (x === 0 && y === 0 ? null : `${x * px}px ${y * px}px 0 rgba(0, 0, 0, 0.95)`))),
    `0 ${px * 2}px ${px * 4.7}px rgba(0, 0, 0, 0.7)`,
  ].filter(Boolean).join(", ");
}
