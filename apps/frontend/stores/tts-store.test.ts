import { describe, expect, it } from "vitest";
import { createTtsStore } from "./tts-store";

describe("TTS store", () => {
  it("creates scene voice lines outside SplitScene and defaults text from dialogue", () => {
    const store = createTtsStore();

    store.getState().setActiveProjectId("project-1");
    store.getState().ensureSceneVoiceLine({
      sceneId: 7,
      dialogue: "旁白：雨落在旧街尽头。",
      characterIds: ["char-a"],
    });

    expect(store.getState().getSceneVoiceLine(7)).toMatchObject({
      sceneId: 7,
      speakerId: "narrator",
      text: "旁白：雨落在旧街尽头。",
      engine: "qwen",
      modelSize: "0.6B",
      status: "idle",
    });
  });

  it("binds narrator and character speakers to reusable voice profiles", () => {
    const store = createTtsStore();

    store.getState().setActiveProjectId("project-1");
    const profile = store.getState().createVoiceProfile({
      name: "低沉旁白",
      type: "reference",
      language: "zh",
      defaultEngine: "qwen",
      defaultModelSize: "0.6B",
      referenceAudioPath: "/tmp/narrator.wav",
      referenceText: "这一夜，雨没有停。",
    });
    store.getState().bindSpeaker({
      speakerId: "narrator",
      profileId: profile.id,
      defaultEngine: "qwen",
      defaultModelSize: "0.6B",
    });

    expect(store.getState().getBinding("narrator")).toMatchObject({
      speakerId: "narrator",
      profileId: profile.id,
    });
    expect(store.getState().voiceProfiles[profile.id]).toMatchObject({
      name: "低沉旁白",
      referenceAudioPath: "/tmp/narrator.wav",
    });
  });

  it("tracks generation lifecycle and skips completed lines during missing-only batches", () => {
    const store = createTtsStore();

    store.getState().setActiveProjectId("project-1");
    store.getState().upsertSceneVoiceLine({ sceneId: 1, text: "第一句", status: "completed", audioLocalPath: "/tmp/1.wav" });
    store.getState().upsertSceneVoiceLine({ sceneId: 2, text: "第二句", status: "failed", error: "模型未下载" });
    store.getState().upsertSceneVoiceLine({ sceneId: 3, text: "第三句", status: "idle" });

    expect(store.getState().selectBatchSceneIds([1, 2, 3], "missing")).toEqual([2, 3]);

    store.getState().markGenerating(3, "gen-3");
    expect(store.getState().getSceneVoiceLine(3)).toMatchObject({
      status: "generating",
      generationId: "gen-3",
    });

    store.getState().markGenerating(2, "retry-2");
    expect(store.getState().getSceneVoiceLine(2)).toMatchObject({
      status: "generating",
      generationId: "retry-2",
      error: undefined,
    });

    store.getState().markCompleted(3, {
      audioLocalPath: "/tmp/3.wav",
      audioMaterialId: "mat-3",
      audioFilePath: "/Users/me/media/scene-3.wav",
      ttsBackend: "mock",
      mocked: true,
      warning: "Real qwen adapter unavailable",
    });

    expect(store.getState().getSceneVoiceLine(3)).toMatchObject({
      status: "completed",
      audioLocalPath: "/tmp/3.wav",
      audioMaterialId: "mat-3",
      audioFilePath: "/Users/me/media/scene-3.wav",
      ttsBackend: "mock",
      mocked: true,
      warning: "Real qwen adapter unavailable",
      error: undefined,
    });

    store.getState().clearSceneAudio(3);
    expect(store.getState().getSceneVoiceLine(3)).toMatchObject({
      status: "idle",
      audioLocalPath: undefined,
      audioMaterialId: undefined,
      audioFilePath: undefined,
      ttsBackend: undefined,
      mocked: undefined,
      warning: undefined,
    });
  });

  it("clears a previous speaker profile when switching to an unbound character", () => {
    const store = createTtsStore();

    store.getState().setActiveProjectId("project-1");
    const narrator = store.getState().createVoiceProfile({
      name: "旁白",
      type: "reference",
      language: "zh",
      defaultEngine: "qwen_custom_voice",
      defaultModelSize: "1.7B",
    });
    store.getState().upsertSceneVoiceLine({
      sceneId: 8,
      speakerId: "narrator",
      profileId: narrator.id,
      engine: "qwen_custom_voice",
      modelSize: "1.7B",
    });

    store.getState().upsertSceneVoiceLine({
      sceneId: 8,
      speakerId: "character:unbound",
      profileId: undefined,
      engine: undefined,
      modelSize: undefined,
    });

    expect(store.getState().getSceneVoiceLine(8)).toMatchObject({
      speakerId: "character:unbound",
      profileId: undefined,
      engine: "qwen",
      modelSize: "0.6B",
    });
  });

  it("supports quick preset profiles without reference audio", () => {
    const store = createTtsStore();

    store.getState().setActiveProjectId("project-1");
    const profile = store.getState().createVoiceProfile({
      name: "旁白声线",
      type: "preset",
      language: "zh",
      defaultEngine: "kokoro",
      presetVoiceId: "zf_xiaobei",
    });

    expect(store.getState().voiceProfiles[profile.id]).toMatchObject({
      type: "preset",
      defaultEngine: "kokoro",
      presetVoiceId: "zf_xiaobei",
    });
    expect(store.getState().voiceProfiles[profile.id].referenceAudioPath).toBeUndefined();
  });
});
