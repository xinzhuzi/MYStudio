// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { buildImageStudioGenerationRequest } from "@/lib/assist/image-studio/request";
import { runImageStudioNodeGeneration } from "@/lib/assist/image-studio/run-node-generation";
import { eventBus } from "@/lib/events/event-bus";
import { runUpscaleImage } from "@/lib/upscale/client";
import { parseUpscaleMediaRef, siblingOutputRef } from "@/lib/upscale/project-file-url";
import { saveToMediaLibrary } from "@/lib/ai/generation-media";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";

/**
 * 图片工作室节点生成/停止/超分编排(状态机+toast+历史+事件广播)。
 * 生图核心在 lib/assist/image-studio/run-node-generation(UI 无关)。
 */
export function useImageStudioGeneration() {
  const abortRef = useRef(new Map<string, AbortController>());

  const generateNode = useCallback(async (nodeId: string) => {
    const store = useImageStudioStore.getState();
    const graph = selectActiveImageStudioWorkflow(store);
    if (!graph) return;
    let prompt = "";
    try {
      // 预检:空提示词不进入 generating 态(失败态会误导用户以为参数有误)
      prompt = buildImageStudioGenerationRequest(graph, nodeId).prompt;
    } catch {
      return;
    }
    if (!prompt) {
      toast.error("请先填写生成提示词");
      return;
    }
    const controller = new AbortController();
    abortRef.current.set(nodeId, controller);
    store.setNodeStatus(nodeId, "generating");
    try {
      const result = await runImageStudioNodeGeneration(graph, nodeId, {
        extraParams: useImageStudioStore.getState().nodeExtras[nodeId],
        signal: controller.signal,
      });
      // 回写基于 store 最新图(生成期间画布可能已被编辑)
      useImageStudioStore.getState().setNodeResult(nodeId, {
        imageUrl: result.imageUrl,
        mediaId: result.mediaId,
      });
      useFreedomStore.getState().addHistoryEntry({
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        prompt: result.prompt,
        model: result.model ?? "",
        resultUrl: result.imageUrl,
        params: { source: "image-studio-canvas" },
        createdAt: Date.now(),
        mediaId: result.mediaId,
        type: "image",
      });
      // 资产弹窗「带入图片工作室」的自动存回契约:每次成图广播
      eventBus.emit("image:generated", {
        url: result.imageUrl,
        prompt: result.prompt,
        model: result.model,
      });
      if (result.persisted) {
        toast.success("生成成功,已存入素材库");
      } else {
        toast.warning("生成成功,但本地落盘失败——正在媒体库后台重试保存");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        useImageStudioStore.getState().setNodeStatus(nodeId, "idle");
      } else {
        const message = error instanceof Error ? error.message : "生成失败";
        useImageStudioStore.getState().setNodeStatus(nodeId, "failed", message);
        toast.error(`生成失败: ${message}`);
      }
    } finally {
      abortRef.current.delete(nodeId);
    }
  }, []);

  const stopNode = useCallback((nodeId: string) => {
    abortRef.current.get(nodeId)?.abort();
  }, []);

  const upscaleNode = useCallback(async (nodeId: string) => {
    const graph = selectActiveImageStudioWorkflow(useImageStudioStore.getState());
    const node = graph?.nodes.find(
      (item): item is Extract<typeof item, { type: "generated" }> =>
        item.id === nodeId && item.type === "generated",
    );
    if (!node?.resultUrl) return;
    const ref = parseUpscaleMediaRef(node.resultUrl);
    if (!ref) {
      toast.error("图片不在应用存储内,无法超分(先重新生成或等媒体库落盘完成)");
      return;
    }
    const filename = `up4x-${Date.now()}.png`;
    const outputUrl = siblingOutputRef(ref, filename);
    if (!outputUrl) {
      toast.error("无法确定超分输出路径");
      return;
    }
    toast.info("超分 4K 开始,请稍候…");
    try {
      const artifact = await runUpscaleImage({
        schemaVersion: 1,
        projectId: ref.kind === "project-file" ? ref.projectId : "local-media",
        model: "realesrgan-x4plus-anime-6b",
        inputImagePath: node.resultUrl,
        outputImagePath: outputUrl,
      });
      if (artifact.status !== "accepted") {
        toast.error(`超分失败: ${artifact.message || artifact.code}`);
        return;
      }
      // 根修(旧表单版超分不回写,画面停留旧图):完成后节点切到超分产物
      useImageStudioStore.getState().setNodeResult(nodeId, { imageUrl: outputUrl });
      saveToMediaLibrary(outputUrl, node.prompt || node.title, "ai-image");
      toast.success("超分 4K 完成,节点已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "超分失败");
    }
  }, []);

  return { generateNode, stopNode, upscaleNode };
}
