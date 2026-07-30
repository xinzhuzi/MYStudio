// @vitest-environment node

import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  assertRenderedMediaEvidence,
  buildLoudnessMeasurementArgs,
  evaluateLoudnessMeasurement,
  parseEbur128Summary,
  selectRenderedVideoDuration,
  type RenderedMediaProbe,
} from "./render-smoke-evidence";

const validProbe: RenderedMediaProbe = {
  raw: {},
  duration: 6,
  width: 1080,
  height: 1920,
  streams: ["video", "audio"],
  videoCodec: "h264",
  audioCodec: "aac",
};

describe("Remotion real media evidence", () => {
  it("accepts H.264/AAC output with exact dimensions and one-frame duration tolerance", () => {
    expect(() => assertRenderedMediaEvidence({
      label: "five-shot",
      probe: { ...validProbe, duration: 6 + (1 / 30) },
      expectedDuration: 6,
      fps: 30,
      width: 1080,
      height: 1920,
    })).not.toThrow();
  });

  it("uses the video stream duration instead of AAC container padding", () => {
    const raw: RenderedMediaProbe["raw"] = {
      format: { duration: "2.048" },
      streams: [
        { codec_type: "video", codec_name: "h264", duration: "2.000", width: 1080, height: 1920 },
        { codec_type: "audio", codec_name: "aac", duration: "2.048" },
      ],
    };
    expect(selectRenderedVideoDuration(raw)).toBe(2);
    const probe: RenderedMediaProbe = {
      raw,
      duration: selectRenderedVideoDuration(raw),
      width: 1080,
      height: 1920,
      streams: ["video", "audio"],
      videoCodec: "h264",
      audioCodec: "aac",
    };
    expect(() => assertRenderedMediaEvidence({
      label: "shot",
      probe,
      expectedDuration: 2,
      fps: 30,
      width: 1080,
      height: 1920,
    })).not.toThrow();
  });

  it.each([
    [{ duration: 0 }, "时长无效"],
    [{ duration: 6.04 }, "时长误差超过一帧"],
    [{ width: 720 }, "尺寸不匹配"],
    [{ videoCodec: "hevc" }, "编解码器不匹配"],
    [{ audioCodec: "" }, "编解码器不匹配"],
  ])("拒绝无效输出 %o", (patch, message) => {
    expect(() => assertRenderedMediaEvidence({
      label: "five-shot",
      probe: { ...validProbe, ...patch },
      expectedDuration: 6,
      fps: 30,
      width: 1080,
      height: 1920,
    })).toThrow(message);
  });

  it("parses only the final ebur128 summary and preserves the reported peak unit", () => {
    const parsed = parseEbur128Summary(`
[Parsed_ebur128_0] I: -13.2 LUFS LRA: 20.0 LU TPK: -1.0 dBFS
[Parsed_ebur128_0] Summary:

  Integrated loudness:
    I:         -14.0 LUFS
    Threshold: -24.0 LUFS

  Loudness range:
    LRA:         0.4 LU

  True peak:
    Peak:       -9.0 dBFS
`);
    expect(parsed).toEqual({
      integratedLufs: -14,
      loudnessRangeLu: 0.4,
      peakType: "true-peak",
      peakUnit: "dBFS",
      peakDbfs: -9,
    });
    expect(parsed).not.toHaveProperty("peakDbtp");
  });

  it("builds the read-only first-audio-stream ebur128 command", () => {
    const inputPath = path.resolve("/tmp/mystudio-loudness-input.mp4");
    expect(buildLoudnessMeasurementArgs(inputPath)).toEqual([
      "-hide_banner",
      "-nostats",
      "-i",
      inputPath,
      "-map",
      "0:a:0",
      "-filter:a",
      "ebur128=peak=true",
      "-f",
      "null",
      "-",
    ]);
  });

  it("rejects incomplete ebur128 output", () => {
    expect(() => parseEbur128Summary("Summary: no true peak"))
      .toThrow("缺少 integrated loudness、LRA 或 true peak");
  });

  it("accepts measurements at the integrated and encoded true-peak tolerances", () => {
    expect(evaluateLoudnessMeasurement(
      { integratedLufs: -14.5, peakDbfs: -1 },
      { integratedLufs: -14, truePeakDbtp: -1.5 },
    )).toMatchObject({
      integratedToleranceLu: 0.5,
      truePeakToleranceDb: 0.5,
      truePeakComparisonLimitDbfs: -1,
      integratedWithinTolerance: true,
      truePeakWithinTolerance: true,
      passed: true,
    });
  });

  it.each([
    [{ integratedLufs: -14.51, peakDbfs: -1.5 }, "integratedWithinTolerance"],
    [{ integratedLufs: -14, peakDbfs: -0.99 }, "truePeakWithinTolerance"],
  ])("rejects measurements beyond the acceptance boundary: %o", (measurement, failedField) => {
    const result = evaluateLoudnessMeasurement(
      measurement,
      { integratedLufs: -14, truePeakDbtp: -1.5 },
    );
    expect(result[failedField as "integratedWithinTolerance" | "truePeakWithinTolerance"])
      .toBe(false);
    expect(result.passed).toBe(false);
  });
});
