import type {
  AutoEditingDecision,
  AutoEditingPresetV1,
  AutoEditingRequest,
  AutoEditingResult,
  AutoEditingRun,
  AutoEditingStage,
  AutoEditingWarning,
  EditingClip,
  EditingEffect,
  EditingProjectV1,
  EditingSourceEvidence,
  EditingTrack,
  EditingTransition,
} from "@/types/editing";
import {
  buildStoryboardEditingProject,
  type BuildStoryboardEditingProjectInput,
  type EditingDirectorHints,
  type StoryboardEditingAdapterResult,
} from "./storyboard-adapter";
import {
  validateAutoEditingRun,
  validateEditingProject,
} from "./validation";

export const STORY_DRIVEN_V1_PRESET = {
  version: 1,
  id: "story-driven-v1",
  imageScaleFrom: 1,
  imageScaleTo: 1.06,
  voiceTailPaddingUs: 200_000,
  maxTransitionUs: 350_000,
  maxTransitionRatio: 0.15,
  bgmDuckingDb: -12,
  bgmDuckingAttackUs: 120_000,
  bgmDuckingReleaseUs: 400_000,
} as const satisfies AutoEditingPresetV1;

export interface SelectedEditingBgm {
  id: string;
  mediaId: string;
  name: string;
  path: string;
}

export interface ApprovedEditingSfx extends SelectedEditingBgm {
  storyboardId: string;
  durationUs: number;
}

export type AutoEditingAdapterInput = Omit<
  BuildStoryboardEditingProjectInput,
  "editingProjectId" | "createdAt" | "name"
>;

export interface AutoEditingProposalContext {
  request: AutoEditingRequest;
  project: EditingProjectV1;
  hints: EditingDirectorHints;
}

export interface RunAutoEditingDraftInput {
  request: AutoEditingRequest;
  adapterInput: AutoEditingAdapterInput;
  existingProjects: EditingProjectV1[];
  runId: string;
  editingProjectId: string;
  now: () => number;
  draftName?: string;
  selectedBgm?: SelectedEditingBgm;
  approvedSfx?: ApprovedEditingSfx[];
  generateProposals?: (
    context: AutoEditingProposalContext,
  ) => Promise<unknown>;
  onRun?: (run: AutoEditingRun) => void | Promise<void>;
}

type AdapterFailure = Extract<
  StoryboardEditingAdapterResult,
  { success: false }
>;

export type RunAutoEditingDraftResult =
  | {
      success: true;
      result: AutoEditingResult;
      staleEditingProjectIds: string[];
    }
  | {
      success: false;
      run: AutoEditingRun;
      adapterFailure?: AdapterFailure;
    };

