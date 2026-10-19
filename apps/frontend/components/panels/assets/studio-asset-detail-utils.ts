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

export function getAssetImageOpenTarget(
  images: AssetImage[],
  currentIndex: number,
  asset: StudioAssetSummary | null,
) {
  // 10-19 用户报障修复:「查看图片」报不存在——openPath 要的是磁盘路径,而 url 是
  // 运行时预览地址(previewUrl/thumbnailUrl 装配,常见 asset-file:///file:// 等协议
  // 头),拿它开文件必失败。优先级=当前图 filePath(族聚兄弟条目天然自带各自磁盘
  // 路径)→ 资产 sourcePath → 资产 filePath;url 仅作末位兜底且仅当自身形如磁盘
  // 路径(以 / 开头)才可用,否则返回空串走「没有可打开的本地路径」toast。
  const entry = images[currentIndex];
  const diskLikeUrl = entry?.url?.startsWith("/") ? entry.url : "";
  return entry?.filePath || asset?.sourcePath || asset?.filePath || diskLikeUrl || "";
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

export function getAssetOperationError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return `${fallback}: ${error.message.trim()}`;
  }
  return fallback;
}
