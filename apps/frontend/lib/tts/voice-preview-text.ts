import type { VoiceProfile } from "@/types/tts";
import type { StudioAssetSummary } from "@/types/studio-assets";

export const MISSING_QWEN_REFERENCE_TEXT_MESSAGE =
  "该音色缺少参考音频的说话内容。请先在音频资产详情中生成说话内容，然后重新分配音色。";

export function buildRoleVoicePreviewText(characterName: string) {
  const name = characterName.trim() || "这个角色";
  return `我是${name}。这一句是中文角色试音，请用清晰自然的语气说出来。`;
}

export function getVoicePreviewBlockReason(profile: VoiceProfile) {
  if (profile.defaultEngine === "qwen" && !profile.referenceText?.trim()) {
    return MISSING_QWEN_REFERENCE_TEXT_MESSAGE;
  }
  return null;
}

export function findReferenceTextForVoiceProfile(
  profile: VoiceProfile,
  audioAssets: StudioAssetSummary[],
) {
  const referenceAudioPath = normalizePath(profile.referenceAudioPath);
  if (!referenceAudioPath) return undefined;

  const matchedAsset = audioAssets.find((asset) => {
    if (asset.type !== "audio") return false;
    return [asset.sourcePath, asset.filePath]
      .map(normalizePath)
      .some((path) => path === referenceAudioPath);
  });
  return normalizeReferenceText(matchedAsset?.description);
}

function normalizeReferenceText(value?: string) {
  const text = value?.trim();
  if (!text || looksLikePath(text)) return undefined;
  return text;
}

function normalizePath(value?: string) {
  return value?.trim() || undefined;
}

function looksLikePath(value: string) {
  return /[\\/]/.test(value) || /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(value);
}
