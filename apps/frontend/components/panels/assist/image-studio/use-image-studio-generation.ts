// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  buildImageStudioGenerationRequest,
  classifyImageStudioGeneration,
} from "@/lib/assist/image-studio/request";
import { runImageStudioNodeGeneration } from "@/lib/assist/image-studio/run-node-generation";
import { buildUnclothChainRequest, findUnclothUpstream } from "@/lib/assist/image-studio/uncloth-request";
import { runUnclothChain } from "@/lib/assist/image-studio/run-uncloth";
import { eventBus } from "@/lib/events/event-bus";
import {
  IMAGE_GENERATION_FAILED_EVENT,
  type ImageGenerationFailedPayload,
} from "@/lib/events/image-generation-events";
import { runUpscaleImage } from "@/lib/upscale/client";
import { mediaRefRequestPath, parseUpscaleMediaRef, siblingOutputRef } from "@/lib/upscale/project-file-url";
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
    // 请求在生成前捕获=当时真实输入(画布生成期间可被编辑,回填记录须用开工快照)
    let request: ReturnType<typeof buildImageStudioGenerationRequest> | null = null;
    try {
      // 预检:空提示词不进入 generating 态(失败态会误导用户以为参数有误)
      request = buildImageStudioGenerationRequest(graph, nodeId);
    } catch {
      return;
    }
    const prompt = request.prompt;
    if (!prompt) {
      toast.error("请先填写生成提示词");
      return;
    }
    // 模式无歧义预检(09-03 用户裁定):挂着空参考图/未生成的上游图时,
    // 静默过滤会让"图生图组"实际走纯文生图通道——阻断并指路,绝不混淆
    const mode = classifyImageStudioGeneration(graph, nodeId);
    if (mode.emptyReferences > 0) {
      toast.error(
        `有 ${mode.emptyReferences} 张参考图还没准备好(空参考图或未生成的上游图):先上传/生成,或断开连线后再${
          mode.readyReferences > 0 ? "按图生图生成" : "按纯文生图生成"
        }`,
      );
      return;
    }
    // 无衣物链分流(09-04):上游有 uncloth 节点时,成图的「生成」执行的是
    // uncloth 管线(双分割+两遍),结果直通本成图——不走普通 t2i/i2i 通道
    const unclothRequest = buildUnclothChainRequest(graph, nodeId);
    if (!("error" in unclothRequest)) {
      store.setNodeStatus(nodeId, "generating");
      try {
        const result = await runUnclothChain(unclothRequest);
        useImageStudioStore.getState().setNodeResult(nodeId, {
          imageUrl: result.imageUrl,
          mediaId: result.mediaId,
        });
        // uncloth 节点回显同一结果(预览)
        useImageStudioStore.getState().updateNode(unclothRequest.unclothNodeId, {
          resultUrl: result.imageUrl,
        } as never);
        toast.success("无衣物链完成,成图已更新");
      } catch (error) {
        const message = error instanceof Error ? error.message : "无衣物链失败";
        useImageStudioStore.getState().setNodeStatus(nodeId, "failed", message);
        eventBus.emit(IMAGE_GENERATION_FAILED_EVENT, {
          surface: "image-studio",
          reason: message,
        } satisfies ImageGenerationFailedPayload);
      }
      return;
    }
    if (findUnclothUpstream(graph, nodeId)) {
      // 有 uncloth 上游但输入不完整:明确指路,不静默走普通生成
      toast.error(unclothRequest.error);
      return;
    }

    const controller = new AbortController();
    abortRef.current.set(nodeId, controller);
    store.setNodeStatus(nodeId, "generating");
    // 批量组(09-02-batch-image-group):通道无原生 n,退化=顺序 N 次(N≤4)
    // 聚合进一个生成节点;部分失败保留成功张。
    const extras = useImageStudioStore.getState().nodeExtras[nodeId];
    const count = Math.max(1, Math.min(4, Number(extras?.count) || 1));
    // count 是 UI 层批量概念,生图通道无此参数——透传前剥掉,
    // 防止多余字段泄进云端请求体(严格供应商可能 400)
    const engineExtras: Record<string, unknown> = { ...(extras ?? {}) };
    delete engineExtras.count;
    try {
      const results: Awaited<ReturnType<typeof runImageStudioNodeGeneration>>[] = [];
      for (let index = 0; index < count; index += 1) {
        if (controller.signal.aborted) break;
        // 逐张进度反馈:批量=顺序 N 次且结果最后才聚合,中途零反馈会被当成
        // 卡死(本地每张 2-3 分钟,4 张≈12 分钟盲等)。每张开始时明确报数。
        if (count > 1) {
          toast.info(
            `批量 ${count} 张:正在生成第 ${index + 1} 张(本地每张约 2-3 分钟,完成后自动开始下一张)`,
          );
        }
        try {
          results.push(
            await runImageStudioNodeGeneration(graph, nodeId, {
              extraParams: engineExtras,
              signal: controller.signal,
            }),
          );
        } catch (error) {
          if (index === 0) throw error;
          toast.warning(`批量生成第 ${index + 1} 张失败,已保留前 ${results.length} 张`);
          break;
        }
      }
      if (results.length === 0) throw new Error("批量生成全部失败");
      const result = results[0];
      // 回写基于 store 最新图(生成期间画布可能已被编辑)
      if (results.length > 1) {
        useImageStudioStore.getState().setNodeBatchResult(
          nodeId,
          results.map((item) => item.imageUrl),
          result.mediaId,
        );
      } else {
        useImageStudioStore.getState().setNodeResult(nodeId, {
          imageUrl: result.imageUrl,
          mediaId: result.mediaId,
        });
      }
      useFreedomStore.getState().addHistoryEntry({
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        prompt: result.prompt,
        model: result.model ?? "",
        resultUrl: result.imageUrl,
        // 生成记录弹窗(09-03):带全复原所需输入快照,旧记录无这些键照常读
        params: {
          source: "image-studio-canvas",
          references: request.referenceImages,
          negativePrompt: request.negativePrompt,
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          count,
          ...(results.length > 1
            ? { batchUrls: results.map((item) => item.imageUrl) }
            : {}),
        },
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
      // 中止语义根修(09-01 实弹第7bug):引擎轮询超时也会抛 AbortError 形状,
      // 按 name 判「用户停止」会把真失败静默回 idle。只有本钩子发出的
      // controller 真的 abort 过才算用户停止。
      const abortedByUser = controller.signal.aborted;
      if (abortedByUser && error instanceof Error && error.name === "AbortError") {
        useImageStudioStore.getState().setNodeStatus(nodeId, "idle");
      } else {
        const message = error instanceof Error ? error.message : "生成失败";
        useImageStudioStore.getState().setNodeStatus(nodeId, "failed", message);
        // 失败提示弹窗化(09-03 用户裁定):不放节点卡,画布层弹窗呈现
        eventBus.emit(IMAGE_GENERATION_FAILED_EVENT, {
          surface: "image-studio",
          reason: message,
        } satisfies ImageGenerationFailedPayload);
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
    const outputRef = parseUpscaleMediaRef(outputUrl);
    if (!outputRef) {
      toast.error("无法确定超分输出路径");
      return;
    }
    toast.info("超分 4K 开始,请稍候…");
    try {
      const artifact = await runUpscaleImage({
        schemaVersion: 1,
        projectId: ref.kind === "project-file" ? ref.projectId : "local-media",
        model: "realesrgan-x4plus-anime-6b",
        // 请求路径必须归一化(project-file→项目内相对路径;与分镜链
        // use-image-workflow-upscale 同款)。09-02 落盘治理改 project-file://
        // 后 URL 直传会被超分契约校验拒收(invalid-request 实弹)
        inputImagePath: mediaRefRequestPath(ref),
        outputImagePath: mediaRefRequestPath(outputRef),
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
