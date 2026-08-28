import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { createBatchFailureReporter } from "../batch-failure-toast";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { buildStoryboardImageWorkflowPatch } from "@/lib/studio/image-workflow";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";
import type { StoryboardItem } from "@/types/studio";
import type { VlmReviewArtifactV1 } from "@/types/contracts/vlm-review-workflow";
import { buildStoryboardItemOpenContext } from "../storyboard-open-context";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { resolveStoryboardAssetReferences } from "./storyboard-asset-references";
import {
  createOpenImageWorkflowGraph,
  ensureStoryboardAssetReferences,
  findStoryboardWorkflowForContext,
  resolveOpenContextGeneratedNodeId,
} from "./image-workflow-graph-utils";
import { runImageWorkflowNodeGeneration } from "./run-image-workflow-node-generation";
import { landStoryboardContinuity } from "./land-continuity";

export interface StoryboardBatchGenerationState {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  /** 当前正在生成的镜序号(index),null=未在运行 */
  currentShotIndex: number | null;
  /** M3a:当前帧标签(多帧镜如 "S12-KF2"),单帧镜缺省 */
  currentFrameLabel?: string;
}

const IDLE_BATCH_STATE: StoryboardBatchGenerationState = {
  running: false,
  total: 0,
  done: 0,
  failed: 0,
  currentShotIndex: null,
};

/**
 * 分镜面板「一键生图」串行批量(Trellis 08-24-storyboard-panel-batch-generate):
 * 未生成镜(mediaRef 非 image)按 index 升序逐镜执行——找/建分镜工作流
 * (黄金公式全装配,与单镜打开同口径)→生图核心→回写分镜 mediaRef。
 * 单镜失败跳过继续;stop() 当前镜完成后终止;面板卸载不中止(store 直写
 * 不依赖挂载);长任务纪律:无模态,失败逐条 toast+结束汇总。
 */
export function useStoryboardBatchGeneration(input: {
  storyboards: StoryboardItem[];
  projectName: string;
}) {
  const [state, setState] = useState<StoryboardBatchGenerationState>(IDLE_BATCH_STATE);
  const runningRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const { storyboards, projectName } = input;

  const stop = useCallback(() => {
    if (!runningRef.current) return;
    stopRequestedRef.current = true;
    toast.info("将在当前分镜完成后停止");
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return;
    // 队列快照:执行期不重算(中途已生成的不重复;外部并发写入按镜级幂等收敛)。
    // M3a:计数单位改帧——单帧镜(无 keyframes)=1 帧缺图即入队;多帧镜按缺图帧数计
    const frameQueue = storyboards
      .map((item) => ({ shot: item, missingFrames: countMissingFrames(item) }))
      .filter((entry) => entry.missingFrames > 0)
      .sort((a, b) => a.shot.index - b.shot.index);
    const totalFrames = frameQueue.reduce((sum, entry) => sum + entry.missingFrames, 0);
    if (frameQueue.length === 0) {
      toast.info("所有分镜画面均已齐备");
      return;
    }
    runningRef.current = true;
    stopRequestedRef.current = false;
    setState({ running: true, total: totalFrames, done: 0, failed: 0, currentShotIndex: frameQueue[0]!.shot.index });
    // 批量生命周期入诊断日志(2026-08-25 补齐: 此前只有 4s 即逝的 toast,单镜失败
    // 原因/批量汇总对 diagnostics 完全不可见,排障只能 CDP 抓 DOM——实弹踩坑)
    const batchOperationId = createOperationId("storyboard-batch-generate");
    void logEvent({
      level: "info",
      category: "ai",
      operationId: batchOperationId,
      message: "Storyboard batch generation started",
      context: { queueShots: frameQueue.length, totalFrames, firstShotIndex: frameQueue[0]!.shot.index },
    });

    void (async () => {
      let done = 0;
      let failed = 0;
      // 同因失败合并计数(同一 toast 刷新「N 个分镜失败」),避免批量失败弹一摞复读弹窗
      const failureReporter = createBatchFailureReporter("分镜");
      for (const entry of frameQueue) {
        if (stopRequestedRef.current) break;
        const shot = entry.shot;
        setState((previous) => ({ ...previous, currentShotIndex: shot.index }));
        try {
          await generateOneShot(shot, projectName, {
            onFrameStart: (label) => setState((previous) => ({ ...previous, currentFrameLabel: label })),
          });
          done += entry.missingFrames;
          void logEvent({
            level: "info",
            category: "ai",
            operationId: batchOperationId,
            message: "Storyboard batch shot generated",
            context: { shotIndex: shot.index, frames: entry.missingFrames, done, failed, storyboardId: shot.id },
          });
        } catch (error) {
          failed += 1;
          const reason = error instanceof Error ? error.message : "生成失败";
          void logEvent({
            level: "warn",
            category: "ai",
            operationId: batchOperationId,
            message: "Storyboard batch shot failed",
            context: { shotIndex: shot.index, done, failed, reason: reason.slice(0, 300) },
          });
          failureReporter.report(`分镜 ${shot.index}`, reason);
        }
        setState((previous) => ({ ...previous, done: done + failed, failed, currentFrameLabel: undefined }));
      }
      runningRef.current = false;
      setState((previous) => ({ ...previous, running: false, currentShotIndex: null }));
      void logEvent({
        level: failed > 0 ? "warn" : "info",
        category: "ai",
        operationId: batchOperationId,
        message: "Storyboard batch generation finished",
        context: {
          succeeded: done,
          failed,
          remaining: totalFrames - done - failed,
          stopped: stopRequestedRef.current,
        },
      });
      if (stopRequestedRef.current) {
        toast.info(`已停止：成功 ${done} 帧 · 失败 ${failed} · 剩余 ${totalFrames - done - failed} 帧`);
      } else {
        toast.success(`一键生图完成：成功 ${done} 帧${failed ? ` · 失败 ${failed}` : ""}`);
      }
    })();
  }, [projectName, storyboards]);

  return { state, start, stop };
}

