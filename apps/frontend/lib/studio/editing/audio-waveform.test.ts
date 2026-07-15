import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditingClip } from "@/types/editing";
import {
  buildAudioWaveformCacheKey,
  clearAudioWaveformCache,
  downsampleAudioPeaks,
  loadCachedAudioWaveform,
} from "./audio-waveform";

beforeEach(clearAudioWaveformCache);

describe("audio waveform", () => {
  it("downsamples and normalizes peaks across channels", () => {
    expect(downsampleAudioPeaks([
      new Float32Array([0, 0.25, -0.5, 1]),
      new Float32Array([0.1, -0.75, 0.25, 0]),
    ], 2)).toEqual([0.75, 1]);
  });

  it("uses source evidence for a stable cache key", () => {
    const clip = audioClip();
    expect(buildAudioWaveformCacheKey(clip)).toBe("fingerprint:voice-v2:48");
    expect(buildAudioWaveformCacheKey({
      ...clip,
      source: { ...clip.source, evidence: {}, path: "/voice.wav" },
    })).toBe("path:/voice.wav:48");
  });

  it("shares successful loads and evicts failures for retry", async () => {
    const loader = vi.fn(async () => [0.2, 1]);
    await expect(Promise.all([
      loadCachedAudioWaveform("key", loader),
      loadCachedAudioWaveform("key", loader),
    ])).resolves.toEqual([[0.2, 1], [0.2, 1]]);
    expect(loader).toHaveBeenCalledOnce();

    const failing = vi.fn()
      .mockRejectedValueOnce(new Error("decode failed"))
      .mockResolvedValueOnce([1]);
    await expect(loadCachedAudioWaveform("retry", failing)).rejects.toThrow("decode failed");
    await expect(loadCachedAudioWaveform("retry", failing)).resolves.toEqual([1]);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

function audioClip(): EditingClip {
  return {
    id: "voice-1",
    trackId: "voice-track",
    name: "口播",
    source: {
      kind: "audio",
      path: "/voice.wav",
      evidence: { sourceFingerprint: "voice-v2", outputVersion: 2 },
    },
    startUs: 0,
    durationUs: 1_000_000,
    trimStartUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
  };
}
