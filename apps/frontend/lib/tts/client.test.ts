import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelModelDownload,
  createBackendVoiceProfile,
  deleteModel,
  downloadModel,
  getActiveTasks,
  getModelCacheDir,
  getModelStatus,
  getTtsRuntimeStatus,
  unloadModel,
  generateSpeech,
} from "./client";

describe("TTS client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { window?: unknown }).window;
  });

  it("keeps the desktop-only error when the preload bridge is unavailable", () => {
    expect(() => getTtsRuntimeStatus()).toThrow(
      "本地 TTS 仅在桌面应用中可用",
    );
  });

  it("calls the Voicebox-compatible model routes through Electron IPC", async () => {
    const request = vi.fn().mockResolvedValue({ models: [] });
    (globalThis as { window?: unknown }).window = {
      ttsRuntime: { request },
    };

    await expect(getModelStatus()).resolves.toEqual({ models: [] });
    await getModelCacheDir();
    await downloadModel("kokoro");
    await cancelModelDownload("kokoro");
    await deleteModel("kokoro");
    await unloadModel("kokoro");
    await getActiveTasks();

    expect(request).toHaveBeenNthCalledWith(1, { method: "GET", path: "/models/status" });
    expect(request).toHaveBeenNthCalledWith(2, { method: "GET", path: "/models/cache-dir" });
    expect(request).toHaveBeenNthCalledWith(3, { method: "POST", path: "/models/download", body: { model_name: "kokoro" } });
    expect(request).toHaveBeenNthCalledWith(4, { method: "POST", path: "/models/download/cancel", body: { model_name: "kokoro" } });
    expect(request).toHaveBeenNthCalledWith(5, { method: "DELETE", path: "/models/kokoro" });
    expect(request).toHaveBeenNthCalledWith(6, { method: "POST", path: "/models/kokoro/unload" });
    expect(request).toHaveBeenNthCalledWith(7, { method: "GET", path: "/tasks/active" });
  });

  it("sends reference voice profile fields required by the local backend", async () => {
    const request = vi.fn().mockResolvedValue({ id: "voice-profile-1" });
    (globalThis as { window?: unknown }).window = {
      ttsRuntime: { request },
    };

    await createBackendVoiceProfile({
      id: "voice-profile-1",
      name: "角色音色",
      type: "reference",
      language: "zh",
      defaultEngine: "qwen",
      defaultModelSize: "1.7B",
      referenceAudioPath: "/tmp/voice.wav",
      referenceText: "这是参考音频内容。",
      instruct: "克制、低沉",
    });

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/profiles",
      body: {
        id: "voice-profile-1",
        name: "角色音色",
        voice_type: "reference",
        language: "zh",
        default_engine: "qwen",
        default_model_size: "1.7B",
        reference_audio_path: "/tmp/voice.wav",
        reference_text: "这是参考音频内容。",
        instruct: "克制、低沉",
      },
    });
  });

  it("serializes the storyboard-shot generation kind without changing generic callers", async () => {
    const request = vi.fn().mockResolvedValue({
      id: "generation-shot-1",
      status: "queued",
      generation_kind: "storyboard-shot",
    });
    (globalThis as { window?: unknown }).window = {
      ttsRuntime: { request },
    };

    await expect(generateSpeech({
      text: "逐镜对白",
      profileId: "profile-1",
      engine: "qwen",
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      shotRevision: 3,
      inputFingerprint: "a".repeat(64),
      referenceAudioSha256: "b".repeat(64),
      generationKind: "storyboard-shot",
    })).resolves.toMatchObject({
      id: "generation-shot-1",
      generationKind: "storyboard-shot",
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/generate",
      body: expect.objectContaining({
        project_id: "project-a",
        chapter_id: "chapter-001",
        shot_id: "shot-001",
        shot_revision: 3,
        input_fingerprint: "a".repeat(64),
        reference_audio_sha256: "b".repeat(64),
        generation_kind: "storyboard-shot",
      }),
    });
  });
});
