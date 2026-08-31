import type { RoleAudioCandidate } from "@/lib/tts/narrator-voice";
import type { StudioAssetSummary } from "@/types/studio-assets";
import type { ProjectVoiceBinding, TtsSpeakerId, VoiceProfile } from "@/types/tts";

/**
 * 角色配音契约——类型/接口/基调线索常量(纯数据,无逻辑)。file-size-reduction P2 拆出,体逐字保留。
 */
type VoiceProfileInput = Omit<VoiceProfile, "id" | "createdAt" | "updatedAt">;

export type Gender = "male" | "female" | "unknown";
export type AgeBand = "child" | "teen" | "young" | "middle" | "old" | "unknown";
export type RoleArchetype = "villain" | "child" | "swordsman" | "scholar" | "worker" | "elder" | "noble";

export type RoleImportance = "protagonist" | "supporting" | "npc";

/** 分层分配选项：主角优先挑段；NPC 允许复用已分配片段（不罚）。 */
export interface AssignAudioOptions {
  importanceByRoleId?: Record<string, RoleImportance>;
}

export const IMPORTANCE_ORDER: Record<RoleImportance, number> = {
  protagonist: 0,
  supporting: 1,
  npc: 2,
};

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
  importanceByRoleId?: Record<string, RoleImportance>;
}

export interface RoleAudioVoiceProfileDraft {
  speakerId: TtsSpeakerId;
  profile: VoiceProfileInput;
  binding: Omit<ProjectVoiceBinding, "profileId">;
}

export interface FixedVoiceTarget {
  speakerId: TtsSpeakerId;
  role: StudioAssetSummary;
}

export interface FixedVoicePlanError {
  speakerId: TtsSpeakerId;
  code:
    | "duplicate-speaker"
    | "missing-profile"
    | "missing-reference-audio"
    | "missing-reference-text"
    | "unreadable-reference-audio"
    | "missing-candidate"
    | "assignment-failed"
    | "invalid-profile";
  message: string;
}

export interface FixedVoicePlan {
  fixed: Array<{
    speakerId: TtsSpeakerId;
    binding: ProjectVoiceBinding;
    profile: VoiceProfile;
    match: "fixed";
  }>;
  /**
   * 同名角色跨 id 复用（用户要求：角色配音固定）：实体重抽生成新 characterId 后
   * 绑定失配时，按「音色·<角色名>·」前缀找回既有 profile 直接重绑，不重新分配。
   * 调用方只需 bindSpeaker，不要 createVoiceProfile（避免重复建档）。
   */
  rebound: Array<{
    speakerId: TtsSpeakerId;
    binding: Omit<ProjectVoiceBinding, "profileId"> & { profileId: string };
    profile: VoiceProfile;
    match: "name-matched";
  }>;
  created: Array<{
    speakerId: TtsSpeakerId;
    assignment: RoleAudioAssignment;
    draft: RoleAudioVoiceProfileDraft;
    match: "ai-selected";
  }>;
  errors: FixedVoicePlanError[];
}

export interface PlanFixedRoleVoicesInput {
  targets: FixedVoiceTarget[];
  candidates: RoleAudioCandidate[];
  bindings: Record<string, ProjectVoiceBinding>;
  voiceProfiles: Record<string, VoiceProfile>;
  resolveReferenceAudioPath: (audioPath: string) => Promise<string | null>;
  /** 旁白音色家族名（音色库资产命名前缀），缺省=木成；换家族后旁白自动重绑。 */
  narratorVoiceFamily?: string;
  /** 角色重要度（key=role.id 即 characterId）：主角优先挑段，NPC 允许复用。 */
  importanceByRoleId?: Record<string, RoleImportance>;
  assignUnbound?: (
    roles: StudioAssetSummary[],
    candidates: RoleAudioCandidate[],
    options?: AssignAudioOptions,
  ) => Promise<RoleAudioAssignment[]> | RoleAudioAssignment[];
}

export const GENDER_CUES: Record<Exclude<Gender, "unknown">, string[]> = {
  male: ["男", "男声", "男性", "少年", "青年男", "老年男", "老者", "大叔", "公子", "将军", "真人", "师父", "师兄"],
  female: ["女", "女声", "女性", "少女", "姑娘", "女子", "御姐", "萝莉", "仙子", "师姐", "师妹", "夫人", "小姐", "公主"],
};

export const AGE_CUES: Record<Exclude<AgeBand, "unknown">, string[]> = {
  child: ["儿童", "童声", "孩童", "幼年", "小孩", "男孩", "女孩", "小男孩", "小女孩", "书童", "正太", "萝莉"],
  teen: ["少年", "少女", "少男", "青春", "稚嫩", "十二三岁", "十几岁", "弟弟", "妹妹"],
  young: ["青年", "年轻", "少年感", "清亮", "明亮", "小伙", "男大"],
  middle: ["中年", "成熟", "稳重", "沉稳", "大叔"],
  old: ["老年", "老人", "老者", "年迈", "苍老", "沧桑", "低沉", "古稀"],
};

export const TONE_CUES = [
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

export const ARCHETYPE_CUES: Record<RoleArchetype, { label: string; role: string[]; audio: string[] }> = {
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

