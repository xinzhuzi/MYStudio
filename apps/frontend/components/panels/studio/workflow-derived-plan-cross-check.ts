// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// COMMERCIAL_LICENSE.md.
/**
 * ⑦ 衍生预划 × 当前章分镜引用 交叉核对(08-27 R2,纯函数零写入)。
 *
 * 三条结构化证据链(零模糊匹配、零 LLM):
 * - 角色:分镜逐镜钉的 ShotContinuityCharacterState.characterId+versionId →
 *   ContinuityAssetVersion.label / wardrobeVersion 即用到的衍生状态;
 * - 场景:分镜引用的场景 id 经媒体桥解析为衍生变体(parentSceneId+
 *   viewpointName)→ viewpointName 即衍生状态;
 * - 道具:StoryboardVisiblePropSemantic {name, state} → name 精确对父道具名,
 *   state 即衍生状态。
 *
 * 输出只有提示,不改 derivedAssetPlan、不自动补清单(改清单是导演规划重跑的事)。
 */
import type {
  ContinuityAssetVersion,
  ScriptPlan,
  StoryboardItem,
} from "@/types/studio";

export type DerivedPlanCrossCheckAssetKind = "character" | "scene" | "prop";

export interface DerivedPlanCrossCheckParent {
  id: string;
  name: string;
  kind: DerivedPlanCrossCheckAssetKind;
}

export interface DerivedPlanCrossCheckInput {
  /** 已章过滤的 ⑦ 衍生预划清单。 */
  planItems: ScriptPlan["derivedAssetPlan"];
  /** 已章过滤的当前章分镜。 */
  chapterStoryboards: StoryboardItem[];
  /** 连续性版本(角色状态证据);缺省视为无角色版本证据。 */
  continuityAssetVersions?: ContinuityAssetVersion[];
  /** 任意 id 空间的键(脚本 id/名、库实体 id、变体场景 id)→ 父资产。 */
  resolveParent: (key: string) => DerivedPlanCrossCheckParent | null;
  /**
   * 场景引用键 → 衍生变体 {父资产, 衍生状态};非衍生变体返回 null。
   * 父资产由接线方用衍生媒体桥(id+名双通道)解析,解析不到时 parent 为 null,
   * 该条证据静默丢弃(桥接失败不误报)。
   */
  resolveSceneVariant: (
    sceneRef: string,
  ) => { parent: DerivedPlanCrossCheckParent | null; state: string } | null;
  /** 父资产+状态 → 项目内是否已有衍生变体记录(含 ⑦ 预划落库)。 */
  hasDerivedVariant: (
    parent: DerivedPlanCrossCheckParent,
    state: string,
  ) => boolean;
}

export interface DerivedPlanCrossCheckUnplanned {
  parentAssetId: string;
  kind: DerivedPlanCrossCheckAssetKind;
  state: string;
  evidenceShotIds: string[];
}

export interface DerivedPlanCrossCheckUnused {
  parentAssetId: string;
  state: string;
}

export interface DerivedPlanCrossCheckResult {
  /** 分镜用到·未预划(且项目内也无该变体记录)。 */
  unplanned: DerivedPlanCrossCheckUnplanned[];
  /** 预划了但当前章分镜零引用。 */
  unused: DerivedPlanCrossCheckUnused[];
}

interface DerivedUsageEntry {
  parent: DerivedPlanCrossCheckParent;
  state: string;
  shotIds: Set<string>;
  /** 同一版本的状态别名(如 wardrobeVersion token):匹配预划/变体时同权。 */
  aliases: Set<string>;
}

function usageKey(parentAssetId: string, state: string) {
  return `${parentAssetId}\u0000${state}`;
}

