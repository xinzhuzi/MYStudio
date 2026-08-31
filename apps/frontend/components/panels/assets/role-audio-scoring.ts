import type { RoleAudioCandidate } from "@/lib/tts/narrator-voice";
import { GENDER_CUES, AGE_CUES, TONE_CUES, ARCHETYPE_CUES } from "./role-audio-contract";
import type { Gender, AgeBand, RoleArchetype } from "./role-audio-contract";
import type { StudioAssetSummary } from "@/types/studio-assets";

/**
 * 角色配音评分引擎——候选打分/排序/文本分析与性别年龄原型侦测(纯函数族)。file-size-reduction P2 拆出,体逐字保留。
 */
export function scoreCandidate(
  role: ReturnType<typeof analyzeText>,
  audio: ReturnType<typeof analyzeText>,
  usedCount: number,
  index: number,
  allowReuse = false,
) {
  const reasons: string[] = [];
  let score = usedCount === 0 || allowReuse ? 20 : -20 - usedCount * 10;

  if (role.gender !== "unknown" && audio.gender !== "unknown") {
    if (role.gender === audio.gender) {
      score += 60;
      reasons.push(`性别匹配：${role.gender === "male" ? "男" : "女"}`);
    } else {
      score -= 80;
      reasons.push("性别不匹配");
    }
  }

  if (role.age !== "unknown" && audio.age !== "unknown") {
    if (role.age === audio.age) {
      score += 25;
      reasons.push(`年龄匹配：${formatAge(role.age)}`);
    } else if (isNearbyAge(role.age, audio.age)) {
      score += 8;
      reasons.push(`年龄相近：${formatAge(audio.age)}`);
    }
  }

  const toneMatches = role.tones.filter((tone) => audio.tones.includes(tone));
  if (toneMatches.length > 0) {
    score += toneMatches.length * 8;
    reasons.push(`气质匹配：${toneMatches.slice(0, 3).join("、")}`);
  }

  const archetypeMatches = role.archetypes.filter((archetype) => audio.archetypes.includes(archetype));
  if (archetypeMatches.length > 0) {
    score += archetypeMatches.length * 36;
    reasons.push(`身份匹配：${archetypeMatches.map((item) => ARCHETYPE_CUES[item].label).slice(0, 2).join("、")}`);
  }

  score -= index / 100;
  if (reasons.length === 0) reasons.push(usedCount === 0 ? "优先使用尚未分配的音频" : "候选不足，循环复用音频");
  return { score, reason: reasons.join("；") };
}

export function rankCandidatesForRole(
  role: StudioAssetSummary,
  candidates: RoleAudioCandidate[],
  usage: Map<string, number>,
  allowReuse = false,
) {
  const roleTraits = analyzeText(buildRoleSearchText(role));
  return candidates
    .map((candidate, index) => {
      const audioTraits = analyzeText(buildAudioSearchText(candidate));
      const usedCount = usage.get(candidate.id) ?? 0;
      const { score, reason } = scoreCandidate(roleTraits, audioTraits, usedCount, index, allowReuse);
      return { candidate, score, reason };
    })
    .sort((left, right) => right.score - left.score);
}

export function analyzeText(text: string) {
  return {
    gender: detectGender(text),
    age: detectAge(text),
    tones: TONE_CUES.filter((cue) => text.includes(cue)),
    archetypes: detectArchetypes(text),
  };
}

export function detectGender(text: string): Gender {
  const explicit = text.match(/性别\s*[：:]\s*(男|女|男性|女性)/);
  if (explicit?.[1]?.startsWith("女")) return "female";
  if (explicit?.[1]?.startsWith("男")) return "male";
  if (GENDER_CUES.female.some((cue) => text.includes(cue))) return "female";
  if (GENDER_CUES.male.some((cue) => text.includes(cue))) return "male";
  return "unknown";
}

export function detectAge(text: string): AgeBand {
  for (const age of ["old", "middle", "child", "teen", "young"] as const) {
    if (AGE_CUES[age].some((cue) => text.includes(cue))) return age;
  }
  return "unknown";
}

export function isNearbyAge(left: AgeBand, right: AgeBand) {
  const order: AgeBand[] = ["child", "teen", "young", "middle", "old"];
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);
  return leftIndex >= 0 && rightIndex >= 0 && Math.abs(leftIndex - rightIndex) === 1;
}

export function formatAge(age: AgeBand) {
  const label: Record<AgeBand, string> = {
    child: "儿童",
    teen: "少年/少女",
    young: "青年",
    middle: "中年/成熟",
    old: "老年/沧桑",
    unknown: "未知",
  };
  return label[age];
}

export function detectArchetypes(text: string): RoleArchetype[] {
  return (Object.keys(ARCHETYPE_CUES) as RoleArchetype[]).filter((archetype) => {
    const cue = ARCHETYPE_CUES[archetype];
    return cue.role.some((item) => text.includes(item)) || cue.audio.some((item) => text.includes(item));
  });
}

export function buildRoleSearchText(role: StudioAssetSummary) {
  return [
    role.name,
    role.description,
    role.setting,
    role.prompt,
    role.remark,
    role.tags?.join(" "),
  ].filter(Boolean).join(" ");
}

export function buildAudioSearchText(candidate: RoleAudioCandidate) {
  return [
    candidate.name,
    candidate.referenceText,
    candidate.sourceLabel,
  ].filter(Boolean).join(" ");
}

export function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return "";
  return trimmed.slice(start, end + 1);
}

export function getFileName(value?: string) {
  const raw = value?.trim();
  if (!raw) return "未命名音频";
  return raw.split(/[\\/]/).filter(Boolean).pop() || raw;
}