/** M3a:缺帧计数——单帧镜无图=1;多帧镜=空槽帧数(mediaRef 缺图视为首帧空) */
function countMissingFrames(shot: StoryboardItem): number {
  if (!shot.keyframes?.length) {
    return shot.mediaRef?.kind === "image" && shot.mediaRef.path ? 0 : 1;
  }
  return shot.keyframes.filter((frame) => !frame.mediaRef?.path).length;
}


/** VLM 视觉一致性审核:成图 vs 资产参考图(fail-open,模型未装=null 跳过)。 */
async function reviewFrame(
  imageUrl: string,
  shot: StoryboardItem,
): Promise<VlmReviewArtifactV1 | null> {
  const bridge = typeof window !== "undefined" ? window.vlmReview : undefined;
  if (!bridge?.run) return null;
  try {
    const probe = await bridge.probe();
    if (probe.status !== "ready") return null;
    const referenceImages = (shot.orderedReferenceManifest ?? [])
      .filter((ref) => ref.imagePath)
      .map((ref) => ({
        path: ref.imagePath!,
        role: ((ref.assetKind as string) ?? "character") as "scene" | "character" | "prop",
        assetName: ref.assetName ?? ref.assetId,
      }));
    if (referenceImages.length === 0) return null;
    return await bridge.run({
      schemaVersion: 1,
      projectId: useProjectStore.getState().activeProjectId ?? "unknown",
      shotId: shot.id,
      generatedImagePath: imageUrl,
      referenceImages,
      expectedContent: shot.videoDesc || shot.prompt || "",
      expectedCharacters: shot.associateAssetsNames ?? [],
    });
  } catch {
    return null;
  }
}

const VLM_MAX_RETRIES = 1;

