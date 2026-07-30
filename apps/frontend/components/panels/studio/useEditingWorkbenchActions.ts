import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  buildChapterEditingProject,
} from "@/lib/studio/editing/chapter-editing-pipeline";
import { useEditingStore } from "@/stores/editing/editing-store";
import { useProjectStore } from "@/stores/project/project-store";
import type { EditingProjectV1 } from "@/types/editing";
import type { ScriptPlan, StoryboardItem } from "@/types/studio";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";

export interface UseEditingWorkbenchActionsInput {
  projectId?: string;
  episodeId: string;
  projectName: string;
  aspectRatio?: string;
  directorPlan?: ScriptPlan;
  storyboards: StoryboardItem[];
  remotionShotSlots?: RemotionCurrentSlotV1[];
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

  useEffect(() => {
    useEditingStore.getState().setActiveProjectId(input.projectId ?? null);
  }, [input.projectId]);

  const createDraft = useCallback(async (): Promise<EditingProjectV1> => {
    const projectId = input.projectId;
    if (!projectId) throw new Error("请先选择项目再准备 Remotion 章节工作台");
    if (!input.episodeId) throw new Error("当前工作流缺少章节 ID");
    if (!input.remotionShotSlots || input.remotionShotSlots.length === 0) {
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
        remotionShotSlots: input.remotionShotSlots,
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
      if (!result.success) throw new Error(formatDraftFailure(result));
      const committed = useEditingStore.getState().commitAutoEditingResult(
        result.result,
        result.staleEditingProjectIds,
        now(),
      );
      if (!committed.success) throw new Error(committed.issue.message);
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
  }, [input]);

  return {
    currentProject,
    drafting,
    error,
    createDraft,
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
