import { describe, expect, it } from "vitest";
import {
  assertDistinctFirstShots,
  assertFormalStreamCounts,
  assertSourceFrameMatch,
  formalQcSampleIndexes,
  parseBlackdetect,
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
});

describe("formal renderer QC gates", () => {
  it("always compares the second output shot with the second source shot", () => {
    expect(formalQcSampleIndexes(43)).toEqual([0, 1, 21, 42]);
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
});
