import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { isUpscaledMediaPath } from "@/lib/upscale/client";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";
import {
  fetchActiveModel,
  guardUpscaleReadiness,
  upscaleProjectImage,
} from "./use-image-workflow-upscale";

export interface StoryboardBatchUpscaleState {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  /** 当前正在超分的镜序号(index),null=未在运行 */
  currentShotIndex: number | null;
}

const IDLE_STATE: StoryboardBatchUpscaleState = {
  running: false,
  total: 0,
  done: 0,
  failed: 0,
  currentShotIndex: null,
};

/** 已是超分产物(up4x- 文件名标记)的镜跳过——重复点击不叠加放大。
 * M3b:多帧镜须全帧 up4x 才算超分完毕(幂等口径从首帧扩到全帧)。 */
function isUpscaled(item: StoryboardItem): boolean {
  const paths = item.keyframes?.length
    ? item.keyframes.filter((frame) => frame.mediaRef?.path).map((frame) => frame.mediaRef!.path)
    : item.mediaRef?.kind === "image" ? [item.mediaRef.path] : [];
  return paths.length > 0 && paths.every((path) => isUpscaledMediaPath(path));
}

/** M3b:镜内待超分帧清单(逐帧 4K;非 up4x 的有图帧) */
function pendingUpscaleFrames(item: StoryboardItem): string[] {
  const frames = item.keyframes?.length
    ? item.keyframes.filter((frame) => frame.mediaRef?.path).map((frame) => ({ path: frame.mediaRef!.path, frame }))
    : item.mediaRef?.kind === "image"
      ? [{ path: item.mediaRef.path, frame: undefined as never }]
      : [];
  return frames.filter((entry) => !isUpscaledMediaPath(entry.path)).map((entry) => entry.path);
}

/**
 * 分镜节点卡「一键超分」串行批量:把所有已生成且尚未超分的分镜图
 * 逐镜本地超分到 4K(x4 模型,1K→4K),并把分镜 mediaRef 换到超分产物
 * (成片时间线直接吃 4K 帧;原 1K 文件保留在旁路不删)。
 * 模型缺失走设置 deep-link(与画布单图超分同款守卫);失败跳过继续;
 * 长任务纪律:无模态,进度在节点卡,汇总 toast;生命周期入 diagnostics。
 */
