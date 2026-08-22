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
  // 2026-08-22 用户裁定:以详情页(资产库键)的音色为准——资产库键优先,角色库键兜底。
  // 背景:角色库键常由「自动分配音频」写入,与用户在详情页手动换绑的资产库键不一致时,
  // 行内试听会播旧音色;详情页才是用户维护音色的权威面。
  const ids: TtsSpeakerId[] = [];
  const assetLibraryId = row.assetLibrary?.id;
  if (assetLibraryId && assetLibraryId !== row.id) {
    ids.push(toRoleSpeakerId(assetLibraryId));
  }
  ids.push(toRoleSpeakerId(row.id));
  return ids;
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
