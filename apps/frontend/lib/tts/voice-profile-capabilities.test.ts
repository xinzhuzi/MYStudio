import { describe, expect, it } from "vitest";
import {
  getDefaultPresetVoiceId,
  getPresetVoiceOptions,
  getVoiceProfileType,
  validateVoiceProfileForGeneration,
} from "./voice-profile-capabilities";

describe("TTS voice profile capabilities", () => {
  it("exposes built-in voices for preset engines", () => {
    expect(getVoiceProfileType("qwen_custom_voice")).toBe("preset");
    expect(getVoiceProfileType("kokoro")).toBe("preset");
    expect(getPresetVoiceOptions("qwen_custom_voice").map((voice) => voice.id)).toContain("Vivian");
    expect(getDefaultPresetVoiceId("kokoro", "zh")).toBe("zf_xiaobei");
  });

  it("validates reference cloning inputs before running generation", () => {
    expect(validateVoiceProfileForGeneration({
      id: "profile-qwen",
      name: "旁白",
      type: "reference",
      language: "zh",
      defaultEngine: "qwen",
      defaultModelSize: "0.6B",
      createdAt: 1,
      updatedAt: 1,
    })).toContain("参考音频");

    expect(validateVoiceProfileForGeneration({
      id: "profile-qwen",
      name: "旁白",
      type: "reference",
      language: "zh",
      defaultEngine: "qwen",
      defaultModelSize: "0.6B",
      referenceAudioPath: "/tmp/ref.wav",
      createdAt: 1,
      updatedAt: 1,
    })).toContain("参考文本");
  });

  it("requires a selected built-in voice for preset profiles", () => {
    expect(validateVoiceProfileForGeneration({
      id: "profile-custom",
      name: "预设旁白",
      type: "preset",
      language: "zh",
      defaultEngine: "qwen_custom_voice",
      defaultModelSize: "0.6B",
      createdAt: 1,
      updatedAt: 1,
    })).toContain("预设音色");
  });
});
