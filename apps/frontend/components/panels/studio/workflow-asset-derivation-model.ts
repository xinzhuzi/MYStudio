import type {
  ContinuityAssetVersion,
  EntityExtractionResult,
  ScriptPlan,
  StoryboardItem,
} from "@/types/studio";
import type { StudioAssetSummary } from "@/types/studio-assets";
import { useStudioStore } from "@/stores/studio/studio-store";
import { buildStudioFlowData, type StudioFlowData } from "@/lib/studio/studio-flow-data";
import {
  crossCheckDerivedPlan,
  type DerivedPlanCrossCheckParent,
  type DerivedPlanCrossCheckResult,
} from "./workflow-derived-plan-cross-check";
import type {
  ProductionFlowAssetCard,
  ProductionFlowAssetGroup,
  ProductionFlowAssetGroupUnplanned,
  ProductionFlowAssetLibraryMatches,
  ProductionFlowAssetMedia,
  ProductionFlowAssetSummary,
  ProductionFlowModelInput,
  ProductionFlowRuntimeAssetKind,
} from "./workflow-asset-types";

/** 交叉核对接线入参:分镜来自章过滤后的当前章;连续性版本缺省读 studio store 现势。 */
export interface BuildAssetDerivationOptions {
  chapterStoryboards?: StoryboardItem[];
  continuityAssetVersions?: ContinuityAssetVersion[];
  /**
   * 08-27 二期 R1:当前章剧本正文指纹(scriptPlanSourceFingerprint)。传入才
   * 做 planStale 比对;不传 = 静默(无指纹存量 plan 同样静默)。
   */
  currentScriptFingerprint?: string;
}

