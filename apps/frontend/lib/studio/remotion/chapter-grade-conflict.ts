/**
 * 钉死成片调色卡的冷暖冲突检测(08-28 两套色彩系统衔接)。
 *
 * 两套色彩系统:生图配色盘(42 色 palette-canon/12 阵营,管画面内容色)与
 * 成片调色卡(32 张 cn-* LUT,管渲染期整体气氛)。用户裁定分离合理,但钉死
 * chapterGrade 时若 LUT 温感与本章主导阵营盘温感反向,会像素级压掉生图配色
 * (08-28 水墨无色根修的万劫圣宗盘全灰同型风险)。本模块只做确定性判定与
 * 提示文案,非阻塞——换卡与否由用户拍板。
 */

import { getCinematicLut } from "./cinematic-luts";
import { chapterFactionTemperature, type PaletteTemperature } from "@/lib/studio/storyboard-frame-prompt";

/** 冲突详情(temperature 均非 neutral,方向相反)。 */
export interface ChapterGradeTemperatureConflict {
  /** 本章主导阵营名(逐镜 associateAssetsNames 命中阵营的众数) */
  faction: string;
  factionTemperature: Exclude<PaletteTemperature, "neutral">;
  /** 主导阵营盘的主色/点睛色名(去重,提示文案用) */
  factionColorNames: string[];
  lutId: string;
  /** 调色卡中文名(description 冒号前) */
  lutName: string;
  lutTemperature: Exclude<PaletteTemperature, "neutral">;
  /** 非阻塞提示全文(UI 直接渲染) */
  message: string;
}

const TEMPERATURE_LABEL: Record<Exclude<PaletteTemperature, "neutral">, string> = {
  warm: "暖",
  cool: "冷",
};

/** 取阵营盘 person+scene 的 主色/点睛 色名(去重,至多 3 个)。 */
function extractAccentColorNames(combo: { person: string; scene: string }): string[] {
  const names: string[] = [];
  for (const text of [combo.person, combo.scene]) {
    for (const match of text.matchAll(/(?:主色|点睛)([^+;；]+)/g)) {
      const name = match[1]!.trim();
      if (name && !names.includes(name)) names.push(name);
      if (names.length >= 3) return names;
    }
  }
  return names;
}

/**
 * 钉死 LUT 与本章主导阵营盘温感反向时返回冲突详情,否则 undefined
 * (未钉死/卡未标温感(film-* legacy)/neutral 卡/阵营盘 neutral/数据未预热
 * 一律不打扰——fail-safe,永不误报)。
 */
export function detectChapterGradeTemperatureConflict(
  pinnedLutId: string | undefined,
  shots: Array<{ associateAssetsNames?: string[] }>,
  faction: {
    members: Record<string, string>;
    palette: Record<string, { person: string; scene: string; prop?: string }>;
  },
): ChapterGradeTemperatureConflict | undefined {
  if (!pinnedLutId) return undefined;
  const lut = getCinematicLut(pinnedLutId);
  const lutTemperature = lut?.temperature;
  if (!lut || !lutTemperature || lutTemperature === "neutral") return undefined;
  const chapter = chapterFactionTemperature(shots, faction);
  if (!chapter.faction || chapter.temperature === "neutral") return undefined;
  if (chapter.temperature === lutTemperature) return undefined;
  // chapterFactionTemperature 返回 faction 即保证 combo 存在;此处再守卫一次,
  // 避免非空断言耦合上游不变量(未来重构 chapterFactionTemperature 不致静默炸这里)。
  const combo = faction.palette[chapter.faction];
  if (!combo) return undefined;
  const colorNames = extractAccentColorNames({ person: combo.person, scene: combo.scene });
  const message =
    `本章画面主色偏${TEMPERATURE_LABEL[chapter.temperature]}` +
    `（${chapter.faction}·${colorNames.join("/")}），` +
    `所选成片调色卡偏${TEMPERATURE_LABEL[lutTemperature]}（${lut.description.split(":")[0]?.trim() ?? pinnedLutId}），` +
    `可能压色——建议换${TEMPERATURE_LABEL[chapter.temperature]}调卡或调低强度`;
  return {
    faction: chapter.faction,
    factionTemperature: chapter.temperature,
    factionColorNames: colorNames,
    lutId: pinnedLutId,
    lutName: lut.description.split(":")[0]?.trim() ?? pinnedLutId,
    lutTemperature,
    message,
  };
}
