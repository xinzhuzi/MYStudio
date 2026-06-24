import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelModelDownload,
  createBackendVoiceProfile,
  deleteModel,
  downloadModel,
  getActiveTasks,
  getModelCacheDir,
  getModelStatus,
  unloadModel,
} from "./client";

describe("TTS client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { window?: unknown }).window;
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
});
