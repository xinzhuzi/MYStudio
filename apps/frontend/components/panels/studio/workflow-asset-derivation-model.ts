import type { EntityExtractionResult, ScriptPlan } from "@/types/studio";
import type { StudioAssetSummary } from "@/types/studio-assets";
import { buildStudioFlowData, type StudioFlowData } from "@/lib/studio/studio-flow-data";
import type {
  ProductionFlowAssetCard,
  ProductionFlowAssetGroup,
  ProductionFlowAssetLibraryMatches,
  ProductionFlowAssetMedia,
  ProductionFlowAssetSummary,
  ProductionFlowModelInput,
  ProductionFlowRuntimeAssetKind,
} from "./workflow-node-model";

export function buildAssetDerivationModel(
  assets: ReturnType<typeof buildStudioFlowData>["assets"],
  scriptPlans: ScriptPlan[],
  assetMediaById: ProductionFlowModelInput["assetMediaById"] = {},
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
    };
  });
  return { groups, summary };
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
  return assets.find((asset) => {
    const parentMedia = resolveAssetMedia(asset, mediaLookup);
    return [
      asset.id,
      asset.name,
      parentMedia?.id,
      parentMedia?.name,
    ].includes(media.parentAssetId) || [
      asset.id,
      asset.name,
      parentMedia?.id,
      parentMedia?.name,
    ].includes(media.parentAssetName);
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
