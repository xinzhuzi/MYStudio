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

export const REQUIRED_DIRECTOR_PLAN_SECTIONS = [
  "① 主题立意与叙事核心",
  "② 视觉风格与画面基调",
  "③ 叙事结构与节奏规划",
  "④ 分场景情绪与画面意图",
  "⑤ 声音方向",
  "⑥ 转场与视觉连续性",
] as const;

const MIN_DIRECTOR_PLAN_CHARS = 1000;
const MIN_DIRECTOR_PLAN_CHINESE_CHARS = 450;
const MIN_SCENE_INTENT_CHINESE_CHARS = 220;
const MIN_SOUND_OR_TRANSITION_CHINESE_CHARS = 40;

export interface DirectorPlanAuditMetrics {
  hasScriptPlanWrapper: boolean;
  chars: number;
  chineseChars: number;
  h2Sections: number;
  bulletCount: number;
  sceneSections: number;
  structuredSceneIntents: number;
  completeSceneIntents: number;
  legacyThreeBlockHeadings: string[];
  requiredSectionsPresent: Record<(typeof REQUIRED_DIRECTOR_PLAN_SECTIONS)[number], boolean>;
  sectionChineseChars: Partial<Record<SectionMarker, number>>;
}

export interface DirectorPlanAuditResult {
  passed: boolean;
  issues: string[];
  metrics: DirectorPlanAuditMetrics;
}

export interface DirectorPlanAuditSummary {
  passed: boolean;
  issueCodes: string[];
  issueCount: number;
  metrics: Pick<
    DirectorPlanAuditMetrics,
    | "hasScriptPlanWrapper"
    | "chars"
    | "chineseChars"
    | "h2Sections"
    | "sceneSections"
    | "structuredSceneIntents"
    | "completeSceneIntents"
    | "legacyThreeBlockHeadings"
  > & {
    missingRequiredSections: string[];
  };
}

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

export function buildDirectorPlanRepairUserMessage(input: {
  originalUserContent: string;
  invalidOutput: string;
  issues: string[];
}): string {
  return [
    input.originalUserContent,
    "",
    "【结构修复任务】",
    "上一次导演规划未通过结构审计。请只基于同一份剧本重写完整导演规划，不新增剧情事实，不输出解释。",
    "必须完整输出一个 <scriptPlan>...</scriptPlan>，内部必须使用以下六个二级标题：",
    ...REQUIRED_DIRECTOR_PLAN_SECTIONS.map((section) => `## ${section}`),
    "第④段必须按 ### Sc ... 逐场展开，每场至少包含：情绪目标、氛围方向、镜头意图、空间叙事、连续性锚点或距离感设计。",
    "第⑤段必须写逐场声音方向；第⑥段必须写转场与视觉连续性锚点。",
    "",
    "未通过审计的问题：",
    ...input.issues.map((issue) => `- ${issue}`),
    "",
    "上一次不合格输出如下，只用于修复结构，不要照抄其缺陷：",
    input.invalidOutput,
  ].join("\n");
}

