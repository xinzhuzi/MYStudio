import { getAgentSkillPreset } from "@/lib/studio/manuals";
import { detectLightingTerms, stripLightingTerms } from "@/lib/studio/director-plan";
import type { EpisodeOutline } from "@/types/studio";

export interface BuildEpisodeOutlineInput {
  episodeId: string;
  /** 故事骨架摘要（三幕/分集规划），降低骨架→剧本跨度的上游 */
  skeletonContext?: string;
  /** 改编策略摘要（删减/呈现决策） */
  strategyContext?: string;
}

export interface EpisodeOutlineMessages {
  system: string;
  user: string;
}

export interface ParseEpisodeOutlineResult {
  outline: EpisodeOutline;
  errors: string[];
  warnings: string[];
}

export function buildEpisodeOutlineMessages(input: BuildEpisodeOutlineInput): EpisodeOutlineMessages {
  const skill = getAgentSkillPreset("script_execution_episode_outline")?.content ?? "分集细纲";
  return {
    system: skill,
    user: [
      `当前集ID：${input.episodeId}`,
      input.skeletonContext ? `故事骨架：\n${input.skeletonContext}` : "",
      input.strategyContext ? `改编策略：\n${input.strategyContext}` : "",
      "请按【输出格式规范】用 <episodeOutline> 分段写出本集 beat 序列（4列：场次序号|地点|beat内容|预估时长秒）。",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function parseEpisodeOutline(output: string, episodeId: string): ParseEpisodeOutlineResult {
  const body = extractOutlineSegments(output);
  const beats: EpisodeOutline["beats"] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const raw of body.split(/\r?\n/)) {
    const line = stripCodeFence(raw).trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    if (isSeparatorRow(line)) continue;

    const fields = line.slice(1, -1).split("|").map((item) => item.trim());
    if (fields.length !== 4) {
      errors.push(`列数不符（应为4列，实为${fields.length}）：${line}`);
      continue;
    }
    if (isHeaderRow(fields)) continue;

    const sceneIndex = Number.parseInt(fields[0]!, 10);
    if (!Number.isFinite(sceneIndex)) {
      errors.push(`场次序号非法：${line}`);
      continue;
    }

    const beatRaw = fields[2]!;
    const lighting = detectLightingTerms(beatRaw);
    if (lighting.length) {
      warnings.push(`第${sceneIndex}场 beat 含光影词，已剔除：${lighting.join("、")}`);
    }

    beats.push({
      sceneIndex,
      location: fields[1]!,
      beat: stripLightingTerms(beatRaw),
      durationSec: parseDurationSec(fields[3]!),
    });
  }

  const outline: EpisodeOutline = {
    id: `episode-outline-${episodeId}-${Date.now()}`,
    episodeId,
    beats,
  };
  return { outline, errors, warnings };
}

/** 取出所有 <episodeOutline>…</episodeOutline> 段并拼接；无标签则回退整段。 */
function extractOutlineSegments(output: string): string {
  const matches = [...output.matchAll(/<episodeOutline>([\s\S]*?)<\/episodeOutline>/g)].map((m) => m[1]!.trim());
  if (matches.length) return matches.join("\n");
  return output.trim();
}

function parseDurationSec(value: string): number {
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match?.[1]) return 0;
  return Math.round(Number(match[1]));
}

function stripCodeFence(line: string): string {
  return line.replace(/```[a-zA-Z]*/g, "").replace(/```/g, "");
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line);
}

function isHeaderRow(fields: string[]): boolean {
  const first = fields[0] ?? "";
  return first.startsWith("场次") || first === "序号" || first.toLowerCase() === "index";
}
