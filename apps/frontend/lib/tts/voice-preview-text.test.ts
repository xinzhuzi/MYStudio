import { describe, expect, it } from "vitest";
import {
  MISSING_QWEN_REFERENCE_TEXT_MESSAGE,
  buildRoleVoicePreviewText,
  findReferenceTextForVoiceProfile,
  getVoicePreviewBlockReason,
} from "./voice-preview-text";
import type { VoiceProfile } from "@/types/tts";

function profile(referenceText?: string): VoiceProfile {
  return {
    id: "voice-1",
    name: "角色音色",
    type: "reference",
    language: "zh",
    defaultEngine: "qwen",
    defaultModelSize: "1.7B",
    referenceAudioPath: "/voices/ref.wav",
    referenceText,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("voice preview text", () => {
  it("uses a normal Chinese role audition sentence", () => {
    expect(buildRoleVoicePreviewText("独孤剑尘")).toBe(
      "我是独孤剑尘。这一句是中文角色试音，请用清晰自然的语气说出来。",
    );
  });

  it("blocks qwen cloning preview when reference text is missing", () => {
    expect(getVoicePreviewBlockReason(profile())).toBe(MISSING_QWEN_REFERENCE_TEXT_MESSAGE);
    expect(getVoicePreviewBlockReason(profile("我会走到最后。"))).toBeNull();
  });

  it("recovers missing qwen reference text from the matching audio asset", () => {
    expect(
      findReferenceTextForVoiceProfile(profile(), [
        {
          id: "audio-1",
          source: "manying-local",
          type: "audio",
          name: "军士-男-低音、厚实、强壮",
          sourcePath: "/voices/ref.wav",
          description: "吾等身披战甲，手握利剑，誓死捍卫国土，不辱使命。",
        },
      ]),
    ).toBe("吾等身披战甲，手握利剑，誓死捍卫国土，不辱使命。");
  });
});
