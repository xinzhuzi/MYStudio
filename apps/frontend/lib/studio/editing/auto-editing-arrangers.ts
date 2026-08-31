import { EditingDirectorHints } from "./storyboard-adapter";
import type { AdapterFailure } from "./auto-editing-contract";
import { explicitTransitionDuration, explicitTransitionEffect, transitionParams } from "./transition-policy";
import { validateEditingProject } from "./validation";
import type { AutoEditingDecision, AutoEditingPresetV1, AutoEditingWarning, EditingClip, EditingEffect, EditingProjectV1, EditingTransition } from "@/types/editing";
import { ApprovedEditingSfx, AutoEditingAdapterInput, SelectedEditingBgm } from "./auto-editing-contract";
import { decision, isRecord, mergeEvidence, orderedVisualClips, sourceReason, sourceRuleId, track, validApprovedSfx, validSelectedAudio, warning } from "./auto-editing-utils";

/**
 * 自动剪辑排布器族——视觉片段排布/音频排布/提案应用/适配器告警。file-size-reduction 拆出,体逐字保留。
 */
export function sourceAndDurationDecisions(
  project: EditingProjectV1,
  input: AutoEditingAdapterInput,
) {
  const storyboardById = new Map(
    input.storyboards.map((storyboard) => [storyboard.id, storyboard]),
  );
  const visualClips = orderedVisualClips(project);
  return visualClips.flatMap((clip) => {
    const storyboardId = clip.source.evidence.storyboardId;
    const storyboard = storyboardId
      ? storyboardById.get(storyboardId)
      : undefined;
    const baseDurationUs = storyboard
      ? Math.round(
          (Number(storyboard.durationTarget) > 0
            ? Number(storyboard.durationTarget)
            : Number(storyboard.duration)) * 1_000_000,
        )
      : null;
    const voiceDurationUs = storyboardId
      ? input.voiceDurationsUs?.[storyboardId] ?? null
      : null;
    return [
      decision(
        `decision-source-${clip.id}`,
        "source",
        sourceRuleId(clip),
        clip.id,
        {
          storyboardId: storyboardId ?? null,
          candidateId: clip.source.evidence.candidateId ?? null,
        },
        {
          sourceKind: clip.source.kind,
          sourcePath: clip.source.path ?? null,
          trimStartUs: clip.trimStartUs,
        },
        sourceReason(clip),
        clip.source.evidence,
      ),
      decision(
        `decision-duration-${clip.id}`,
        "duration",
        voiceDurationUs && baseDurationUs && voiceDurationUs > baseDurationUs
          ? "duration.extend-for-voice"
          : "duration.keep-director-target",
        clip.id,
        { baseDurationUs, voiceDurationUs },
        { durationUs: clip.durationUs },
        voiceDurationUs && baseDurationUs && voiceDurationUs > baseDurationUs
          ? "voice 超过导演时长，保留 0.2 秒尾垫"
          : "voice 未超过导演时长，保留导演节奏",
        clip.source.evidence,
      ),
    ];
  });
}

