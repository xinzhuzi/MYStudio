import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { buildStoryboardImageWorkflowPatch } from "@/lib/studio/image-workflow";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";
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

export interface StoryboardBatchGenerationState {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  /** 当前正在生成的镜序号(index),null=未在运行 */
  currentShotIndex: number | null;
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
    // 队列快照:执行期不重算(中途已生成的不重复;外部并发写入按镜级幂等收敛)
    const queue = storyboards
      .filter((item) => item.mediaRef?.kind !== "image")
      .sort((a, b) => a.index - b.index);
    if (queue.length === 0) {
      toast.info("所有分镜都已生成画面");
      return;
    }
    runningRef.current = true;
    stopRequestedRef.current = false;
    setState({ running: true, total: queue.length, done: 0, failed: 0, currentShotIndex: queue[0]!.index });

    void (async () => {
      let done = 0;
      let failed = 0;
      for (const shot of queue) {
        if (stopRequestedRef.current) break;
        setState((previous) => ({ ...previous, currentShotIndex: shot.index }));
        try {
          await generateOneShot(shot, projectName);
          done += 1;
        } catch (error) {
          failed += 1;
          const reason = error instanceof Error ? error.message : "生成失败";
          toast.error(`分镜 ${shot.index} 生成失败：${reason}`);
        }
        setState((previous) => ({ ...previous, done: done + failed, failed }));
      }
      runningRef.current = false;
      setState((previous) => ({ ...previous, running: false, currentShotIndex: null }));
      if (stopRequestedRef.current) {
        toast.info(`已停止：成功 ${done} · 失败 ${failed} · 剩余 ${queue.length - done - failed}`);
      } else {
        toast.success(`一键生图完成：成功 ${done}${failed ? ` · 失败 ${failed}` : ""}`);
      }
    })();
  }, [projectName, storyboards]);

  return { state, start, stop };
}

/** 单镜执行:找既有分镜工作流(打开链同口径匹配)→无则全装配建流→生图→回写分镜。 */
async function generateOneShot(shot: StoryboardItem, projectName: string): Promise<void> {
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
  const { imageUrl } = await runImageWorkflowNodeGeneration(graph, targetNodeId, {
    addMaterial: useStudioStore.getState().addMaterial,
  });
  if (!imageUrl) throw new Error("生成结果为空");
  // 分镜回写:核心函数已 upsert 含 resultUrl 的最新代图,直接组 patch
  const latest = useStudioStore.getState().imageWorkflows.find((item) => item.id === graph.id) ?? graph;
  const patch = buildStoryboardImageWorkflowPatch(latest, targetNodeId);
  useStudioStore.getState().updateStoryboard(shot.id, patch);
}
