import { useEffect, useRef } from "react";
import type {
  ImageWorkflowGraph,
  ImageWorkflowOpenContext,
  StoryboardItem,
} from "@/types/studio";
import {
  createAssetImageWorkflowGraph,
  ensureAssetImageWorkflowGraph,
  ensureImageWorkflowPromptNodes,
  ensureStoryboardImageResult,
} from "@/lib/studio/image-workflow";
import { resolveStoryboardAssetReferences } from "./storyboard-asset-references";
import {
  assetWorkflowContextKey,
  createOpenImageWorkflowGraph,
  imageWorkflowTargetKey,
  isAssetOpenContext,
  matchesStoryboardOpenContext,
  resolveOpenContextGeneratedNodeId,
} from "./image-workflow-graph-utils";

/**
 * 图像工作流画布的图生命周期(自 Canvas 等价抽取,行为零变化):
 * ① 无激活图且非 scoped → 建默认 free 图(水合窗口内禁建,防 T4 竞态盲保存);
 * ② 激活图缺提示词节点 → ensure 补齐;
 * ③ 激活图目标变化 → 同步 targetStoryboardId;
 * ④ scoped 打开上下文 → 匹配既有图或按装配链现建(含资产参考异步解析;水合窗口内禁建)。
 */
export function useScopedWorkflowLifecycle(input: {
  activeGraph?: ImageWorkflowGraph;
  activeWorkflowId: string | null;
  hydrated: boolean;
  initialAssetContext?: ImageWorkflowOpenContext;
  imageWorkflows: ImageWorkflowGraph[];
  storyboards: StoryboardItem[];
  projectName: string;
  upsertImageWorkflow: (graph: ImageWorkflowGraph) => void;
  createImageWorkflow: (payload: { name: string; target: ImageWorkflowGraph["target"] }) => string;
  setActiveWorkflowId: (id: string) => void;
  setSelectedNodeId: (id: string | null) => void;
  setPreferredGeneratedNodeId: (id: string | null) => void;
  setTargetStoryboardId: (id: string) => void;
}) {
  const handledAssetContextKeyRef = useRef("");
  const activeGraphTargetKeyRef = useRef("");
  const {
    activeGraph, activeWorkflowId, hydrated, initialAssetContext, imageWorkflows,
    storyboards, projectName, upsertImageWorkflow, createImageWorkflow,
    setActiveWorkflowId, setSelectedNodeId, setPreferredGeneratedNodeId, setTargetStoryboardId,
  } = input;

  useEffect(() => {
    if (activeGraph) {
      if (activeWorkflowId !== activeGraph.id) setActiveWorkflowId(activeGraph.id);
      return;
    }
    // T4 水合竞态:store 未完成水合(启动/切项目 rehydrate 窗口)时禁止自动
    // 新建 free 图——空 store 上的误建会触发整库盲保存(storage 层另有拒写兜底)
    if (!hydrated) return;
    if (initialAssetContext) return;
    const id = createImageWorkflow({
      name: `${projectName} 图像工作流`,
      target: { kind: "free" },
    });
    setActiveWorkflowId(id);
  }, [activeGraph, activeWorkflowId, createImageWorkflow, hydrated, initialAssetContext, projectName, setActiveWorkflowId]);

  useEffect(() => {
    if (!activeGraph) return;
    // 联动愈合:分镜已挂图而工作流成图为空(旁路写入) → 补挂后再补提示词节点
    const storyboardTargetId = activeGraph.target.kind === "storyboard"
      ? activeGraph.target.id
      : undefined;
    const storyboardMediaRef = storyboardTargetId
      ? storyboards.find((item) => item.id === storyboardTargetId)?.mediaRef
      : undefined;
    const storyboardMediaPath = storyboardMediaRef?.kind === "image" ? storyboardMediaRef.path : undefined;
    const ensured = ensureImageWorkflowPromptNodes(
      ensureStoryboardImageResult(activeGraph, storyboardMediaPath),
    );
    if (ensured !== activeGraph) upsertImageWorkflow(ensured);
  }, [activeGraph, storyboards, upsertImageWorkflow]);

  useEffect(() => {
    if (!activeGraph) return;
    const targetKey = `${activeGraph.id}|${imageWorkflowTargetKey(activeGraph.target)}`;
    if (activeGraphTargetKeyRef.current === targetKey) return;
    activeGraphTargetKeyRef.current = targetKey;
    setTargetStoryboardId(
      activeGraph.target.kind === "storyboard" && activeGraph.target.id
        ? activeGraph.target.id
        : "",
    );
  }, [activeGraph, setTargetStoryboardId]);

  useEffect(() => {
    if (!initialAssetContext) return;
    // T4 水合竞态:水合窗口内禁止 scoped 现建(空 store 上建流同样触发盲保存);
    // 水合完成后 hydrated 变化会重跑本 effect,正常补建
    if (!hydrated) return;
    const contextKey = assetWorkflowContextKey(initialAssetContext);
    if (
      handledAssetContextKeyRef.current === contextKey &&
      activeGraph &&
      matchesStoryboardOpenContext(activeGraph, initialAssetContext)
    ) {
      return;
    }
    const existing = initialAssetContext.imageWorkflowId
      ? imageWorkflows.find((graph) => graph.id === initialAssetContext.imageWorkflowId)
      : imageWorkflows.find((graph) =>
          matchesStoryboardOpenContext(graph, initialAssetContext),
        );
    if (existing) {
      const ensured = ensureImageWorkflowPromptNodes(
        isAssetOpenContext(initialAssetContext)
          ? ensureAssetImageWorkflowGraph(existing, initialAssetContext)
          : existing,
      );
      if (ensured !== existing) upsertImageWorkflow(ensured);
      setActiveWorkflowId(existing.id);
      const selectedId = resolveOpenContextGeneratedNodeId(ensured, initialAssetContext);
      setSelectedNodeId(selectedId);
      setPreferredGeneratedNodeId(selectedId);
      handledAssetContextKeyRef.current = contextKey;
      return;
    }
    // 建新工作流:分镜目标先异步解析关联资产参考图(场景/角色),再建流挂载。
    // handled key 前置防并发重复创建;解析失败按无参考建流(fail-soft)。
    handledAssetContextKeyRef.current = contextKey;
    void (async () => {
      const assetReferences = initialAssetContext.target.kind === "storyboard"
        ? await resolveStoryboardAssetReferences(
            storyboards.find((item) => item.id === initialAssetContext.target.id),
          ).catch(() => [])
        : undefined;
      const graph = isAssetOpenContext(initialAssetContext)
        ? createAssetImageWorkflowGraph(initialAssetContext, projectName)
        : createOpenImageWorkflowGraph(
            { ...initialAssetContext, assetReferences },
            projectName,
          );
      upsertImageWorkflow(graph);
      setActiveWorkflowId(graph.id);
      const selectedId = resolveOpenContextGeneratedNodeId(graph, initialAssetContext);
      setSelectedNodeId(selectedId);
      setPreferredGeneratedNodeId(selectedId);
    })();
  }, [activeGraph, hydrated, imageWorkflows, initialAssetContext, projectName, storyboards, upsertImageWorkflow,
    setActiveWorkflowId, setSelectedNodeId, setPreferredGeneratedNodeId]);
}
