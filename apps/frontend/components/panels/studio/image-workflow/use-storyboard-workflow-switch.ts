import { useCallback } from "react";
import type { ImageWorkflowGraph, ImageWorkflowOpenContext, StoryboardItem } from "@/types/studio";
import { storyboardSourceFingerprint } from "@/stores/studio/studio-store-continuity-helpers";
import { resolveStoryboardAssetReferences } from "./storyboard-asset-references";
import { createOpenImageWorkflowGraph, matchesStoryboardOpenContext } from "./image-workflow-graph-utils";

/**
 * 图像节点图(全局模式)内的分镜切换:原地换 activeGraph,不进入 scoped 单镜模式
 * (2026-08-23 用户裁定:图像节点图=总览浏览器,切镜在画布内完成)。
 * 已有匹配工作流(指纹口径)直切;无则按与 scoped 相同的装配链现建后切入。
 */
export function useStoryboardWorkflowSwitch(input: {
  imageWorkflows: ImageWorkflowGraph[];
  projectName: string;
  upsertImageWorkflow: (graph: ImageWorkflowGraph) => void;
  setActiveWorkflowId: (id: string) => void;
  setSelectedNodeId: (id: string | null) => void;
  setPreferredGeneratedNodeId: (id: string | null) => void;
}) {
  const switchTo = useCallback(
    async (storyboard: Pick<
      StoryboardItem,
      "id" | "index" | "prompt" | "videoDesc" | "imageWorkflowId" | "sourceFingerprint" | "lines" | "associateAssetsNames"
    > & { mediaRef?: StoryboardItem["mediaRef"] }) => {
      const context = buildSwitchContext(storyboard);
      const existing = input.imageWorkflows.find((graph) =>
        matchesStoryboardOpenContext(graph, context),
      );
      if (existing) {
        input.setActiveWorkflowId(existing.id);
        input.setSelectedNodeId(null);
        input.setPreferredGeneratedNodeId(null);
        return;
      }
      const assetReferences = await resolveStoryboardAssetReferences(storyboard).catch(() => []);
      const graph = createOpenImageWorkflowGraph({ ...context, assetReferences }, input.projectName);
      input.upsertImageWorkflow(graph);
      input.setActiveWorkflowId(graph.id);
      input.setSelectedNodeId(null);
      input.setPreferredGeneratedNodeId(null);
    },
    // 输入为每渲染新对象;行为等价于原 inline 实现(依赖同源 state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.imageWorkflows, input.projectName, input.upsertImageWorkflow,
      input.setActiveWorkflowId, input.setSelectedNodeId, input.setPreferredGeneratedNodeId],
  );
  return { switchTo };
}

/**
 * 分镜 → 打开上下文。指纹缺失(旧分镜行)时现算兜底:
 * 新建流恒带 targetSourceFingerprint,否则会被水合清理当成上一代遗留丢弃。
 * toolbar 合并切换器的 scoped 链路也复用本函数(走 onOpenStoryboardWorkflow)。
 */
export function buildSwitchContext(storyboard: Pick<
  StoryboardItem,
  "id" | "index" | "prompt" | "videoDesc" | "imageWorkflowId" | "sourceFingerprint" | "lines" | "associateAssetsNames"
> & { mediaRef?: StoryboardItem["mediaRef"] }): ImageWorkflowOpenContext {
  return {
    target: { kind: "storyboard", id: storyboard.id },
    title: `分镜 ${storyboard.index}`,
    prompt: storyboard.videoDesc || storyboard.prompt,
    sourceImagePath: storyboard.mediaRef?.kind === "image" ? storyboard.mediaRef.path : undefined,
    resultImagePath: storyboard.mediaRef?.kind === "image" ? storyboard.mediaRef.path : undefined,
    imageWorkflowId: storyboard.imageWorkflowId ?? storyboard.mediaRef?.imageWorkflowId,
    sourceStage: "storyboard",
    sourceStageLabel: "分镜视频生成",
    sourceLabel: `分镜成图 · 分镜 ${storyboard.index}`,
    storyboardSourceFingerprint: storyboard.sourceFingerprint ?? storyboardSourceFingerprint(storyboard),
    storyboardLines: storyboard.lines,
  };
}
