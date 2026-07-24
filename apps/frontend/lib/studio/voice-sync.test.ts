import { describe, expect, it } from "vitest";
import {
  syncCharacterVoices,
  type VoiceProfileSink,
} from "./voice-sync";
import type { VoiceAssignment } from "./voice-assigner";

function makeSink() {
  const calls = {
    createVoiceProfile: [] as Array<Parameters<VoiceProfileSink["createVoiceProfile"]>[0]>,
    bindSpeaker: [] as Array<Parameters<VoiceProfileSink["bindSpeaker"]>[0]>,
  };
  let seq = 0;
  const sink: VoiceProfileSink = {
    createVoiceProfile: (profile) => {
      calls.createVoiceProfile.push(profile);
      return `voice-profile-${++seq}`;
    },
    bindSpeaker: (binding) => {
      calls.bindSpeaker.push(binding);
    },
  };
  return { sink, calls };
}

const assignments: VoiceAssignment[] = [
  { characterId: "a", speakerId: "character:a", presetVoiceId: "Dylan", engine: "qwen_custom_voice", reason: "男青年" },
  { characterId: "b", speakerId: "character:b", presetVoiceId: "Vivian", engine: "qwen_custom_voice", reason: "女默认" },
];

describe("studio voice sync", () => {
  it("creates a preset voice profile per character and binds it to its speaker id", () => {
    const { sink, calls } = makeSink();
    const result = syncCharacterVoices(assignments, { projectId: "proj-1", sink });

    expect(calls.createVoiceProfile).toHaveLength(2);
    expect(calls.createVoiceProfile[0]).toMatchObject({
      type: "preset",
      presetVoiceId: "Dylan",
      defaultEngine: "qwen_custom_voice",
    });

    expect(calls.bindSpeaker).toHaveLength(2);
    expect(calls.bindSpeaker[0]).toMatchObject({
      speakerId: "character:a",
      profileId: "voice-profile-1",
      defaultEngine: "qwen_custom_voice",
    });

    expect(result.bound).toBe(2);
    expect(result.profileIdByCharacter).toEqual({ a: "voice-profile-1", b: "voice-profile-2" });
  });

  it("reuses an existing binding without replacing its profile", () => {
    const { sink, calls } = makeSink();
    const existing = {
      speakerId: "character:a" as const,
      profileId: "voice-profile-existing",
      defaultEngine: "qwen_custom_voice" as const,
      defaultModelSize: "1.7B",
    };
    const result = syncCharacterVoices(assignments, {
      projectId: "proj-1",
      sink: {
        ...sink,
        getBinding: (speakerId) => speakerId === existing.speakerId ? existing : undefined,
      },
    });

    expect(calls.createVoiceProfile).toHaveLength(1);
    expect(calls.bindSpeaker).toHaveLength(1);
    expect(calls.bindSpeaker[0]).toMatchObject({ speakerId: "character:b" });
    expect(result.bound).toBe(2);
    expect(result.profileIdByCharacter).toEqual({ a: "voice-profile-existing", b: "voice-profile-1" });
  });
});
