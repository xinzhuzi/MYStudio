import type { StudioMaterial } from "@/types/studio";
import type { StudioAssetSummary } from "@/types/studio-assets";
import type { ProjectVoiceBinding, TtsSpeakerId, VoiceProfile } from "@/types/tts";
import { toRoleSpeakerId } from "@/lib/tts/role-speaker-id";

type VoiceProfileInput = Omit<VoiceProfile, "id" | "createdAt" | "updatedAt">;

type Gender = "male" | "female" | "unknown";
type AgeBand = "child" | "teen" | "young" | "middle" | "old" | "unknown";
type RoleArchetype = "villain" | "child" | "swordsman" | "scholar" | "worker" | "elder" | "noble";

export interface RoleAudioCandidate {
  id: string;
  name: string;
  filePath: string;
  referenceText?: string;
  sourceLabel?: string;
}

export interface RoleAudioAssignment {
  role: StudioAssetSummary;
  audio: RoleAudioCandidate;
  reason: string;
}

export interface RoleAudioAiMatchRequest {
  role: StudioAssetSummary;
  candidates: RoleAudioCandidate[];
  localAssignment: RoleAudioAssignment;
}

export interface RoleAudioAiMatchResult {
  audioId?: string | null;
  reason?: string;
}

export interface RoleAudioAiOptions {
  maxCandidatesPerRole?: number;
  match: (request: RoleAudioAiMatchRequest) => Promise<RoleAudioAiMatchResult | null | undefined>;
}

export interface RoleAudioVoiceProfileDraft {
  speakerId: TtsSpeakerId;
  profile: VoiceProfileInput;
  binding: Omit<ProjectVoiceBinding, "profileId">;
}

const GENDER_CUES: Record<Exclude<Gender, "unknown">, string[]> = {
  male: ["男", "男声", "男性", "少年", "青年男", "老年男", "老者", "大叔", "公子", "将军", "真人", "师父", "师兄"],
  female: ["女", "女声", "女性", "少女", "姑娘", "女子", "御姐", "萝莉", "仙子", "师姐", "师妹", "夫人", "小姐", "公主"],
};

const AGE_CUES: Record<Exclude<AgeBand, "unknown">, string[]> = {
  child: ["儿童", "童声", "孩童", "幼年", "小孩", "男孩", "女孩", "小男孩", "小女孩", "书童", "正太", "萝莉"],
  teen: ["少年", "少女", "少男", "青春", "稚嫩", "十二三岁", "十几岁", "弟弟", "妹妹"],
  young: ["青年", "年轻", "少年感", "清亮", "明亮", "小伙", "男大"],
  middle: ["中年", "成熟", "稳重", "沉稳", "大叔"],
  old: ["老年", "老人", "老者", "年迈", "苍老", "沧桑", "低沉", "古稀"],
};

const TONE_CUES = [
  "清冷",
  "温柔",
  "威严",
  "低沉",
  "沧桑",
  "沙哑",
  "活泼",
  "明亮",
  "成熟",
  "稳重",
  "狠厉",
  "阴冷",
  "妩媚",
  "奸诈",
  "狡猾",
  "老谋深算",
  "粗暴",
  "冷峻",
  "淡漠",
  "倔强",
  "严厉",
  "文气",
  "儒雅",
];

const ARCHETYPE_CUES: Record<RoleArchetype, { label: string; role: string[]; audio: string[] }> = {
  villain: {
    label: "反派/压迫者",
    role: ["监工", "反派", "压迫", "狗腿", "狠厉", "阴冷", "粗暴", "奸诈", "狡猾", "老谋深算", "赤练蛇皮鞭", "记名弟子"],
    audio: ["反派", "奸诈", "狡猾", "老谋深算", "狠厉", "阴冷", "粗暴", "恶毒", "霸道", "傲慢", "狂妄", "严厉", "说教"],
  },
  child: {
    label: "少年/孩童",
    role: ["少年", "少女", "孩童", "孩子", "小杂役", "丫头", "十二三岁", "十几岁", "稚嫩", "星火", "底层少年"],
    audio: ["少年", "少女", "男孩", "女孩", "小男孩", "小女孩", "孩童", "儿童", "童声", "书童", "正太", "萝莉", "小龄", "弟弟", "妹妹"],
  },
  swordsman: {
    label: "剑修/冷峻",
    role: ["剑修", "剑主", "断剑", "归元", "冷峻", "寡言", "清冷", "淡漠", "灰衫", "剑"],
    audio: ["清冷", "冷峻", "淡漠", "正经", "专注", "儒雅", "文气", "书生", "侠", "不羁"],
  },
  scholar: {
    label: "先生/文气",
    role: ["先生", "教师", "教书", "塾馆", "掌柜", "儒", "文气", "书生"],
    audio: ["教师", "先生", "书生", "儒雅", "文质彬彬", "文气", "正经", "专注"],
  },
  worker: {
    label: "底层/苦力",
    role: ["苦力", "力工", "底层", "码头", "杂役", "贫苦", "粗粝", "老苦力", "年轻苦力"],
    audio: ["路人", "窝囊", "胆小", "叫卖", "村妇", "质朴", "沧桑", "沙哑", "中年", "老年"],
  },
  elder: {
    label: "长者/师父",
    role: ["老年", "老人", "老者", "师父", "真人", "长老", "年迈", "沧桑"],
    audio: ["老年", "老人", "老者", "奶奶", "老妇", "苍老", "沧桑", "沙哑", "师父"],
  },
  noble: {
    label: "贵气/权势",
    role: ["公子", "少爷", "小姐", "公主", "宗门弟子", "帝王", "权势", "掌权"],
    audio: ["少爷", "公子", "小姐", "公主", "帝王", "霸总", "贵气", "华丽", "傲娇", "女王"],
  },
};

