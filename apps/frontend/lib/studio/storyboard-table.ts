import { getAgentSkillPreset } from "@/lib/studio/manuals";
import { detectLightingTerms, stripLightingTerms } from "@/lib/studio/director-plan";
import type { StoryboardItem } from "@/types/studio";

export interface BuildStoryboardTableInput {
  episodeId: string;
  scriptText: string;
  /** 导演规划摘要（ScriptPlan 关键维度文本），作为节奏/情绪基准注入 */
  scriptPlanContext?: string;
}

export interface StoryboardTableMessages {
  system: string;
  user: string;
}

/** 解析出的一行分镜（14 列协议，§3.2）。所有流向生图的文本字段已剔除光影词。 */
export interface StoryboardTableRow {
  index: number;
  description: string;
  scene: string;
  associateAssetsNames: string[];
  duration: number;
  shotSize: string;
  cameraMove: string;
  action: string;
  orientation: string;
  spatialRelation: string;
  emotion: string;
  lines: string;
  sound: string;
  associateAssetsIds: string[];
}

export interface ParseStoryboardTableResult {
  rows: StoryboardTableRow[];
  errors: string[];
  warnings: string[];
}

/** §3.2 语速表：愤怒~4字/秒，正常~3字/秒，悲伤/低语/虚弱~2字/秒，缺省按正常。 */
const FAST_EMOTION_HINTS = ["愤怒", "激动", "急促", "亢奋", "暴怒", "嘶吼", "怒"];
const SLOW_EMOTION_HINTS = ["悲伤", "绝望", "低语", "虚弱", "哽咽", "无力", "气若游丝", "垂死"];

export function resolveSpeed(emotion: string): number {
  const text = emotion ?? "";
  if (FAST_EMOTION_HINTS.some((hint) => text.includes(hint))) return 4;
  if (SLOW_EMOTION_HINTS.some((hint) => text.includes(hint))) return 2;
  return 3;
}

/** §3.2 时长精算：duration ≥ 字数 ÷ 语速（向上取整）+ 1s 余量。纯公式，语料由调用方负责抽取。 */
export function computeDurationSec(text: string, speed: number): number {
  const safeSpeed = speed > 0 ? speed : 3;
  return Math.ceil((text ?? "").length / safeSpeed) + 1;
}

export function buildStoryboardTableMessages(input: BuildStoryboardTableInput): StoryboardTableMessages {
  const skill = getAgentSkillPreset("production_execution_storyboard_table")?.content ?? "storyboardTable";
  return {
    system: [skill, input.scriptPlanContext].filter(Boolean).join("\n\n---\n\n"),
    user: [
      `当前集ID：${input.episodeId}`,
      input.scriptPlanContext ? `导演规划要点：\n${input.scriptPlanContext}` : "",
      "剧本正文：",
      input.scriptText,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function parseStoryboardTable(output: string, episodeId: string): ParseStoryboardTableResult {
  void episodeId;
  const body = extractStoryboardSegments(output);
  const rows: StoryboardTableRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const raw of body.split(/\r?\n/)) {
    const line = stripCodeFence(raw).trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    if (isSeparatorRow(line)) continue;

    const fields = line.slice(1, -1).split("|").map((item) => item.trim());
    if (fields.length !== 14) {
      errors.push(`列数不符（应为14列，实为${fields.length}）：${line}`);
      continue;
    }
    if (isHeaderRow(fields)) continue;

    const index = Number.parseInt(fields[0]!, 10);
    if (!Number.isFinite(index)) {
      errors.push(`序号非法：${line}`);
      continue;
    }

    const row = buildRow(index, fields, warnings);
    rows.push(row);
  }

  return { rows, errors, warnings };
}

export function toStoryboardItems(rows: StoryboardTableRow[], episodeId: string): StoryboardItem[] {
  return rows.map<StoryboardItem>((row) => {
    const computed = computeDurationSec(extractSpeech(row.lines), resolveSpeed(row.emotion));
    const duration = Math.max(row.duration, computed);
    return {
      id: `sb-${episodeId}-${row.index}`,
      episodeId,
      index: row.index,
      trackKey: `shot-${String(row.index).padStart(3, "0")}`,
      trackId: "",
      duration,
      prompt: row.description,
      videoDesc: row.action,
      assetIds: row.associateAssetsIds,
      state: "idle",
      emotion: row.emotion,
      orientation: row.orientation,
      spatialRelation: row.spatialRelation,
      associateAssetsNames: row.associateAssetsNames,
    };
  });
}

/** 取出所有 <storyboardTable>…</storyboardTable> 段并拼接；无标签则回退整段。 */
function extractStoryboardSegments(output: string): string {
  const matches = [...output.matchAll(/<storyboardTable>([\s\S]*?)<\/storyboardTable>/g)].map((m) => m[1]!.trim());
  if (matches.length) return matches.join("\n");
  return output.trim();
}

function buildRow(index: number, fields: string[], warnings: string[]): StoryboardTableRow {
  const descriptionRaw = fields[1]!;
  const actionRaw = fields[7]!;
  const emotionRaw = fields[10]!;

  collectLightingWarnings(descriptionRaw, "画面描述", warnings);
  collectLightingWarnings(actionRaw, "角色动作", warnings);
  collectLightingWarnings(emotionRaw, "情绪", warnings);

  return {
    index,
    description: stripLightingTerms(descriptionRaw),
    scene: fields[2]!,
    associateAssetsNames: splitBracketList(fields[3]!),
    duration: parseDuration(fields[4]!),
    shotSize: fields[5]!,
    cameraMove: fields[6]!,
    action: stripLightingTerms(actionRaw),
    orientation: fields[8]!,
    spatialRelation: fields[9]!,
    emotion: stripLightingTerms(emotionRaw),
    lines: fields[11]!,
    sound: fields[12]!,
    associateAssetsIds: splitBracketList(fields[13]!),
  };
}

function collectLightingWarnings(text: string, fieldName: string, warnings: string[]): void {
  const hits = detectLightingTerms(text);
  if (hits.length) {
    warnings.push(`${fieldName}含光影词，已剔除：${hits.join("、")}`);
  }
}

/** `[甲, 乙]` / `甲、乙` → ["甲","乙"]；`—`/空 → []。 */
function splitBracketList(value: string): string[] {
  const inner = value.replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner || inner === "—" || inner === "-" || inner === "无") return [];
  return inner
    .split(/[，,、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDuration(value: string): number {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match?.[1]) return 0;
  return Math.round(Number(match[1]));
}

/** 台词字段去掉「角色：」前缀与旁白标记，仅留实际念白用于时长精算。 */
function extractSpeech(lines: string): string {
  const text = (lines ?? "").trim();
  if (!text || text === "无台词" || text === "—") return "";
  const colonIdx = text.search(/[:：]/);
  return colonIdx >= 0 ? text.slice(colonIdx + 1).trim() : text;
}

function stripCodeFence(line: string): string {
  return line.replace(/```[a-zA-Z]*/g, "").replace(/```/g, "");
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line);
}

function isHeaderRow(fields: string[]): boolean {
  const first = fields[0] ?? "";
  return first === "序号" || first.toLowerCase() === "index" || first === "#";
}
