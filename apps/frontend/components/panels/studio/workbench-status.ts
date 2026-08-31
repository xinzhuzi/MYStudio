import type { RemotionQueueScopeState } from "./useRemotionQueueScope";
import { persistableProjectMediaPath, resolveAssetCurrentMediaPaths } from "./workflow-asset-media-path";
import { isStoryboardReadyForVideoWorkflow } from "@/lib/studio/video-workflow/chapter-run-request";
import type { ToonflowWorkbenchAssetMedia } from "@/lib/studio/workbench-view-model";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { SubtitleAuthority } from "@/types/editing";
import type { RemotionCurrentSlotV1, RemotionRenderJobV1 } from "@/types/remotion-workspace";
import type { ContinuityAssetVersion } from "@/types/studio";
import type { VideoUseStoryboardSourcePolicy } from "@rendering/contracts/video-workflow";

/**
 * 工作台 Remotion 状态纯函数族——章节就绪判定/镜头槽解析与计数/字幕权威汇总/当前任务选择/首镜状态文案/资产媒体映射。file-size-reduction P2 拆出,体逐字保留。
 */
export function isCurrentChapterReady(
  episodeId: string,
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"],
  slots: RemotionCurrentSlotV1[],
  storyboardSourcePolicy: VideoUseStoryboardSourcePolicy = "current-ready",
) {
  const currentStoryboards = storyboards.filter((storyboard) => storyboard.episodeId === episodeId);
  return currentStoryboards.length > 0
    && countCurrentShotSlots(episodeId, currentStoryboards, slots, storyboardSourcePolicy) === currentStoryboards.length;
}

/**
 * The workbench must create an EditingProject from the direct, chapter-scoped
 * queue read. Props only keep standalone renderer tests usable before the
 * desktop bridge has answered; a loaded empty/error scope remains fail-closed.
 */
export function resolveWorkbenchRemotionShotSlots(
  queueScope: Pick<RemotionQueueScopeState, "loaded" | "currentShotSlots">,
  fallbackSlots?: RemotionCurrentSlotV1[],
): RemotionCurrentSlotV1[] {
  return queueScope.loaded ? queueScope.currentShotSlots : fallbackSlots ?? [];
}

export function countCurrentShotSlots(
  episodeId: string,
  storyboards: ReturnType<typeof useStudioStore.getState>["storyboards"],
  slots: RemotionCurrentSlotV1[],
  storyboardSourcePolicy: VideoUseStoryboardSourcePolicy = "current-ready",
) {
  const currentStoryboards = storyboards.filter((storyboard) => storyboard.episodeId === episodeId);
  return currentStoryboards.filter((storyboard) => isStoryboardReadyForVideoWorkflow(storyboard, storyboardSourcePolicy) && slots.some((slot) => slot.target.kind === "shot"
    && slot.target.chapterId === episodeId
    && slot.target.shotId === storyboard.id
    && slot.target.shotRevision === Math.max(1, storyboard.outputVersion ?? 1)
    && slot.job.status === "succeeded")).length;
}

export function summarizeSubtitleAuthority(storyboards: readonly { subtitleAuthority?: SubtitleAuthority }[]) {
  const modes = [...new Set(storyboards.map((storyboard) => storyboard.subtitleAuthority?.mode ?? "unknown"))];
  if (modes.length === 0 || modes.includes("unknown")) {
    return { label: "unknown / 阻塞", detail: "每个视觉源需有明确策略和证据；TTS 文本不是可见字幕证明。" };
  }
  const names: Record<string, string> = {
    "clean-remotion": "Remotion 普通字幕",
    "source-embedded": "源媒体内嵌字幕",
    hyperframes: "HyperFrames 动效字幕",
  };
  return { label: modes.map((mode) => names[mode] ?? mode).join(" + "), detail: "subtitleMode 由 cue owner 派生，避免重复字幕。" };
}