export function buildRoleAudioCandidates(
  materials: StudioMaterial[],
  runtimeAssets: StudioAssetSummary[] = [],
): RoleAudioCandidate[] {
  const materialCandidates: RoleAudioCandidate[] = materials
    .filter((item) => item.kind === "audio" && item.localPath.trim())
    .map((item) => ({
      id: `material:${item.id}`,
      name: getFileName(item.sourceName || item.localPath),
      filePath: item.localPath.trim(),
      referenceText: normalizeReferenceText(item.sourceName) ?? normalizeReferenceText(item.name) ?? normalizeReferenceText(item.localPath),
      sourceLabel: getFileName(item.sourceName || item.localPath),
    }));

  const runtimeCandidates: RoleAudioCandidate[] = runtimeAssets
    .filter((item) => item.type === "audio")
    .flatMap((item) => {
      const filePath = (item.sourcePath || item.filePath || "").trim();
      if (!filePath) return [];
      return [{
        id: item.id,
        name: getFileName(item.name || filePath),
        filePath,
        referenceText: normalizeReferenceText(item.description)
          ?? normalizeReferenceText(item.name)
          ?? normalizeReferenceText(filePath),
        sourceLabel: getFileName(item.sourcePath || item.filePath || item.name),
      }];
    });

  const candidates: RoleAudioCandidate[] = [
    ...materialCandidates,
    ...runtimeCandidates,
  ];

  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = item.filePath;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function assignAudioToRoles(
  roles: StudioAssetSummary[],
  candidates: RoleAudioCandidate[],
): RoleAudioAssignment[] {
  if (candidates.length === 0) return [];
  const usage = new Map<string, number>();

  return roles
    .filter((role) => role.type === "role")
    .map((role) => {
      const roleTraits = analyzeText(buildRoleSearchText(role));
      let best = candidates[0]!;
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestReason = "按候选顺序分配";

      candidates.forEach((candidate, index) => {
        const audioTraits = analyzeText(buildAudioSearchText(candidate));
        const usedCount = usage.get(candidate.id) ?? 0;
        const { score, reason } = scoreCandidate(roleTraits, audioTraits, usedCount, index);
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
          bestReason = reason;
        }
      });

      usage.set(best.id, (usage.get(best.id) ?? 0) + 1);
      return { role, audio: best, reason: bestReason };
    });
}

export async function assignAudioToRolesWithAi(
  roles: StudioAssetSummary[],
  candidates: RoleAudioCandidate[],
  options: RoleAudioAiOptions,
): Promise<RoleAudioAssignment[]> {
  const localAssignments = assignAudioToRoles(roles, candidates);
  const maxCandidatesPerRole = Math.max(1, options.maxCandidatesPerRole ?? 8);

  const assignments: RoleAudioAssignment[] = [];
  const usage = new Map<string, number>();

  for (const localAssignment of localAssignments) {
    const rankedCandidates = rankCandidatesForRole(localAssignment.role, candidates, usage)
      .slice(0, maxCandidatesPerRole)
      .map((item) => item.candidate);
    const allowedIds = new Set(rankedCandidates.map((item) => item.id));
    let finalAssignment = localAssignment;

    try {
      const result = await options.match({
        role: localAssignment.role,
        candidates: rankedCandidates,
        localAssignment,
      });
      if (result?.audioId && allowedIds.has(result.audioId)) {
        const audio = rankedCandidates.find((item) => item.id === result.audioId);
        if (audio) {
          finalAssignment = {
            role: localAssignment.role,
            audio,
            reason: result.reason?.trim() || `AI语义匹配：${audio.name}`,
          };
        }
      }
    } catch {
      finalAssignment = localAssignment;
    }

    usage.set(finalAssignment.audio.id, (usage.get(finalAssignment.audio.id) ?? 0) + 1);
    assignments.push(finalAssignment);
  }

  return assignments;
}