/** 生成+VLM审核循环:通过=返回 / rejected=重生一次 / 两次rejected=抛错。 */
async function generateWithVlmReview(
  graph: NonNullable<ReturnType<typeof findStoryboardWorkflowForContext>>,
  targetNodeId: string,
  shot: StoryboardItem,
  opts: { addMaterial: ReturnType<typeof useStudioStore.getState>["addMaterial"] },
): Promise<{ imageUrl: string; vlmStatus: string | null; vlmArtifact?: VlmReviewArtifactV1 }> {
  for (let attempt = 0; attempt <= VLM_MAX_RETRIES; attempt++) {
    const { imageUrl } = await runImageWorkflowNodeGeneration(graph, targetNodeId, opts);
    if (!imageUrl) throw new Error("生成结果为空");
    const artifact = await reviewFrame(imageUrl, shot);
    if (!artifact || artifact.status !== "rejected") {
      return { imageUrl, vlmStatus: artifact?.status ?? null, vlmArtifact: artifact ?? undefined };
    }
    if (attempt === VLM_MAX_RETRIES) {
      throw new Error(`VLM 审核不通过:${(artifact.reasons ?? []).join(";").slice(0, 120)}`);
    }
  }
  throw new Error("VLM 审核不通过");
}

/**
 * 单镜执行:找既有分镜工作流(打开链同口径匹配)→无则全装配建流→生图→回写分镜。
 * M3a 多帧:按 frameId 序逐帧串行生成(帧间链 gen(k-1)→gen(k) 自动喂上一帧
 * 成图作连贯参考),每帧即时回写 keyframes(reason="generate");单帧镜走原路径。
 */
async function generateOneShot(
  shot: StoryboardItem,
  projectName: string,
  hooks?: { onFrameStart?: (label: string) => void },
): Promise<void> {
  const context = buildStoryboardItemOpenContext(shot);
  const store = useStudioStore.getState();
  // 身份防线:择优复用(有参考节点的旧代/新代并存时优先带参考者),
  // 选中者无参考而分镜带资产清单→重解析补挂(S08 实证:空参考会让
  // 模型自由发挥角色形象,监工被画成主角剑客相)
  let graph = findStoryboardWorkflowForContext(store.imageWorkflows, context);
  if (!graph) {
    const assetReferences = await resolveStoryboardAssetReferences(shot).catch(() => []);
    graph = createOpenImageWorkflowGraph({ ...context, assetReferences }, projectName);
    useStudioStore.getState().upsertImageWorkflow(graph);
  } else if (!graph.nodes.some((node) => node.type === "reference")) {
    const references = await resolveStoryboardAssetReferences(shot).catch(() => []);
    const ensured = ensureStoryboardAssetReferences(graph, references);
    if (ensured !== graph) {
      useStudioStore.getState().upsertImageWorkflow(ensured);
      graph = ensured;
    }
  }
  const targetNodeId = resolveOpenContextGeneratedNodeId(graph, context)
    ?? graph.nodes.find((node) => node.type === "generated")?.id;
  if (!targetNodeId) {
    throw new Error("工作流缺少成图节点");
  }
  // M3a 多帧:按帧串行生成并逐帧回写;帧间链要求顺序执行,中途失败抛错由批次层记录
  const emptyFrames = (shot.keyframes ?? []).filter((frame) => !frame.mediaRef?.path);
  if (emptyFrames.length > 0) {
    for (const frame of emptyFrames) {
      hooks?.onFrameStart?.(`S${String(shot.index).padStart(2, "0")}-${frame.frameId.slice(-3)}`);
      const frameNodeId = graph.nodes.find(
        (node) => node.type === "generated" && (node as { frameId?: string }).frameId === frame.frameId,
      )?.id;
      if (!frameNodeId) {
        throw new Error(`工作流缺少帧节点 ${frame.frameId}(请重新进入该镜图片工作流建流)`);
      }
      await runFrameGenerationAndWriteback(graph, shot, frame, frameNodeId);
    }
    return;
  }
  // 生成前预检(不烧配额,08-24 装配门禁链收口): ①file:// 参考探活——经资产桥
  // 轻读一次(读完即弃,不驻留 data: 防 OOM),断链(资产改名/文件损坏)在装配后
  // 秒级可见,而非生成中「参考图无法解码」烧一次等待;②长度门前置——正文超
  // 800 直接拒,提示精炼而非让编译器在网络前才拦
  const assetBridge = getStudioAssetsBridge();
  for (const node of graph.nodes) {
    if (node.type !== "reference") continue;
    const url = node.imageUrl ?? "";
    const assetId = node.source?.kind === "asset" ? node.source.id : undefined;
    if (!url.startsWith("file://") || !assetId || !assetBridge?.readImageDataUrl) continue;
    const alive = await assetBridge.readImageDataUrl(assetId).then(() => true).catch(() => false);
    if (!alive) {
      throw new Error(`参考图[${node.title ?? "未命名"}]无法读取(资产可能已改名或损坏),请重建参考`);
    }
  }
  const promptLength = graph.nodes.find((node) => node.type === "prompt")?.prompt?.length ?? 0;
  if (promptLength > 800) {
    throw new Error(`提示词 ${promptLength} 字符超 800 正文门,需精炼后再生成`);
  }
  const { imageUrl, vlmArtifact } = await generateWithVlmReview(graph, targetNodeId, shot, {
    addMaterial: useStudioStore.getState().addMaterial,
  });
  if (!imageUrl) throw new Error("生成结果为空");
  // 分镜回写:核心函数已 upsert 含 resultUrl 的最新代图,直接组 patch
  const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
  // 连续性接线(方案 2):媒体落库前先落三件套,图的 freshWrite 会顺带清
  // sourceChanged 的 stale 标记;前置不满足时静默跳过,不阻塞生图主链
  landStoryboardContinuity(shot.id, latest.id, targetNodeId);
  const patch = buildStoryboardImageWorkflowPatch(latest, targetNodeId);
  useStudioStore.getState().updateStoryboard(shot.id, patch);
  if (vlmArtifact) useStudioStore.getState().writeStoryboardVlmReview(shot.id, {
    ...vlmArtifact,
    generatedAt: vlmArtifact.generatedAt || Date.now(),
  }, imageUrl);
}


