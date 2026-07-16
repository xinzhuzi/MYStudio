import type { AssetImage, StudioAssetSummary } from "@/types/studio-assets";
import { getPrimaryAssetName } from "@/lib/studio/asset-names";

const MEDIA_EXT_PATTERN = /\.(mp3|wav|m4a|aac|flac|ogg|opus|png|jpe?g|webp|gif|mp4|mov|webm|mkv)$/i;

export function updateImagesAfterReplacingMainImage(images: AssetImage[], updatedAsset: StudioAssetSummary): AssetImage[] {
  const mainImage: AssetImage = {
    name: "主图",
    filePath: updatedAsset.filePath || "",
    url: updatedAsset.previewUrl || updatedAsset.thumbnailUrl,
  };
  const restImages = images[0]?.name === "主图" ? images.slice(1) : images;
  return [mainImage, ...restImages];
}

export function getAssetDisplayName(asset: StudioAssetSummary | null) {
  if (!asset) return "";
  return getPrimaryAssetName(asset.name || asset.sourcePath || asset.filePath, "未命名素材");
}

export function getAssetSpokenText(asset: StudioAssetSummary | null) {
  if (!asset) return "";
  const text = asset.description?.trim();
  if (text && !looksLikePath(text)) return text;
  return getAssetDisplayName(asset).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikePath(value: string) {
  return /[\\/]/.test(value) || MEDIA_EXT_PATTERN.test(value);
}

export function buildAssetRegenerationPrompt(asset: StudioAssetSummary | null) {
  if (!asset) return "";
  return [asset.prompt, asset.setting, asset.description].map((part) => part?.trim()).filter(Boolean).join("\n\n");
}