export function arrangeVisualClips(
  project: EditingProjectV1,
  hints: EditingDirectorHints,
  preset: AutoEditingPresetV1,
) {
  const visualClips = orderedVisualClips(project);
  const transitions: EditingTransition[] = [];
  const effects: EditingEffect[] = [];
  const decisions: AutoEditingDecision[] = [];
  const explicitEffect = explicitTransitionEffect(hints.transitions);

  for (const clip of visualClips) {
    if (clip.source.kind !== "storyboardImage") continue;
    effects.push({
      id: `effect-pan-zoom-${clip.id}`,
      effectId: "panZoom",
      targetClipId: clip.id,
      startUs: clip.startUs,
      durationUs: clip.durationUs,
      params: {
        scaleFrom: preset.imageScaleFrom,
        scaleTo: preset.imageScaleTo,
        x: 0.5,
        y: 0.5,
      },
      enabled: true,
    });
    decisions.push(
      decision(
        `decision-motion-${clip.id}`,
        "motion",
        "motion.image.pan-zoom",
        clip.id,
        { sourceKind: clip.source.kind },
        {
          scaleFrom: preset.imageScaleFrom,
          scaleTo: preset.imageScaleTo,
        },
        "静态分镜图增加轻微推拉，视频来源不二次运镜",
        clip.source.evidence,
      ),
    );
  }

  for (let index = 0; index < visualClips.length - 1; index += 1) {
    const from = visualClips[index];
    const to = visualClips[index + 1];
    const isConservativeTarget = index === visualClips.length - 2;
    const effectId = isConservativeTarget ? explicitEffect : null;
    const durationUs = effectId
      ? explicitTransitionDuration(from, to, preset)
      : 0;
    if (effectId && durationUs > 0) {
      transitions.push({
        id: `transition-${from.id}-${to.id}`,
        fromClipId: from.id,
        toClipId: to.id,
        effectId,
        durationUs,
        params: transitionParams(effectId),
      });
    }
    decisions.push(
      decision(
        `decision-transition-${from.id}-${to.id}`,
        "transition",
        effectId && durationUs > 0
          ? `transition.explicit.${effectId}`
          : "transition.default.cut",
        `${from.id}->${to.id}`,
        {
          directorHint: hints.transitions ?? null,
          shorterDurationUs: Math.min(from.durationUs, to.durationUs),
        },
        {
          effectId: effectId && durationUs > 0 ? effectId : "cut",
          durationUs,
        },
        effectId && durationUs > 0
          ? "导演计划明确要求基础转场，仅映射到保守目标边界"
          : "没有逐边界明确转场证据，保持硬切",
        mergeEvidence(from.source.evidence, to.source.evidence),
      ),
    );
  }

  return {
    project: { ...project, transitions, effects },
    decisions,
  };
}

export function arrangeAudio(
  project: EditingProjectV1,
  hints: EditingDirectorHints,
  selectedBgm: SelectedEditingBgm | undefined,
  approvedSfx: ApprovedEditingSfx[],
) {
  const clips = [...project.clips];
  const tracks = [...project.tracks];
  const decisions: AutoEditingDecision[] = project.clips
    .filter((clip) => clip.source.kind === "audio")
    .map((clip) =>
      decision(
        `decision-audio-${clip.id}`,
        "audio",
        "audio.voice.actual",
        clip.id,
        { sourcePath: clip.source.path ?? null },
        { startUs: clip.startUs, durationUs: clip.durationUs },
        "复用分镜真实 audioRef 铺设逐镜 voice",
        clip.source.evidence,
      ),
    );
  const warnings: AutoEditingWarning[] = [];
  let nextOrder = tracks.reduce(
    (maximum, track) => Math.max(maximum, track.order),
    -1,
  ) + 1;
  const visualClips = orderedVisualClips(project);
  const timelineDurationUs = visualClips.reduce(
    (maximum, clip) => Math.max(maximum, clip.startUs + clip.durationUs),
    0,
  );

  if (selectedBgm && validSelectedAudio(selectedBgm) && timelineDurationUs > 0) {
    const trackId = `${project.id}-bgm`;
    const clip: EditingClip = {
      id: `bgm-${selectedBgm.id}`,
      trackId,
      name: selectedBgm.name,
      source: {
        kind: "audio",
        path: selectedBgm.path,
        evidence: { mediaId: selectedBgm.mediaId },
      },
      startUs: 0,
      durationUs: timelineDurationUs,
      trimStartUs: 0,
      speed: 1,
      volume: 1,
      muted: false,
    };
    tracks.push(track(trackId, "bgm", "背景音乐", nextOrder, [clip]));
    clips.push(clip);
    nextOrder += 1;
    decisions.push(
      decision(
        `decision-audio-bgm-${selectedBgm.id}`,
        "audio",
        "audio.bgm.selected",
        clip.id,
        { mediaId: selectedBgm.mediaId },
        { startUs: 0, durationUs: timelineDurationUs },
        "仅铺设项目明确选择的 BGM",
        clip.source.evidence,
      ),
    );
  } else {
    warnings.push(
      warning(
        "editing.auto.bgm_missing",
        "项目未明确选择 BGM，自动剪辑已跳过背景音乐",
        true,
      ),
    );
  }

  const visualByStoryboardId = new Map(
    visualClips.flatMap((clip) => {
      const storyboardId = clip.source.evidence.storyboardId;
      return storyboardId ? [[storyboardId, clip] as const] : [];
    }),
  );
  const approvedByStoryboardId = new Map(
    approvedSfx.map((asset) => [asset.storyboardId, asset]),
  );
  const sfxClips: EditingClip[] = [];
  for (const item of hints.storyboardSounds) {
    const asset = approvedByStoryboardId.get(item.storyboardId);
    const visual = visualByStoryboardId.get(item.storyboardId);
    if (!asset || !visual || !validApprovedSfx(asset)) {
      warnings.push(
        warning(
          "editing.auto.sfx_missing",
          `分镜 ${item.storyboardId} 的 sound 没有已批准 SFX，已保留待处理建议`,
          true,
          item.storyboardId,
        ),
      );
      continue;
    }
    const trackId = `${project.id}-sfx`;
    const clip: EditingClip = {
      id: `sfx-${asset.id}`,
      trackId,
      name: asset.name,
      source: {
        kind: "audio",
        path: asset.path,
        evidence: {
          storyboardId: item.storyboardId,
          mediaId: asset.mediaId,
        },
      },
      startUs: visual.startUs,
      durationUs: asset.durationUs,
      trimStartUs: 0,
      speed: 1,
      volume: 1,
      muted: false,
    };
    sfxClips.push(clip);
    decisions.push(
      decision(
        `decision-audio-sfx-${asset.id}`,
        "audio",
        "audio.sfx.approved",
        clip.id,
        { storyboardSound: item.sound, mediaId: asset.mediaId },
        { startUs: clip.startUs, durationUs: clip.durationUs },
        "使用分镜 sound 已批准映射的 SFX",
        clip.source.evidence,
      ),
    );
  }
  if (sfxClips.length > 0) {
    const trackId = `${project.id}-sfx`;
    tracks.push(track(trackId, "sfx", "音效", nextOrder, sfxClips));
    clips.push(...sfxClips);
  }

  return {
    project: { ...project, tracks, clips },
    decisions,
    warnings,
  };
}