export async function runAutoEditingDraft(
  input: RunAutoEditingDraftInput,
): Promise<RunAutoEditingDraftResult> {
  let run = createRun(input);
  await input.onRun?.(run);

  const scopeWarning = validateInputScope(input);
  if (scopeWarning) {
    run = await failRun(input, run, [scopeWarning], scopeWarning.message);
    return { success: false, run };
  }

  const reusable = input.request.forceNewDraft
    ? undefined
    : findReusableDraft(input);
  if (reusable) {
    run = {
      ...run,
      decisions: [
        decision(
          "decision-draft-reuse",
          "source",
          "draft.reuse.snapshot",
          reusable.id,
          { sourceSnapshotHash: input.adapterInput.sourceSnapshotHash },
          { editingProjectId: reusable.id },
          "输入快照未变化，重新打开未修改的自动草案",
          {},
        ),
      ],
      editingProjectId: reusable.id,
    };
    for (const stage of [
      "selectingSources",
      "arrangingClips",
      "arrangingAudio",
      "arrangingSubtitles",
      "generatingProposals",
      "previewReady",
    ] as const) {
      run = await advanceRun(input, run, stage);
    }
    return finalizeSuccessfulDraft(input, run, reusable, true, []);
  }

  run = await advanceRun(input, run, "selectingSources");
  const adapterResult = buildStoryboardEditingProject({
    ...input.adapterInput,
    editingProjectId: input.editingProjectId,
    name: input.draftName,
    createdAt: run.startedAt,
    voiceTailPaddingUs: input.request.preset.voiceTailPaddingUs,
  });
  if (!adapterResult.success) {
    const warnings = adapterFailureWarnings(adapterResult);
    run = await failRun(
      input,
      run,
      warnings,
      "分镜素材未通过一键剪辑 preflight",
    );
    return { success: false, run, adapterFailure: adapterResult };
  }

  let project = adapterResult.project;
  let decisions = [
    ...sourceAndDurationDecisions(project, input.adapterInput),
  ];
  const clipArrangement = arrangeVisualClips(
    project,
    adapterResult.hints,
    input.request.preset,
  );
  project = clipArrangement.project;
  decisions = [...decisions, ...clipArrangement.decisions];
  const deterministicValidation = validateEditingProject(project);
  if (!deterministicValidation.success) {
    run = await failRun(
      input,
      { ...run, decisions },
      [projectInvalidWarning(deterministicValidation.issues[0]?.message)],
      "确定性剪辑产生了无效项目",
    );
    return { success: false, run };
  }
  project = deterministicValidation.value;
  run = await advanceRun(input, { ...run, decisions }, "arrangingClips");

  const audioArrangement = arrangeAudio(
    project,
    adapterResult.hints,
    input.selectedBgm,
    input.approvedSfx ?? [],
  );
  const audioValidation = validateEditingProject(audioArrangement.project);
  if (!audioValidation.success) {
    run = await failRun(
      input,
      {
        ...run,
        decisions: [...run.decisions, ...audioArrangement.decisions],
        warnings: [...run.warnings, ...audioArrangement.warnings],
      },
      [projectInvalidWarning(audioValidation.issues[0]?.message)],
      "声音铺轨产生了无效项目",
    );
    return { success: false, run };
  }
  project = audioValidation.value;
  run = await advanceRun(
    input,
    {
      ...run,
      decisions: [...run.decisions, ...audioArrangement.decisions],
      warnings: [...run.warnings, ...audioArrangement.warnings],
    },
    "arrangingAudio",
  );

  const subtitleDecisions = project.clips
    .filter((clip) => clip.source.kind === "text")
    .map((clip) =>
      decision(
        `decision-subtitle-${clip.id}`,
        "subtitle",
        "subtitle.storyboard-spoken-text",
        clip.id,
        { textLength: clip.source.text?.length ?? 0 },
        { startUs: clip.startUs, durationUs: clip.durationUs },
        "复用分镜字幕优先级生成的逐镜字幕",
        clip.source.evidence,
      ),
    );
  run = await advanceRun(
    input,
    { ...run, decisions: [...run.decisions, ...subtitleDecisions] },
    "arrangingSubtitles",
  );

  run = await advanceRun(input, run, "generatingProposals");
  if (input.generateProposals) {
    try {
      const rawProposals = await input.generateProposals({
        request: input.request,
        project,
        hints: adapterResult.hints,
      });
      const proposalResult = applyPendingProposals(project, rawProposals);
      if (proposalResult.success) {
        project = proposalResult.project;
        run = {
          ...run,
          decisions: [
            ...run.decisions,
            ...project.proposals.map((proposal) =>
              decision(
                `decision-proposal-${proposal.id}`,
                "proposal",
                "proposal.ai.pending",
                proposal.id,
                { confidence: proposal.confidence },
                { status: proposal.status, effectId: proposal.effectId },
                proposal.reason,
                proposal.sourceEvidence,
              ),
            ),
          ],
        };
      } else {
        run = {
          ...run,
          warnings: [
            ...run.warnings,
            warning(
              "editing.auto.proposal_invalid",
              proposalResult.message,
              true,
            ),
          ],
        };
      }
    } catch (error) {
      run = {
        ...run,
        warnings: [
          ...run.warnings,
          warning(
            "editing.auto.ai_failed",
            `AI 剪辑建议不可用: ${errorMessage(error)}`,
            true,
          ),
        ],
      };
    }
  }

  run = await advanceRun(
    input,
    { ...run, editingProjectId: project.id },
    "previewReady",
  );
  return finalizeSuccessfulDraft(
    input,
    run,
    project,
    false,
    staleProjectIds(input),
  );
}

function createRun(input: RunAutoEditingDraftInput): AutoEditingRun {
  const startedAt = input.now();
  return {
    id: input.runId,
    projectId: input.request.projectId,
    episodeId: input.request.episodeId,
    sourceSnapshotHash: input.adapterInput.sourceSnapshotHash,
    presetId: input.request.preset.id,
    stage: "preflight",
    decisions: [],
    warnings: [],
    startedAt,
    updatedAt: startedAt,
  };
}

