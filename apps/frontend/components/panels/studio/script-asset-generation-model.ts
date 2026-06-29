import type { AssetGenerationTask } from "@/lib/studio/asset-generation-orchestrator";
import type { Character } from "@/stores/character-library-store";
import type { PropItem } from "@/stores/props-library-store";
import type { Scene } from "@/stores/scene-store";
import type { ScriptPlan } from "@/types/studio";
import { Gem, MapPin, UserRound, type LucideIcon } from "lucide-react";

export type AssetGenerationType = "character" | "scene" | "prop";

export type AssetRow =
  | { type: "character"; id: string; name: string; note?: string; asset?: Character }
  | { type: "scene"; id: string; name: string; note?: string; asset?: Scene }
  | { type: "prop"; id: string; name: string; note?: string; asset?: PropItem };

export const ASSET_TYPES: Array<{
  key: AssetGenerationType;
  label: string;
  Icon: LucideIcon;
}> = [
  { key: "character", label: "角色", Icon: UserRound },
  { key: "scene", label: "场景", Icon: MapPin },
  { key: "prop", label: "道具", Icon: Gem },
];

export function uniqueByName<T extends { name: string }>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) {
    if (!map.has(item.name)) map.set(item.name, item);
  }
  return map;
}

export function summarizeRows(rows: AssetRow[]) {
  let ready = 0;
  let todo = 0;
  for (const row of rows) {
    const image = getRowImage(row);
    if (row.asset?.promptState === "ready" || image) ready += 1;
    else todo += 1;
  }
  return { total: rows.length, ready, todo };
}

export function summarizeImageRows(rows: AssetRow[]) {
  let ready = 0;
  let todo = 0;
  let missingAsset = 0;
  for (const row of rows) {
    if (!row.asset) {
      missingAsset += 1;
      continue;
    }
    if (getRowImage(row)) ready += 1;
    else todo += 1;
  }
  return { total: rows.length, ready, todo, missingAsset };
}

export function toGenerationTask(
  row: AssetRow,
  visualManualId: string,
): AssetGenerationTask | null {
  if (!row.asset || getRowImage(row)) return null;
  const existingPrompt = getRowPrompt(row);
  return {
    assetId: row.asset.id,
    assetType: row.type,
    name: row.name,
    description: getRowDescription(row) || row.note || "",
    isDerivative:
      row.type === "prop"
        ? Boolean(row.asset.isDerivative)
        : row.type === "scene"
          ? Boolean(row.asset.isViewpointVariant)
          : false,
    visualManualId,
    identityAnchors:
      row.type === "character" ? row.asset.identityAnchors : undefined,
    referenceImages: getRowReferenceImages(row),
    skipPolish: Boolean(existingPrompt),
    existingPrompt: existingPrompt || undefined,
  };
}

export function getRowImage(row: AssetRow) {
  if (row.type === "character") {
    return row.asset?.thumbnailUrl || row.asset?.views?.[0]?.imageUrl;
  }
  if (row.type === "scene") {
    return row.asset?.referenceImage || row.asset?.referenceImageBase64;
  }
  return row.asset?.imageUrl;
}

export function getRowPrompt(row: AssetRow) {
  if (row.type === "character") return row.asset?.visualTraits;
  if (row.type === "scene") return row.asset?.visualPrompt;
  return row.asset?.visualPrompt;
}

export function getRowReferenceImages(row: AssetRow) {
  if (row.type === "character") return row.asset?.referenceImages;
  if (row.type === "scene") {
    return [row.asset?.referenceImage, row.asset?.referenceImageBase64].filter(
      (image): image is string => Boolean(image),
    );
  }
  return row.asset?.referenceImages;
}

export function getRowDescription(row: AssetRow) {
  if (row.type === "character") {
    return row.asset?.description || row.asset?.role || row.asset?.traits;
  }
  if (row.type === "scene") {
    return row.asset?.location || row.asset?.atmosphere || row.asset?.notes;
  }
  return row.asset?.description || row.asset?.visualPrompt;
}

export function toRuntimeAssetType(type: AssetGenerationType) {
  return type === "prop" ? "tool" : type === "character" ? "role" : "scene";
}

export function typeLabel(type: AssetGenerationType) {
  return type === "character" ? "角色" : type === "scene" ? "场景" : "道具";
}

export function findPlanForEpisode(plans: ScriptPlan[], episodeId: string) {
  return plans.find((item) => item.episodeId === episodeId) ?? plans[plans.length - 1];
}