export function selectCurrentShotJobForStoryboard(
  storyboard: ReturnType<typeof useStudioStore.getState>["storyboards"][number],
  jobs: RemotionRenderJobV1[],
  slots: RemotionCurrentSlotV1[],
): RemotionRenderJobV1 | undefined {
  const revision = Math.max(1, storyboard.outputVersion ?? 1);
  const currentSlot = slots.find((slot) => slot.target.kind === "shot"
    && slot.target.chapterId === storyboard.episodeId
    && slot.target.shotId === storyboard.id
    && slot.target.shotRevision === revision);
  if (currentSlot) return currentSlot.job;
  return jobs
    .filter((item) => item.target.kind === "shot"
      && item.target.chapterId === storyboard.episodeId
      && item.target.shotId === storyboard.id
      && item.target.shotRevision === revision)
    .slice()
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))[0];
}

export function formatFirstShotStatus(status: RemotionRenderJobV1["status"]): string {
  switch (status) {
    case "queued":
    case "running":
      return status === "queued" ? "排队中" : "渲染中";
    case "succeeded":
      return "已生成";
    case "failed":
      return "生成失败";
    case "canceled":
      return "已取消";
    case "stale":
      return "已过期";
    case "blocked":
      return "已阻塞";
    case "ready":
      return "待执行";
    case "pending":
      return "待准备";
    default:
      return status;
  }
}


