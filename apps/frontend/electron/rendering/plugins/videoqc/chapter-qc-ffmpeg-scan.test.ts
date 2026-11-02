import { describe, expect, it } from "vitest";
import {
  parseBlackSegments,
  parseBlurMean,
  parseFrameMetrics,
  parseFreezeSegments,
  parseLoudness,
  parseSilenceSegments,
  speechSegmentsFromSilences,
  summarizeClarity,
  summarizeCuts,
  summarizeExposure,
  summarizeMotion,
} from "./parse-ffmpeg-probe";
import {
  buildScanFilterGraph,
  computeSampleStep,
  runFfmpegScanLayer,
  scanTimeoutMsFor,
} from "./chapter-qc-ffmpeg-scan";
import type { QcCommandRunner } from "./chapter-qc-fftools";
import { buildShotSpans } from "./chapter-qc-timeline";
import type { VideoUseEdlEntryV1, VideoUseSubtitleCueV1 } from "../../contracts/video-workflow";

const SAMPLE = `
[blackdetect @ 0x12b605d40] black_start:3.200 black_end:3.410 black_duration:0.210
[silencedetect @ 0x600001ed8000] silence_start: 1.234
[silencedetect @ 0x600001ed8000] silence_end: 2.500 | silence_duration: 1.266
[Parsed_loudnorm_0 @ 0x600000bd240] {
	"input_i" : "-23.70",
	"input_tp" : "-2.60",
	"input_lra" : "3.10",
	"input_thresh" : "-35.80"
}
`;

/**
 * 逐字抄自本机实测(1101):`/tmp/qc_freeze_partial_1101.mp4`(前 6s 静帧 + 后 3.4s 动)
 * 跑 `freezedetect=n=-60dB:d=0.5,metadata=print`。要点:三个值分三行,
 * 且 `[freezedetect]` 自身日志与 `metadata=print` 各打一遍(键名同、分隔符 `:` 与 `=`)。
 */
const FREEZE_EVENTS = `
[freezedetect @ 0x8b2c943c0] lavfi.freezedetect.freeze_start: 0
[Parsed_metadata_7 @ 0x8b2e79680] lavfi.freezedetect.freeze_start=0
[freezedetect @ 0x8b2c943c0] lavfi.freezedetect.freeze_duration: 6
[freezedetect @ 0x8b2c943c0] lavfi.freezedetect.freeze_end: 6
[Parsed_metadata_7 @ 0x8b2e79680] lavfi.freezedetect.freeze_duration=6
[Parsed_metadata_7 @ 0x8b2e79680] lavfi.freezedetect.freeze_end=6
`;

/** 整片冻死(/tmp/qc_negatives_1101/freeze/009.mp4)实测:ffmpeg 只打 start,结束事件永不出现。 */
const FREEZE_UNCLOSED_TO_EOF = `
[freezedetect @ 0xb6ec44640] lavfi.freezedetect.freeze_start: 0
[Parsed_metadata_1 @ 0xb6ee75380] lavfi.freezedetect.freeze_start=0
`;

describe("parseBlackSegments", () => {
  it("解析黑场行", () => {
    expect(parseBlackSegments(SAMPLE)).toEqual([{ startS: 3.2, endS: 3.41, durationS: 0.21 }]);
    expect(parseBlackSegments("")).toEqual([]);
  });
});

describe("parseFreezeSegments", () => {
  it("事件流三行 + 双写手:同一次冻结只出一段", () => {
    expect(parseFreezeSegments(FREEZE_EVENTS, 9.375)).toEqual([{ startS: 0, endS: 6, durationS: 6 }]);
  });

  it("冻结跑到片尾(只有 start 没有 end)按总时长截断——整片冻死不许读成无冻结", () => {
    expect(parseFreezeSegments(FREEZE_UNCLOSED_TO_EOF, 9.417)).toEqual([
      { startS: 0, endS: 9.417, durationS: 9.417 },
    ]);
  });

  it("总时长未知时不编造尾部段;空输出无段", () => {
    expect(parseFreezeSegments(FREEZE_UNCLOSED_TO_EOF, Number.NaN)).toEqual([]);
    expect(parseFreezeSegments(SAMPLE, 100)).toEqual([]);
  });
});

