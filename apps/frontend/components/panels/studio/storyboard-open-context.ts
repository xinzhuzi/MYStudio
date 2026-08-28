import type {
  ImageWorkflowOpenContext,
  StoryboardItem,
  StoryboardKeyframe,
} from "@/types/studio";
import type { ProductionFlowStoryboardTile } from "./workflow-node-model";

/**
 * 分镜瓦片 → 图片工作流打开上下文(分镜面板卡片与节点预览瓦片点击共用)。
 * 携带分镜内容指纹,用于跳过「同 id 但属于被替换上一代分镜」的旧工作流。
 * (08-24 自 WorkflowNodePreviews 巨文件拆出——纯逻辑,不属展示组件层。)
 */
export function buildStoryboardImageOpenContext(tile: ProductionFlowStoryboardTile): ImageWorkflowOpenContext {
  return {
    target: { kind: "storyboard", id: tile.id },
    title: `分镜 ${tile.index}`,
    prompt: tile.title,
    sourceImagePath: tile.mediaPath,
    resultImagePath: tile.mediaPath,
    imageWorkflowId: tile.imageWorkflowId,
    sourceStage: "storyboard",
    sourceStageLabel: "分镜视频生成",
    sourceLabel: `分镜成图 · 分镜 ${tile.index}`,
    storyboardSourceFingerprint: tile.sourceFingerprint,
    storyboardLines: tile.lines,
  };
}

/** StoryboardItem → 打开上下文(分镜面板全量视图用;瓦片路径请用 buildStoryboardImageOpenContext)。 */
export function buildStoryboardItemOpenContext(item: {
  id: string;
  index: number;
  mediaRef?: { kind: string; path: string; imageWorkflowId?: string };
  videoDesc?: string;
  prompt: string;
  imageWorkflowId?: string;
  sourceFingerprint?: string;
  lines?: string;
  state?: StoryboardItem["state"];
  associateAssetsNames?: string[];
  keyframes?: StoryboardKeyframe[];
  shotSemantics?: StoryboardItem["shotSemantics"];
}): ImageWorkflowOpenContext {
  return {
    ...buildStoryboardImageOpenContext({
      id: item.id,
      index: item.index,
      mediaPath: item.mediaRef?.kind === "image" ? item.mediaRef.path : undefined,
      title: item.videoDesc || item.prompt || `分镜 ${item.index}`,
      imageWorkflowId: item.imageWorkflowId ?? item.mediaRef?.imageWorkflowId,
      sourceFingerprint: item.sourceFingerprint,
      lines: item.lines,
      // ProductionFlowStoryboardTile.state 必填;面板视图的分镜行不一定带 state,兜底 ready
      state: item.state ?? "ready",
    }),
    // 无指纹工作流的代际校验依据(次优择优内容对齐,S20 跨代流实证)
    associateAssetsNames: item.associateAssetsNames,
    // 关键帧序列(M1d):>1 帧时建流克隆帧节点对
    storyboardKeyframes: item.keyframes,
    // 画面可见角色名(R18):构图模板按人数自适应;语义缺失不改写(fail-safe)
    storyboardVisibleCharacters: (item.shotSemantics?.visibleCharacters ?? [])
      .map((character) => character.name)
      .filter(Boolean),
  };
}