export function buildWorkbenchAssetMediaMap(
  characters: ReturnType<typeof useCharacterLibraryStore.getState>["characters"],
  scenes: ReturnType<typeof useSceneStore.getState>["scenes"],
  propsItems: ReturnType<typeof usePropsLibraryStore.getState>["items"],
  continuityAssetVersions?: ContinuityAssetVersion[],
): Record<string, ToonflowWorkbenchAssetMedia & { stale?: boolean }> {
  const entries: Record<string, ToonflowWorkbenchAssetMedia & { stale?: boolean }> = {};
  // 08-27 R1 衍生图过期判定:衍生记录带父代锚时与「父当前样子」比对——父媒体
  // 路径变了 → stale;路径没变但锚里存了连续性指纹且父最新批准指纹漂移 → stale。
  // 存量记录无锚 = 代次未知,不设 stale(静默,漏报优于误报)。
  const latestApprovedByAssetId = new Map<string, ContinuityAssetVersion>();
  for (const version of continuityAssetVersions ?? useStudioStore.getState().continuityAssetVersions) {
    if (!version.approved) continue;
    const incumbent = latestApprovedByAssetId.get(version.assetId);
    const rank = (item: ContinuityAssetVersion) =>
      item.approval?.reviewedAt ?? 0;
    if (
      !incumbent
      || rank(version) > rank(incumbent)
      || (rank(version) === rank(incumbent)
        && version.versionId.localeCompare(incumbent.versionId) > 0)
    ) {
      latestApprovedByAssetId.set(version.assetId, version);
    }
  }
  const evaluateDerivedStale = (
    anchor: { parentMediaPath?: string; parentContinuityFingerprint?: string } | undefined,
    parentCurrentCandidates: string[],
    parentAssetId: string | undefined,
  ): boolean | undefined => {
    if (!anchor) return undefined;
    // 08-27 二期 R2:命中候选集合任一即不算路径过期——一期锚值是当时 legacy 链
    // 首位(通常 thumbnailUrl),该资产出现连续性版本后 candidates[0] 切到连续性
    // 图,若仍只比「首位」会全量假报过期;宁可漏报,指纹漂移仍是权威判据。
    // 路径裁定:比对只认可持久化候选(项目相对虚拟协议/裸相对路径),与锚
    // 写入同口径;data:/http(s)/绝对路径不参与锚比对(父卡显示不受此限)。
    const persistableCandidates = parentCurrentCandidates.filter(
      persistableProjectMediaPath,
    );
    if (
      anchor.parentMediaPath
      && !persistableCandidates.includes(anchor.parentMediaPath)
    ) {
      return true;
    }
    const currentFingerprint = parentAssetId
      ? latestApprovedByAssetId.get(parentAssetId)?.contentFingerprint
      : undefined;
    if (
      anchor.parentContinuityFingerprint
      && currentFingerprint
      && anchor.parentContinuityFingerprint !== currentFingerprint
    ) {
      return true;
    }
    return undefined;
  };
  for (const character of characters) {
    // 二期 R2:父卡显示与锚比对共用同一候选解析(连续性最新批准图优先,
    // 无连续性版本时 legacy 链行为与一期完全一致)。
    const parentCandidates = resolveAssetCurrentMediaPaths({
      kind: "character",
      character,
      latestApprovedVersion: latestApprovedByAssetId.get(character.id),
    });
    const path = parentCandidates[0];
    if (path) {
      entries[character.id] = {
        id: character.id,
        name: character.name,
        fileType: "image",
        path,
        prompt: character.visualTraits || character.description,
      };
    }
    for (const variation of character.variations ?? []) {
      entries[variation.id] = {
        id: variation.id,
        name: variation.name,
        fileType: "image",
        path: variation.referenceImage,
        prompt: variation.visualPromptZh || variation.visualPrompt,
        parentAssetId: character.id,
        parentAssetName: character.name,
        state: variation.name,
        reason: variation.stageDescription || variation.ageDescription,
        imageWorkflowId: variation.imageWorkflowId,
        imageWorkflowTarget: {
          kind: "asset",
          assetType: "character",
          parentId: character.id,
          id: variation.id,
        },
        stale: evaluateDerivedStale(variation.parentAnchor, parentCandidates, character.id),
      };
    }
  }
  for (const scene of scenes) {
    // 基础场景(无 parentSceneId)是父卡:显示切连续性最新批准图优先;
    // 视角变体保持自身取图链不变。
    const path = scene.parentSceneId
      ? scene.referenceImage
        ?? scene.referenceImageBase64
        ?? getOptionalStringField(scene, "contactSheetImage")
      : resolveAssetCurrentMediaPaths({
          kind: "scene",
          scene,
          latestApprovedVersion: latestApprovedByAssetId.get(scene.id),
        })[0];
    const parentScene = scene.parentSceneId
      ? scenes.find((item) => item.id === scene.parentSceneId)
      : undefined;
    const parentCandidates = parentScene
      ? resolveAssetCurrentMediaPaths({
          kind: "scene",
          scene: parentScene,
          latestApprovedVersion: latestApprovedByAssetId.get(parentScene.id),
        })
      : [];
    entries[scene.id] = {
      id: scene.id,
      name: scene.viewpointName || scene.name,
      fileType: "image",
      path,
      prompt: scene.visualPrompt || scene.location || scene.atmosphere,
      parentAssetId: scene.parentSceneId,
      parentAssetName: parentScene?.name,
      state: scene.viewpointName,
      reason: scene.notes || scene.spatialLayout,
      imageWorkflowId: scene.imageWorkflowId,
      imageWorkflowTarget: scene.parentSceneId
        ? {
            kind: "asset",
            assetType: "scene",
            parentId: scene.parentSceneId,
            id: scene.id,
          }
        : undefined,
      stale: evaluateDerivedStale(scene.parentAnchor, parentCandidates, scene.parentSceneId),
    };
  }
  for (const item of propsItems) {
    const parentProp = item.parentId
      ? propsItems.find((prop) => prop.id === item.parentId)
      : undefined;
    // 基础道具(无 parentId)是父卡:显示切连续性最新批准图优先;衍生道具保持自身图。
    const path = item.parentId
      ? item.imageUrl
      : resolveAssetCurrentMediaPaths({
          kind: "prop",
          prop: item,
          latestApprovedVersion: latestApprovedByAssetId.get(item.id),
        })[0];
    const parentCandidates = parentProp
      ? resolveAssetCurrentMediaPaths({
          kind: "prop",
          prop: parentProp,
          latestApprovedVersion: latestApprovedByAssetId.get(parentProp.id),
        })
      : [];
    entries[item.id] = {
      id: item.id,
      name: item.category || item.name,
      fileType: "image",
      path,
      prompt: item.visualPrompt || item.description,
      parentAssetId: item.parentId,
      parentAssetName: parentProp?.name,
      state: item.category,
      reason: item.description,
      imageWorkflowId: item.imageWorkflowId,
      imageWorkflowTarget: item.parentId
        ? {
            kind: "asset",
            assetType: "prop",
            parentId: item.parentId,
            id: item.id,
          }
        : undefined,
      stale: evaluateDerivedStale(item.parentAnchor, parentCandidates, item.parentId),
    };
  }
  return entries;
}

export function getOptionalStringField(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}
