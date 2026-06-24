import { getAgentSkillPreset } from "@/lib/studio/manuals";
import type { ScriptPlan } from "@/types/studio";

export interface BuildDirectorPlanInput {
  episodeId: string;
  scriptText: string;
  /** 已选视觉/导演手册摘要（buildStudioManualContext 产出），作为风格基准注入 */
  manualContext?: string;
}

export interface DirectorPlanMessages {
  system: string;
  user: string;
}

export interface ParseDirectorPlanResult {
  plan: ScriptPlan;
  warnings: string[];
}

/**
 * §2.4 光影分离铁律：导演规划/分镜/提示词层均不得显式描述光影方向、色温、明暗、色调。
 * 这些词命中后从流向生图的字段中剔除，并产生 warning 供 UI 提示。
 */
const LIGHTING_TERMS = [
  "暖光",
  "冷光",
  "逆光",
  "顺光",
  "侧光",
  "顶光",
  "底光",
  "背光",
  "柔光",
  "硬光",
  "色温",
  "明暗",
  "色调",
  "高光",
  "阴影",
  "光影",
  "光线",
  "光束",
  "光晕",
  "曝光",
  "亮度",
  "黑暗",
] as const;

const NO_DERIVE_MARKERS = ["无需衍生", "不需要衍生", "无衍生"];

export function detectLightingTerms(text: string): string[] {
  const found = new Set<string>();
  for (const term of LIGHTING_TERMS) {
    if (text.includes(term)) found.add(term);
  }
  return [...found];
}

export function stripLightingTerms(text: string): string {
  let result = text;
  for (const term of LIGHTING_TERMS) {
    result = result.split(term).join("");
  }
  // 清理因剔除产生的连续标点/空白
  return result.replace(/[，、,]{2,}/g, "，").replace(/\s{2,}/g, " ").trim();
}

export function buildDirectorPlanMessages(input: BuildDirectorPlanInput): DirectorPlanMessages {
  const skill = getAgentSkillPreset("production_execution_director_plan")?.content ?? "";
  return {
    system: [skill, input.manualContext].filter(Boolean).join("\n\n---\n\n"),
    user: [
      `当前集ID：${input.episodeId}`,
      "剧本正文：",
      input.scriptText,
    ].join("\n"),
  };
}

export function parseDirectorPlan(output: string, episodeId: string): ParseDirectorPlanResult {
  const body = extractScriptPlanSegments(output);
  if (!hasLegacySections(body) && isToonflowScriptPlan(body)) {
    return parseToonflowDirectorPlan(body, episodeId);
  }

  const sections = splitSections(body);
  const warnings: string[] = [];

  const visualRaw = sections["②"] ?? "";
  const visualLighting = detectLightingTerms(visualRaw);
  if (visualLighting.length) {
    warnings.push(`视觉风格含光影词，已剔除：${visualLighting.join("、")}`);
  }

  const sceneIntentRaw = sections["④"] ?? "";
  const sceneLighting = detectLightingTerms(sceneIntentRaw);
  if (sceneLighting.length) {
    warnings.push(`分场景意图含光影词，已剔除：${sceneLighting.join("、")}`);
  }

  const derivedAssetPlan = parseDerivedAssetTable(sections["⑦"] ?? "");

  const plan: ScriptPlan = {
    id: `script-plan-${episodeId}-${Date.now()}`,
    episodeId,
    theme: clean(sections["①"]),
    visualStyle: stripLightingTerms(visualRaw),
    narrativeRhythm: clean(sections["③"]),
    sceneIntents: [],
    soundDirection: clean(sections["⑤"]),
    transitions: clean(sections["⑥"]),
    derivedAssetPlan,
  };

  return { plan, warnings };
}

function hasLegacySections(body: string): boolean {
  return SECTION_MARKERS.some((marker) => body.includes(marker));
}

function isToonflowScriptPlan(body: string): boolean {
  return body.includes("分场汇总表") || body.includes("逐场注意事项") || body.includes("场间过渡");
}