function validateInputScope(
  input: RunAutoEditingDraftInput,
): AutoEditingWarning | null {
  if (
    input.request.projectId !== input.adapterInput.projectId ||
    input.request.episodeId !== input.adapterInput.episodeId
  ) {
    return warning(
      "editing.auto.request_scope",
      "一键剪辑 request 与分镜输入的 project/episode 不一致",
      false,
    );
  }
  if (!input.runId.trim() || !input.editingProjectId.trim()) {
    return warning(
      "editing.auto.id_required",
      "一键剪辑 runId 和 editingProjectId 不能为空",
      false,
    );
  }
  const preset = input.request.preset;
  if (
    preset.id !== "story-driven-v1" ||
    preset.version !== 1 ||
    !positiveSafeInteger(preset.voiceTailPaddingUs) ||
    !positiveSafeInteger(preset.maxTransitionUs) ||
    !Number.isFinite(preset.maxTransitionRatio) ||
    preset.maxTransitionRatio <= 0 ||
    preset.maxTransitionRatio > 1 ||
    !Number.isFinite(preset.imageScaleFrom) ||
    !Number.isFinite(preset.imageScaleTo) ||
    preset.imageScaleFrom <= 0 ||
    preset.imageScaleTo <= 0
  ) {
    return warning(
      "editing.auto.preset_invalid",
      "story-driven-v1 preset 参数无效",
      false,
    );
  }
  return null;
}

function findReusableDraft(input: RunAutoEditingDraftInput) {
  return [...input.existingProjects]
    .filter(
      (project) =>
        project.projectId === input.request.projectId &&
        project.episodeId === input.request.episodeId &&
        project.createdBy === "auto" &&
        !project.manuallyEdited &&
        !project.stale &&
        project.sourceSnapshotHash === input.adapterInput.sourceSnapshotHash,
    )
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    )
    .at(-1);
}

function staleProjectIds(input: RunAutoEditingDraftInput) {
  return input.existingProjects
    .filter(
      (project) =>
        project.projectId === input.request.projectId &&
        project.episodeId === input.request.episodeId &&
        project.createdBy === "auto" &&
        !project.stale &&
        project.sourceSnapshotHash !== input.adapterInput.sourceSnapshotHash,
    )
    .map((project) => project.id)
    .sort();
}