export function buildAssetDerivationModel(
  assets: ReturnType<typeof buildStudioFlowData>["assets"],
  scriptPlans: ScriptPlan[],
  assetMediaById: ProductionFlowModelInput["assetMediaById"] = {},
  options?: BuildAssetDerivationOptions,
): { groups: ProductionFlowAssetGroup[]; summary: ProductionFlowAssetSummary } {
  const assetLookup = new Map<string, (typeof assets)[number]>();
  const mediaLookup = new Map<string, ProductionFlowAssetMedia>();
  for (const asset of assets) {
    assetLookup.set(asset.id, asset);
    assetLookup.set(asset.name, asset);
  }
  for (const media of Object.values(assetMediaById)) {
    if (!media) continue;
    indexAssetMedia(mediaLookup, media);
  }

  const derivedByParent = new Map<string, ProductionFlowAssetCard[]>();
  const derivedKeys = new Set<string>();
  const summary: ProductionFlowAssetSummary = {
    planned: 0,
    existing: 0,
    linked: 0,
    completed: 0,
    missingParent: 0,
    unused: 0,
    unplanned: 0,
  };
  const existingMediaIds = new Set<string>();
  const countExistingDerivedMedia = (media: ProductionFlowAssetMedia | undefined) => {
    if (!media || existingMediaIds.has(media.id)) return;
    existingMediaIds.add(media.id);
    summary.existing += 1;
  };
  for (const plan of scriptPlans) {
    for (const item of plan.derivedAssetPlan) {
      summary.planned += 1;
      const parent = resolvePlannedDerivedParent(item, assetLookup, assets, mediaLookup);
      if (!parent) {
        summary.missingParent += 1;
        continue;
      }
      summary.linked += 1;
      const media = resolveDerivedAssetMedia(item, parent, mediaLookup);
      const sourceMedia = resolveAssetMedia(parent, mediaLookup);
      const mediaPath = media?.path;
      countExistingDerivedMedia(media);
      if (mediaPath) summary.completed += 1;
      const derived: ProductionFlowAssetCard = {
        id: `${parent.id}:${item.state}`,
        name: item.state,
        typeLabel: typeLabelForAsset(parent.type),
        runtimeType: runtimeTypeForAsset(parent.type),
        mediaPath,
        state: item.state,
        reason: media?.reason || item.reason,
        parentAssetId: parent.id,
        prompt: media?.prompt || `${item.state}：${item.reason}`.trim(),
        generationState: mediaPath ? "已完成" : "未生成",
        isDerived: true,
        sourceImagePath: sourceMedia?.path,
        imageWorkflowId: media?.imageWorkflowId || item.imageWorkflowId,
        stale: media?.stale,
        imageWorkflowTarget:
          media?.imageWorkflowTarget ?? {
            kind: "asset",
            assetType: assetWorkflowTargetTypeForAsset(parent.type),
            parentId: parent.id,
            id: media?.id || `${parent.id}:${item.state}`,
          },
      };
      addDerivedAssetCard(derivedByParent, derivedKeys, parent.id, derived);
    }
  }

  for (const media of uniqueAssetMedia(Object.values(assetMediaById))) {
    if (!media.parentAssetId && !media.parentAssetName) continue;
    const parent = resolveParentAssetForMedia(media, assets, mediaLookup);
    if (!parent) continue;
    const sourceMedia = resolveAssetMedia(parent, mediaLookup);
    const derived: ProductionFlowAssetCard = {
      id: media.id,
      name: media.state || media.name,
      typeLabel: typeLabelForAsset(parent.type),
      runtimeType: runtimeTypeForAsset(parent.type),
      mediaPath: media.path,
      state: media.state || media.name,
      reason: media.reason || media.prompt,
      parentAssetId: parent.id,
      prompt: media.prompt,
      generationState: media.path ? "已完成" : "未生成",
      isDerived: true,
      sourceImagePath: sourceMedia?.path,
      imageWorkflowId: media.imageWorkflowId,
      stale: media.stale,
      imageWorkflowTarget:
        media.imageWorkflowTarget ?? {
          kind: "asset",
          assetType: assetWorkflowTargetTypeForAsset(parent.type),
          parentId: parent.id,
          id: media.id,
        },
    };
    if (addDerivedAssetCard(derivedByParent, derivedKeys, parent.id, derived)) {
      countExistingDerivedMedia(media);
      summary.linked += 1;
      if (media.path) summary.completed += 1;
    }
  }

  // 08-27 R2 分镜反哺交叉核对(只读):⑦ 预划 × 当前章分镜结构化引用。
  // 父资产解析走 id+名双通道(与上面衍生循环同一套桥),桥接失败的证据静默丢弃,
  // 不误报。结果只做提示:unused 标到 ⑦ 来源的衍生卡,unplanned 挂到组行。
  const crossCheck = options?.chapterStoryboards
    ? crossCheckDerivedPlan({
        planItems: scriptPlans.flatMap((plan) => plan.derivedAssetPlan),
        chapterStoryboards: options.chapterStoryboards,
        continuityAssetVersions:
          options.continuityAssetVersions
          ?? useStudioStore.getState().continuityAssetVersions,
        resolveParent: buildCrossCheckParentResolver(assets, assetLookup, mediaLookup),
        resolveSceneVariant: (sceneRef) => {
          const media = mediaLookup.get(sceneRef);
          if (!media?.parentAssetId || !media.state?.trim()) return null;
          const parent = resolveParentAssetForMedia(media, assets, mediaLookup);
          return parent
            ? { parent: { id: parent.id, name: parent.name, kind: parent.type }, state: media.state.trim() }
            : null;
        },
        hasDerivedVariant: (parent, state) =>
          (derivedByParent.get(parent.id) ?? []).some(
            (card) => card.state === state || card.name === state,
          ),
      })
    : emptyCrossCheckResult();
  summary.unused = crossCheck.unused.length;
  summary.unplanned = crossCheck.unplanned.length;
  // 08-27 二期 R1 预划剧本锚比对:本章 plan 盖过指纹且与当前剧本正文指纹
  // 不一致 → planStale(预划已过期,只提示不重跑)。存量 plan 无指纹、或调用
  // 方未传当前指纹 → 不设(静默,漏报优于误报)。
  summary.planStale =
    options?.currentScriptFingerprint !== undefined
    && summary.planned > 0
    && scriptPlans.some(
      (plan) =>
        plan.scriptFingerprint !== undefined
        && plan.scriptFingerprint !== options?.currentScriptFingerprint,
    );
  const unplannedByParent = new Map<string, ProductionFlowAssetGroupUnplanned[]>();
  for (const item of crossCheck.unplanned) {
    const list = unplannedByParent.get(item.parentAssetId) ?? [];
    list.push({ state: item.state, evidenceShotIds: item.evidenceShotIds });
    unplannedByParent.set(item.parentAssetId, list);
  }
  for (const item of crossCheck.unused) {
    for (const card of derivedByParent.get(item.parentAssetId) ?? []) {
      if (card.state === item.state || card.name === item.state) {
        card.unused = true;
      }
    }
  }

  const groups = assets.map<ProductionFlowAssetGroup>((asset) => {
    const media = resolveAssetMedia(asset, mediaLookup);
    const mediaPath = media?.path;
    return {
      source: {
        id: asset.id,
        name: asset.name,
        typeLabel: typeLabelForAsset(asset.type),
        runtimeType: runtimeTypeForAsset(asset.type),
        mediaPath,
        note: asset.note,
        prompt: media?.prompt,
        generationState: mediaPath ? "已完成" : "未生成",
        isDerived: false,
      },
      derived: derivedByParent.get(asset.id) ?? [],
      ...(unplannedByParent.has(asset.id)
        ? { unplanned: unplannedByParent.get(asset.id) }
        : {}),
    };
  });
  return { groups, summary };
}

