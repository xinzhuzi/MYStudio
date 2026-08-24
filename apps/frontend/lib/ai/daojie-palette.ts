/**
 * 道劫 ma-gongbi-palette-v1 色彩代码体系(MA ma-imagegen 权威镜像)。
 *
 * 数据源:ma_sync/palette-canon.json,由 MA scripts/data/三轨选色配料.toml(42 色卡+24 方案)
 * 与 阵营配色与黄金公式.toml(12 阵营×3 轨)生成,来源 SHA 已登记 lock-anchors/runtime-contract,
 * 由 daojie-ma-sync-check.py 守护。配方模块文本与 MA gongbi_contract._palette_module 逐字同构。
 */
import canonJson from "../../assets/studio-manuals/art_skills/daojie_ink_guofeng/ma_sync/palette-canon.json";
import type { DaojieMaTrack, DaojieRuntimeTrack } from "./daojie-prompt-contract";

export interface DaojiePaletteColor {
  colorId: string;
  groupId: string;
  name: string;
  hex: string;
  mediumRole: string;
  suitable: string;
  forbidden: string;
}

export interface DaojiePaletteScheme {
  schemeId: string;
  track: DaojieMaTrack;
  name: string;
  roles: Record<"base" | "ink" | "primary" | "secondary" | "accent", string>;
  parts: Record<"base" | "ink" | "primary" | "secondary" | "accent", number>;
  suitable: string;
  forbidden: string;
}

export interface DaojieFactionTrackRecipe {
  roles: Partial<Record<"base" | "ink" | "primary" | "secondary" | "accent", string>>;
  parts: Record<string, number>;
  suitable: string;
  forbidden: string;
}

export interface DaojieFaction {
  alignment: string;
  composition: string;
  imagery: string;
  tracks: { person: DaojieFactionTrackRecipe; scene: DaojieFactionTrackRecipe; prop: DaojieFactionTrackRecipe };
}

export interface DaojiePaletteCanon {
  canonVersion: "ma-gongbi-palette-v1";
  sources: Array<{ path: string; sha256: string; responsibility: string }>;
  roleOrder: ["base", "ink", "primary", "secondary", "accent"];
  colorGroups: Array<{ groupId: string; name: string }>;
  colors: DaojiePaletteColor[];
  schemes: DaojiePaletteScheme[];
  factions: Record<string, DaojieFaction>;
}