function parseToonflowDirectorPlan(body: string, episodeId: string): ParseDirectorPlanResult {
  const warnings: string[] = [];
  const sceneSummary = extractToonflowSection(body, "分场汇总表", ["逐场注意事项", "场间过渡"]);
  const sceneNotes = extractToonflowSection(body, "逐场注意事项", ["场间过渡"]);
  const transitions = extractToonflowSection(body, "场间过渡", []);

  for (const [label, text] of [
    ["分场汇总表", sceneSummary],
    ["逐场注意事项", sceneNotes],
    ["场间过渡", transitions],
  ] as const) {
    const hits = detectLightingTerms(text);
    if (hits.length) warnings.push(`${label}含光影词，已剔除：${hits.join("、")}`);
  }

  return {
    plan: {
      id: `script-plan-${episodeId}-${Date.now()}`,
      episodeId,
      theme: stripLightingTerms(sceneSummary),
      visualStyle: "",
      narrativeRhythm: stripLightingTerms(sceneNotes),
      sceneIntents: parseToonflowSceneIntents(sceneSummary),
      soundDirection: extractEnvironmentSounds(sceneNotes),
      transitions: stripLightingTerms(transitions),
      derivedAssetPlan: [],
    },
    warnings,
  };
}

function extractToonflowSection(body: string, title: string, stopTitles: string[]): string {
  const start = body.indexOf(title);
  if (start < 0) return "";
  const rest = body.slice(start);
  const stopIndexes = stopTitles
    .map((stop) => rest.indexOf(stop))
    .filter((index) => index > 0);
  const end = stopIndexes.length ? Math.min(...stopIndexes) : rest.length;
  return rest.slice(0, end).trim();
}

function parseToonflowSceneIntents(section: string): ScriptPlan["sceneIntents"] {
  const rows: ScriptPlan["sceneIntents"] = [];
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    if (isSeparatorRow(line) || line.includes("场次 | 场景名")) continue;
    const fields = line.slice(1, -1).split("|").map((item) => item.trim());
    if (fields.length < 6) continue;
    rows.push({
      sceneId: fields[0]!,
      emotion: fields[5]!,
      shotIntent: fields[1]!,
      spatial: "",
    });
  }
  return rows;
}

function extractEnvironmentSounds(section: string): string {
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("环境音"))
    .join("\n");
}

/** 取出所有 <scriptPlan>…</scriptPlan> 段并按出现顺序拼接；若无标签则回退整段。 */
function extractScriptPlanSegments(output: string): string {
  const matches = [...output.matchAll(/<scriptPlan>([\s\S]*?)<\/scriptPlan>/g)].map((m) => m[1]!.trim());
  if (matches.length) return matches.join("\n");
  return output.trim();
}

const SECTION_MARKERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦"] as const;
type SectionMarker = (typeof SECTION_MARKERS)[number];

/** 按 ①–⑦ 圈号标题切分正文，返回每个圈号对应的正文块（不含标题行）。 */
function splitSections(body: string): Partial<Record<SectionMarker, string>> {
  const lines = body.split(/\r?\n/);
  const result: Partial<Record<SectionMarker, string>> = {};
  let current: SectionMarker | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) {
      result[current] = (result[current] ? `${result[current]}\n` : "") + buffer.join("\n").trim();
    }
    buffer = [];
  };

  for (const line of lines) {
    const marker = SECTION_MARKERS.find((m) => line.includes(m) && /^#{0,6}\s*[①②③④⑤⑥⑦]/.test(line.trim()));
    if (marker) {
      flush();
      current = marker;
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return result;
}

/** ⑦ 表格 → derivedAssetPlan；每行 3 列 `资产名 | 衍生状态 | 原因/出现段落`，跳过表头/分隔/非法行。 */
function parseDerivedAssetTable(section: string): ScriptPlan["derivedAssetPlan"] {
  if (NO_DERIVE_MARKERS.some((marker) => section.includes(marker))) return [];

  const rows: ScriptPlan["derivedAssetPlan"] = [];
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    if (isSeparatorRow(line) || isDerivedHeaderRow(line)) continue;

    const fields = line.slice(1, -1).split("|").map((item) => item.trim());
    if (fields.length !== 3) continue;
    const [parentAssetId, state, reason] = fields;
    if (!parentAssetId || !state) continue;

    rows.push({ parentAssetId, state, reason: reason ?? "" });
  }
  return rows;
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line);
}

function isDerivedHeaderRow(line: string): boolean {
  const first = line.slice(1).split("|")[0]?.trim() ?? "";
  return first === "资产名" || first.toLowerCase() === "asset";
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}