/** M3a:单帧生成+回写(多帧路径复用;预检同单帧口径) */
async function runFrameGenerationAndWriteback(
  graph: ReturnType<typeof findStoryboardWorkflowForContext> extends infer T ? NonNullable<T> : never,
  shot: StoryboardItem,
  frame: NonNullable<StoryboardItem["keyframes"]>[number],
  frameNodeId: string,
): Promise<void> {
  const { imageUrl, vlmArtifact } = await generateWithVlmReview(graph, frameNodeId, shot, {
    addMaterial: useStudioStore.getState().addMaterial,
  });
  if (!imageUrl) throw new Error("生成结果为空");
  const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
  landStoryboardContinuity(shot.id, latest.id, frameNodeId);
  const node = latest.nodes.find((item) => item.id === frameNodeId);
  const frameMediaRef = {
    kind: "image" as const,
    path: imageUrl,
    imageWorkflowId: latest.id,
    imageWorkflowNodeId: frameNodeId,
  };
  // 增量回写必须以 store 现势为基(批次快照里的 shot.keyframes 是旧值,
  // 直接在其上映射会丢掉前几帧已落的写入——多帧串行实测坑)
  const liveFrames = useStudioStore.getState().storyboards.find((item) => item.id === shot.id)?.keyframes
    ?? shot.keyframes
    ?? [];
  const updatedFrames = liveFrames.map((candidate) =>
    candidate.frameId === frame.frameId
      ? { ...candidate, mediaRef: frameMediaRef }
      : candidate,
  );
  useStudioStore.getState().setStoryboardKeyframes(shot.id, updatedFrames, "generate");
  if (vlmArtifact) useStudioStore.getState().writeStoryboardVlmReview(shot.id, {
    ...vlmArtifact,
    generatedAt: vlmArtifact.generatedAt || Date.now(),
  }, imageUrl);
  void node;
}