const ROLE_ORDER = ["base", "ink", "primary", "secondary", "accent"] as const;
type PaletteRole = (typeof ROLE_ORDER)[number];
const ROLE_LABELS: Record<PaletteRole, string> = {
  base: "底色",
  ink: "墨线",
  primary: "主色",
  secondary: "辅色",
  accent: "点睛色",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/** 校验色卡正典;缺字段/数量不符 fail-closed,不回退硬编码。 */
export function validateDaojiePaletteCanon(value: unknown): DaojiePaletteCanon {
  if (!isRecord(value) || value.canonVersion !== "ma-gongbi-palette-v1") {
    throw new Error("daojie palette canon: canonVersion");
  }
  if (!Array.isArray(value.sources) || value.sources.length < 2
    || !value.sources.every((s) => isRecord(s) && typeof s.path === "string" && isSha256(s.sha256))) {
    throw new Error("daojie palette canon: sources");
  }
  if (JSON.stringify(value.roleOrder) !== JSON.stringify(ROLE_ORDER)) {
    throw new Error("daojie palette canon: roleOrder");
  }
  if (!Array.isArray(value.colors) || value.colors.length !== 42
    || !value.colors.every((c) => isRecord(c) && typeof c.colorId === "string" && typeof c.name === "string" && /^#[0-9A-Fa-f]{6}$/.test(String(c.hex)))) {
    throw new Error("daojie palette canon: colors(42)");
  }
  if (!Array.isArray(value.schemes) || value.schemes.length !== 24
    || !value.schemes.every((s) => isRecord(s)
      && typeof s.schemeId === "string"
      && ["person", "scene", "prop"].includes(String(s.track))
      && ROLE_ORDER.every((role) => typeof s.roles?.[role] === "string"))) {
    throw new Error("daojie palette canon: schemes(24)");
  }
  if (!isRecord(value.factions) || Object.keys(value.factions).length !== 12
    || !Object.values(value.factions).every((f) => isRecord(f) && isRecord(f.tracks)
      && ["person", "scene", "prop"].every((track) => isRecord((f.tracks as Record<string, unknown>)[track])))) {
    throw new Error("daojie palette canon: factions(12×3 tracks)");
  }
  return value as unknown as DaojiePaletteCanon;
}

export const DAOJIE_PALETTE_CANON = validateDaojiePaletteCanon(canonJson);

const colorsById = new Map(DAOJIE_PALETTE_CANON.colors.map((color) => [color.colorId, color]));
const schemesById = new Map(DAOJIE_PALETTE_CANON.schemes.map((scheme) => [scheme.schemeId, scheme]));

export function getDaojiePaletteScheme(schemeId: string): DaojiePaletteScheme | undefined {
  return schemesById.get(schemeId);
}

/**
 * 解析方案并校验轨道(MA _resolve_palette_roles 语义):
 * 未知方案/跨轨使用一律 fail-closed,不静默回落。
 */
export function resolveDaojiePaletteScheme(schemeId: string, maTrack: DaojieMaTrack): DaojiePaletteScheme {
  const scheme = schemesById.get(schemeId);
  if (!scheme) {
    throw new Error(`daojie palette scheme is unknown: ${schemeId}`);
  }
  if (scheme.track !== maTrack) {
    throw new Error(`daojie palette scheme crosses tracks: ${schemeId} belongs to ${scheme.track}, contract is ${maTrack}`);
  }
  return scheme;
}

/**
 * 配方模块文本,与 MA _palette_module 方案分支逐字同构:
 * 「配料方案（{名}）：底色用X；墨线用Y；主色用Z；辅色用W；点睛色用V。职责色服从 Source facts，不覆盖已核验的主体颜色与材质事实。」
 */
export function buildDaojiePaletteModuleText(scheme: DaojiePaletteScheme): string {
  const parts: string[] = [];
  for (const role of ROLE_ORDER) {
    const color = colorsById.get(scheme.roles[role]);
    parts.push(color ? `${ROLE_LABELS[role]}用${color.name}` : `不额外启用${ROLE_LABELS[role]}`);
  }
  return `配料方案（${scheme.name}）：${parts.join("；")}。职责色服从 Source facts，不覆盖已核验的主体颜色与材质事实。`;
}

/** 方案 → 编译器模块标识(MA 同款 palette.<scheme_id>)。 */
export function daojiePaletteModuleId(scheme: DaojiePaletteScheme): string {
  return `palette.${scheme.schemeId}`;
}

/** 规则预筛:方案 suitable 关键词与资产名称/描述的重合计分(降序;0 分不推荐)。 */
export function prefilterDaojiePaletteSchemes(input: {
  runtimeTrack: DaojieRuntimeTrack | DaojieMaTrack;
  name: string;
  description: string;
}): Array<{ scheme: DaojiePaletteScheme; score: number }> {
  const track = input.runtimeTrack === "character" ? "person" : input.runtimeTrack;
  const haystack = `${input.name} ${input.description}`;
  const scored = DAOJIE_PALETTE_CANON.schemes
    .filter((scheme) => scheme.track === track)
    .map((scheme) => {
      const keywords = [...scheme.suitable.split(/[、,，;；\s]+/), ...scheme.name.split(/[、,，;；\s]+/)]
        .filter((keyword) => keyword.length >= 2);
      const score = keywords.reduce(
        (total, keyword) => (keyword && haystack.includes(keyword) ? total + 1 : total),
        0,
      );
      return { scheme, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.scheme.schemeId.localeCompare(b.scheme.schemeId));
  return scored;
}

/** LLM 选配目录:当前轨 8 个方案的紧凑描述(id/名/气质/配方色名/适用/禁止)。 */
export function buildDaojiePaletteSelectionCatalog(maTrack: DaojieMaTrack): string {
  const lines = DAOJIE_PALETTE_CANON.schemes
    .filter((scheme) => scheme.track === maTrack)
    .map((scheme) => {
      const recipe = ROLE_ORDER.map((role) => `${ROLE_LABELS[role]}${colorsById.get(scheme.roles[role])?.name ?? "?"}`).join("+");
      return `- ${scheme.schemeId}「${scheme.name}」配方:${recipe} 适合:${scheme.suitable} 禁止:${scheme.forbidden}`;
    });
  return lines.join("\n");
}

/** 解析 LLM 选配输出;任何不合法(未知 id/跨轨/格式坏)一律返回 null(source-facts-only 兜底),不抛错。 */
export function parseDaojiePaletteSelectionResponse(
  rawText: string,
  maTrack: DaojieMaTrack,
): string | null {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { schemeId?: unknown };
    if (parsed.schemeId === null || parsed.schemeId === undefined) return null;
    if (typeof parsed.schemeId !== "string") return null;
    const scheme = schemesById.get(parsed.schemeId);
    if (!scheme || scheme.track !== maTrack) return null;
    return scheme.schemeId;
  } catch {
    return null;
  }
}
