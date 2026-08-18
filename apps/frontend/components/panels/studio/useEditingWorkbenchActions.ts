import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  buildChapterEditingProject,
} from "@/lib/studio/editing/chapter-editing-pipeline";
import { buildVideoWorkflowChapterRunRequest } from "@/lib/studio/video-workflow/chapter-run-request";
import { videoWorkflowStoryboardBlocker } from "@/lib/studio/video-workflow/chapter-run-request";
import { projectVideoUseArtifactToEditingProject } from "@/lib/studio/video-workflow/editing-project-projection";
import { useEditingStore } from "@/stores/editing/editing-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { EditingProjectV1 } from "@/types/editing";
import type { ScriptPlan, StoryboardItem } from "@/types/studio";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import type {
  VideoWorkflowChapterRunReplyV1,
  VideoWorkflowChapterApplyReplyV1,
} from "@rendering/contracts/video-workflow-ipc";
import type { VideoUseDerivedInputPolicy, VideoUseStoryboardSourcePolicy } from "@rendering/contracts/video-workflow";

export interface UseEditingWorkbenchActionsInput {
  projectId?: string;
  episodeId: string;
  projectName: string;
  aspectRatio?: string;
  directorPlan?: ScriptPlan;
  storyboards: StoryboardItem[];
  remotionShotSlots?: RemotionCurrentSlotV1[];
  storyboardSourcePolicy?: VideoUseStoryboardSourcePolicy;
}

/**
 * Thin preparation bridge for the native Remotion Studio host.
 *
 * Chapter rendering, cancellation, subtitle exchange and timeline commands
 * belong to native Studio/queue IPC. They are intentionally not exposed from
 * this hook so the renderer cannot reintroduce the retired timeline renderer.
 */
