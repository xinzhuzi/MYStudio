import type { StudioMaterial } from "@/types/studio";
import type { StudioAssetSummary } from "@/types/studio-assets";

export interface VoiceReferenceAsset {
  id: string;
  name: string;
  filePath: string;
  referenceText?: string;
  sourceLabel?: string;
}

export function buildVoiceReferenceAssets(
  materials: StudioMaterial[],
  runtimeAssets: StudioAssetSummary[] = [],
): VoiceReferenceAsset[] {
  const items: VoiceReferenceAsset[] = [
    ...materials
      .filter((item) => item.kind === "audio" && item.localPath.trim())
      .map((item) => ({
        id: `material:${item.id}`,
        name: item.name,
        filePath: item.localPath,
        sourceLabel: getFileName(item.sourceName || item.localPath),
      })),
    ...runtimeAssets
      .filter((item) => item.type === "audio" && getRuntimeAudioPath(item))
      .map((item) => ({
        id: item.id,
        name: item.name,
        filePath: getRuntimeAudioPath(item)!,
        referenceText: normalizeReferenceText(item.description),
        sourceLabel: getFileName(getRuntimeAudioPath(item)) || item.description,
      })),
  ];

  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.filePath;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeReferenceText(value?: string) {
  const text = value?.trim();
  if (!text || looksLikePath(text)) return undefined;
  return text;
}

function looksLikePath(value: string) {
  return /[\\/]/.test(value) || /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(value);
}

function getRuntimeAudioPath(item: StudioAssetSummary) {
  return item.sourcePath?.trim() || item.filePath?.trim() || undefined;
}

function getFileName(value?: string) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.split(/[\\/]/).pop() || normalized;
}
