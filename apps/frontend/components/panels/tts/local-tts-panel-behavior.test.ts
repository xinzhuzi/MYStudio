import { describe, expect, it } from "vitest";
import { applyModelStatuses, getTtsModelByName } from "@/lib/tts/model-catalog";
import { resolvePresetVoiceSelection, validateVoiceProfileForGeneration } from "@/lib/tts/voice-profile-capabilities";

describe("Local TTS catalog and voice profile behavior", () => {
  it("merges backend model status into the catalog row", () => {
    const model = getTtsModelByName("qwen-tts-0.6B");
    expect(model).toBeDefined();
    const rows = applyModelStatuses([{ model_name: "qwen-tts-0.6B", downloaded: true, loaded: false, downloading: false }]);
    expect(rows.find(row => row.modelName === "qwen-tts-0.6B")?.downloaded).toBe(true);
  });

  it("resolves preset voice metadata and rejects incomplete profiles", () => {
    const selection = resolvePresetVoiceSelection("qwen:Vivian", "zh");
    expect(selection?.engine).toBe("qwen");
    expect(validateVoiceProfileForGeneration({ id: "x", name: "旁白", type: "preset", language: "zh", defaultEngine: "qwen", createdAt: 0, updatedAt: 0 })).toBeTruthy();
  });
});
