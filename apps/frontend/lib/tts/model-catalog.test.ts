import { describe, expect, it } from "vitest";
import {
  TTS_MODEL_GROUPS,
  applyModelStatuses,
  getDefaultTtsModel,
  getTtsModelByName,
  groupTtsModelsByPurpose,
} from "./model-catalog";

describe("TTS model catalog", () => {
  it("keeps all Voicebox TTS engines in the MYStudio download catalog", () => {
    const engines = new Set(TTS_MODEL_GROUPS.flatMap((group) => group.models.map((model) => model.engine)));

    expect(engines).toEqual(new Set([
      "qwen",
      "qwen_custom_voice",
      "luxtts",
      "chatterbox",
      "chatterbox_turbo",
      "tada",
      "kokoro",
    ]));
  });

  it("groups models by MYStudio narration use case", () => {
    const grouped = groupTtsModelsByPurpose();

    expect(grouped.voiceClone.models.map((model) => model.modelName)).toContain("qwen-tts-1.7B");
    expect(grouped.presetVoice.models.map((model) => model.modelName)).toContain("kokoro");
    expect(grouped.longAudio.models.map((model) => model.modelName)).toContain("tada-3b-ml");
  });

  it("merges backend status without losing static model metadata", () => {
    const rows = applyModelStatuses([
      {
        model_name: "kokoro",
        display_name: "Kokoro 82M",
        hf_repo_id: "hexgrad/Kokoro-82M",
        downloaded: true,
        downloading: false,
        loaded: true,
        size_mb: 355,
        model_cache_dir: "/Users/test/.cache/huggingface/hub",
        model_repo_path: "/Users/test/.cache/huggingface/hub/models--hexgrad--Kokoro-82M",
      },
    ]);

    const kokoro = rows.find((row) => row.modelName === "kokoro");

    expect(kokoro).toMatchObject({
      modelName: "kokoro",
      engine: "kokoro",
      downloaded: true,
      loaded: true,
      sizeMb: 355,
      purpose: "presetVoice",
      modelCacheDir: "/Users/test/.cache/huggingface/hub",
      modelRepoPath: "/Users/test/.cache/huggingface/hub/models--hexgrad--Kokoro-82M",
    });
  });

  it("exposes a stable default model for first-run narrator generation", () => {
    expect(getDefaultTtsModel()).toMatchObject({
      modelName: "qwen-tts-0.6B",
      engine: "qwen",
      modelSize: "0.6B",
    });
    expect(getTtsModelByName("qwen-custom-voice-1.7B")?.supportsInstruct).toBe(true);
  });
});
