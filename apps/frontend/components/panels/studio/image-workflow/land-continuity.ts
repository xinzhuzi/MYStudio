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
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { storyboardSourceFingerprint } from "@/stores/studio/studio-store-continuity-helpers";
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
  if (!patch) {
    // R16 可见性(08-28):版本解析失败(连续性圣经缺该实体版本——S10 实证「道口镇
    // 街巷」实体在库但无版本)时 manifest 不刷新,分镜可能保留旧代清单,审核/离线
    // 审计会拿陈旧参考判卷。不做 manifest 改写(会破坏章节闸门的 approved 校验),
    // 但必须把陈旧性显式化:graph 实际参考 vs manifest 现值分叉时告警入诊断日志。
    const graphRefNames = graph.nodes
      .filter((node) => node.type === "reference")
      .map((node) => node.title)
      .filter(Boolean);
    const manifestNames = (storyboard.orderedReferenceManifest ?? [])
      .map((ref) => ref.assetName)
      .filter(Boolean);
    const diverged = manifestNames.length > 0
      && graphRefNames.some((name) => name && !manifestNames.includes(name));
    if (diverged) {
      void logEvent({
        level: "warn",
        category: "ai",
        operationId: createOperationId("continuity-landing-stale-manifest"),
        message: "连续性版本解析失败,分镜 manifest 未刷新(审核参考可能陈旧)",
        context: { storyboardId, graphRefNames, manifestNames },
      });
    }
    return false;
  }
  store.updateStoryboard(storyboardId, patch);
  // R21 根修(08-28):落库写入 manifest/continuityState 后分镜 sourceFingerprint
  // 随内容重算(mergeStoryboardReplacement);工作流若仍持有落库前指纹,下一轮
  // findStoryboardWorkflowForContext 必失配 → 每轮新建流重新解析参考(注入随之
  // 作废)。按落库后内容同步刷新本流指纹,保持同代工作流可复用。指纹哈希不含
  // mediaRef,后续媒体回写不会再次改变它。
  const landedFingerprint = storyboardSourceFingerprint({ ...storyboard, ...patch });
  if (landedFingerprint && landedFingerprint !== graph.targetSourceFingerprint) {
    useStudioStore.getState().upsertImageWorkflow({
      ...graph,
      targetSourceFingerprint: landedFingerprint,
      updatedAt: Date.now(),
    });
  }
  return true;
}
