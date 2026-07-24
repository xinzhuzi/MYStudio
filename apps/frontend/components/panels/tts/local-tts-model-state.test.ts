import { describe, expect, it } from "vitest";
import type { TtsModelRow } from "@/types/tts";
import { getLocalTtsModelState } from "./local-tts-model-state";

const row = (overrides: Partial<TtsModelRow> = {}): TtsModelRow => ({
  modelName: "qwen-tts-0.6B",
  displayName: "Qwen TTS",
  description: "test",
  engine: "qwen",
  hfRepoId: "test/qwen-tts-0.6B",
  languages: ["zh"],
  purpose: "presetVoice",
  sizeMb: 1,
  loaded: false,
  downloading: false,
  downloaded: false,
  ...overrides,
});

describe("local TTS model state", () => {
  it("keeps row lifecycle precedence over progress events", () => {
    expect(getLocalTtsModelState(row({ loaded: true }), { status: "error", model_name: "qwen-tts-0.6B", current: 0, total: 1, progress: 0 })).toBe("loaded");
    expect(getLocalTtsModelState(row({ downloading: true }), { status: "complete", model_name: "qwen-tts-0.6B", current: 1, total: 1, progress: 100 })).toBe("downloading");
    expect(getLocalTtsModelState(row({ downloaded: true }), { status: "error", model_name: "qwen-tts-0.6B", current: 0, total: 1, progress: 0 })).toBe("downloaded");
  });

  it("maps progress and missing states explicitly", () => {
    const progress = { model_name: "qwen-tts-0.6B", current: 0, total: 1, progress: 0 };
    expect(getLocalTtsModelState(row(), { ...progress, status: "downloading" })).toBe("downloading");
    expect(getLocalTtsModelState(row(), { ...progress, status: "complete" })).toBe("downloaded");
    expect(getLocalTtsModelState(row(), { ...progress, status: "error" })).toBe("failed");
    expect(getLocalTtsModelState(row(), { ...progress, status: "idle" })).toBe("missing");
  });
});
