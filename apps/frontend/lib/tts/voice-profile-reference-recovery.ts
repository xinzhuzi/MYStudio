import type { StudioAssetSummary } from "@/types/studio-assets";
import type { VoiceProfile } from "@/types/tts";
import { findReferenceTextForVoiceProfile } from "./voice-preview-text";

type VoiceProfileInput = Omit<VoiceProfile, "id" | "createdAt" | "updatedAt">;

export async function recoverVoiceProfileReferenceText(
  profile: VoiceProfile,
  updateVoiceProfile: (
    profileId: string,
    updates: Partial<VoiceProfileInput>,
  ) => void,
  listAudioAssets = listRuntimeAudioAssets,
) {
  if (profile.referenceText?.trim() || !profile.referenceAudioPath) {
    return profile;
  }

  const audioAssets = await listAudioAssets().catch(() => []);
  const recoveredText = findReferenceTextForVoiceProfile(profile, audioAssets);
  if (!recoveredText) return profile;

  updateVoiceProfile(profile.id, { referenceText: recoveredText });
  return { ...profile, referenceText: recoveredText, updatedAt: Date.now() };
}

async function listRuntimeAudioAssets(): Promise<StudioAssetSummary[]> {
  if (typeof window === "undefined" || !window.studioAssets?.list) {
    return [];
  }
  const result = await window.studioAssets.list({ type: "audio", limit: 9999 });
  return result.items ?? [];
}