export function useEditingWorkbenchActions(
  input: UseEditingWorkbenchActionsInput,
) {
  const editingProjectId = useEditingStore((state) =>
    input.projectId
      && state.activeProjectId === input.projectId
      && input.episodeId
      ? state.currentEditingProjectIdByEpisode[input.episodeId]
      : undefined,
  );
  const currentProject = useEditingStore((state) =>
    editingProjectId ? state.editingProjects[editingProjectId] : undefined,
  );
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string>();
  const [videoUseState, setVideoUseState] = useState<"idle" | "pending" | "accepted" | "blocked">("idle");
  const [videoUseRevision, setVideoUseRevision] = useState<number>();
  const [videoUseInputSha, setVideoUseInputSha] = useState<string>();
  const [videoUseBusy, setVideoUseBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [hyperFramesState, setHyperFramesState] = useState<"idle" | "accepted" | "noop" | "blocked">("idle");
  const chapterStatusRequestVersion = useRef(0);
  const storyboardSourcePolicy = input.storyboardSourcePolicy ?? "current-ready";
  const storyboardBlocker = videoWorkflowStoryboardBlocker(input.storyboards, input.episodeId, storyboardSourcePolicy);

  useEffect(() => {
    useEditingStore.getState().setActiveProjectId(input.projectId ?? null);
  }, [input.projectId]);

  useEffect(() => {
    const requestVersion = ++chapterStatusRequestVersion.current;
    const bridge = typeof window !== "undefined" ? window.videoWorkflowPlugins : undefined;
    if (!input.projectId || !input.episodeId || !bridge?.readChapter) {
      setVideoUseState("idle"); setVideoUseRevision(undefined); setVideoUseInputSha(undefined); setHyperFramesState("idle"); return;
    }
    if (storyboardBlocker) {
      setVideoUseState("blocked");
      setHyperFramesState("blocked");
      setVideoUseRevision(undefined);
      setVideoUseInputSha(undefined);
      setError(storyboardBlocker);
      return;
    }
    let cancelled = false;
    void bridge.readChapter({ schemaVersion: 1, projectId: input.projectId, chapterId: input.episodeId }).then((status) => {
      if (cancelled || requestVersion !== chapterStatusRequestVersion.current) return;
      setVideoUseState(status.videoUseState);
      setHyperFramesState(status.hyperFramesState);
      setVideoUseRevision(status.revision);
      setVideoUseInputSha(status.inputSha256);
      setError(status.videoUseState === "blocked" ? status.message ?? "视频工作流 artifact 恢复被阻塞" : undefined);
    }).catch((caught) => {
      if (!cancelled && requestVersion === chapterStatusRequestVersion.current) {
        setVideoUseState("blocked");
        setHyperFramesState("blocked");
        setVideoUseRevision(undefined);
        setVideoUseInputSha(undefined);
        setError(errorMessage(caught));
      }
    });
    return () => { cancelled = true; };
  }, [input.episodeId, input.projectId, storyboardBlocker, storyboardSourcePolicy]);

  const createDraft = useCallback(async (options: { preserveVideoWorkflowState?: boolean } = {}): Promise<EditingProjectV1> => {
    const projectId = input.projectId;
    if (!projectId) throw new Error("请先选择项目再准备 Remotion 章节工作台");
    if (!input.episodeId) throw new Error("当前工作流缺少章节 ID");
    const remotionShotSlots = await readCurrentRemotionShotSlotsForDraft({
      projectId,
      chapterId: input.episodeId,
      fallbackSlots: input.remotionShotSlots,
    });
    if (remotionShotSlots.length === 0) {
      throw new Error("当前章节缺少已完成的 Remotion 分镜输出，请先完成分镜队列");
    }
    setDrafting(true);
    setError(undefined);
    try {
      assertProjectActive(projectId);
      const state = useEditingStore.getState();
      if (state.activeProjectId !== projectId) state.setActiveProjectId(projectId);
      const now = Date.now;
      const result = await buildChapterEditingProject({
        projectId,
        episodeId: input.episodeId,
        projectName: input.projectName,
        aspectRatio: input.aspectRatio,
        directorPlan: input.directorPlan,
        storyboards: input.storyboards,
        productionTracks: [],
        videoCandidates: [],
        remotionShotSlots,
        allowStaleStoryboards: storyboardSourcePolicy === "reuse-existing",
        existingProjects: Object.values(state.editingProjects).filter(
          (project) => project.projectId === projectId && project.episodeId === input.episodeId,
        ),
        runId: uniqueId("remotion-edit"),
        editingProjectId: uniqueId(`editing-${input.episodeId}`),
        now,
        onRun: (run) => {
          const saved = useEditingStore.getState().saveAutoEditingRun(run);
          if (!saved.success) throw new Error(saved.issue.message);
        },
      });
      assertProjectActive(projectId);
      if (!result.success) {
        throw new Error(`${formatDraftFailure(result)}；本次读取 ${remotionShotSlots.length} 个 Remotion current slot，章节输入 ${input.storyboards.filter((storyboard) => storyboard.episodeId === input.episodeId).length} 个分镜`);
      }
      const committed = useEditingStore.getState().commitAutoEditingResult(
        result.result,
        result.staleEditingProjectIds,
        now(),
      );
      if (!committed.success) throw new Error(committed.issue.message);
      if (!options.preserveVideoWorkflowState) {
        setVideoUseState("idle");
        setVideoUseRevision(undefined);
        setVideoUseInputSha(undefined);
        setHyperFramesState("idle");
      }
      toast.success(result.result.reusedExistingDraft ? "已打开当前章节 Remotion 工程" : "当前章节 Remotion 工程已准备");
      return useEditingStore.getState().editingProjects[committed.editingProjectId]
        ?? result.result.project;
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      toast.error(message);
      throw caught;
    } finally {
      setDrafting(false);
    }
// eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const runVideoUse = useCallback(async (
    mode: "editable-edl" | "flat-shot-mp4" = "editable-edl",
    derivedInputPolicy: VideoUseDerivedInputPolicy = "reject",
    requestedStoryboardSourcePolicy: VideoUseStoryboardSourcePolicy = storyboardSourcePolicy,
  ): Promise<VideoWorkflowChapterRunReplyV1> => {
    const projectId = input.projectId;
    const project = useEditingStore.getState().getCurrentEditingProject(input.episodeId);
    const bridge = typeof window !== "undefined" ? window.videoWorkflowPlugins : undefined;
    if (!projectId) throw new Error("请先选择项目再运行 video-use");
    if (!bridge?.runChapter) throw new Error("当前环境未接入 video-use 章节 bridge");
    assertProjectActive(projectId);
    chapterStatusRequestVersion.current += 1;
    const revision = (project?.revision ?? 1) + 1;
    setVideoUseBusy(true);
    setError(undefined);
    try {
      const scriptPlanTransitions = useStudioStore
        .getState()
        .scriptPlans.find((plan) => plan.episodeId === input.episodeId)?.transitions;
      const request = await buildVideoWorkflowChapterRunRequest({
        projectId,
        chapterId: input.episodeId,
        revision,
        mode,
        derivedInputPolicy,
        storyboardSourcePolicy: requestedStoryboardSourcePolicy,
        storyboards: input.storyboards,
        remotionShotSlots: await readCurrentRemotionShotSlotsForDraft({
          projectId,
          chapterId: input.episodeId,
          fallbackSlots: input.remotionShotSlots,
        }),
        ...(scriptPlanTransitions ? { scriptPlanTransitions } : {}),
      });
      const reply = await bridge.runChapter(request);
      if (!reply.success || !reply.artifact) {
        setVideoUseState("blocked");
        const message = reply.message ?? "video-use 章节执行被阻塞";
        setError(message);
        throw new Error(message);
      }
      setVideoUseRevision(reply.revision);
      setVideoUseInputSha(reply.artifact.evidence.inputSha256);
      // A worker result is still awaiting human review. The accepted state is
      // reserved for the post-review HyperFrames application below.
      setVideoUseState("pending");
      setHyperFramesState("idle");
      return reply;
    } catch (caught) {
      const message = errorMessage(caught);
      setVideoUseState("blocked");
      setError(message);
      throw caught;
    } finally {
      setVideoUseBusy(false);
    }
  }, [input, storyboardSourcePolicy]);

  const applyVideoWorkflow = useCallback(async (): Promise<VideoWorkflowChapterApplyReplyV1> => {
    const projectId = input.projectId;
    const bridge = typeof window !== "undefined" ? window.videoWorkflowPlugins : undefined;
    if (!projectId || !videoUseRevision || !videoUseInputSha) throw new Error("请先完成 video-use preview 并确认当前 revision");
    if (!bridge?.applyChapter) throw new Error("当前环境未接入 HyperFrames 应用 bridge");
    assertProjectActive(projectId);
    setApplying(true);
    // The review sidecar is accepted before this callback runs. Keep that
    // state visible when HyperFrames/projection fails so the UI exposes a
    // retry action instead of asking the user to re-run the whole chapter.
    setVideoUseState("accepted");
    setError(undefined);
    try {
      // The first EditingProject is created only after the review sidecar is
      // accepted, so video-use remains the first executable chapter stage.
      const project = useEditingStore.getState().getCurrentEditingProject(input.episodeId)
        ?? await createDraft({ preserveVideoWorkflowState: true });
      const reply = await bridge.applyChapter({
        schemaVersion: 1,
        projectId,
        chapterId: input.episodeId,
        revision: videoUseRevision,
        inputSha256: videoUseInputSha,
        width: project.renderSettings.width,
        height: project.renderSettings.height,
        fps: project.renderSettings.fps,
        alphaFormat: "prores-4444-mov",
      });
      if (!reply.success || !reply.videoUseArtifact || !reply.hyperFramesArtifact) {
        setHyperFramesState("blocked");
        const message = reply.message ?? "HyperFrames overlay/no-op 应用被阻塞";
        setError(message);
        throw new Error(message);
      }
      const projected = projectVideoUseArtifactToEditingProject({
        project,
        artifact: reply.videoUseArtifact,
        now: Date.now(),
        // 主进程投影已用同一份槽位（reply 携带）；渲染层二次投影喂相同槽位，
        // 避免本地保存覆盖掉主进程写入的身份证据。
        shotSlots: reply.currentShotSlots as RemotionCurrentSlotV1[] | undefined,
      });
      if (!projected.success) {
        const message = projected.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；");
        setError(message);
        throw new Error(message);
      }
      assertProjectActive(projectId);
      const saved = useEditingStore.getState().saveEditingProject(projected.project);
      if (!saved.success) {
        const message = saved.issue.message;
        setError(message);
        throw new Error(message);
      }
      setVideoUseState("accepted");
      setHyperFramesState(reply.hyperFramesArtifact.status === "noop" ? "noop" : "accepted");
      setError(undefined);
      toast.success(reply.hyperFramesArtifact.status === "noop" ? "video-use 已应用；HyperFrames 记录 no-op" : "video-use 与 HyperFrames 已应用到章节工程");
      return reply;
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      throw caught;
    } finally {
      setApplying(false);
    }
  }, [createDraft, input, videoUseInputSha, videoUseRevision]);

  return {
    currentProject,
    drafting,
    error,
    createDraft,
    runVideoUse,
    applyVideoWorkflow,
    videoUseBusy,
    applying,
    videoUseState,
    videoUseRevision,
    videoUseInputSha,
    hyperFramesState,
  };
}

function assertProjectActive(projectId: string) {
  if (useProjectStore.getState().activeProjectId !== projectId) {
    throw new Error("项目已切换，Remotion 章节准备已停止写回");
  }
}

function formatDraftFailure(
  result: Extract<
    Awaited<ReturnType<typeof buildChapterEditingProject>>,
    { success: false }
  >,
) {
  const failure = result.adapterFailure;
  if (!failure) return result.run.error ?? "Remotion 章节工程准备失败";
  const details = [
    failure.episodeMissing ? `缺少 episode ${result.run.episodeId}` : "",
    failure.missingVisualStoryboardIds.length ? `缺少 Remotion 分镜: ${failure.missingVisualStoryboardIds.join(", ")}` : "",
    failure.missingAudioStoryboardIds.length ? `缺少口播: ${failure.missingAudioStoryboardIds.join(", ")}` : "",
    failure.invalidDurationStoryboardIds.length ? `时长无效: ${failure.invalidDurationStoryboardIds.join(", ")}` : "",
    failure.invalidVoiceDurationStoryboardIds.length ? `口播时长无效: ${failure.invalidVoiceDurationStoryboardIds.join(", ")}` : "",
  ].filter(Boolean);
  return details.join("；") || result.run.error || "Remotion 章节工程准备失败";
}

function uniqueId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

/**
 * The persisted chapter scope is authoritative at the moment a draft is
 * committed. A render-time prop can lag the workspace after a reload or a
 * completed queue restoration. If the desktop bridge answers, its empty or
 * failed result must stay fail-closed instead of falling back to stale props.
 */
async function readCurrentRemotionShotSlotsForDraft(input: {
  projectId: string;
  chapterId: string;
  fallbackSlots?: RemotionCurrentSlotV1[];
}): Promise<RemotionCurrentSlotV1[]> {
  const queue = typeof window === "undefined" ? undefined : window.remotionQueue;
  if (!queue?.get) return input.fallbackSlots ?? [];
  const scope = await queue.get({ projectId: input.projectId, chapterId: input.chapterId });
  return scope.currentShotSlots;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
