import { describe, expect, it } from "vitest";
import {
  parseBlackSegments,
  parseFreezeSegments,
  parseLoudness,
  parseSilenceSegments,
  speechSegmentsFromSilences,
} from "./parse-ffmpeg-probe";
import { runFfmpegScanLayer } from "./chapter-qc-ffmpeg-scan";
import type { QcCommandRunner } from "./chapter-qc-fftools";
import { buildShotSpans } from "./chapter-qc-timeline";
import type { VideoUseEdlEntryV1, VideoUseSubtitleCueV1 } from "../../contracts/video-workflow";

const SAMPLE = `
[blackdetect @ 0x12b605d40] black_start:3.200 black_end:3.410 black_duration:0.210
[freezedetect @ 0x12b705c40] freeze_start:10.000 freeze_duration:3.000 freeze_end:13.000
[silencedetect @ 0x600001ed8000] silence_start: 1.234
[silencedetect @ 0x600001ed8000] silence_end: 2.500 | silence_duration: 1.266
[Parsed_loudnorm_0 @ 0x600000bd240] {
	"input_i" : "-23.70",
	"input_tp" : "-2.60",
	"input_lra" : "3.10",
	"input_thresh" : "-35.80"
}
`;

describe("parseBlackSegments", () => {
  it("解析黑场行", () => {
    expect(parseBlackSegments(SAMPLE)).toEqual([{ startS: 3.2, endS: 3.41, durationS: 0.21 }]);
    expect(parseBlackSegments("")).toEqual([]);
  });
});

describe("parseFreezeSegments", () => {
  it("解析冻结行", () => {
    expect(parseFreezeSegments(SAMPLE)).toEqual([{ startS: 10, durationS: 3, endS: 13 }]);
  });
});

describe("parseSilenceSegments", () => {
  it("成对解析;尾部未闭合按总时长截断", () => {
    const paired = parseSilenceSegments(SAMPLE, 100);
    expect(paired).toEqual([{ startS: 1.234, endS: 2.5, durationS: 1.266 }]);
    const unclosed = parseSilenceSegments("silence_start: 99.5", 100);
    expect(unclosed).toEqual([{ startS: 99.5, endS: 100, durationS: 0.5 }]);
  });
});

describe("parseLoudness", () => {
  it("解析 loudnorm JSON 尾块", () => {
    expect(parseLoudness(SAMPLE)).toEqual({ inputI: -23.7, inputTp: -2.6, inputLra: 3.1 });
    expect(parseLoudness("no marker")).toBeUndefined();
  });
});

describe("speechSegmentsFromSilences", () => {
  it("静音补集=语音段", () => {
    const speech = speechSegmentsFromSilences([{ startS: 1, endS: 2, durationS: 1 }, { startS: 5, endS: 6, durationS: 1 }], 8);
    expect(speech).toEqual([
      { startS: 0, endS: 1 },
      { startS: 2, endS: 5 },
      { startS: 6, endS: 8 },
    ]);
  });
});

function edl(shotId: string, startS: number, durationS: number): VideoUseEdlEntryV1 {
  return { shotId, sourcePath: `/x/${shotId}`, sourceInS: 0, sourceOutS: durationS, timelineStartS: startS, durationS };
}

function cue(cueId: string, shotId: string, startS: number): VideoUseSubtitleCueV1 {
  return { cueId, shotId, text: `台词${cueId}`, startUs: startS * 1e6, durationUs: 2_000_000, source: "alignment" };
}

const spans = buildShotSpans([edl("s1", 0, 30), edl("s2", 30, 30), edl("s3", 60, 14)]);

function runnerWith(stderr: string): QcCommandRunner {
  return async () => ({ stdout: "", stderr });
}

describe("runFfmpegScanLayer 场景感知黑场", () => {
  it("整镜暗=info 记录不告警;白名单镜完全 suppress", async () => {
    const fullShotBlack = "black_start:0.05 black_end:29.9 black_duration:29.85";
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      runner: runnerWith(fullShotBlack),
    });
    const fullShot = result.findings.find((f) => f.code === "chapter-qc.black.full-shot");
    expect(fullShot?.severity).toBe("info");
    expect(fullShot?.shotId).toBe("s1");

    const suppressed = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      darkShotIds: ["s1"],
      runner: runnerWith(fullShotBlack),
    });
    expect(suppressed.findings.filter((f) => f.code.startsWith("chapter-qc.black"))).toEqual([]);
  });

  it("短促黑段=warn 且定位到镜", async () => {
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      runner: runnerWith("black_start:31.0 black_end:31.2 black_duration:0.2"),
    });
    const segment = result.findings.find((f) => f.code === "chapter-qc.black.segment");
    expect(segment?.severity).toBe("warn");
    expect(segment?.shotId).toBe("s2");
  });
});

describe("runFfmpegScanLayer 语音挤压与音画同步", () => {
  it("实际语音比计划旁白短 2% 以上报挤压", async () => {
    // 全片 74s,静音 30s → 语音 44s;计划 60s
    const stderr = "silence_start: 44.0\nsilence_end: 74.0 | silence_duration: 30.0";
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      plannedVoiceS: 60,
      runner: runnerWith(stderr),
    });
    expect(result.findings.some((f) => f.code === "chapter-qc.audio.speech-compressed")).toBe(true);
    expect(result.raw.speechSeconds).toBeCloseTo(44, 1);
  });

  it("语音起点与字幕起点偏移超 0.3s 报 cue-offset", async () => {
    // s2 从 30s 起,cue 对齐 30.0;语音实际 30.6 才开始
    const stderr = "silence_start: 0\nsilence_end: 30.6 | silence_duration: 30.6";
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      cues: [cue("c1", "s2", 30.0)],
      runner: runnerWith(stderr),
    });
    const offset = result.findings.find((f) => f.code === "chapter-qc.audio.cue-offset");
    expect(offset?.shotId).toBe("s2");
    expect(offset?.evidence).toMatchObject({ deltaS: expect.closeTo(0.6, 2) });
  });

  it("无静音事件时(BGM 掩盖)挤压/同步退化不报", async () => {
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      plannedVoiceS: 60,
      cues: [cue("c1", "s2", 30.0)],
      runner: runnerWith(""),
    });
    expect(result.findings.filter((f) => f.code.startsWith("chapter-qc.audio"))).toEqual([]);
    expect(result.raw.silences).toBe(0);
  });
});

describe("runFfmpegScanLayer 死寂与响度", () => {
  it("≥0.8s 死寂报 warn;响度超窗报 warn", async () => {
    const stderr = "silence_start: 40.0\nsilence_end: 42.0 | silence_duration: 2.0\n[Parsed_loudnorm_0 @ 0x1] {\n\"input_i\" : \"-42.00\",\n\"input_tp\" : \"-3.00\",\n\"input_lra\" : \"2.00\"\n}";
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      runner: runnerWith(stderr),
    });
    expect(result.findings.some((f) => f.code === "chapter-qc.silence.segment" && f.shotId === "s2")).toBe(true);
    expect(result.findings.some((f) => f.code === "chapter-qc.audio.loudness-out-of-range")).toBe(true);
  });
});