export function crossCheckDerivedPlan(
  input: DerivedPlanCrossCheckInput,
): DerivedPlanCrossCheckResult {
  const versions = input.continuityAssetVersions ?? [];
  const versionById = new Map(versions.map((version) => [version.versionId, version]));
  const usage = new Map<string, DerivedUsageEntry>();
  const aliasToKey = new Map<string, string>();
  // 三条证据通道各自是否在本章分镜里出现过:通道没出现(旧数据没写连续性/
  // 出镜语义)时该类型的「未使用」判定静默跳过——证据缺失不等于零引用,不误报。
  const evidenceChannelSeen = { character: false, scene: false, prop: false };
  const upsertUse = (
    parent: DerivedPlanCrossCheckParent,
    state: string,
    shotId: string,
  ) => {
    const key = usageKey(parent.id, state);
    const entry = usage.get(key);
    if (entry) {
      entry.shotIds.add(shotId);
      return entry;
    }
    const fresh = { parent, state, shotIds: new Set([shotId]), aliases: new Set<string>() };
    usage.set(key, fresh);
    return fresh;
  };
  const recordUse = (
    parent: DerivedPlanCrossCheckParent | null,
    rawState: string | undefined,
    shotId: string,
  ) => {
    const state = rawState?.trim();
    if (!parent || !state) return;
    upsertUse(parent, state, shotId);
  };
  // 角色版本一次引用只算一条证据:label 为主状态,wardrobeVersion 作为同条
  // 证据的别名(预划状态写的是 token 时也能对上,不重复报)。
  const recordCharacterVersionUse = (
    parent: DerivedPlanCrossCheckParent,
    version: ContinuityAssetVersion,
    shotId: string,
  ) => {
    const label = version.label?.trim();
    const wardrobe = version.wardrobeVersion?.trim();
    if (!label) {
      if (wardrobe) upsertUse(parent, wardrobe, shotId);
      return;
    }
    const entry = upsertUse(parent, label, shotId);
    if (wardrobe && wardrobe !== label) {
      entry.aliases.add(wardrobe);
      aliasToKey.set(usageKey(parent.id, wardrobe), usageKey(parent.id, label));
    }
  };
  const usageHasKey = (parentId: string, state: string) => {
    const direct = usageKey(parentId, state);
    if (usage.has(direct)) return true;
    const aliasKey = aliasToKey.get(direct);
    return aliasKey ? usage.has(aliasKey) : false;
  };

  for (const storyboard of input.chapterStoryboards) {
    // 角色:逐镜钉版本 → 版本 label / wardrobeVersion 即用到的状态
    for (const characterState of storyboard.continuityState?.characters ?? []) {
      evidenceChannelSeen.character = true;
      const version = characterState.versionId
        ? versionById.get(characterState.versionId)
        : undefined;
      if (!version || version.assetId !== characterState.characterId) continue;
      const parent = input.resolveParent(characterState.characterId);
      if (parent) recordCharacterVersionUse(parent, version, storyboard.id);
    }
    // 场景:分镜引用的场景键解析为衍生变体 → viewpointName 即衍生状态
    for (const sceneRef of storyboard.assetIds) {
      const variant = input.resolveSceneVariant(sceneRef);
      if (!variant) continue;
      evidenceChannelSeen.scene = true;
      recordUse(variant.parent, variant.state, storyboard.id);
    }
    // 道具:出镜道具语义 {name, state}(name 精确对父道具名)
    for (const prop of storyboard.shotSemantics?.visibleProps ?? []) {
      evidenceChannelSeen.prop = true;
      recordUse(input.resolveParent(prop.name), prop.state, storyboard.id);
    }
  }

  const plannedKeys = new Set<string>();
  for (const item of input.planItems) {
    const parent = input.resolveParent(item.parentAssetId);
    if (!parent) continue;
    plannedKeys.add(usageKey(parent.id, item.state.trim()));
  }

  const unplanned = [...usage.values()]
    .filter((entry) => {
      const stateStrings = [entry.state, ...entry.aliases];
      const planned = stateStrings.some((state) =>
        plannedKeys.has(usageKey(entry.parent.id, state)),
      );
      const hasVariant = stateStrings.some((state) =>
        input.hasDerivedVariant(entry.parent, state),
      );
      return !planned && !hasVariant;
    })
    .map((entry) => ({
      parentAssetId: entry.parent.id,
      kind: entry.parent.kind,
      state: entry.state,
      evidenceShotIds: [...entry.shotIds],
    }));

  const unused = input.planItems.flatMap((item) => {
    const parent = input.resolveParent(item.parentAssetId);
    if (!parent || !evidenceChannelSeen[parent.kind]) return [];
    return usageHasKey(parent.id, item.state.trim())
      ? []
      : [{ parentAssetId: parent.id, state: item.state.trim() }];
  });

  return { unplanned, unused };
}
