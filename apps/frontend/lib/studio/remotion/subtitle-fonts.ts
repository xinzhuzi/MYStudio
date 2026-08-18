/**
 * 字幕字体注册表 —— 烧录字幕的字体唯一事实源。
 *
 * 每个候选字体都以 @fontsource unicode-range 子集离线打进固定 bundle
 * （SubtitleTrack 静态 import CSS），渲染期按需加载子集，不依赖网络。
 * 值保持 primitive（字符串 id）：字段跨 editing.json / plan / composition
 * props 的 JSON 持久化边界，白名单校验在 editing validation 与
 * composition-props-validation 两侧各自执行。
 */

export const SUBTITLE_FONT_IDS = ["ma-shan-zheng", "noto-sans-sc", "noto-serif-sc"] as const;

export type SubtitleFontId = (typeof SUBTITLE_FONT_IDS)[number];

/** 源码级默认：毛笔楷书（仙侠武侠片题字质感，用户 08-18 拍板）。 */
export const DEFAULT_SUBTITLE_FONT_ID: SubtitleFontId = "ma-shan-zheng";

export interface SubtitleFontStyle {
  /** 设置页展示名。 */
  label: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: string;
  color: string;
}

export const SUBTITLE_FONT_STYLES: Readonly<Record<SubtitleFontId, SubtitleFontStyle>> = {
  // 马善政毛笔楷书：单字重 400——禁合成加粗（伪粗会糊掉笔锋），粗细交给笔画。
  "ma-shan-zheng": {
    label: "毛笔楷书",
    fontFamily: "'Ma Shan Zheng', 'Kaiti SC', 'STKaiti', 'Noto Sans SC', 'PingFang SC', sans-serif",
    fontSize: 58,
    fontWeight: 400,
    letterSpacing: "0.08em",
    color: "#fdfaf2",
  },
  "noto-sans-sc": {
    label: "思源黑体",
    fontFamily: "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', sans-serif",
    fontSize: 54,
    fontWeight: 900,
    letterSpacing: "0.02em",
    color: "#ffffff",
  },
  "noto-serif-sc": {
    label: "思源宋体",
    fontFamily: "'Noto Serif SC', 'Songti SC', 'Noto Sans SC', 'PingFang SC', sans-serif",
    fontSize: 54,
    fontWeight: 900,
    letterSpacing: "0.04em",
    color: "#ffffff",
  },
};

export function isSubtitleFontId(value: unknown): value is SubtitleFontId {
  return typeof value === "string" && (SUBTITLE_FONT_IDS as readonly string[]).includes(value);
}

/** 未知/缺省 id 一律回落默认字体（fail-open 到默认值，缺字不缺字幕）。 */
export function resolveSubtitleFontStyle(fontId: string | undefined): SubtitleFontStyle {
  const id = isSubtitleFontId(fontId) ? fontId : DEFAULT_SUBTITLE_FONT_ID;
  return SUBTITLE_FONT_STYLES[id];
}

/**
 * 八方向硬描边 + 底部投影（比 -webkit-text-stroke 稳：描边不侵蚀笔画
 * 内侧）。px 为描边厚度；烧录用 3px，设置页样张按字号缩放取小值。
 */
export function subtitleTextShadow(px: number): string {
  return [
    ...[-1, 0, 1].flatMap((y) => [-1, 0, 1].map((x) => (x === 0 && y === 0 ? null : `${x * px}px ${y * px}px 0 rgba(0, 0, 0, 0.95)`))),
    `0 ${px * 2}px ${px * 4.7}px rgba(0, 0, 0, 0.7)`,
  ].filter(Boolean).join(", ");
}