describe("runFfmpegScanLayer 卡帧", () => {
  it("闭合的冻结段落 warn 线索并归到所在镜", async () => {
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      runner: runnerWith("[freezedetect @ 0x1] lavfi.freezedetect.freeze_start: 40\n[freezedetect @ 0x1] lavfi.freezedetect.freeze_end: 44"),
    });
    const freeze = result.findings.find((f) => f.code === "chapter-qc.freeze.segment");
    expect(freeze?.severity).toBe("warn");
    expect(freeze?.shotId).toBe("s2");
    expect(freeze?.evidence).toMatchObject({ startS: 40, durationS: 4 });
    expect(result.raw.freezes).toBe(1);
  });

  it("全片一张静帧:未闭合尾部按总时长出段(freezes 恒 0 的哑火已修)", async () => {
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      runner: runnerWith(FREEZE_UNCLOSED_TO_EOF),
    });
    expect(result.raw.freezes).toBe(1);
    expect(result.findings.find((f) => f.code === "chapter-qc.freeze.segment")?.evidence).toMatchObject({
      startS: 0,
      durationS: 74,
    });
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
    expect(result.raw.speechSource).toBeUndefined();
  });
});

describe("runFfmpegScanLayer 语音段口径(VAD 顶掉 silencedetect 退化)", () => {
  it("BGM 下死寂段为 0:VAD 段到位仍能报挤压,口径落 raw.speechSource", async () => {
    // 全片 74s;silencedetect 一个段都不出(runner 空输出),VAD 给出 44s 语音;计划 60s
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      plannedVoiceS: 60,
      runner: runnerWith(""),
      vadSpeech: {
        segments: [{ startS: 0, endS: 28 }, { startS: 30, endS: 46 }],
        model: "silero-vad@6.2.3",
      },
    });
    expect(result.raw.speechSource).toBe("silero-vad");
    expect(result.raw.speechSeconds).toBeCloseTo(44, 1);
    const squeeze = result.findings.find((f) => f.code === "chapter-qc.audio.speech-compressed");
    expect(squeeze?.evidence.speechSource).toBe("silero-vad");
    expect(result.notes.join("\n")).toContain("语音段口径=Silero VAD");
  });

  it("VAD 段也喂音画同步:语音 30.6s 起 → 第 2 镜 cue-offset", async () => {
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      cues: [cue("c1", "s2", 30.0)],
      runner: runnerWith(""),
      vadSpeech: { segments: [{ startS: 0, endS: 20 }, { startS: 30.6, endS: 50 }] },
    });
    const offset = result.findings.find((f) => f.code === "chapter-qc.audio.cue-offset");
    expect(offset?.shotId).toBe("s2");
    expect(offset?.evidence.deltaS).toBeCloseTo(0.6, 2);
  });

  it("VAD 不可用 → 沿用补集口径并把退化原因写进 notes", async () => {
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      plannedVoiceS: 60,
      runner: runnerWith("silence_start: 44.0\nsilence_end: 74.0 | silence_duration: 30.0"),
      vadReason: "VAD needs-runtime(module-missing)",
    });
    expect(result.raw.speechSource).toBe("silencedetect-complement");
    expect(result.notes.join("\n")).toContain("VAD 不可用:VAD needs-runtime(module-missing)");
    expect(result.findings.some((f) => f.code === "chapter-qc.audio.speech-compressed")).toBe(true);
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

// ---------------------------------------------------------------------------
// 1030 逐帧信号统计。夹具取自 /tmp/009-reuse.mp4 的真实 ffmpeg 7.1.1 输出
// (行序、键名、前缀、空白全照原样,含解析器必须忽略的 mafd/YMIN/YBITDEPTH)。
// ---------------------------------------------------------------------------

const PREFIX = "[Parsed_metadata_5 @ 0x914c19200]";

function frameBlock(
  frameIndex: number,
  tS: number,
  values: { si: number; ti: number; score: number; yavg: number; satavg: number; blur: number },
): string {
  return [
    `${PREFIX} frame:${frameIndex}    pts:${Math.round(tS * 12288)}       pts_time:${tS}`,
    `${PREFIX} lavfi.blur=${values.blur}`,
    `${PREFIX} lavfi.siti.si=${values.si}`,
    `${PREFIX} lavfi.siti.ti=${values.ti}`,
    `${PREFIX} lavfi.scd.mafd=1.094`,
    `${PREFIX} lavfi.scd.score=${values.score}`,
    `${PREFIX} lavfi.signalstats.YMIN=13`,
    `${PREFIX} lavfi.signalstats.YAVG=${values.yavg}`,
    `${PREFIX} lavfi.signalstats.SATAVG=${values.satavg}`,
    `${PREFIX} lavfi.signalstats.YBITDEPTH=8`,
  ].join("\n");
}

// 真实值:首帧 TI=0.00 / si=54.96 / YAVG=70.2746 / SATAVG=6.76374 / blur=5.010267
const FRAMES = [
  frameBlock(0, 0, { si: 54.96, ti: 0.0, score: 0.0, yavg: 70.2746, satavg: 6.76374, blur: 5.010267 }),
  frameBlock(1, 2.25, { si: 59.86, ti: 6.45, score: 0.04, yavg: 71.5356, satavg: 6.60158, blur: 5.003246 }),
  frameBlock(2, 4.5, { si: 60.11, ti: 0.31, score: 0.021, yavg: 72.0, satavg: 6.5, blur: 4.687315 }),
].join("\n");

