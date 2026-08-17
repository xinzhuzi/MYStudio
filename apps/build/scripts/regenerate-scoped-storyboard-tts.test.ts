import { describe, expect, it } from "vitest";
import {
  applyScopedTtsResults,
  parseScopedShotIds,
  selectScopedStoryboards,
  type ScopedTtsResult,
} from "./regenerate-scoped-storyboard-tts";

function storyboard(id: string, outputVersion: number) {
  return {
    id,
    outputVersion,
    shotAudioBindings: [
      {
        role: "sfx",
        bindingId: `sfx:${id}`,
      },
    ],
  };
}

function result(id: string, revision: number, fingerprint: string): ScopedTtsResult {
  return {
    storyboardId: id,
    writeback: {
      audioRef: {
        kind: "audio",
        path: `project-file://project/remotion/audio/${id}.wav`,
        contentSha256: "a".repeat(64),
      },
      shotAudioBinding: {
        role: "voice",
        shotId: id,
        shotRevision: revision,
        ttsInputFingerprint: fingerprint,
        bindingFingerprint: "b".repeat(64),
      },
      ttsJob: {
        status: "completed",
        shotId: id,
        shotRevision: revision,
        inputFingerprint: fingerprint,
      },
      generationId: `generation:${id}`,
      ttsBackend: "qwen-mlx",
      ttsMocked: false,
      ttsEmotionCapability: "metadata-only",
    },
  } as ScopedTtsResult;
}

describe("parseScopedShotIds", () => {
  it("accepts a unique non-empty comma-separated allowlist", () => {
    expect(parseScopedShotIds("shot-001, shot-002")).toEqual(["shot-001", "shot-002"]);
  });

  it.each([undefined, "", "shot-001,shot-001"])("rejects unsafe input %j", (value) => {
    expect(() => parseScopedShotIds(value)).toThrow();
  });
});

describe("scoped storyboard TTS repair", () => {
  const storyboards = [storyboard("shot-001", 4), storyboard("shot-002", 3), storyboard("shot-003", 8)];

  it("rejects unknown shot IDs", () => {
    expect(() => selectScopedStoryboards(storyboards, ["shot-004"])).toThrow(/shot-004/);
  });

  it("updates only selected shots and preserves non-voice bindings", () => {
    const updated = applyScopedTtsResults(storyboards, [
      result("shot-001", 4, "1".repeat(64)),
      result("shot-002", 3, "2".repeat(64)),
    ]);

    expect(updated[2]).toBe(storyboards[2]);
    expect(updated[0].shotAudioBindings).toEqual([
      storyboards[0].shotAudioBindings[0],
      expect.objectContaining({ role: "voice", shotRevision: 4 }),
    ]);
    expect(updated[1]).toMatchObject({
      ttsGenerationId: "generation:shot-002",
      ttsBackend: "qwen-mlx",
      ttsMocked: false,
    });
  });

  it("fails closed when generated identity does not match the current revision", () => {
    expect(() => applyScopedTtsResults(storyboards, [
      result("shot-001", 3, "1".repeat(64)),
    ])).toThrow(/revision/);
  });
});