export function createRoleAudioVoiceProfileInput(assignment: RoleAudioAssignment): RoleAudioVoiceProfileDraft {
  const speakerId = toRoleSpeakerId(assignment.role.id);
  return {
    speakerId,
    profile: {
      name: `音色·${assignment.role.name}·${assignment.audio.name}`,
      type: "reference",
      language: "zh",
      defaultEngine: "qwen",
      defaultModelSize: "1.7B",
      referenceAudioPath: assignment.audio.filePath,
      referenceText: assignment.audio.referenceText,
      instruct: assignment.reason,
    },
    binding: {
      speakerId,
      defaultEngine: "qwen",
      defaultModelSize: "1.7B",
    },
  };
}

export function parseRoleAudioAiMatchResult(text: string): RoleAudioAiMatchResult | null {
  const jsonText = extractJsonObject(text);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as { audioId?: unknown; reason?: unknown };
    const audioId = typeof parsed.audioId === "string" ? parsed.audioId.trim() : parsed.audioId === null ? null : undefined;
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : undefined;
    return { audioId: audioId || null, reason };
  } catch {
    return null;
  }
}

function scoreCandidate(
  role: ReturnType<typeof analyzeText>,
  audio: ReturnType<typeof analyzeText>,
  usedCount: number,
  index: number,
) {
  const reasons: string[] = [];
  let score = usedCount === 0 ? 20 : -20 - usedCount * 10;

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

function rankCandidatesForRole(
  role: StudioAssetSummary,
  candidates: RoleAudioCandidate[],
  usage: Map<string, number>,
) {
  const roleTraits = analyzeText(buildRoleSearchText(role));
  return candidates
    .map((candidate, index) => {
      const audioTraits = analyzeText(buildAudioSearchText(candidate));
      const usedCount = usage.get(candidate.id) ?? 0;
      const { score, reason } = scoreCandidate(roleTraits, audioTraits, usedCount, index);
      return { candidate, score, reason };
    })
    .sort((left, right) => right.score - left.score);
}

function analyzeText(text: string) {
  return {
    gender: detectGender(text),
    age: detectAge(text),
    tones: TONE_CUES.filter((cue) => text.includes(cue)),
    archetypes: detectArchetypes(text),
  };
}

function detectGender(text: string): Gender {
  const explicit = text.match(/性别\s*[：:]\s*(男|女|男性|女性)/);
  if (explicit?.[1]?.startsWith("女")) return "female";
  if (explicit?.[1]?.startsWith("男")) return "male";
  if (GENDER_CUES.female.some((cue) => text.includes(cue))) return "female";
  if (GENDER_CUES.male.some((cue) => text.includes(cue))) return "male";
  return "unknown";
}

function detectAge(text: string): AgeBand {
  for (const age of ["old", "middle", "child", "teen", "young"] as const) {
    if (AGE_CUES[age].some((cue) => text.includes(cue))) return age;
  }
  return "unknown";
}

function isNearbyAge(left: AgeBand, right: AgeBand) {
  const order: AgeBand[] = ["child", "teen", "young", "middle", "old"];
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);
  return leftIndex >= 0 && rightIndex >= 0 && Math.abs(leftIndex - rightIndex) === 1;
}

function formatAge(age: AgeBand) {
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

function detectArchetypes(text: string): RoleArchetype[] {
  return (Object.keys(ARCHETYPE_CUES) as RoleArchetype[]).filter((archetype) => {
    const cue = ARCHETYPE_CUES[archetype];
    return cue.role.some((item) => text.includes(item)) || cue.audio.some((item) => text.includes(item));
  });
}

function buildRoleSearchText(role: StudioAssetSummary) {
  return [
    role.name,
    role.description,
    role.setting,
    role.prompt,
    role.remark,
    role.tags?.join(" "),
  ].filter(Boolean).join(" ");
}

function buildAudioSearchText(candidate: RoleAudioCandidate) {
  return [
    candidate.name,
    candidate.referenceText,
    candidate.sourceLabel,
  ].filter(Boolean).join(" ");
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return "";
  return trimmed.slice(start, end + 1);
}

function normalizeReferenceText(value?: string) {
  const text = value?.trim();
  if (!text || looksLikePath(text)) return undefined;
  return text;
}

function looksLikePath(value: string) {
  return /[\\/]/.test(value) || /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(value);
}

function getFileName(value?: string) {
  const raw = value?.trim();
  if (!raw) return "未命名音频";
  return raw.split(/[\\/]/).filter(Boolean).pop() || raw;
}