export function auditDirectorPlanStructure(output: string): DirectorPlanAuditResult {
  const hasScriptPlanWrapper = /<scriptPlan>[\s\S]*?<\/scriptPlan>/.test(output);
  const body = extractScriptPlanSegments(output);
  const sections = splitSections(body);
  const issues: string[] = [];
  const legacyThreeBlockHeadings = detectLegacyThreeBlockHeadings(body);
  const requiredSectionsPresent = Object.fromEntries(
    REQUIRED_DIRECTOR_PLAN_SECTIONS.map((section) => [
      section,
      new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, "m").test(body),
    ]),
  ) as DirectorPlanAuditMetrics["requiredSectionsPresent"];
  const sceneSectionMatches = [...body.matchAll(/^###\s+Sc\s*\d+(?:-\d+)?[^\n]*$/gm)];
  const sceneIntents = parseLegacySceneIntents(sections["④"] ?? "");
  const completeSceneIntents = sceneIntents.filter(
    (item) => item.sceneId && item.emotion && item.shotIntent && item.spatial,
  );
  const sectionChineseChars: DirectorPlanAuditMetrics["sectionChineseChars"] = {};
  for (const marker of SECTION_MARKERS) {
    if (sections[marker]) sectionChineseChars[marker] = chineseCharCount(sections[marker]);
  }

  const metrics: DirectorPlanAuditMetrics = {
    hasScriptPlanWrapper,
    chars: body.length,
    chineseChars: chineseCharCount(body),
    h2Sections: (body.match(/^##\s+[①②③④⑤⑥]/gm) ?? []).length,
    bulletCount: (body.match(/^\s*-\s+/gm) ?? []).length,
    sceneSections: sceneSectionMatches.length,
    structuredSceneIntents: sceneIntents.length,
    completeSceneIntents: completeSceneIntents.length,
    legacyThreeBlockHeadings,
    requiredSectionsPresent,
    sectionChineseChars,
  };

  if (!hasScriptPlanWrapper) issues.push("缺少完整 <scriptPlan>...</scriptPlan> 包裹");
  if (metrics.chars < MIN_DIRECTOR_PLAN_CHARS) {
    issues.push(`导演规划正文过短：${metrics.chars}/${MIN_DIRECTOR_PLAN_CHARS}`);
  }
  if (metrics.chineseChars < MIN_DIRECTOR_PLAN_CHINESE_CHARS) {
    issues.push(`导演规划中文有效字数过少：${metrics.chineseChars}/${MIN_DIRECTOR_PLAN_CHINESE_CHARS}`);
  }

  const missingSections = REQUIRED_DIRECTOR_PLAN_SECTIONS.filter(
    (section) => !requiredSectionsPresent[section],
  );
  if (missingSections.length) {
    issues.push(`缺少固定二级标题：${missingSections.join("、")}`);
  }
  if (legacyThreeBlockHeadings.length && missingSections.length) {
    issues.push(`检测到旧三段导演规划格式：${legacyThreeBlockHeadings.join("、")}`);
  }

  if (!sections["④"]?.trim()) {
    issues.push("第④段“分场景情绪与画面意图”为空");
  } else if ((sectionChineseChars["④"] ?? 0) < MIN_SCENE_INTENT_CHINESE_CHARS) {
    issues.push(`第④段逐场细化不足：${sectionChineseChars["④"] ?? 0}/${MIN_SCENE_INTENT_CHINESE_CHARS}`);
  }
  if (metrics.sceneSections < 1) {
    issues.push("第④段缺少 ### Sc ... 逐场小节");
  }
  if (metrics.sceneSections > 0 && metrics.completeSceneIntents < metrics.sceneSections) {
    issues.push(`逐场意图字段不完整：${metrics.completeSceneIntents}/${metrics.sceneSections}`);
  }

  for (const marker of ["⑤", "⑥"] as const) {
    if (!sections[marker]?.trim()) {
      issues.push(`第${marker}段为空`);
    } else if ((sectionChineseChars[marker] ?? 0) < MIN_SOUND_OR_TRANSITION_CHINESE_CHARS) {
      issues.push(`第${marker}段内容过短：${sectionChineseChars[marker] ?? 0}/${MIN_SOUND_OR_TRANSITION_CHINESE_CHARS}`);
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    metrics,
  };
}

export function summarizeDirectorPlanAudit(audit: DirectorPlanAuditResult): DirectorPlanAuditSummary {
  return {
    passed: audit.passed,
    issueCodes: audit.issues.map(toDirectorPlanIssueCode),
    issueCount: audit.issues.length,
    metrics: {
      hasScriptPlanWrapper: audit.metrics.hasScriptPlanWrapper,
      chars: audit.metrics.chars,
      chineseChars: audit.metrics.chineseChars,
      h2Sections: audit.metrics.h2Sections,
      sceneSections: audit.metrics.sceneSections,
      structuredSceneIntents: audit.metrics.structuredSceneIntents,
      completeSceneIntents: audit.metrics.completeSceneIntents,
      legacyThreeBlockHeadings: audit.metrics.legacyThreeBlockHeadings,
      missingRequiredSections: REQUIRED_DIRECTOR_PLAN_SECTIONS.filter(
        (section) => !audit.metrics.requiredSectionsPresent[section],
      ),
    },
  };
}

export function formatDirectorPlanAuditError(audit: DirectorPlanAuditResult): string {
  return `导演规划结构不合格：${audit.issues.slice(0, 4).join("；")}`;
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
    sceneIntents: parseLegacySceneIntents(sceneIntentRaw),
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
  const sceneNotes = extractToonflowSection(body, "逐场注意事项", ["场间过渡", "衍生资产"]);
  const transitions = extractToonflowSection(body, "场间过渡", ["衍生资产"]);
  const derivedAssetSection = extractToonflowDerivedAssetSection(body);

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
      derivedAssetPlan: parseDerivedAssetTable(derivedAssetSection),
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

function extractToonflowDerivedAssetSection(body: string): string {
  const titles = ["衍生资产预划清单", "衍生资产", "derive assets", "derived assets"];
  const starts = titles
    .map((title) => {
      const index = body.toLowerCase().indexOf(title.toLowerCase());
      return index >= 0 ? index : null;
    })
    .filter((index): index is number => index !== null);
  if (!starts.length) return "";

  const start = Math.min(...starts);
  const rest = body.slice(start);
  const nextHeading = rest.slice(1).search(/\n#{1,6}\s+\S/);
  return (nextHeading >= 0 ? rest.slice(0, nextHeading + 1) : rest).trim();
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

function parseLegacySceneIntents(section: string): ScriptPlan["sceneIntents"] {
  return splitLegacySceneBlocks(section)
    .map(({ sceneId, body }) => {
      const emotionTarget = extractLegacySceneField(body, ["情绪目标"]);
      const atmosphere = extractLegacySceneField(body, ["氛围方向"]);
      const shotIntent = extractLegacySceneField(body, ["镜头意图"]);
      const spatial = [
        extractLegacySceneField(body, ["空间叙事"]),
        extractLegacySceneField(body, ["距离感设计"]),
        extractLegacySceneField(body, ["连续性锚点"]),
      ].filter(Boolean).join("；");

      return {
        sceneId,
        emotion: [emotionTarget, atmosphere].filter(Boolean).join("；"),
        shotIntent,
        spatial,
      };
    })
    .filter((item) => item.sceneId && (item.emotion || item.shotIntent || item.spatial));
}

function splitLegacySceneBlocks(section: string): Array<{ sceneId: string; body: string }> {
  const blocks: Array<{ sceneId: string; body: string[] }> = [];
  let current: { sceneId: string; body: string[] } | null = null;

  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^###\s+(Sc\s*\d+(?:-\d+)?)\b/);
    if (match) {
      current = { sceneId: match[1]!, body: [] };
      blocks.push(current);
      continue;
    }
    current?.body.push(line);
  }

  return blocks.map((block) => ({
    sceneId: block.sceneId,
    body: block.body.join("\n"),
  }));
}

function extractLegacySceneField(body: string, labels: string[]): string {
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    const match = line.match(/^-\s+\*\*([^*]+)\*\*[：:]\s*(.*)$/);
    if (!match) continue;

    const label = match[1]!.trim();
    if (!labels.includes(label)) continue;

    const values = [match[2]!.trim()].filter(Boolean);
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = lines[cursor]!.trim();
      if (!next) continue;
      if (/^-\s+\*\*[^*]+\*\*[：:]/.test(next) || /^###\s+Sc\s*\d+(?:-\d+)?\b/.test(next)) break;
      values.push(next.replace(/^-\s+/, "").trim());
    }
    return stripLightingTerms(values.join("；"));
  }
  return "";
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
  let header: string[] | null = null;
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    if (isSeparatorRow(line) || isDerivedHeaderRow(line)) continue;

    const fields = line.slice(1, -1).split("|").map((item) => item.trim());
    if (isDerivedHeaderFields(fields)) {
      header = fields.map(normalizeDerivedHeader);
      continue;
    }

    const item = header ? parseDerivedAssetRowByHeader(fields, header) : parseLegacyDerivedAssetRow(fields);
    if (item) rows.push(item);
  }
  return rows;
}

function parseLegacyDerivedAssetRow(fields: string[]): ScriptPlan["derivedAssetPlan"][number] | null {
  if (fields.length !== 3) return null;
  const [parentAssetId, state, reason] = fields;
  if (!parentAssetId || !state) return null;
  return { parentAssetId, state, reason: reason ?? "" };
}

function parseDerivedAssetRowByHeader(
  fields: string[],
  header: string[],
): ScriptPlan["derivedAssetPlan"][number] | null {
  const value = (key: string) => fields[header.indexOf(key)]?.trim() ?? "";
  const assetName = value("assetName") || value("parentAssetId") || value("parent");
  const assetsId = parseOptionalNumber(value("assetsId"));
  const parentAssetId = assetName || (assetsId == null ? "" : String(assetsId));
  const state = value("deriveName") || value("state");
  const reason = value("reason") || value("desc") || value("prompt");
  if (!parentAssetId || !state) return null;

  return {
    parentAssetId,
    state,
    reason,
    ...(assetsId == null ? {} : { toonflowAssetsId: assetsId }),
    ...optionalNumberField("toonflowDerivedAssetId", value("id")),
    ...(value("flowId") ? { imageWorkflowId: value("flowId") } : {}),
  };
}

function optionalNumberField<K extends string>(key: K, value: string): Partial<Record<K, number>> {
  const numeric = parseOptionalNumber(value);
  return numeric == null ? {} : { [key]: numeric } as Partial<Record<K, number>>;
}

function parseOptionalNumber(value: string) {
  if (!value) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function isDerivedHeaderFields(fields: string[]) {
  const normalized = fields.map(normalizeDerivedHeader);
  return normalized.includes("assetsId") || normalized.includes("assetName");
}

function normalizeDerivedHeader(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "assetsid" || normalized === "assets id" || value === "父资产ID") return "assetsId";
  if (normalized === "id" || value === "衍生资产ID") return "id";
  if (normalized === "flowid" || normalized === "flow id") return "flowId";
  if (normalized === "name" || value === "衍生资产名称" || value === "衍生名称") return "deriveName";
  if (normalized === "state" || value === "衍生状态") return "state";
  if (normalized === "desc" || normalized === "describe" || value === "原因/出现段落") return "reason";
  if (normalized === "prompt") return "prompt";
  if (value === "资产名") return "assetName";
  if (normalized === "parentassetid") return "parentAssetId";
  if (normalized === "parent") return "parent";
  return normalized;
}

function isDerivedHeaderRow(line: string): boolean {
  const fields = line.slice(1, -1).split("|").map((item) => item.trim());
  if (isDerivedHeaderFields(fields)) return false;
  const first = fields[0] ?? "";
  return first === "资产名" || first.toLowerCase() === "asset";
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line);
}

function detectLegacyThreeBlockHeadings(body: string): string[] {
  const headings = [
    "分场汇总表",
    "逐场注意事项",
    "场间过渡",
  ];
  return headings.filter((heading) =>
    new RegExp(`^#{1,6}\\s+${escapeRegExp(heading)}(?:[（(][^\\n]*[）)])?\\s*$`, "m").test(body),
  );
}

function toDirectorPlanIssueCode(issue: string): string {
  if (issue.includes("<scriptPlan>")) return "missing_script_plan_wrapper";
  if (issue.includes("正文过短")) return "body_too_short";
  if (issue.includes("中文有效字数过少")) return "chinese_chars_too_low";
  if (issue.includes("缺少固定二级标题")) return "missing_required_sections";
  if (issue.includes("旧三段导演规划格式")) return "legacy_three_block_format";
  if (issue.includes("第④段") && issue.includes("为空")) return "scene_intent_section_empty";
  if (issue.includes("第④段") && issue.includes("细化不足")) return "scene_intent_section_too_short";
  if (issue.includes("缺少 ### Sc")) return "missing_scene_subsections";
  if (issue.includes("逐场意图字段不完整")) return "incomplete_scene_intents";
  if (issue.includes("第⑤段")) return "sound_section_invalid";
  if (issue.includes("第⑥段")) return "transition_section_invalid";
  return "unknown";
}

function chineseCharCount(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}