export function applyPendingProposals(
  project: EditingProjectV1,
  value: unknown,
):
  | { success: true; project: EditingProjectV1 }
  | { success: false; message: string } {
  if (!Array.isArray(value)) {
    return { success: false, message: "AI 剪辑建议必须是数组" };
  }
  if (
    value.some(
      (proposal) =>
        !isRecord(proposal) || proposal.status !== "pending",
    )
  ) {
    return {
      success: false,
      message: "AI 剪辑建议只能以 pending 状态进入草案",
    };
  }
  const validation = validateEditingProject({ ...project, proposals: value });
  if (!validation.success) {
    return {
      success: false,
      message:
        validation.issues[0]?.message ?? "AI 剪辑建议未通过效果白名单校验",
    };
  }
  return { success: true, project: validation.value };
}

export function adapterFailureWarnings(
  failure: AdapterFailure,
): AutoEditingWarning[] {
  const warnings: AutoEditingWarning[] = [];
  if (failure.episodeMissing) {
    warnings.push(
      warning(
        "editing.auto.episode_missing",
        "目标剧集没有动态分镜",
        false,
      ),
    );
  }
  for (const storyboardId of failure.missingVisualStoryboardIds) {
    warnings.push(
      warning(
        "editing.auto.missing_visual",
        `分镜 ${storyboardId} 缺少可用画面素材`,
        false,
        storyboardId,
      ),
    );
  }
  for (const storyboardId of failure.missingAudioStoryboardIds) {
    warnings.push(
      warning(
        "editing.auto.missing_audio",
        `分镜 ${storyboardId} 有台词但缺少真实 audioRef`,
        false,
        storyboardId,
      ),
    );
  }
  for (const storyboardId of failure.invalidDurationStoryboardIds) {
    warnings.push(
      warning(
        "editing.auto.invalid_duration",
        `分镜 ${storyboardId} 的导演时长无效`,
        false,
        storyboardId,
      ),
    );
  }
  for (const storyboardId of failure.invalidVoiceDurationStoryboardIds) {
    warnings.push(
      warning(
        "editing.auto.invalid_voice_duration",
        `分镜 ${storyboardId} 的真实 voice 时长无效`,
        false,
        storyboardId,
      ),
    );
  }
  return warnings;
}