describe("parseFrameMetrics", () => {
  it("按 frame: 头分组,只收关心的键,忽略 mafd/YMIN/YBITDEPTH", () => {
    expect(parseFrameMetrics(FRAMES)).toEqual([
      { frameIndex: 0, tS: 0, blur: 5.010267, si: 54.96, ti: 0, scdScore: 0, yavg: 70.2746, satavg: 6.76374 },
      { frameIndex: 1, tS: 2.25, blur: 5.003246, si: 59.86, ti: 6.45, scdScore: 0.04, yavg: 71.5356, satavg: 6.60158 },
      { frameIndex: 2, tS: 4.5, blur: 4.687315, si: 60.11, ti: 0.31, scdScore: 0.021, yavg: 72, satavg: 6.5 },
    ]);
    expect(parseFrameMetrics("")).toEqual([]);
    expect(parseFrameMetrics(`${PREFIX} lavfi.siti.ti=9.9`)).toEqual([]);
  });

  it("无日志前缀(metadata=print:file=-)同样可解", () => {
    const bare = "frame:0    pts:0       pts_time:0\nlavfi.siti.si=54.96\nlavfi.siti.ti=0.00";
    expect(parseFrameMetrics(bare)).toEqual([{ frameIndex: 0, tS: 0, si: 54.96, ti: 0 }]);
  });
});

describe("summarizeMotion", () => {
  it("剔除首帧 TI:静止帧占比按 TI<0.5 算", () => {
    const summary = summarizeMotion(parseFrameMetrics(FRAMES), 0.5);
    expect(summary?.tiSampleCount).toBe(2);
    expect(summary?.tiMean).toBeCloseTo((6.45 + 0.31) / 2, 6);
    expect(summary?.staticFrameRatio).toBeCloseTo(0.5, 6);
    expect(summary?.tiMax).toBe(6.45);
  });

  it("全为首帧/无 TI 时 undefined", () => {
    expect(summarizeMotion(parseFrameMetrics(frameBlock(0, 0, { si: 1, ti: 0, score: 0, yavg: 1, satavg: 1, blur: 1 })), 0.5)).toBeUndefined();
  });
});

describe("summarizeExposure / summarizeCuts / summarizeClarity / parseBlurMean", () => {
  it("亮度窗、切换分下界、清晰度分与 blurdetect 收尾均值", () => {
    const points = parseFrameMetrics(FRAMES);
    const exposure = summarizeExposure(points, 20, 245);
    expect(exposure?.yavgMin).toBeCloseTo(70.2746, 6);
    expect(exposure?.darkFrameRatio).toBe(0);
    expect(exposure?.blownFrameRatio).toBe(0);
    expect(summarizeCuts(points, 8, 4)).toEqual({ scoreMax: 0.04, hardCutCount: 0, softCutCount: 0 });
    expect(summarizeClarity(points)?.blurMax).toBe(5.010267);
    expect(parseBlurMean(`${PREFIX} blur mean: 4.7219766`)).toBe(4.7219766);
    expect(parseBlurMean("no blur")).toBeUndefined();
  });

  it("暗帧与硬切可被计数", () => {
    const dark = parseFrameMetrics(
      [
        frameBlock(0, 0, { si: 1, ti: 0, score: 0, yavg: 5, satavg: 1, blur: 1 }),
        frameBlock(1, 1, { si: 1, ti: 9, score: 9.5, yavg: 8, satavg: 1, blur: 12 }),
        frameBlock(2, 2, { si: 1, ti: 9, score: 4.5, yavg: 9, satavg: 1, blur: 12 }),
      ].join("\n"),
    );
    expect(summarizeExposure(dark, 20, 245)?.darkFrameRatio).toBe(1);
    // 9.5 与 4.5 达软切线,仅 9.5 达硬切线
    expect(summarizeCuts(dark, 8, 4)).toMatchObject({ scoreMax: 9.5, hardCutCount: 1, softCutCount: 2 });
  });
});

describe("computeSampleStep / buildScanFilterGraph", () => {
  it("短片逐帧,长片按打印上限抽帧", () => {
    expect(computeSampleStep(9.42, 24)).toBe(1);
    expect(computeSampleStep(undefined, undefined)).toBe(1);
    expect(computeSampleStep(1200, 24)).toBe(8);
  });

  it("抽帧件挂在全部全帧分析件之后、metadata 之前", () => {
    expect(buildScanFilterGraph(1)).toBe(
      "blackdetect=d=0.08:pix_th=0.10,freezedetect=n=-60dB:d=0.5,blurdetect,siti,scdet,signalstats,metadata=print",
    );
    expect(buildScanFilterGraph(8)).toContain(`select='not(mod(n\\,8))',metadata=print`);
  });
});

