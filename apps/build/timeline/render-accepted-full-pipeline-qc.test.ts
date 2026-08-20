import { describe, expect, it } from "vitest";
import {
  assertAudibleMeanVolume,
  assertDistinctFirstShots,
  assertFormalStreamCounts,
  assertSourceFrameMatch,
  expectedFormalDurationSeconds,
  formalQcSampleIndexes,
  formalSourceMatchFilterGraph,
  parseBlackdetect,
  parseMeanVolumeDb,
  parseSsim,
} from "./render-accepted-full-pipeline-qc";

describe("formal renderer QC parsers", () => {
  it("reads the final aggregate SSIM score", () => {
    expect(parseSsim("[Parsed_ssim_0] SSIM Y:0.99 All:0.994128 (22.3)"))
      .toBeCloseTo(0.994128, 6);
  });

  it("keeps only black segments that reach the 0.5 second gate", () => {
    const log = [
      "black_start:0 black_end:0.2 black_duration:0.2",
      "black_start:12.5 black_end:13.1 black_duration:0.6",
    ].join("\n");
    expect(parseBlackdetect(log)).toEqual([{ start: 12.5, end: 13.1, duration: 0.6 }]);
  });

  it("reads the decoded audio mean volume", () => {
    expect(parseMeanVolumeDb("[Parsed_volumedetect_0] mean_volume: -23.4 dB"))
      .toBeCloseTo(-23.4, 6);
  });

  it("rejects silent and invalid volume output", () => {
    expect(() => parseMeanVolumeDb("mean_volume: -inf dB")).toThrow("silent");
    expect(() => parseMeanVolumeDb("audio decode completed without statistics"))
      .toThrow("missing mean_volume");
  });
});

describe("formal renderer QC gates", () => {
  it("uses transition-compressed frame duration instead of raw EDL end time", () => {
    const plan = {
      renderSettings: { fps: 30 },
      clips: [
        { id: "shot-1", trackKind: "video", startUs: 0, durationUs: 2_000_000 },
        { id: "shot-2", trackKind: "video", startUs: 2_000_000, durationUs: 2_000_000 },
      ],
      transitions: [{ fromClipId: "shot-1", toClipId: "shot-2", effectId: "fade", durationUs: 200_000 }],
    } as Parameters<typeof expectedFormalDurationSeconds>[0];

    expect(expectedFormalDurationSeconds(plan)).toBeCloseTo(3.8, 6);
  });

  it("always compares the second output shot with the second source shot", () => {
    expect(formalQcSampleIndexes(43)).toEqual([0, 1, 21, 42]);
  });

  it("compares source identity on a low-frequency luma projection so approved visual effects do not invalidate the source", () => {
    expect(formalSourceMatchFilterGraph()).toBe(
      "scale=96:54:flags=area,format=gray,gblur=sigma=3",
    );
  });

  it("rejects duplicate first shots and a mismatched second source", () => {
    expect(() => assertDistinctFirstShots(0.98)).toThrow("appear duplicated");
    expect(() => assertSourceFrameMatch("clip-2", 0.899)).toThrow("below 0.90");
  });

  it("rejects double audio and subtitle streams", () => {
    expect(() => assertFormalStreamCounts({
      videoStreamCount: 1,
      audioStreamCount: 2,
      subtitleStreamCount: 0,
    })).toThrow("audio=2");
    expect(() => assertFormalStreamCounts({
      videoStreamCount: 1,
      audioStreamCount: 1,
      subtitleStreamCount: 1,
    })).toThrow("subtitle=1");
  });

  it("requires decoded audio mean volume above -60 dB", () => {
    expect(() => assertAudibleMeanVolume(-60)).toThrow("must be greater than -60 dB");
    expect(() => assertAudibleMeanVolume(Number.NaN)).toThrow("invalid");
    expect(() => assertAudibleMeanVolume(-59.9)).not.toThrow();
  });
});
