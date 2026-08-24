import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useEditingStore } from "@/stores/editing/editing-store";
import { createStudioWorkflowId } from "@/stores/studio/studio-store-runtime";
import { latestAgentWork } from "./workflow-helpers";
import {
  deriveSceneGroups,
  type SceneStoryboardGroup,
} from "@/lib/studio/remotion/scene-segments";
import type { RemotionQueueEnqueueChapterScenesReplySegment } from "@rendering/plugins/remotion/queue/remotion-queue-ipc";

interface PendingSceneSegment {
  sceneNo: number;
  sceneName: string;
  storyboardIds: string[];
  jobId: string;
  outputRelativePath: string;
  outputAbsolutePath: string;
  frameRange: [number, number];
  inputHash?: string;
}

/**
 * 按场分段导出（Remotion chapter-scene frameRange 渲染）渲染域入口。
 *
 * 场结构从 agentWorkData 最新分镜表原文推导（## 场N 场头）；入队走
 * window.remotionQueue.enqueueChapterScenes；job 成功后按 jobId upsert
 * sceneSegments（章级产物，进产物树）。
 */
export function useSceneSegmentExport(options: {
  projectId?: string;
  chapterId: string;
  /** useRemotionQueueScope 的 jobs（job 事件驱动重拉；这里只读终态）。 */
  queueJobs: Array<{ jobId: string; status: string; inputHash: string; outputPath?: string; progress: number }>;
}) {
  const { projectId, chapterId, queueJobs } = options;
  const agentWorkData = useStudioStore((state) => state.agentWorkData);
  const storyboards = useStudioStore((state) => state.storyboards);
  const registerSceneSegment = useStudioStore((state) => state.registerSceneSegment);
  const [exporting, setExporting] = useState(false);
  const pendingRef = useRef(new Map<string, PendingSceneSegment>());
  const [pendingCount, setPendingCount] = useState(0);

  const chapterStoryboards = useMemo(
    () => storyboards.filter((item) => item.episodeId === chapterId),
    [storyboards, chapterId],
  );

  const derived = useMemo(() => {
    const tableText = latestAgentWork(agentWorkData, "storyboardTable", chapterId);
    if (!tableText) {
      return { scenes: [] as SceneStoryboardGroup[], error: "尚未生成分镜表，无法按场分段" };
    }
    const result = deriveSceneGroups(tableText, chapterStoryboards.map((item) => ({
      id: item.id,
      index: item.index,
      ...(typeof item.duration === "number" ? { duration: item.duration } : {}),
    })));
    if (!result.success) return { scenes: [] as SceneStoryboardGroup[], error: result.error };
    return { scenes: result.scenes, error: undefined as string | undefined };
  }, [agentWorkData, chapterId, chapterStoryboards]);

  const editingRevision = useEditingStore((state) => {
    const editingProjectId = state.currentEditingProjectIdByEpisode[chapterId];
    return editingProjectId ? state.editingProjects[editingProjectId]?.revision : undefined;
  });

  // job 终态回写：queueJobs 由 useRemotionQueueScope 在 job 事件后重拉，
  // 这里只做「pending jobId → 成功登记 / 失败提示」的收敛。
  useEffect(() => {
    const jobById = new Map(queueJobs.map((job) => [job.jobId, job]));
    for (const [jobId, pending] of [...pendingRef.current.entries()]) {
      const job = jobById.get(jobId);
      if (!job || (job.status !== "succeeded" && job.status !== "failed" && job.status !== "canceled")) continue;
      pendingRef.current.delete(jobId);
      if (job.status === "succeeded" && job.outputPath) {
        registerSceneSegment({
          id: createStudioWorkflowId("scene-segment"),
          chapterId,
          sceneNo: pending.sceneNo,
          sceneName: pending.sceneName,
          storyboardIds: pending.storyboardIds,
          frameRange: pending.frameRange,
          outputRelativePath: job.outputPath,
          outputAbsolutePath: pending.outputAbsolutePath,
          jobId,
          inputHash: job.inputHash,
          createdAt: Date.now(),
        });
        toast.success(`场 ${pending.sceneNo} 分段已导出（Remotion 渲染）`);
      } else if (job.status === "failed" || job.status === "canceled") {
        toast.error(`场 ${pending.sceneNo} 分段导出${job.status === "canceled" ? "已取消" : "失败"}`);
      }
    }
    setPendingCount(pendingRef.current.size);
  }, [queueJobs, chapterId, registerSceneSegment]);

  const exportScenes = useCallback(async (selectedSceneNos: readonly number[]) => {
    const bridge = typeof window !== "undefined" ? window.remotionQueue : undefined;
    if (!bridge?.enqueueChapterScenes) {
      toast.error("按场分段导出通道不可用（请更新应用）");
      return;
    }
    if (!projectId) {
      toast.error("缺少项目上下文，无法按场分段导出");
      return;
    }
    if (!editingRevision) {
      toast.error("当前章节缺少 video-use 验收后的编辑工程，无法按场分段导出");
      return;
    }
    const selected = derived.scenes.filter((scene) => selectedSceneNos.includes(scene.sceneNo));
    if (selected.length === 0) {
      toast.error("请至少选择一个场");
      return;
    }
    setExporting(true);
    try {
      const reply = await bridge.enqueueChapterScenes({
        projectId,
        chapterId,
        editingRevision,
        segments: selected.map((scene) => ({
          sceneNo: scene.sceneNo,
          sceneName: scene.sceneName,
          storyboardIds: scene.storyboardIds,
        })),
      });
      if (!reply.accepted) {
        toast.error(`按场分段导出失败：${reply.message}`);
        return;
      }
      for (const segment of reply.segments) {
        const scene = selected.find((candidate) => candidate.sceneNo === segment.sceneNo);
        if (!scene) continue;
        pendingRef.current.set(segment.jobId, {
          sceneNo: segment.sceneNo,
          sceneName: scene.sceneName,
          storyboardIds: scene.storyboardIds,
          jobId: segment.jobId,
          outputRelativePath: segment.outputRelativePath,
          outputAbsolutePath: segment.outputAbsolutePath,
          frameRange: segment.frameRange,
        });
      }
      setPendingCount(pendingRef.current.size);
      toast.success(`已入队 ${reply.segments.length} 个场分段（Remotion 队列串行渲染）`);
    } catch (error) {
      toast.error(`按场分段导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExporting(false);
    }
  }, [projectId, chapterId, editingRevision, derived.scenes]);

  const pendingSegments = useMemo(
    () => [...pendingRef.current.values()],
    // pendingCount 变化时重算（ref 本身非响应式）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingCount],
  );

  return {
    scenes: derived.scenes,
    sceneError: derived.error,
    editingRevision,
    exportScenes,
    exporting,
    pendingSegments,
    pendingJobStatuses: useMemo(() => {
      const jobById = new Map(queueJobs.map((job) => [job.jobId, job]));
      return pendingSegments.map((segment) => ({
        segment,
        status: jobById.get(segment.jobId)?.status ?? "queued",
        progress: jobById.get(segment.jobId)?.progress ?? 0,
      }));
    }, [queueJobs, pendingSegments]),
  };
}

export type { RemotionQueueEnqueueChapterScenesReplySegment };
