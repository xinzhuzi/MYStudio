import { getAgentSkillPreset } from "@/lib/studio/manuals";
import { detectLightingTerms, stripLightingTerms } from "@/lib/studio/director-plan";
import {
  buildStoryboardVoiceoverItem,
  type VoiceoverCharacterIdentity,
} from "@/lib/studio/chapter-voiceover";
import type {
  StoryboardItem,
  StoryboardShotSemantics,
  StoryboardVisibleCharacterSemantic,
  StoryboardVisiblePropSemantic,
} from "@/types/studio";

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

/** 解析出的一行分镜。兼容旧 14 列协议与 Toonflow 新版「场头 -> 片段 -> 7 列镜表」协议。 */
export interface StoryboardTableRow {
  index: number;
  sceneIndex?: number;
  segmentTitle?: string;
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
  shotSemantics?: StoryboardShotSemantics;
}

export interface ParseStoryboardTableResult {
  rows: StoryboardTableRow[];
  errors: string[];
  warnings: string[];
}

export interface ParseStoryboardTableOptions {
  requireShotSemantics?: boolean;
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
  const voiceoverGuard = [
    "分镜配音硬约束：每条分镜必须填写台词/旁白字段，作为后续配音、TTS 和角色音色绑定的输入。",
    "角色台词保留 `角色名：台词内容`，无角色台词时必须写 `旁白：解说内容`，不要留空或写无台词。",
  ].join("\n");
  return {
    system: [skill, voiceoverGuard, input.scriptPlanContext].filter(Boolean).join("\n\n---\n\n"),
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

export function parseStoryboardTable(
  output: string,
  episodeId: string,
  options: ParseStoryboardTableOptions = {},
): ParseStoryboardTableResult {
  void episodeId;
  const body = extractStoryboardSegments(output);
  const rows: StoryboardTableRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let currentScene = "";
  let currentSceneIndex: number | undefined;
  let currentSegmentTitle = "";
  let currentAssetNames: string[] = [];
  let currentAssetIds: string[] = [];
  const legacySceneIndexes = new Map<string, number>();

  for (const raw of body.split(/\r?\n/)) {
    const line = stripCodeFence(raw).trim();
    const sceneMeta = parseSceneHeading(line);
    if (sceneMeta) {
      currentScene = sceneMeta.scene;
      currentSceneIndex = sceneMeta.index;
      currentSegmentTitle = "";
      currentAssetNames = sceneMeta.roles;
      currentAssetIds = [];
      continue;
    }
    const segmentTitle = parseSegmentHeading(line);
    if (segmentTitle) {
      currentSegmentTitle = segmentTitle;
      continue;
    }
    const assetNames = parseAssetLine(line, "引用资产名称");
    if (assetNames) {
      currentAssetNames = assetNames;
      continue;
    }
    const assetIds = parseAssetLine(line, "引用资产ID");
    if (assetIds) {
      currentAssetIds = assetIds;
      continue;
    }
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    if (isSeparatorRow(line)) continue;

    const fields = line.slice(1, -1).split("|").map((item) => item.trim());
    if (isHeaderRow(fields)) continue;

    const index = Number.parseInt(fields[0]!, 10);
    if (!Number.isFinite(index)) {
      errors.push(`序号非法：${line}`);
      continue;
    }

    const row =
      fields.length === 15
        ? buildLegacyRow(index, fields, warnings, legacySceneIndexes, errors)
        : fields.length === 14
        ? buildLegacyRow(index, fields, warnings, legacySceneIndexes)
        : fields.length === 8
          ? buildGroupedRow(
              index,
              fields,
              {
                scene: currentScene,
                sceneIndex: currentSceneIndex,
                segmentTitle: currentSegmentTitle,
                assetNames: currentAssetNames,
                assetIds: currentAssetIds,
              },
              warnings,
              errors,
            )
        : fields.length === 7
          ? buildGroupedRow(
              index,
              fields,
              {
                scene: currentScene,
                sceneIndex: currentSceneIndex,
                segmentTitle: currentSegmentTitle,
                assetNames: currentAssetNames,
                assetIds: currentAssetIds,
              },
              warnings,
            )
          : null;
    if (!row) {
      errors.push(`列数不符（应为15列、14列、8列或7列，实为${fields.length}）：${line}`);
      continue;
    }
    rows.push(row);
  }

  const indexError = storyboardIndexContinuityError(rows);
  if (indexError) errors.push(indexError);
  if (options.requireShotSemantics) {
    for (const row of rows) {
      if (!row.shotSemantics) {
        errors.push(`分镜 ${row.index} 缺少出镜语义JSON`);
      }
    }
  }

  return { rows, errors, warnings };
}

export function toStoryboardItems(
  rows: StoryboardTableRow[],
  episodeId: string,
  characters: VoiceoverCharacterIdentity[],
): StoryboardItem[] {
  const indexError = storyboardIndexContinuityError(rows);
  if (indexError) throw new Error(indexError);

  return rows.map<StoryboardItem>((row) => {
    const sourceDuration = row.duration > 0
      ? row.duration
      : computeDurationSec(extractSpeech(row.lines), resolveSpeed(row.emotion));
    const storyboardId = `sb-${episodeId}-${String(row.index).padStart(3, "0")}`;
    const voiceover = buildStoryboardVoiceoverItem({
      storyboardId,
      index: row.index,
      description: row.description,
      lines: row.lines,
      duration: sourceDuration,
      emotion: row.emotion,
      characters,
    });
    return {
      id: storyboardId,
      episodeId,
      index: row.index,
      trackKey: `${episodeId}-scene-${row.sceneIndex ?? 1}`,
      trackId: "",
      duration: voiceover.durationTarget,
      prompt: row.description,
      videoDesc: row.action,
      assetIds: row.associateAssetsIds,
      shouldGenerateImage: true,
      state: "idle",
      emotion: row.emotion,
      orientation: row.orientation,
      spatialRelation: row.spatialRelation,
      associateAssetsNames: row.associateAssetsNames,
      lines: `${voiceover.speaker}：${voiceover.line}`,
      speaker: voiceover.speaker,
      speakerId: voiceover.speakerId,
      line: voiceover.line,
      ttsSpokenText: voiceover.ttsSpokenText,
      durationTarget: voiceover.durationTarget,
      voiceStyle: voiceover.voiceStyle,
      requiresFixedVoice: voiceover.requiresFixedVoice,
      sound: row.sound,
      shotSemantics: row.shotSemantics,
    };
  });
}

/** 取出所有 <storyboardTable>…</storyboardTable> 段并拼接；无标签则回退整段。 */
function extractStoryboardSegments(output: string): string {
  const matches = [...output.matchAll(/<storyboardTable>([\s\S]*?)<\/storyboardTable>/g)].map((m) => m[1]!.trim());
  if (matches.length) return matches.join("\n");
  return output.trim();
}

function buildLegacyRow(
  index: number,
  fields: string[],
  warnings: string[],
  sceneIndexes: Map<string, number>,
  errors?: string[],
): StoryboardTableRow {
  const descriptionRaw = fields[1]!;
  const scene = fields[2]!;
  const actionRaw = fields[7]!;
  const emotionRaw = fields[10]!;
  const sceneIndex = sceneIndexes.get(scene) ?? sceneIndexes.size + 1;
  sceneIndexes.set(scene, sceneIndex);

  collectLightingWarnings(descriptionRaw, "画面描述", warnings);
  collectLightingWarnings(actionRaw, "角色动作", warnings);
  collectLightingWarnings(emotionRaw, "情绪", warnings);

  return {
    index,
    sceneIndex,
    description: stripLightingTerms(descriptionRaw),
    scene,
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
    shotSemantics: fields.length === 15
      ? parseShotSemantics(fields[14]!, index, errors ?? [])
      : undefined,
  };
}

function buildGroupedRow(
  index: number,
  fields: string[],
  context: {
    scene: string;
    sceneIndex?: number;
    segmentTitle: string;
    assetNames: string[];
    assetIds: string[];
  },
  warnings: string[],
  errors?: string[],
): StoryboardTableRow {
  const descriptionRaw = fields[1]!;
  const soundRaw = fields[6]!;

  collectLightingWarnings(descriptionRaw, "画面描述", warnings);
  collectLightingWarnings(soundRaw, "音效", warnings);

  const description = stripLightingTerms(descriptionRaw);
  return {
    index,
    sceneIndex: context.sceneIndex,
    segmentTitle: context.segmentTitle,
    description,
    scene: context.scene,
    associateAssetsNames: context.assetNames,
    duration: parseDuration(fields[2]!),
    shotSize: fields[3]!,
    cameraMove: fields[4]!,
    action: description,
    orientation: "",
    spatialRelation: "",
    emotion: "",
    lines: fields[5]!,
    sound: stripLightingTerms(soundRaw),
    associateAssetsIds: context.assetIds,
    shotSemantics: fields.length === 8
      ? parseShotSemantics(fields[7]!, index, errors ?? [])
      : undefined,
  };
}

function parseShotSemantics(
  raw: string,
  index: number,
  errors: string[],
): StoryboardShotSemantics | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    errors.push(`分镜 ${index} 出镜语义JSON不是有效JSON`);
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`分镜 ${index} 出镜语义JSON必须是对象`);
    return undefined;
  }
  const semantic = value as Record<string, unknown>;
  const sceneViewpointId = semantic.sceneViewpointId;
  const personFree = semantic.personFree;
  const visibleCharacters = semantic.visibleCharacters;
  const visibleProps = semantic.visibleProps;
  const actionIn = semantic.actionIn;
  const actionOut = semantic.actionOut;
  if (!isNonEmptyString(sceneViewpointId) || typeof personFree !== "boolean"
    || !Array.isArray(visibleCharacters) || !Array.isArray(visibleProps)
    || !isNonEmptyString(actionIn) || !isNonEmptyString(actionOut)) {
    errors.push(`分镜 ${index} 出镜语义JSON缺少 sceneViewpointId、personFree、visibleCharacters、visibleProps、actionIn 或 actionOut`);
    return undefined;
  }
  const parsedCharacters: StoryboardVisibleCharacterSemantic[] = [];
  for (const item of visibleCharacters) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`分镜 ${index} 出镜语义JSON含非法角色项`);
      return undefined;
    }
    const character = item as Record<string, unknown>;
    if (!isNonEmptyString(character.name) || !isNonEmptyString(character.position)
      || !isNonEmptyString(character.orientation) || !isNonEmptyString(character.actionIn)
      || !isNonEmptyString(character.actionOut)) {
      errors.push(`分镜 ${index} 出镜角色必须有名称、站位、朝向、入镜动作和出镜动作`);
      return undefined;
    }
    parsedCharacters.push({
      name: character.name.trim(),
      position: character.position.trim(),
      orientation: character.orientation.trim(),
      actionIn: character.actionIn.trim(),
      actionOut: character.actionOut.trim(),
    });
  }
  if ((personFree && parsedCharacters.length > 0) || (!personFree && parsedCharacters.length === 0)) {
    errors.push(`分镜 ${index} 必须明确人物入画，或以 personFree=true 声明无人物镜头`);
    return undefined;
  }
  if (new Set(parsedCharacters.map((item) => item.name)).size !== parsedCharacters.length) {
    errors.push(`分镜 ${index} 出镜语义JSON不能重复同一角色`);
    return undefined;
  }
  const parsedProps: StoryboardVisiblePropSemantic[] = [];
  for (const item of visibleProps) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`分镜 ${index} 出镜语义JSON含非法道具项`);
      return undefined;
    }
    const prop = item as Record<string, unknown>;
    if (!isNonEmptyString(prop.name) || !isNonEmptyString(prop.position) || !isNonEmptyString(prop.state)) {
      errors.push(`分镜 ${index} 出镜道具必须有名称、位置和状态`);
      return undefined;
    }
    parsedProps.push({
      name: prop.name.trim(),
      position: prop.position.trim(),
      state: prop.state.trim(),
    });
  }
  if (new Set(parsedProps.map((item) => item.name)).size !== parsedProps.length) {
    errors.push(`分镜 ${index} 出镜语义JSON不能重复同一道具`);
    return undefined;
  }
  return {
    sceneViewpointId: sceneViewpointId.trim(),
    personFree,
    visibleCharacters: parsedCharacters,
    visibleProps: parsedProps,
    actionIn: actionIn.trim(),
    actionOut: actionOut.trim(),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseSceneHeading(line: string): { index?: number; scene: string; roles: string[] } | null {
  const match = line.match(/^##\s*场\s*(\d+)?[：:]\s*(.+?)(?:\s*[｜|]\s*参演角色[：:]\s*(.+))?$/);
  if (!match) return null;
  return {
    index: match[1] ? Number.parseInt(match[1], 10) : undefined,
    scene: (match[2] ?? "").trim(),
    roles: splitBracketList(match[3] ?? ""),
  };
}

function parseSegmentHeading(line: string): string | null {
  const match = line.match(/^###\s*(片段.+|第.+组.+)$/);
  return match?.[1]?.trim() ?? null;
}

function parseAssetLine(line: string, label: string): string[] | null {
  const normalized = line.replace(/\*\*/g, "").trim();
  const match = normalized.match(new RegExp(`^${label}[：:]\\s*(.+)$`));
  return match?.[1] ? splitBracketList(match[1]) : null;
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
  return Number(match[1]);
}

function storyboardIndexContinuityError(
  rows: Pick<StoryboardTableRow, "index">[],
): string | null {
  const actualIndexes = rows.map((row) => row.index);
  const isContinuous = actualIndexes.every(
    (index, offset) => index === offset + 1,
  );
  return isContinuous
    ? null
    : `分镜序号必须连续为 1..N: [${actualIndexes.join(", ")}]`;
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
