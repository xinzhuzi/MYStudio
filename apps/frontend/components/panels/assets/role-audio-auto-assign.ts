import type { RoleAudioCandidate } from "@/lib/tts/narrator-voice";
import type { StudioMaterial } from "@/types/studio";
import type { StudioAssetSummary } from "@/types/studio-assets";
import type { TtsSpeakerId } from "@/types/tts";
import { toRoleSpeakerId } from "@/lib/tts/role-speaker-id";
import { normalizeReferenceText } from "@/lib/tts/reference-text";
import { validateVoiceProfileForGeneration } from "@/lib/tts/voice-profile-capabilities";
import { DEFAULT_NARRATOR_VOICE_FAMILY, filterNarratorVoiceFamily, isNarratorProfileOffFamily, pickNarratorVoiceBase } from "@/lib/tts/narrator-voice";
import { AssignAudioOptions, FixedVoicePlan, FixedVoicePlanError, FixedVoiceTarget, PlanFixedRoleVoicesInput, RoleAudioAiMatchRequest, RoleAudioAiMatchResult, RoleAudioAiOptions, RoleAudioAssignment, RoleAudioVoiceProfileDraft, RoleImportance, IMPORTANCE_ORDER } from "./role-audio-contract";
import { getFileName, analyzeText, buildAudioSearchText, buildRoleSearchText, extractJsonObject, rankCandidatesForRole, scoreCandidate } from "./role-audio-scoring";

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
      // 08-24 路径裁定:候选 filePath 优先取虚拟 asset-file://(会被持久化进
      // tts profile),绝对 sourcePath 仅作兜底(瞬态消费)
      const filePath = (item.previewUrl || item.filePath || item.sourcePath || "").trim();
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
  options: AssignAudioOptions = {},
): RoleAudioAssignment[] {
  if (candidates.length === 0) return [];
  const usage = new Map<string, number>();
  const importanceOf = (roleId: string): RoleImportance =>
    options.importanceByRoleId?.[roleId] ?? "supporting";
  // 分层顺序：主角先挑（拿到最佳匹配），NPC 最后（允许复用）。
  const ordered = [...roles]
    .filter((role) => role.type === "role")
    .sort((left, right) =>
      IMPORTANCE_ORDER[importanceOf(left.id)] - IMPORTANCE_ORDER[importanceOf(right.id)]
      || left.id.localeCompare(right.id),
    );

  return ordered
    .map((role) => {
      const roleTraits = analyzeText(buildRoleSearchText(role));
      const allowReuse = importanceOf(role.id) === "npc";
      let best = candidates[0]!;
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestReason = "按候选顺序分配";

      candidates.forEach((candidate, index) => {
        const audioTraits = analyzeText(buildAudioSearchText(candidate));
        const usedCount = usage.get(candidate.id) ?? 0;
        const { score, reason } = scoreCandidate(roleTraits, audioTraits, usedCount, index, allowReuse);
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
  const importanceByRoleId = options.importanceByRoleId;
  const localAssignments = assignAudioToRoles(roles, candidates, { importanceByRoleId });
  const maxCandidatesPerRole = Math.max(1, options.maxCandidatesPerRole ?? 8);
  const importanceOf = (roleId: string): RoleImportance =>
    importanceByRoleId?.[roleId] ?? "supporting";

  const assignments: RoleAudioAssignment[] = [];
  const usage = new Map<string, number>();

  for (const localAssignment of localAssignments) {
    const allowReuse = importanceOf(localAssignment.role.id) === "npc";
    const rankedCandidates = rankCandidatesForRole(localAssignment.role, candidates, usage, allowReuse)
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

export function createRoleAudioVoiceProfileInput(
  assignment: RoleAudioAssignment,
  speakerId: TtsSpeakerId = toRoleSpeakerId(assignment.role.id),
): RoleAudioVoiceProfileDraft {
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

export function createNarratorVoiceTarget(): FixedVoiceTarget {
  return {
    speakerId: "narrator",
    role: {
      id: "fixed-voice-narrator",
      source: "manying-local",
      type: "role",
      name: "旁白",
      description: "电影级中文旁白，厚重克制，吐字清晰，停顿自然。",
      setting: "成年中文旁白，稳重、克制、叙事感强。",
    },
  };
}

export async function planFixedRoleVoices(
  input: PlanFixedRoleVoicesInput,
): Promise<FixedVoicePlan> {
  const fixed: FixedVoicePlan["fixed"] = [];
  const rebound: FixedVoicePlan["rebound"] = [];
  const created: FixedVoicePlan["created"] = [];
  const errors: FixedVoicePlanError[] = [];
  const uniqueTargets: FixedVoiceTarget[] = [];
  const targetBySpeaker = new Map<TtsSpeakerId, FixedVoiceTarget>();

  for (const target of input.targets) {
    const existing = targetBySpeaker.get(target.speakerId);
    if (existing) {
      if (existing.role.id !== target.role.id) {
        errors.push({
          speakerId: target.speakerId,
          code: "duplicate-speaker",
          message: `speaker ${target.speakerId} 对应多个角色资产: ${existing.role.id}, ${target.role.id}`,
        });
      }
      continue;
    }
    targetBySpeaker.set(target.speakerId, target);
    uniqueTargets.push(target);
  }

  const unbound: FixedVoiceTarget[] = [];
  // 旁白锁定配置家族（默认木成，可经 workflowConfig.narratorVoiceFamily 更换）：
  // 家族候选可用时，旁白只从家族内确定性选段，不再全库打分/AI 匹配漂移；
  // 既有绑定若已偏离家族则视为过期重新绑定。
  const narratorFamily = filterNarratorVoiceFamily(input.candidates, input.narratorVoiceFamily);
  for (const target of uniqueTargets) {
    const binding = input.bindings[target.speakerId];
    if (!binding) {
      unbound.push(target);
      continue;
    }

    const profile = input.voiceProfiles[binding.profileId];
    if (!profile) {
      errors.push({
        speakerId: target.speakerId,
        code: "missing-profile",
        message: `固定音色 ${target.speakerId} 缺少 profile ${binding.profileId}`,
      });
      continue;
    }
    if (
      target.speakerId === "narrator"
      && narratorFamily.length > 0
      && profile.type === "reference"
      && isNarratorProfileOffFamily(profile, input.narratorVoiceFamily)
    ) {
      unbound.push(target);
      continue;
    }
    const referenceAudioPath = profile.referenceAudioPath?.trim();
    if (!referenceAudioPath) {
      errors.push({
        speakerId: target.speakerId,
        code: "missing-reference-audio",
        message: `固定音色 ${target.speakerId} 缺少参考音频路径`,
      });
      continue;
    }
    if (!profile.referenceText?.trim()) {
      errors.push({
        speakerId: target.speakerId,
        code: "missing-reference-text",
        message: `固定音色 ${target.speakerId} 缺少参考文本`,
      });
      continue;
    }
    const profileError = validateVoiceProfileForGeneration(profile);
    if (profileError) {
      errors.push({
        speakerId: target.speakerId,
        code: "invalid-profile",
        message: `固定音色 ${target.speakerId} 不可用于生成: ${profileError}`,
      });
      continue;
    }
    const resolvedPath = await input.resolveReferenceAudioPath(referenceAudioPath);
    if (!resolvedPath) {
      errors.push({
        speakerId: target.speakerId,
        code: "unreadable-reference-audio",
        message: `固定音色 ${target.speakerId} 的参考音频不可读: ${referenceAudioPath}`,
      });
      continue;
    }
    fixed.push({
      speakerId: target.speakerId,
      binding,
      profile,
      match: "fixed",
    });
  }

  if (errors.length > 0 || unbound.length === 0) {
    return { fixed, rebound, created, errors };
  }

  // 同名角色跨 id 复用（用户要求：角色配音固定）：实体重抽生成新 characterId
  // 后绑定失配时，按「音色·<角色名>·」前缀找回既有 profile 直接重绑，
  // 不再重新分配——同名角色的声音跨章节/重抽保持不变。
  const reboundTargets = new Set<FixedVoiceTarget>();
  for (const target of unbound) {
    if (target.speakerId === "narrator") continue;
    const prefix = `音色·${target.role.name}·`;
    const matched = Object.values(input.voiceProfiles).find(
      (profile) => profile.type === "reference" && profile.name.startsWith(prefix),
    );
    if (!matched?.referenceAudioPath?.trim()) continue;
    rebound.push({
      speakerId: target.speakerId,
      binding: {
        speakerId: target.speakerId,
        defaultEngine: matched.defaultEngine,
        defaultModelSize: matched.defaultModelSize,
        profileId: matched.id,
      },
      profile: matched,
      match: "name-matched",
    });
    reboundTargets.add(target);
  }
  const remaining: FixedVoiceTarget[] = unbound.filter((target) => !reboundTargets.has(target));

  // 旁白确定性分配：家族内基准片段（平静优先），不走打分/AI。
  const narratorTargets = narratorFamily.length > 0
    ? remaining.filter((target) => target.speakerId === "narrator")
    : [];
  const autoTargets = remaining.filter(
    (target) => !(narratorFamily.length > 0 && target.speakerId === "narrator"),
  );
  const assignments: RoleAudioAssignment[] = [];
  for (const target of narratorTargets) {
    const base = pickNarratorVoiceBase(narratorFamily);
    if (base) {
      assignments.push({
        role: target.role,
        audio: base,
        reason: `旁白锁定${input.narratorVoiceFamily ?? DEFAULT_NARRATOR_VOICE_FAMILY}家族（基准=平静）`,
      });
    }
  }

  // 撞音色防护：已被既有绑定（fixed/rebound）占用的参考片段不进入自动分配
  // 候选池——新角色不会与已固定角色同声（池空则回落全量保证可分配）。
  const takenPaths = new Set(
    [...fixed, ...rebound]
      .map((item) => item.profile.referenceAudioPath?.trim())
      .filter((path): path is string => Boolean(path)),
  );
  const untakenCandidates = input.candidates.filter(
    (candidate) => !takenPaths.has(candidate.filePath.trim()),
  );
  const autoCandidatePool = untakenCandidates.length > 0 ? untakenCandidates : input.candidates;

  if (autoTargets.length > 0) {
    if (autoCandidatePool.length === 0) {
      for (const target of autoTargets) {
        errors.push({
          speakerId: target.speakerId,
          code: "missing-candidate",
          message: `未绑定 speaker ${target.speakerId}，且音频库没有可用候选`,
        });
      }
      return { fixed, rebound, created, errors };
    }

    const assignUnbound = input.assignUnbound ?? assignAudioToRoles;
    try {
      const autoAssignments = await assignUnbound(
        autoTargets.map((target) => target.role),
        autoCandidatePool,
        { importanceByRoleId: input.importanceByRoleId },
      );
      assignments.push(...autoAssignments);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const target of autoTargets) {
        errors.push({
          speakerId: target.speakerId,
          code: "assignment-failed",
          message: `speaker ${target.speakerId} 音色匹配失败: ${reason}`,
        });
      }
      return { fixed, rebound, created, errors };
    }
  }

  const assignmentByRoleId = new Map(
    assignments.map((assignment) => [assignment.role.id, assignment]),
  );
  for (const target of remaining) {
    const assignment = assignmentByRoleId.get(target.role.id);
    if (!assignment) {
      errors.push({
        speakerId: target.speakerId,
        code: "missing-candidate",
        message: `未给 speaker ${target.speakerId} 选出音频`,
      });
      continue;
    }
    if (!assignment.audio.referenceText?.trim()) {
      errors.push({
        speakerId: target.speakerId,
        code: "missing-reference-text",
        message: `speaker ${target.speakerId} 选中的音频缺少参考文本: ${assignment.audio.name}`,
      });
      continue;
    }
    const resolvedPath = await input.resolveReferenceAudioPath(
      assignment.audio.filePath,
    );
    if (!resolvedPath) {
      errors.push({
        speakerId: target.speakerId,
        code: "unreadable-reference-audio",
        message: `speaker ${target.speakerId} 选中的音频不可读: ${assignment.audio.filePath}`,
      });
      continue;
    }
    const normalizedAssignment: RoleAudioAssignment = {
      ...assignment,
      audio: {
        ...assignment.audio,
        filePath: resolvedPath,
      },
    };
    const draft = createRoleAudioVoiceProfileInput(
      normalizedAssignment,
      target.speakerId,
    );
    const draftError = validateVoiceProfileForGeneration({
      ...draft.profile,
      id: "pending-fixed-voice",
      createdAt: 0,
      updatedAt: 0,
    });
    if (draftError) {
      errors.push({
        speakerId: target.speakerId,
        code: "invalid-profile",
        message: `speaker ${target.speakerId} 选中的音色不可用于生成: ${draftError}`,
      });
      continue;
    }
    created.push({
      speakerId: target.speakerId,
      assignment: normalizedAssignment,
      draft,
      match: "ai-selected",
    });
  }

  return { fixed, rebound, created, errors };
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

/** AI 精选提示词（角色 → 候选片段），配合 parseRoleAudioAiMatchResult 使用。 */
export function buildRoleAudioAiMatchPrompt(request: RoleAudioAiMatchRequest): string {
  const role = request.role;
  const roleText = [role.description, role.setting, role.prompt, role.remark]
    .filter(Boolean)
    .join("；");
  const candidates = request.candidates
    .map((candidate, index) =>
      `${index + 1}. audioId=${candidate.id}｜${candidate.name}｜参考文本: ${(candidate.referenceText ?? "").slice(0, 48)}`)
    .join("\n");
  return `你是配音导演。为角色「${role.name}」从候选音频片段中选出音色最贴合的一段。
角色设定：${roleText || "(无)"}
本地初选：${request.localAssignment.audio.name}（${request.localAssignment.reason}）

候选片段（只能从中选）：
${candidates}

要求：结合角色性别、年龄、气质与身份选最贴合的一段；只输出 JSON，格式 {"audioId": "...", "reason": "一句话理由"}；不要输出任何解释文字。`;
}



export type { AssignAudioOptions, FixedVoicePlan, FixedVoicePlanError, FixedVoiceTarget, PlanFixedRoleVoicesInput, RoleAudioAiMatchRequest, RoleAudioAiMatchResult, RoleAudioAiOptions, RoleAudioAssignment, RoleAudioVoiceProfileDraft, RoleImportance } from "./role-audio-contract";
export { analyzeText, buildAudioSearchText, buildRoleSearchText, detectAge, detectArchetypes, detectGender, extractJsonObject, formatAge, isNearbyAge, rankCandidatesForRole, scoreCandidate } from "./role-audio-scoring";