function sourceAndDurationDecisions(
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

function arrangeVisualClips(
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

function arrangeAudio(
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

function applyPendingProposals(
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

function adapterFailureWarnings(
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

async function advanceRun(
  input: RunAutoEditingDraftInput,
  run: AutoEditingRun,
  stage: AutoEditingStage,
) {
  const next = { ...run, stage, updatedAt: input.now() };
  await input.onRun?.(next);
  return next;
}

async function finalizeSuccessfulDraft(
  input: RunAutoEditingDraftInput,
  run: AutoEditingRun,
  project: EditingProjectV1,
  reusedExistingDraft: boolean,
  staleEditingProjectIds: string[],
): Promise<RunAutoEditingDraftResult> {
  const completedAt = input.now();
  const completedRun: AutoEditingRun = {
    ...run,
    stage: "completed",
    updatedAt: completedAt,
    completedAt,
  };
  const projectValidation = validateEditingProject(project);
  const runValidation = validateAutoEditingRun(completedRun);
  if (!projectValidation.success || !runValidation.success) {
    const message = !projectValidation.success
      ? projectValidation.issues[0]?.message
      : !runValidation.success
        ? runValidation.issues[0]?.message
        : undefined;
    const failedRun = await failRun(
      input,
      run,
      [projectInvalidWarning(message)],
      "自动剪辑结果未通过 T1 validator",
    );
    return { success: false, run: failedRun };
  }
  await input.onRun?.(runValidation.value);
  return {
    success: true,
    result: {
      run: runValidation.value,
      project: projectValidation.value,
      reusedExistingDraft,
    },
    staleEditingProjectIds,
  };
}

async function failRun(
  input: RunAutoEditingDraftInput,
  run: AutoEditingRun,
  warnings: AutoEditingWarning[],
  error: string,
) {
  const completedAt = input.now();
  const next: AutoEditingRun = {
    ...run,
    stage: "failed",
    warnings: [...run.warnings, ...warnings],
    error,
    updatedAt: completedAt,
    completedAt,
  };
  await input.onRun?.(next);
  return next;
}

function orderedVisualClips(project: EditingProjectV1) {
  const visualTrackIds = new Set(
    project.tracks
      .filter((item) => item.kind === "video" || item.kind === "image")
      .map((item) => item.id),
  );
  return project.clips
    .filter((clip) => visualTrackIds.has(clip.trackId))
    .sort(
      (left, right) =>
        left.startUs - right.startUs || left.id.localeCompare(right.id),
    );
}

function sourceRuleId(clip: EditingClip) {
  switch (clip.source.kind) {
    case "videoCandidate":
      return "source.selected-candidate";
    case "storyboardVideo":
      return "source.storyboard-video";
    case "storyboardImage":
      return "source.storyboard-image";
    default:
      return "source.adapter";
  }
}

function sourceReason(clip: EditingClip) {
  switch (clip.source.kind) {
    case "videoCandidate":
      return "使用已选择、ready、非 stale 的视频候选";
    case "storyboardVideo":
      return "没有可用已选候选，使用分镜自身视频";
    case "storyboardImage":
      return "没有可用视频，使用分镜图片";
    default:
      return "使用 adapter 已验证的画面来源";
  }
}

function explicitTransitionEffect(
  hint: string | undefined,
): EditingTransition["effectId"] | null {
  if (!hint) return null;
  if (/黑场/.test(hint)) return "blackout";
  if (/闪白/.test(hint)) return "flash";
  if (/叠化|交叉淡化|cross\s*fade/i.test(hint)) return "crossfade";
  if (/淡入|淡出|\bfade\b/i.test(hint)) return "fade";
  return null;
}

function explicitTransitionDuration(
  from: EditingClip,
  to: EditingClip,
  preset: AutoEditingPresetV1,
) {
  const ratioDuration = Math.floor(
    Math.min(from.durationUs, to.durationUs) * preset.maxTransitionRatio,
  );
  if (ratioDuration < 1) return 0;
  return Math.min(preset.maxTransitionUs, ratioDuration);
}

function transitionParams(
  effectId: EditingTransition["effectId"],
): EditingTransition["params"] {
  switch (effectId) {
    case "fade":
      return { opacity: 1 };
    case "crossfade":
      return { curve: "linear" };
    case "flash":
      return { intensity: 0.8 };
    case "blackout":
      return { hold: 0.15 };
    case "cut":
      return {};
  }
}

function track(
  id: string,
  kind: EditingTrack["kind"],
  name: string,
  order: number,
  clips: EditingClip[],
): EditingTrack {
  return {
    id,
    kind,
    name,
    order,
    clipIds: clips.map((clip) => clip.id),
    muted: false,
    locked: false,
  };
}

function validSelectedAudio(value: SelectedEditingBgm) {
  return Boolean(
    value.id.trim() &&
      value.mediaId.trim() &&
      value.name.trim() &&
      value.path.trim(),
  );
}

function validApprovedSfx(value: ApprovedEditingSfx) {
  return (
    validSelectedAudio(value) &&
    value.storyboardId.trim().length > 0 &&
    Number.isSafeInteger(value.durationUs) &&
    value.durationUs > 0
  );
}

function mergeEvidence(
  from: EditingSourceEvidence,
  to: EditingSourceEvidence,
): EditingSourceEvidence {
  return {
    storyboardId: to.storyboardId ?? from.storyboardId,
    trackId: to.trackId ?? from.trackId,
    candidateId: to.candidateId ?? from.candidateId,
    mediaId: to.mediaId ?? from.mediaId,
    sourceRunId: to.sourceRunId ?? from.sourceRunId,
    sourceFingerprint: to.sourceFingerprint ?? from.sourceFingerprint,
    outputVersion: to.outputVersion ?? from.outputVersion,
  };
}

function decision(
  id: string,
  kind: AutoEditingDecision["kind"],
  ruleId: string,
  targetId: string,
  input: AutoEditingDecision["input"],
  output: AutoEditingDecision["output"],
  reason: string,
  sourceEvidence: EditingSourceEvidence,
): AutoEditingDecision {
  return {
    id,
    kind,
    ruleId,
    targetId,
    input,
    output,
    reason,
    sourceEvidence,
  };
}

function warning(
  code: string,
  message: string,
  recoverable: boolean,
  targetId?: string,
): AutoEditingWarning {
  return { code, message, recoverable, ...(targetId ? { targetId } : {}) };
}

function projectInvalidWarning(message: string | undefined) {
  return warning(
    "editing.auto.project_invalid",
    message ?? "一键剪辑项目未通过 T1 validator",
    false,
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function positiveSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