function emptyCrossCheckResult(): DerivedPlanCrossCheckResult {
  return { unplanned: [], unused: [] };
}

/**
 * 交叉核对的父资产解析器:接受任意 id 空间的键——
 * 1) 脚本空间 id/名字直接命中;
 * 2) 衍生媒体键(库空间变体 id)→ 沿 parentAssetId/parentAssetName 桥回父资产;
 * 3) 基础资产媒体键(库实体 id,如连续性 characterId)→ 按媒体名精确桥回脚本资产。
 */
function buildCrossCheckParentResolver(
  assets: StudioFlowData["assets"],
  assetLookup: Map<string, StudioFlowData["assets"][number]>,
  mediaLookup: Map<string, ProductionFlowAssetMedia>,
) {
  const toParent = (asset: StudioFlowData["assets"][number]): DerivedPlanCrossCheckParent => ({
    id: asset.id,
    name: asset.name,
    kind: asset.type,
  });
  return (key: string): DerivedPlanCrossCheckParent | null => {
    const direct = assetLookup.get(key);
    if (direct) return toParent(direct);
    const media = mediaLookup.get(key);
    if (!media) return null;
    if (media.parentAssetId || media.parentAssetName) {
      const parent = resolveParentAssetForMedia(media, assets, mediaLookup);
      if (parent) return toParent(parent);
    }
    const mediaName = media.name?.trim();
    const byName = mediaName ? assetLookup.get(mediaName) : undefined;
    return byName ? toParent(byName) : null;
  };
}

function indexAssetMedia(
  mediaLookup: Map<string, ProductionFlowAssetMedia>,
  media: ProductionFlowAssetMedia,
) {
  const aliases = [
    media.id,
    media.name,
    media.state,
    media.toonflowAssetId == null ? undefined : String(media.toonflowAssetId),
    media.toonflowAssetId == null ? undefined : `toonflow-db:${media.toonflowAssetId}`,
    media.parentAssetId && media.state
      ? `${media.parentAssetId}:${media.state}`
      : undefined,
    media.parentAssetId && media.name
      ? `${media.parentAssetId}:${media.name}`
      : undefined,
    media.parentAssetId && media.state
      ? `${media.parentAssetId}·${media.state}`
      : undefined,
    media.parentAssetId && media.name
      ? `${media.parentAssetId}·${media.name}`
      : undefined,
    media.parentAssetName && media.state
      ? `${media.parentAssetName}:${media.state}`
      : undefined,
    media.parentAssetName && media.name
      ? `${media.parentAssetName}:${media.name}`
      : undefined,
    media.parentAssetName && media.state
      ? `${media.parentAssetName}·${media.state}`
      : undefined,
    media.parentAssetName && media.name
      ? `${media.parentAssetName}·${media.name}`
      : undefined,
    media.toonflowParentAssetId != null && media.state
      ? `${media.toonflowParentAssetId}:${media.state}`
      : undefined,
    media.toonflowParentAssetId != null && media.name
      ? `${media.toonflowParentAssetId}:${media.name}`
      : undefined,
    media.toonflowParentAssetId != null && media.state
      ? `toonflow-db:${media.toonflowParentAssetId}:${media.state}`
      : undefined,
    media.toonflowParentAssetId != null && media.name
      ? `toonflow-db:${media.toonflowParentAssetId}:${media.name}`
      : undefined,
  ].filter((alias): alias is string => Boolean(alias?.trim()));
  for (const alias of aliases) {
    mediaLookup.set(alias, media);
  }
}