describe("runFfmpegScanLayer 逐帧统计(记录不判)", () => {
  it("全片一条 motion.summary,数字进 evidence,severity 恒 info", async () => {
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      runner: runnerWith(FRAMES),
    });
    const summary = result.findings.find((f) => f.code === "chapter-qc.motion.summary");
    expect(summary?.severity).toBe("info");
    expect(summary?.evidence).toMatchObject({ sampleStep: 1, samplePoints: 3, blurMean: expect.closeTo(4.9, 1) });
    expect(result.raw.frameSampleCount).toBe(3);
    expect(result.findings.every((f) => f.severity !== "blocker")).toBe(true);
  });

  it("静止帧占比过半的镜记一条伪动态线索", async () => {
    const still = [
      frameBlock(0, 0, { si: 50, ti: 0, score: 0, yavg: 120, satavg: 20, blur: 4 }),
      frameBlock(1, 31, { si: 50, ti: 0.1, score: 0, yavg: 120, satavg: 20, blur: 4 }),
      frameBlock(2, 32, { si: 50, ti: 0.2, score: 0, yavg: 120, satavg: 20, blur: 4 }),
      frameBlock(3, 33, { si: 50, ti: 0.05, score: 0, yavg: 120, satavg: 20, blur: 4 }),
    ].join("\n");
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      runner: runnerWith(still),
    });
    const heavy = result.findings.find((f) => f.code === "chapter-qc.motion.static-heavy");
    expect(heavy?.shotId).toBe("s2");
    expect(heavy?.severity).toBe("info");
    expect(heavy?.evidence.staticFrameRatio).toBe(1);
  });

  it("采样点不足的镜不出镜级结论(不判也不误判)", async () => {
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      runner: runnerWith(frameBlock(0, 61, { si: 50, ti: 0, score: 0, yavg: 3, satavg: 1, blur: 20 })),
    });
    expect(result.findings.filter((f) => f.shotId === "s3")).toEqual([]);
  });

  it("镜内软切记一条下界线索,镜边界窗内的切换不算", async () => {
    const cuts = [
      frameBlock(0, 0, { si: 50, ti: 5, score: 0, yavg: 120, satavg: 20, blur: 4 }),
      frameBlock(1, 15, { si: 50, ti: 5, score: 0, yavg: 120, satavg: 20, blur: 4 }),
      // 30.2 落在 s2 但距镜起点 <0.5s:属镜间切,不计镜内
      frameBlock(2, 30.2, { si: 50, ti: 5, score: 12, yavg: 120, satavg: 20, blur: 4 }),
      frameBlock(3, 45, { si: 50, ti: 5, score: 5, yavg: 120, satavg: 20, blur: 4 }),
      frameBlock(4, 50, { si: 50, ti: 5, score: 1, yavg: 120, satavg: 20, blur: 4 }),
    ].join("\n");
    const result = await runFfmpegScanLayer({
      videoPath: "/tmp/v.mp4",
      spans,
      durationS: 74,
      runner: runnerWith(cuts),
    });
    const unplanned = result.findings.filter((f) => f.code === "chapter-qc.cut.unplanned");
    expect(unplanned).toHaveLength(1);
    expect(unplanned[0].shotId).toBe("s2");
    expect(unplanned[0].evidence).toMatchObject({ softCutCount: 1, hardCutCount: 0, scdetMax: 5 });
  });
});

describe("scanTimeoutMsFor(1031 实测定谳:固定 180s 误杀整章)", () => {
  it("本机实测锚点:1080p/197.12s 成片全帧链跑 391s ≈ 2× 实时,4× 档不得判死", () => {
    // 197.12 → 4× 实时 + 120s 底 = 908.48s(实测 391s 的 2.3 倍余量)
    expect(scanTimeoutMsFor(197.12)).toBe(908_480);
    expect(scanTimeoutMsFor(197.12)).toBeGreaterThan(391_060);
  });

  it("短片与未知时长走 180s 下限;非法时长不塌成 0", () => {
    expect(scanTimeoutMsFor(9.417)).toBe(180_000);
    expect(scanTimeoutMsFor(0)).toBe(180_000);
    expect(scanTimeoutMsFor(Number.NaN)).toBe(180_000);
    expect(scanTimeoutMsFor(60)).toBe(360_000);
  });
});
