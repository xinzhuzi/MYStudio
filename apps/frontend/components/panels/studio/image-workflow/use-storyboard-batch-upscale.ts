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

/** 已是超分产物(up4x- 文件名标记)的镜跳过——重复点击不叠加放大。 */
function isUpscaled(item: StoryboardItem): boolean {
  const path = item.mediaRef?.kind === "image" ? item.mediaRef.path : "";
  return isUpscaledMediaPath(path);
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
        .filter((item) => item.mediaRef?.kind === "image" && !isUpscaled(item))
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
          const result = await upscaleProjectImage({
            imageUrl: shot.mediaRef!.path,
            title: `分镜 ${shot.index} 成图`,
            shotId: shot.id,
            idForFilename: shot.id,
            activeModel,
          });
          // 换轨:mediaRef 指向 4K 产物;工作流成图节点同步,保持双源一致
          const store = useStudioStore.getState();
          const latest = store.storyboards.find((item) => item.id === shot.id) ?? shot;
          const mediaRef = { ...(latest.mediaRef as { kind: "image"; path: string } & Record<string, unknown>) };
          mediaRef.path = result.outputUrl;
          store.updateStoryboard(shot.id, { mediaRef } as Partial<StoryboardItem>);
          const workflowId = mediaRef.imageWorkflowId;
          if (typeof workflowId === "string") {
            const graph = store.imageWorkflows.find((item) => item.id === workflowId);
            const mainGen = graph?.nodes.find(
              (node): node is typeof node & { type: "generated"; resultUrl?: string } =>
                node.type === "generated"
                && !node.title?.includes("背景板") && !node.title?.includes("净底"),
            );
            if (graph && mainGen) {
              mainGen.resultUrl = result.outputUrl;
              mainGen.updatedAt = Date.now();
              store.updateImageWorkflow(graph.id, graph);
            }
          }
          done += 1;
          void logEvent({
            level: "info",
            category: "ai",
            operationId,
            message: "Storyboard batch upscale shot done",
            context: { shotIndex: shot.index, done, failed, outputUrl: result.outputUrl.slice(0, 120) },
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