function resolvePlannedDerivedParent(
  item: ScriptPlan["derivedAssetPlan"][number],
  assetLookup: Map<string, ReturnType<typeof buildStudioFlowData>["assets"][number]>,
  assets: ReturnType<typeof buildStudioFlowData>["assets"],
  mediaLookup: Map<string, ProductionFlowAssetMedia>,
) {
  const direct = assetLookup.get(item.parentAssetId);
  if (direct) return direct;

  const parentMedia = [
    item.toonflowAssetsId == null ? undefined : mediaLookup.get(String(item.toonflowAssetsId)),
    item.toonflowAssetsId == null ? undefined : mediaLookup.get(`toonflow-db:${item.toonflowAssetsId}`),
    mediaLookup.get(item.parentAssetId),
  ].find(Boolean);
  if (!parentMedia) return undefined;

  return assets.find((asset) => {
    const assetMedia = resolveAssetMedia(asset, mediaLookup);
    return [
      asset.id,
      asset.name,
      assetMedia?.id,
      assetMedia?.name,
      assetMedia?.toonflowAssetId == null ? undefined : String(assetMedia.toonflowAssetId),
      assetMedia?.toonflowAssetId == null ? undefined : `toonflow-db:${assetMedia.toonflowAssetId}`,
    ].includes(parentMedia.id) || [
      asset.id,
      asset.name,
      assetMedia?.id,
      assetMedia?.name,
    ].includes(parentMedia.name);
  });
}

function uniqueAssetMedia(
  values: Array<ProductionFlowAssetMedia | undefined>,
): ProductionFlowAssetMedia[] {
  const seen = new Set<string>();
  const unique: ProductionFlowAssetMedia[] = [];
  for (const media of values) {
    if (!media || seen.has(media.id)) continue;
    seen.add(media.id);
    unique.push(media);
  }
  return unique;
}

function addDerivedAssetCard(
  derivedByParent: Map<string, ProductionFlowAssetCard[]>,
  derivedKeys: Set<string>,
  parentId: string,
  derived: ProductionFlowAssetCard,
) {
  const key = `${parentId}:${derived.id}:${derived.name}`;
  const stateKey = `${parentId}:${derived.name}`;
  if (derivedKeys.has(key) || derivedKeys.has(stateKey)) return false;
  derivedKeys.add(key);
  derivedKeys.add(stateKey);
  derivedByParent.set(parentId, [
    ...(derivedByParent.get(parentId) ?? []),
    derived,
  ]);
  return true;
}

function resolveAssetMedia(
  asset: ReturnType<typeof buildStudioFlowData>["assets"][number],
  mediaLookup: Map<string, ProductionFlowAssetMedia>,
) {
  return mediaLookup.get(asset.id) ?? mediaLookup.get(asset.name);
}

function resolveParentAssetForMedia(
  media: ProductionFlowAssetMedia,
  assets: ReturnType<typeof buildStudioFlowData>["assets"],
  mediaLookup: Map<string, ProductionFlowAssetMedia>,
) {
  // parentAssetId/parentAssetName 任一非空才参与匹配;候选里的 undefined 必须
  // 剔除——否则 [.., undefined].includes(undefined) 恒真,任何无媒体资产都会
  // 冒名认领别人的衍生媒体(08-27 R2 交叉核对首当其冲,逐处核实后修复)。
  const parentAssetId = media.parentAssetId?.trim() || undefined;
  const parentAssetName = media.parentAssetName?.trim() || undefined;
  if (!parentAssetId && !parentAssetName) return undefined;
  return assets.find((asset) => {
    const parentMedia = resolveAssetMedia(asset, mediaLookup);
    const candidates = [asset.id, asset.name, parentMedia?.id, parentMedia?.name]
      .filter((value): value is string => Boolean(value?.trim()));
    return (parentAssetId ? candidates.includes(parentAssetId) : false)
      || (parentAssetName ? candidates.includes(parentAssetName) : false);
  });
}

