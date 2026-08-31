import type { AutoEditingRun, AutoEditingStage, AutoEditingWarning, EditingProjectV1 } from "@/types/editing";
import { buildStoryboardEditingProject } from "./storyboard-adapter";
import { validateAutoEditingRun, validateEditingProject } from "./validation";
import { findReusableDraft, staleProjectIds, validateInputScope } from "./auto-editing-planning";
import { adapterFailureWarnings, applyPendingProposals, arrangeAudio, arrangeVisualClips, sourceAndDurationDecisions } from "./auto-editing-arrangers";
import { RunAutoEditingDraftInput, RunAutoEditingDraftResult } from "./auto-editing-contract";
import { decision, errorMessage, projectInvalidWarning, warning } from "./auto-editing-utils";

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

  const audioArrangement = input.adapterInput.remotionShotSlots !== undefined
    ? { project, decisions: [], warnings: [] }
    : arrangeAudio(
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



export { adapterFailureWarnings, applyPendingProposals, arrangeAudio, arrangeVisualClips, sourceAndDurationDecisions } from "./auto-editing-arrangers";
export { decision, errorMessage, isRecord, mergeEvidence, orderedVisualClips, projectInvalidWarning, sourceReason, sourceRuleId, track, validApprovedSfx, validSelectedAudio, warning } from "./auto-editing-utils";
export type { ApprovedEditingSfx, AutoEditingAdapterInput, AutoEditingProposalContext, RunAutoEditingDraftInput, RunAutoEditingDraftResult, SelectedEditingBgm } from "./auto-editing-contract";
export { STORY_DRIVEN_V1_PRESET } from "./auto-editing-contract";
