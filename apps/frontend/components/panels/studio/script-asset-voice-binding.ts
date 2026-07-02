import { toRoleSpeakerId } from "@/lib/tts/role-speaker-id";
import type { ProjectVoiceBinding, TtsSpeakerId, VoiceProfile } from "@/types/tts";
import type { AssetRow } from "./script-asset-generation-model";

export type RoleVoiceBindingResolution =
  | {
      state: "assigned";
      speakerId: TtsSpeakerId;
      binding: ProjectVoiceBinding;
      profile: VoiceProfile;
    }
  | {
      state: "missing-profile";
      speakerId: TtsSpeakerId;
      binding: ProjectVoiceBinding;
      profileId: string;
    }
  | {
      state: "unassigned";
    };

export function getRoleVoiceSpeakerIds(row: AssetRow): TtsSpeakerId[] {
  if (row.type !== "character") return [];
  return uniqueIds([row.asset?.id, row.id, row.assetLibraryId]).map(toRoleSpeakerId);
}

export function resolveRoleVoiceBinding(
  speakerIds: TtsSpeakerId[],
  bindings: Record<string, ProjectVoiceBinding>,
  voiceProfiles: Record<string, VoiceProfile>,
): RoleVoiceBindingResolution {
  let missingProfile: RoleVoiceBindingResolution | null = null;

  for (const speakerId of speakerIds) {
    const binding = bindings[speakerId];
    if (!binding) continue;
    const profile = voiceProfiles[binding.profileId];
    if (profile) {
      return { state: "assigned", speakerId, binding, profile };
    }
    missingProfile ??= {
      state: "missing-profile",
      speakerId,
      binding,
      profileId: binding.profileId,
    };
  }

  return missingProfile ?? { state: "unassigned" };
}

function uniqueIds(ids: Array<string | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    const value = id?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
