import { describe, expect, it, vi } from "vitest";
import { recoverVoiceProfileReferenceText } from "./voice-profile-reference-recovery";
import type { VoiceProfile } from "@/types/tts";

function profile(): VoiceProfile {
  return {
    id: "voice-1",
    name: "角色音色",
    type: "reference",
    language: "zh",
    defaultEngine: "qwen",
    defaultModelSize: "1.7B",
    referenceAudioPath: "/voices/ref.wav",
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("voice profile reference recovery", () => {
  it("fills missing reference text from a matching audio asset", async () => {
    const updateVoiceProfile = vi.fn();

    const recovered = await recoverVoiceProfileReferenceText(
      profile(),
      updateVoiceProfile,
      async () => [
        {
          id: "audio-1",
          source: "manying-local",
          type: "audio",
          name: "军士音色",
          sourcePath: "/voices/ref.wav",
          description: "吾等身披战甲，手握利剑。",
        },
      ],
    );

    expect(recovered.referenceText).toBe("吾等身披战甲，手握利剑。");
    expect(updateVoiceProfile).toHaveBeenCalledWith("voice-1", {
      referenceText: "吾等身披战甲，手握利剑。",
    });
  });

  it("leaves the profile unchanged when no audio asset text matches", async () => {
    const updateVoiceProfile = vi.fn();
    const original = profile();

    const recovered = await recoverVoiceProfileReferenceText(
      original,
      updateVoiceProfile,
      async () => [],
    );

    expect(recovered).toBe(original);
    expect(updateVoiceProfile).not.toHaveBeenCalled();
  });
});