export function useStoryboardBatchUpscale(input: {
  storyboards: StoryboardItem[];
}) {
  const [state, setState] = useState<StoryboardBatchUpscaleState>(IDLE_STATE);
  const runningRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const { storyboards } = input;

  const stop = useCallback(() => {
    if (!runningRef.current) return;
    stopRequestedRef.current = true;
    toast.info("将在当前分镜完成后停止");
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return;
    void (async () => {
      if (!(await guardUpscaleReadiness())) return;
      const activeModel = await fetchActiveModel().catch(() => "");
      const queue = storyboards
        .filter((item) => pendingUpscaleFrames(item).length > 0)
        .sort((a, b) => a.index - b.index);
      const alreadyUpscaled = storyboards.filter(isUpscaled).length;
      if (queue.length === 0) {
        toast.info(
          alreadyUpscaled > 0
            ? `所有分镜图均已超分（${alreadyUpscaled} 张）`
            : "没有可超分的分镜图，请先生成画面",
        );
        return;
      }
      runningRef.current = true;
      stopRequestedRef.current = false;
      setState({ running: true, total: queue.length, done: 0, failed: 0, currentShotIndex: queue[0]!.index });
      const operationId = createOperationId("storyboard-batch-upscale");
      void logEvent({
        level: "info",
        category: "ai",
        operationId,
        message: "Storyboard batch upscale started",
        context: { queueSize: queue.length, skippedUpscaled: alreadyUpscaled, activeModel },
      });

      let done = 0;
      let failed = 0;
      for (const shot of queue) {
        if (stopRequestedRef.current) break;
        setState((previous) => ({ ...previous, currentShotIndex: shot.index }));
        try {
          // M3b:逐帧超分(镜内多帧各自 4K);换轨走 setStoryboardKeyframes
          // 唯一写入口(I1 首帧镜像自动同步,弃手拼 mediaRef)
          const store = useStudioStore.getState();
          const latest = store.storyboards.find((item) => item.id === shot.id) ?? shot;
          let frames = (latest.keyframes?.length ? latest.keyframes : undefined) as typeof latest.keyframes;
          const pending = latest.keyframes?.length
            ? latest.keyframes.filter((frame) => frame.mediaRef?.path && !isUpscaledMediaPath(frame.mediaRef.path))
            : (latest.mediaRef?.kind === "image" && !isUpscaledMediaPath(latest.mediaRef.path)
              ? ["first" as const]
              : []);
          for (const pendingEntry of pending) {
            const sourcePath = pendingEntry === "first"
              ? latest.mediaRef!.path
              : pendingEntry.mediaRef!.path;
            const result = await upscaleProjectImage({
              imageUrl: sourcePath,
              title: `分镜 ${shot.index} 成图${pendingEntry !== "first" ? ` · ${pendingEntry.frameId}` : ""}`,
              shotId: shot.id,
              idForFilename: shot.id,
              activeModel,
            });
            if (frames?.length) {
              const liveFrames = (useStudioStore.getState().storyboards.find((item) => item.id === shot.id)?.keyframes
                ?? frames) as NonNullable<typeof frames>;
              frames = liveFrames.map((frame) =>
                frame.mediaRef?.path === sourcePath
                  ? { ...frame, mediaRef: { ...frame.mediaRef, path: result.outputUrl } }
                  : frame,
              );
              useStudioStore.getState().setStoryboardKeyframes(shot.id, frames, "upscale");
            } else {
              const mediaRef = { ...(latest.mediaRef as { kind: "image"; path: string } & Record<string, unknown>) };
              mediaRef.path = result.outputUrl;
              useStudioStore.getState().updateStoryboard(shot.id, { mediaRef } as Partial<StoryboardItem>);
            }
            // 工作流节点同步(G6):按帧 resultUrl 精确匹配,弃 title 启发式
            const liveMedia = useStudioStore.getState().storyboards.find((item) => item.id === shot.id);
            const syncPath = result.outputUrl;
            const sourceWorkflowId = (pendingEntry === "first"
              ? latest.mediaRef?.imageWorkflowId
              : pendingEntry.mediaRef?.imageWorkflowId)
              ?? liveMedia?.mediaRef?.imageWorkflowId;
            if (typeof sourceWorkflowId === "string") {
              const graph = useStudioStore.getState().imageWorkflows.find((item) => item.id === sourceWorkflowId);
              const matched = graph?.nodes.find(
                (node) => node.type === "generated" && (node as { resultUrl?: string }).resultUrl === sourcePath,
              );
              if (graph && matched) {
                (matched as { resultUrl?: string }).resultUrl = syncPath;
                matched.updatedAt = Date.now();
                useStudioStore.getState().updateImageWorkflow(graph.id, graph);
              }
            }
          }
          done += 1;
          void logEvent({
            level: "info",
            category: "ai",
            operationId,
            message: "Storyboard batch upscale shot done",
            context: { shotIndex: shot.index, done, failed, frames: pending.length },
          });
        } catch (error) {
          failed += 1;
          const reason = error instanceof Error ? error.message : "超分失败";
          void logEvent({
            level: "warn",
            category: "ai",
            operationId,
            message: "Storyboard batch upscale shot failed",
            context: { shotIndex: shot.index, done, failed, reason: reason.slice(0, 300) },
          });
          toast.error(`分镜 ${shot.index} 超分失败：${reason}`);
        }
        setState((previous) => ({ ...previous, done: done + failed, failed }));
      }
      runningRef.current = false;
      setState((previous) => ({ ...previous, running: false, currentShotIndex: null }));
      void logEvent({
        level: failed > 0 ? "warn" : "info",
        category: "ai",
        operationId,
        message: "Storyboard batch upscale finished",
        context: {
          succeeded: done,
          failed,
          remaining: queue.length - done - failed,
          stopped: stopRequestedRef.current,
        },
      });
      if (stopRequestedRef.current) {
        toast.info(`已停止：成功 ${done} · 失败 ${failed} · 剩余 ${queue.length - done - failed}${alreadyUpscaled ? ` · 跳过已超分 ${alreadyUpscaled}` : ""}`);
      } else {
        toast.success(`一键超分完成：成功 ${done}${failed ? ` · 失败 ${failed}` : ""}${alreadyUpscaled ? ` · 跳过已超分 ${alreadyUpscaled}` : ""}`);
      }
    })();
  }, [storyboards]);

  // 派生进度(空闲态按钮显示「已 4K n/总」;廉价过滤,随 storyboards 重算)
  const withImage = storyboards.filter((item) => item.mediaRef?.kind === "image");
  const upscaledCount = withImage.filter(isUpscaled).length;
  return { state, start, stop, upscaledCount, shotCount: withImage.length };
}
