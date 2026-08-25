// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 生图落库的连续性接线(方案 2 薄胶水):从 store 现势组装三件套并落库。
 *
 * 调用时序约定:在媒体回写(applyImageWorkflowResultToStoryboard /
 * buildStoryboardImageWorkflowPatch 落库)**之前**调用——updateStoryboard 的
 * mergeStoryboardReplacement 只有媒体/工作流 id 变化(freshWrite)才会清
 * stale,先落连续性再落图,图落库的 freshWrite 一并清掉连续性写入引发的
 * sourceChanged 标记;若连续性写入失败/前置不满足则静默跳过,不阻塞生图主链。
 *
 * 双 id 空间桥:参考节点的 source.id 是资产库 UUID,连续性版本按
 * 角色/场景/道具库的实体 id 登记——用三个实体库的名称索引解析
 * (entityNameMatches:精确→去前缀/后缀→包含)。
 */
import { entityNameMatches, buildStoryboardContinuityLanding } from "@/lib/studio/image-workflow/continuity-landing";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { usePropsLibraryStore } from "@/stores/library/props-library-store";
import { useSceneStore } from "@/stores/library/scene-store";
import { useStudioStore } from "@/stores/studio/studio-store";

function resolveEntityKeyByName(assetType: string, title: string): string | undefined {
  if (!title) return undefined;
  const entries: Array<{ id: string; name: string }> = assetType === "scene"
    ? useSceneStore.getState().scenes.map((scene) => ({ id: scene.id, name: scene.name }))
    : assetType === "character"
      ? useCharacterLibraryStore.getState().characters.map((character) => ({ id: character.id, name: character.name }))
      : usePropsLibraryStore.getState().items.map((item) => ({ id: item.id, name: item.name }));
  return entries.find((entry) => entityNameMatches(entry.name, title))?.id;
}

export function landStoryboardContinuity(
  storyboardId: string,
  workflowId: string,
  generatedNodeId: string,
): boolean {
  const store = useStudioStore.getState();
  const graph = store.imageWorkflows.find((item) => item.id === workflowId);
  if (!graph || graph.target.kind !== "storyboard") return false;
  const storyboard = store.storyboards.find((item) => item.id === storyboardId);
  if (!storyboard) return false;
  const patch = buildStoryboardContinuityLanding({
    storyboard,
    graph,
    generatedNodeId,
    continuityAssetVersions: store.continuityAssetVersions,
    storyboards: store.storyboards,
    resolveAssetKey: (assetType, _assetLibraryId, title) => resolveEntityKeyByName(assetType, title),
  });
  if (!patch) return false;
  store.updateStoryboard(storyboardId, patch);
  return true;
}