function typeLabelForAsset(type: ReturnType<typeof buildStudioFlowData>["assets"][number]["type"]) {
  return type === "character" ? "角色" : type === "scene" ? "场景" : "道具";
}

function runtimeTypeForAsset(type: ReturnType<typeof buildStudioFlowData>["assets"][number]["type"]) {
  return type === "character" ? "role" : type === "scene" ? "scene" : "tool";
}

function resolveDerivedAssetMedia(
  item: ScriptPlan["derivedAssetPlan"][number],
  parent: ReturnType<typeof buildStudioFlowData>["assets"][number],
  mediaLookup: Map<string, ProductionFlowAssetMedia>,
) {
  return (
    mediaLookup.get(`${parent.id}:${item.state}`) ??
    mediaLookup.get(`${parent.id}·${item.state}`) ??
    mediaLookup.get(`${parent.name}:${item.state}`) ??
    mediaLookup.get(`${parent.name}·${item.state}`) ??
    (item.toonflowAssetsId == null ? undefined : mediaLookup.get(`${item.toonflowAssetsId}:${item.state}`)) ??
    (item.toonflowAssetsId == null ? undefined : mediaLookup.get(`toonflow-db:${item.toonflowAssetsId}:${item.state}`)) ??
    mediaLookup.get(item.state)
  );
}

export function buildAssetLibraryMatchNamesForProductionFlow(input: {
  entityExtractions: EntityExtractionResult[];
  scriptPlans: ScriptPlan[];
}): Record<ProductionFlowRuntimeAssetKind, string[]> {
  const assets = buildStudioFlowData({
    agentWorkData: [],
    entityExtractions: input.entityExtractions,
    scriptPlans: [],
    storyboards: [],
    productionTracks: [],
    videoCandidates: [],
  }).assets;
  const assetLookup = new Map<string, (typeof assets)[number]>();
  const names: Record<ProductionFlowRuntimeAssetKind, Set<string>> = {
    role: new Set(),
    scene: new Set(),
    tool: new Set(),
  };

  for (const asset of assets) {
    assetLookup.set(asset.id, asset);
    assetLookup.set(asset.name, asset);
    names[runtimeTypeForAsset(asset.type)].add(asset.name);
  }

  for (const plan of input.scriptPlans) {
    for (const item of plan.derivedAssetPlan) {
      const parent = assetLookup.get(item.parentAssetId);
      if (parent) {
        names[runtimeTypeForAsset(parent.type)].add(item.state);
        continue;
      }
      if (item.toonflowAssetsId == null) continue;
      for (const asset of assets) {
        names[runtimeTypeForAsset(asset.type)].add(item.state);
      }
    }
  }

  return {
    role: [...names.role],
    scene: [...names.scene],
    tool: [...names.tool],
  };
}

function getStudioAssetPreviewPath(asset: StudioAssetSummary) {
  return (
    asset.thumbnailUrl ||
    asset.previewUrl ||
    asset.images?.find((image) => image.url || image.filePath)?.url ||
    asset.images?.find((image) => image.url || image.filePath)?.filePath ||
    asset.filePath ||
    asset.sourcePath
  );
}

