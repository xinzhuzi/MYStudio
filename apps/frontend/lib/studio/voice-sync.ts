import { getDefaultModelSizeForEngine } from "@/lib/tts/voice-profile-capabilities";
import { useTtsStore } from "@/stores/tts-store";
import type { ProjectVoiceBinding, VoiceProfile } from "@/types/tts";
import type { VoiceAssignment } from "./voice-assigner";

type VoiceProfileInput = Omit<VoiceProfile, "id" | "createdAt" | "updatedAt">;

/** 注入式 sink，便于在不挂真实 store 的情况下测试桥接逻辑。 */
export interface VoiceProfileSink {
  createVoiceProfile: (profile: VoiceProfileInput) => string;
  bindSpeaker: (binding: ProjectVoiceBinding) => void;
}

export interface SyncCharacterVoicesDeps {
  projectId: string;
  sink: VoiceProfileSink;
}

export interface SyncCharacterVoicesResult {
  bound: number;
  profileIdByCharacter: Record<string, string>;
}

/**
 * 把音色分配落进 TTS 体系：每个角色建一个 preset VoiceProfile 并绑定到其 speakerId，
 * 后续分镜配音即可按 `character:{id}` 取到稳定音色（§M7 音色闭环）。
 */
export function syncCharacterVoices(
  assignments: VoiceAssignment[],
  deps: SyncCharacterVoicesDeps,
): SyncCharacterVoicesResult {
  const { sink } = deps;
  const profileIdByCharacter: Record<string, string> = {};
  let bound = 0;

  for (const assignment of assignments) {
    const engine = assignment.engine;
    const modelSize = getDefaultModelSizeForEngine(engine);
    const profileId = sink.createVoiceProfile({
      name: `音色·${assignment.characterId}`,
      type: "preset",
      language: "zh",
      defaultEngine: engine,
      defaultModelSize: modelSize,
      presetVoiceId: assignment.presetVoiceId,
      instruct: assignment.reason,
    });

    sink.bindSpeaker({
      speakerId: assignment.speakerId,
      profileId,
      defaultEngine: engine,
      defaultModelSize: modelSize,
    });

    profileIdByCharacter[assignment.characterId] = profileId;
    bound += 1;
  }

  return { bound, profileIdByCharacter };
}

/** 真实 moyin tts store 适配 sink；调用前请确保 setActiveProjectId 已指向目标项目。 */
export function createMoyinTtsSink(): VoiceProfileSink {
  return {
    createVoiceProfile: (profile) => useTtsStore.getState().createVoiceProfile(profile).id,
    bindSpeaker: (binding) => useTtsStore.getState().bindSpeaker(binding),
  };
}