export function buildAssetLibraryMediaMapForProductionFlow(input: {
  entityExtractions: EntityExtractionResult[];
  scriptPlans: ScriptPlan[];
  matchesByType: ProductionFlowAssetLibraryMatches;
}): Record<string, ProductionFlowAssetMedia> {
  const assets = buildStudioFlowData({
    agentWorkData: [],
    entityExtractions: input.entityExtractions,
    scriptPlans: [],
    storyboards: [],
    productionTracks: [],
    videoCandidates: [],
  }).assets;
  const assetLookup = new Map<string, (typeof assets)[number]>();
  const entries: Record<string, ProductionFlowAssetMedia> = {};

  for (const asset of assets) {
    assetLookup.set(asset.id, asset);
    assetLookup.set(asset.name, asset);
    const media = studioAssetSummaryToMedia(
      findAssetLibraryMatch(
        input.matchesByType,
        runtimeTypeForAsset(asset.type),
        asset.name,
      ),
      {
        id: asset.id,
        name: asset.name,
      },
    );
    if (!media) continue;
    entries[asset.id] = media;
    entries[asset.name] = media;
  }

  for (const plan of input.scriptPlans) {
    for (const item of plan.derivedAssetPlan) {
      const parent = assetLookup.get(item.parentAssetId);
      if (!parent) {
        if (item.toonflowAssetsId == null) continue;
        for (const kind of ["role", "scene", "tool"] as const) {
          const numericMedia = studioAssetSummaryToMedia(
            findAssetLibraryMatch(input.matchesByType, kind, item.state),
            {
              id: `toonflow-db:${item.toonflowAssetsId}:${item.state}`,
              name: item.state,
              parentAssetId: `toonflow-db:${item.toonflowAssetsId}`,
              state: item.state,
              reason: item.reason,
              imageWorkflowId: item.imageWorkflowId,
              toonflowParentAssetId: item.toonflowAssetsId,
              imageWorkflowTarget: {
                kind: "asset",
                assetType:
                  kind === "role" ? "character" : kind === "tool" ? "prop" : "scene",
                parentId: `toonflow-db:${item.toonflowAssetsId}`,
              },
            },
          );
          if (!numericMedia) continue;
          entries[`${item.toonflowAssetsId}:${item.state}`] = numericMedia;
          entries[`toonflow-db:${item.toonflowAssetsId}:${item.state}`] = numericMedia;
        }
        continue;
      }
      const media = studioAssetSummaryToMedia(
        findAssetLibraryMatch(
          input.matchesByType,
          runtimeTypeForAsset(parent.type),
          item.state,
        ),
        {
          id: `${parent.id}:${item.state}`,
          name: item.state,
          parentAssetId: parent.id,
          parentAssetName: parent.name,
          state: item.state,
          reason: item.reason,
          imageWorkflowTarget: {
            kind: "asset",
            assetType: assetWorkflowTargetTypeForAsset(parent.type),
            parentId: parent.id,
          },
        },
      );
      if (!media) continue;
      entries[`${parent.id}:${item.state}`] = media;
      entries[`${parent.id}·${item.state}`] = media;
      entries[`${parent.name}:${item.state}`] = media;
      entries[`${parent.name}·${item.state}`] = media;
    }
  }

  return entries;
}

function assetWorkflowTargetTypeForAsset(
  type: StudioFlowData["assets"][number]["type"],
) {
  return type === "character" ? "character" : type === "prop" ? "prop" : "scene";
}

function findAssetLibraryMatch(
  matchesByType: ProductionFlowAssetLibraryMatches,
  kind: ProductionFlowRuntimeAssetKind,
  name: string,
) {
  return matchesByType[kind]?.[name.trim()] ?? null;
}

function studioAssetSummaryToMedia(
  asset: StudioAssetSummary | null | undefined,
  fallback: Pick<ProductionFlowAssetMedia, "id" | "name"> &
    Partial<ProductionFlowAssetMedia>,
): ProductionFlowAssetMedia | null {
  if (!asset) return null;
  const path = getStudioAssetPreviewPath(asset);
  if (!path) return null;
  const imageWorkflowTarget = fallback.imageWorkflowTarget
    ? {
        ...fallback.imageWorkflowTarget,
        id: fallback.imageWorkflowTarget.id || asset.id,
      }
    : undefined;
  return {
    id: fallback.id,
    name: fallback.name,
    path,
    prompt:
      asset.prompt ||
      asset.description ||
      asset.setting ||
      asset.remark ||
      fallback.prompt,
    parentAssetId: fallback.parentAssetId || asset.parentAssetId,
    parentAssetName: fallback.parentAssetName || asset.parentAssetName,
    state: fallback.state || asset.state,
    reason: fallback.reason || asset.description || asset.remark,
    imageWorkflowId: asset.imageWorkflowId || fallback.imageWorkflowId,
    imageWorkflowTarget,
    toonflowAssetId: asset.toonflowAssetId ?? fallback.toonflowAssetId,
    toonflowParentAssetId:
      asset.toonflowParentAssetId ?? fallback.toonflowParentAssetId,
  };
}
