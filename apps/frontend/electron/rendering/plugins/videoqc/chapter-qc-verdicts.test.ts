import { describe, expect, it } from "vitest";

import {
  applyChapterQcRequirements,
  buildChapterQcRequirements,
  summarizeChapterQcRequirements,
  type ChapterQcRequirementInput,
} from "./chapter-qc-verdicts";
import { buildShotExpectations } from "./chapter-qc-expectations";
import { runSupplyCheck, type ChapterQcSupplyInput } from "./chapter-qc-supply-check";
import { CHAPTER_QC_DIMENSIONS, CHAPTER_QC_WEIGHT_TOTAL } from "./chapter-qc-registry";
import type {
  ChapterQcFindingV1,
  ChapterQcLayerId,
  ChapterQcLayerResultV1,
  ChapterQcSignalBaselineV1,
} from "./chapter-qc-types";

const PASSED_LAYERS: Record<ChapterQcLayerId, ChapterQcLayerResultV1> = {
  structural: { status: "passed" },
  ffmpegScan: { status: "passed" },
  aesthetic: { status: "passed" },
  semantic: { status: "passed" },
  vision: { status: "passed" },
};

const MEASURED_SIGNALS = {
  blacks: 0,
  freezes: 0,
  silences: 0,
  loudnessInputI: -14.2,
  speechSeconds: 12.5,
  frameSampleCount: 190,
  frameSampleStep: 1,
};

function finding(
  code: string,
  layer: ChapterQcLayerId,
  severity: ChapterQcFindingV1["severity"],
  evidence: Record<string, unknown> = {},
): ChapterQcFindingV1 {
  return { code, layer, severity, message: `${code} 测试`, evidence };
}

/**
 * 1102 真机捕获(源:`python -m face_qc.worker --json` 打 ch1_h3_matrix_1029/h3_edition_final.mp4,
 * 608×352):51 张脸只有 18 张达可辨尺寸,中位短边 22.1px。同章 1080P 出片 50 张全可辨。
 * 与 chapter-qc-face.test.ts 用的是同一份原文。
 */
const FACE_608 = {
  framesRead: 24, framesWithFace: 13, coverage: 0.542, faceCount: 51, readableFaceCount: 18,
  readableRatio: 0.353, minReadableFacePx: 24, medianFaceShortSidePx: 22.1, maxFaceScore: 0.895,
  driftDistanceP50: 0.061, driftDistanceP95: 0.127, driftPairs: 7,
};
const FACE_1080 = {
  framesRead: 24, framesWithFace: 13, coverage: 0.542, faceCount: 50, readableFaceCount: 50,
  readableRatio: 1.0, minReadableFacePx: 24, medianFaceShortSidePx: 71.1, maxFaceScore: 0.88,
  driftDistanceP50: 0.0725, driftDistanceP95: 0.1697, driftPairs: 7,
};
const FACE_ZERO = {
  framesRead: 24, framesWithFace: 0, coverage: 0, faceCount: 0, readableFaceCount: 0,
  minReadableFacePx: 24, driftPairs: 0,
};

/** L2 跑通并出数的最理想输入(逐帧统计有采样点=数字已记录)。 */
const MOTION_SUMMARY = finding("chapter-qc.motion.summary", "ffmpegScan", "info", {
  samplePoints: 190, tiMean: 19.27, staticFrameRatio: 0.034,
});

function greenInput(overrides: Partial<ChapterQcRequirementInput> = {}): ChapterQcRequirementInput {
  return {
    layers: PASSED_LAYERS,
    findings: [MOTION_SUMMARY],
    signals: MEASURED_SIGNALS,
    aesthetic: {
      fused: 0.71,
      aesthetic: 0.68,
      technical: 0.74,
      baseline: { seriesId: "p1", meanFused: 0.7, sigma: 0.02, sampleCount: 8 },
    },
    semantic: { checked: 5, passed: 5, failed: 0, skipped: 0, finishedAt: 1 },
    vision: {
      frameCount: 20,
      frames: [],
      decisions: [],
      densityChecked: 4,
      frameErrors: 0,
      preflight: { checked: 20, passed: 20, failed: 0, skipped: 0, finishedAt: 1 },
    },
    ...overrides,
  };
}

function byId(requirements: ChapterQcRequirementInput | ReturnType<typeof buildChapterQcRequirements>, id: string) {
  const list = Array.isArray(requirements) ? requirements : buildChapterQcRequirements(requirements);
  return list.find((item) => item.requirementId === id);
}

describe("buildChapterQcRequirements(三态验收:unverified 永不计通过)", () => {
  it("最理想片子也不放行:客观门全 pass,人证/标定/人脸/供给/逐镜期望六条恒 unverified", () => {
    const requirements = buildChapterQcRequirements(greenInput());
    const summary = summarizeChapterQcRequirements(requirements);
    expect(summary.failed).toBe(0);
    // 1102 骨干前 4 条(human/speech/real-motion/face);骨干后加 2 条:
    // supply-integrity(本轮没跑供给自检)+ motion-plan-consistent(分镜没声明该动的镜)
    expect(summary.unverified).toBe(6);
    expect(summary.releasable).toBe(false);
    expect(byId(requirements, "human-full-watch")?.missing?.[0]).toContain("尚无人工复核回写");
    expect(byId(requirements, "speech-integrity")?.missing?.[0]).toContain("VAD 未接");
    expect(byId(requirements, "real-motion")?.missing?.[0]).toContain("阈值未标定");
    expect(byId(requirements, "face-readability")?.missing?.[0]).toContain("人脸侧车未出数");
    expect(byId(requirements, "supply-integrity")?.missing?.[0]).toContain("本轮未跑供给自检");
    expect(byId(requirements, "motion-plan-consistent")?.missing?.[0]).toContain("分镜未声明任何「要动」的镜");
    // 客观门确实拿到了 pass,不是被 unverified 糊过去
    expect(byId(requirements, "no-blackout")?.verdict).toBe("pass");
    expect(byId(requirements, "audio-loudness")?.verdict).toBe("pass");
    expect(byId(requirements, "semantic-reviewed")?.verdict).toBe("pass");
    expect(byId(requirements, "vision-reviewed")?.verdict).toBe("pass");
  });

  it("人工复核两问分列:只签一项仍是缺证,签全了才翻 pass", () => {
    const half = greenInput({ humanReview: { fullWatched: true, audioListened: false, reviewer: "世事", at: 1 } });
    const item = byId(half, "human-full-watch");
    expect(item?.verdict).toBe("unverified");
    expect(item?.missing).toEqual(["世事 的复核未确认「人耳听完全轨」"]);

    const signed = byId(
      greenInput({ humanReview: { fullWatched: true, audioListened: true, reviewer: "世事", at: 1 } }),
      "human-full-watch",
    );
    expect(signed?.verdict).toBe("pass");
    expect(signed?.missing).toBeUndefined();
    expect(signed?.note).toContain("复核人 世事");
    // 人证落定后,最理想片子还剩「阈值未标定 + 人脸证据缺 + 供给自检未跑 + 逐镜期望没声明」五条缺证
    const summary = summarizeChapterQcRequirements(
      buildChapterQcRequirements(
        greenInput({ humanReview: { fullWatched: true, audioListened: true, reviewer: "世事", at: 1 } }),
      ),
    );
    expect(summary.unverified).toBe(5);
    expect(summary.releasable).toBe(false);
  });

  it("层被跳过 → 依赖它的需求全落 unverified 并写明原因", () => {
    const requirements = buildChapterQcRequirements(
      greenInput({
        layers: { ...PASSED_LAYERS, ffmpegScan: { status: "skipped", reason: "structural blocker 短路" } },
      }),
    );
    for (const id of ["no-blackout", "no-freeze", "audio-loudness", "speech-integrity", "real-motion", "motion-plan-consistent"]) {
      const item = byId(requirements, id);
      expect(item?.verdict, id).toBe("unverified");
      expect(item?.missing?.[0], id).toContain("ffmpegScan=skipped");
    }
    expect(summarizeChapterQcRequirements(requirements).failed).toBe(0);
  });

  it("黑段 warn → no-blackout fail;命中码落 evidenceCodes", () => {
    const requirements = buildChapterQcRequirements(
      greenInput({ findings: [finding("chapter-qc.black.segment", "ffmpegScan", "warn")] }),
    );
    const item = byId(requirements, "no-blackout");
    expect(item?.verdict).toBe("fail");
    expect(item?.evidenceCodes).toEqual(["chapter-qc.black.segment"]);
    expect(item?.watchedCodes).toContain("chapter-qc.black.out-of-timeline");
  });

  it("先记不判的 info 不推翻任何需求", () => {
    const requirements = buildChapterQcRequirements(
      greenInput({
        findings: [
          finding("chapter-qc.motion.summary", "ffmpegScan", "info", { samplePoints: 190, tiMean: 19.27, staticFrameRatio: 0.034 }),
          finding("chapter-qc.motion.static-heavy", "ffmpegScan", "info"),
          finding("chapter-qc.blur.shot-blurry", "ffmpegScan", "info"),
          finding("chapter-qc.exposure.dark-heavy", "ffmpegScan", "info"),
          finding("chapter-qc.cut.unplanned", "ffmpegScan", "info"),
        ],
      }),
    );
    const summary = summarizeChapterQcRequirements(requirements);
    expect(summary.failed).toBe(0);
    expect(byId(requirements, "real-motion")?.verdict).toBe("unverified");
    expect(byId(requirements, "real-motion")?.note).toContain("TI 均值 19.27");
    expect(byId(requirements, "no-freeze")?.verdict).toBe("pass");
  });

  it("阈值未标定但数字已记录:note 带实测值,verdict 不许冒 pass", () => {
    const requirements = buildChapterQcRequirements(
      greenInput({
        findings: [
          finding("chapter-qc.motion.summary", "ffmpegScan", "info", {
            samplePoints: 175, tiMean: 19.27, staticFrameRatio: 0.034,
          }),
        ],
      }),
    );
    expect(byId(requirements, "real-motion")).toMatchObject({
      verdict: "unverified",
      watchedCodes: ["chapter-qc.motion.summary", "chapter-qc.motion.static-heavy"],
    });
    // 缺证文案要写明委托对象(这行的判定权在上游 dynamic_degree,不是我们忘了做)
    expect(byId(requirements, "real-motion")?.missing?.[0]).toContain("上游 VBench dynamic_degree(未供)");

    // 攒了样本也要如实报数,并写明「攒够不等于自动放行」
    const withSamples = byId(
      greenInput({
        findings: [finding("chapter-qc.motion.summary", "ffmpegScan", "info", { samplePoints: 175, tiMean: 19.27, staticFrameRatio: 0.034 })],
        calibration: {
          seriesId: "p1",
          baselines: [{ signalId: "motion.tiMean", seriesId: "p1", mean: 19.1, sigma: 0.4, sampleCount: 3, updatedAt: 1 }],
        },
      }),
      "real-motion",
    );
    expect(withSamples?.verdict).toBe("unverified");
    expect(withSamples?.missing?.[0]).toContain("TI 已攒 3/5 条样本");
    expect(withSamples?.missing?.[0]).toContain("攒够也不自动放行");
  });

  it("逐帧统计无采样点 → real-motion 缺的是数,不是阈值", () => {
    const requirements = buildChapterQcRequirements(greenInput({ findings: [] }));
    expect(byId(requirements, "real-motion")?.missing?.[0]).toContain("逐帧统计未出数");
  });

  it("响度未出数不许当「在窗内」", () => {
    const signals = { ...MEASURED_SIGNALS, loudnessInputI: undefined };
    expect(byId(greenInput({ signals }), "audio-loudness")?.verdict).toBe("unverified");
    expect(byId(greenInput({ signals }), "audio-loudness")?.missing?.[0]).toContain("loudnorm");
    expect(byId(greenInput(), "audio-loudness")?.note).toContain("I=-14.2 LUFS");
  });

  it("无系列基线时观感门只能 unverified;越线 warn 直接 fail", () => {
    expect(
      byId(greenInput({ aesthetic: { fused: 0.5, aesthetic: 0.4, technical: 0.6 } }), "aesthetic-in-baseline")?.verdict,
    ).toBe("unverified");
    const outlier = greenInput({
      findings: [finding("chapter-qc.aesthetic.below-baseline", "aesthetic", "warn")],
    });
    expect(byId(outlier, "aesthetic-in-baseline")?.verdict).toBe("fail");
  });

  it("语义层回写计数 failed>0 判 fail;模型给的码不作匹配依据", () => {
    const input = greenInput({
      semantic: { checked: 5, passed: 3, failed: 2, skipped: 0, finishedAt: 1 },
      findings: [finding("model.said.shot-3-mismatch", "semantic", "warn")],
    });
    const item = byId(input, "semantic-reviewed");
    expect(item?.verdict).toBe("fail");
    expect(item?.evidenceCodes).toEqual(["model.said.shot-3-mismatch"]);
    // 只计数不回写 finding 也算 fail(客观门越限)
    expect(
      byId(greenInput({ semantic: { checked: 5, passed: 4, failed: 1, skipped: 0, finishedAt: 1 } }), "semantic-reviewed")
        ?.verdict,
    ).toBe("fail");
  });

  it("语义层没消费任何镜(绑定缺/物料缺)→ unverified 而不是 pass", () => {
    const item = byId(
      greenInput({ semantic: { checked: 0, passed: 0, failed: 0, skipped: 5, finishedAt: 1 } }),
      "semantic-reviewed",
    );
    expect(item?.verdict).toBe("unverified");
    expect(item?.missing?.[0]).toContain("未消费任何镜");
  });

  it("预审 finding 分四组落四行,一条只算一次(1102 拆行)", () => {
    const drift = greenInput({
      findings: [finding("chapter-qc.vision.preflight.identity-drift", "vision", "warn")],
    });
    // 漂移归跨镜一致行,不再被 vision-reviewed 的前缀兜住——免得一个烂脸在板上算两次 fail
    expect(byId(drift, "cross-shot-coherence")?.verdict).toBe("fail");
    expect(byId(drift, "vision-reviewed")?.verdict).toBe("pass");
    expect(byId(drift, "vision-reviewed")?.evidenceCodes).toEqual([]);

    const body = greenInput({ findings: [finding("chapter-qc.vision.preflight.hand-anomaly", "vision", "blocker")] });
    expect(byId(body, "character-integrity")?.verdict).toBe("fail");
    expect(byId(body, "character-integrity")?.evidenceCodes).toEqual(["chapter-qc.vision.preflight.hand-anomaly"]);

    const text = greenInput({ findings: [finding("chapter-qc.vision.preflight.text-garbled", "vision", "warn")] });
    expect(byId(text, "text-integrity")?.verdict).toBe("fail");
    expect(byId(text, "character-integrity")?.verdict).toBe("pass");

    const assembly = greenInput({ findings: [finding("chapter-qc.vision.preflight.subtitle-obstruction", "vision", "warn")] });
    expect(byId(assembly, "vision-reviewed")?.verdict).toBe("fail");
  });

  it("密度 warn 仍算装配行 fail;预审未回写时四行一起缺证", () => {
    expect(
      byId(greenInput({ findings: [finding("chapter-qc.vision.transition-density", "vision", "warn")] }), "vision-reviewed")
        ?.verdict,
    ).toBe("fail");
    // 预审未回写:密度闸跑过也只是半证,四行都不许冒 pass
    const noPreflight = greenInput({ vision: { ...greenInput().vision!, preflight: undefined } });
    for (const id of ["vision-reviewed", "character-integrity", "text-integrity", "cross-shot-coherence"]) {
      expect(byId(noPreflight, id)?.verdict, id).toBe("unverified");
      expect(byId(noPreflight, id)?.missing?.[0], id).toContain("视觉预审未回写");
    }
  });

  it("人脸可判读度:608×352(0.353)unverified 写明尺寸缺,1080P(1.0)才 pass", () => {
    const small = greenInput({ faceSignals: FACE_608 });
    expect(byId(small, "face-readability")?.verdict).toBe("unverified");
    expect(byId(small, "face-readability")?.missing?.[0]).toContain("仅 35% 达可辨尺寸");
    expect(byId(small, "face-readability")?.missing?.[0]).toContain("22.1px");
    expect(byId(small, "face-readability")?.note).toContain("脸 51 张(可辨 18)");

    const big = greenInput({ faceSignals: FACE_1080 });
    expect(byId(big, "face-readability")?.verdict).toBe("pass");
    expect(byId(big, "face-readability")?.missing).toBeUndefined();
  });

  it("零检出章(靴子特写/背面/侧脸=合理内容)判 unverified 而不是 fail", () => {
    const item = byId(greenInput({ faceSignals: FACE_ZERO }), "face-readability");
    expect(item?.verdict).toBe("unverified");
    expect(item?.missing?.[0]).toContain("合理内容,不是崩坏");
  });

  it("人脸行恒不产 fail:连 unreadable warn 也只把该行留在 unverified", () => {
    const requirements = buildChapterQcRequirements(
      greenInput({
        faceSignals: FACE_608,
        findings: [
          finding("chapter-qc.face.summary", "vision", "info", FACE_608),
          finding("chapter-qc.face.unreadable", "vision", "warn"),
        ],
      }),
    );
    const item = requirements.find((row) => row.requirementId === "face-readability");
    expect(item?.verdict).toBe("unverified");
    expect(summarizeChapterQcRequirements(requirements).failed).toBe(0);
  });

  it("需求 id 唯一且每条都有 watched/missing 交代", () => {
    const requirements = buildChapterQcRequirements(greenInput());
    expect(new Set(requirements.map((item) => item.requirementId)).size).toBe(requirements.length);
    for (const item of requirements) {
      if (item.verdict === "unverified") expect(item.missing?.length, item.requirementId).toBeGreaterThan(0);
      else expect(item.watchedCodes.length + item.evidenceCodes.length + (item.label.length > 0 ? 1 : 0)).toBeGreaterThan(0);
    }
  });

  it("板即注册表:行序、行数、类别/评价器/权重逐条来自 CHAPTER_QC_DIMENSIONS", () => {
    const requirements = buildChapterQcRequirements(greenInput());
    expect(requirements.map((item) => item.requirementId)).toEqual(
      CHAPTER_QC_DIMENSIONS.map((spec) => spec.requirementId),
    );
    for (const item of requirements) {
      const spec = CHAPTER_QC_DIMENSIONS.find((candidate) => candidate.requirementId === item.requirementId)!;
      expect(item.label, item.requirementId).toBe(spec.label);
      expect(item.category, item.requirementId).toBe(spec.category);
      expect(item.evaluator, item.requirementId).toBe(spec.evaluator);
      expect(item.weight, item.requirementId).toBe(spec.weight);
    }
    expect(requirements.reduce((sum, item) => sum + (item.weight ?? 0), 0)).toBe(CHAPTER_QC_WEIGHT_TOTAL);
  });
});

/** 每镜都给了 supply 真话的最小输入:除调用方覆盖的几条外全 ok。 */
function supplyInput(overrides: Partial<ChapterQcSupplyInput> = {}): ChapterQcSupplyInput {
  return {
    mediaReadable: true,
    durationS: 120,
    fps: 30,
    spanCount: 3,
    declaredShotCount: 3,
    timelineSource: "render-plan",
    expectationShotCount: 3,
    speechDeclaredShots: 2,
    subtitleCueCount: 4,
    extractedFrameCount: 3,
    vadAvailable: true,
    faceAvailable: true,
    aestheticModelReady: true,
    unreadyShotCount: 0,
    missingReferenceCount: 0,
    scriptPresent: true,
    ...overrides,
  };
}

/** 逐镜口径的带(本章最差镜那条信号),不是全片那条:单位不同不许共用。 */
const SHOT_STATIC_RATIO_BASELINE: ChapterQcSignalBaselineV1 = {
  signalId: "shot.motion.staticFrameRatio",
  seriesId: "p1",
  mean: 0.05,
  sigma: 0.01,
  sampleCount: 5,
  updatedAt: 1,
};

/** 三镜:s1 声明运镜(该动)、s2 声明运镜配方(该动)、s3 显式定格(hold,静止不是病)。 */
const THREE_SHOT_EXPECTATIONS = buildShotExpectations([
  { shotId: "s1", ordinal: 1, durationS: 5, cameraMove: "推" },
  { shotId: "s2", ordinal: 2, durationS: 5, shotFxMotion: "push-in" },
  { shotId: "s3", ordinal: 3, durationS: 5, shotFxMotion: "hold" },
]);

describe("骨干接线后的三态板(供给⓪ + 逐镜期望② + 标定③)", () => {
  it("供给自检全过 → supply-integrity pass;缺一条即 unverified 并指名是哪条", () => {
    const allOk = byId(greenInput({ supplyChecks: runSupplyCheck(supplyInput()) }), "supply-integrity");
    expect(allOk?.verdict).toBe("pass");
    expect(allOk?.note).toContain("供给自检 11 项全过");

    const noVad = byId(
      greenInput({ supplyChecks: runSupplyCheck(supplyInput({ vadAvailable: false })) }),
      "supply-integrity",
    );
    expect(noVad?.verdict).toBe("unverified");
    expect(noVad?.missing?.join("|")).toContain("Silero VAD 侧车可用");
  });

  it("供给硬矛盾(声明有台词却零字幕 cue)→ 该行 fail,不是缺证", () => {
    const item = byId(
      greenInput({ supplyChecks: runSupplyCheck(supplyInput({ subtitleCueCount: 0 })) }),
      "supply-integrity",
    );
    expect(item?.verdict).toBe("fail");
    expect(item?.evidenceCodes).toEqual(["chapter-qc.supply.blocked"]);
    expect(item?.missing?.[0]).toContain("字幕文本对照物料");
  });

  it("逐镜动态门:声明该动的镜都被测到且在带内 → pass;定格镜不参与判定", () => {
    const item = byId(
      greenInput({
        expectations: THREE_SHOT_EXPECTATIONS,
        signals: {
          ...MEASURED_SIGNALS,
          shotMotion: [
            { shotId: "s1", ordinal: 1, sampleCount: 120, tiMean: 21.4, staticFrameRatio: 0.02 },
            { shotId: "s2", ordinal: 2, sampleCount: 120, tiMean: 18.9, staticFrameRatio: 0.04 },
            { shotId: "s3", ordinal: 3, sampleCount: 120, tiMean: 0.1, staticFrameRatio: 0.98 },
          ],
        },
        calibration: { seriesId: "p1", baselines: [SHOT_STATIC_RATIO_BASELINE] },
      }),
      "motion-plan-consistent",
    );
    expect(item?.verdict).toBe("pass");
    expect(item?.note).toContain("声明要动 2 镜");
    expect(item?.note).toContain("声明定格 1 镜");
  });

  it("逐镜动态门:声明该动却静止越带 → fail 并点名镜号", () => {
    const item = byId(
      greenInput({
        expectations: THREE_SHOT_EXPECTATIONS,
        signals: {
          ...MEASURED_SIGNALS,
          shotMotion: [
            { shotId: "s1", ordinal: 1, sampleCount: 120, tiMean: 21.4, staticFrameRatio: 0.02 },
            { shotId: "s2", ordinal: 2, sampleCount: 120, tiMean: 0.2, staticFrameRatio: 0.86 },
          ],
        },
        calibration: { seriesId: "p1", baselines: [SHOT_STATIC_RATIO_BASELINE] },
      }),
      "motion-plan-consistent",
    );
    expect(item?.verdict).toBe("fail");
    expect(item?.failingShotOrdinals).toEqual([2]);
    expect(item?.missing?.[0]).toContain("第 2 镜声明要动");
  });

  it("逐镜动态门:带画不出来(样本不足)与台账没覆盖都不许冒 pass", () => {
    const ledger = [
      { shotId: "s1", ordinal: 1, sampleCount: 120, tiMean: 21.4, staticFrameRatio: 0.02 },
    ];
    const uncalibrated = byId(
      greenInput({ expectations: THREE_SHOT_EXPECTATIONS, signals: { ...MEASURED_SIGNALS, shotMotion: ledger }, calibration: { seriesId: "p1", baselines: [] } }),
      "motion-plan-consistent",
    );
    expect(uncalibrated?.verdict).toBe("unverified");
    expect(uncalibrated?.missing?.[0]).toContain("逐镜台账无数据");

    const noBaseline = byId(
      greenInput({
        expectations: THREE_SHOT_EXPECTATIONS,
        signals: {
          ...MEASURED_SIGNALS,
          shotMotion: [
            ...ledger,
            { shotId: "s2", ordinal: 2, sampleCount: 120, tiMean: 18.9, staticFrameRatio: 0.03 },
          ],
        },
      }),
      "motion-plan-consistent",
    );
    expect(noBaseline?.verdict).toBe("unverified");
    expect(noBaseline?.missing?.[0]).toContain("阈值未标定");
  });

  it("语音覆盖率信号:台词镜带语音的条数进 note,分母来自分镜声明", () => {
    const item = byId(
      greenInput({
        expectations: buildShotExpectations([
          { shotId: "s1", ordinal: 1, durationS: 5, dialogueText: "金水河畔,又一年。" },
          { shotId: "s2", ordinal: 2, durationS: 5, ttsSpokenText: "他回来了。" },
          { shotId: "s3", ordinal: 3, durationS: 5 },
        ]),
        signals: {
          ...MEASURED_SIGNALS,
          speechSource: "silero-vad",
          shotSpeech: [
            { shotId: "s1", ordinal: 1, speechSeconds: 3.1 },
            { shotId: "s2", ordinal: 2, speechSeconds: 0 },
            { shotId: "s3", ordinal: 3, speechSeconds: 0 },
          ],
        },
        calibration: { seriesId: "p1", baselines: [] },
      }),
      "speech-integrity",
    );
    expect(item?.verdict).toBe("unverified");
    expect(item?.note).toContain("台词镜 1/2 带语音");
    expect(item?.missing?.[0]).toContain("阈值未标定");
  });

  it("观感基线以标定库为口径:库能画带就不听控制器的,库薄时才由控制器补位", () => {
    const fused = (mean: number, sampleCount: number): ChapterQcSignalBaselineV1 => ({
      signalId: "aesthetic.fused", seriesId: "p1", mean, sigma: 0.02, sampleCount, updatedAt: 1,
    });
    // 库空 + 报告带控制器基线(8 条)⇒ 控制器补位,本行按「已标定」办(该行门槛 2 条)
    expect(byId(greenInput({ calibration: { seriesId: "p1", baselines: [] } }), "aesthetic-in-baseline")?.verdict)
      .toBe("pass");
    // 库里只有 2 条、控制器那说有 8 条:不比大小(一边每章一条、一边每评一次加一条),库说话。
    // 库带下界 0.85 罩不住本片 0.71 ⇒ 判 fail,不许拿控制器那条宽带来盖掉
    const storeWins = byId(
      greenInput({
        calibration: { seriesId: "p1", baselines: [fused(0.9, 2)] },
      }),
      "aesthetic-in-baseline",
    );
    expect(storeWins?.verdict).toBe("fail");
    expect(storeWins?.missing?.[0]).toContain("越出本系列带");
    // 两处都拿不出 2 条 ⇒ 缺证,并写明样本数
    const thin = byId(
      greenInput({
        aesthetic: { fused: 0.71, aesthetic: 0.68, technical: 0.74 },
        calibration: { seriesId: "p1", baselines: [fused(0.7, 1)] },
      }),
      "aesthetic-in-baseline",
    );
    expect(thin?.verdict).toBe("unverified");
    expect(thin?.missing?.[0]).toContain("阈值未标定");
  });

  it("台词覆盖率越出系列带 = fail(越限不许当「没数」),VAD 没接时仍记缺证不判病", () => {
    const expectations = buildShotExpectations([
      { shotId: "s1", ordinal: 1, durationS: 5, dialogueText: "金水河畔,又一年。" },
      { shotId: "s2", ordinal: 2, durationS: 5, ttsSpokenText: "他回来了。" },
    ]);
    const coverageBaseline: ChapterQcSignalBaselineV1 = {
      signalId: "speech.coverageRatio", seriesId: "p1", mean: 1, sigma: 0.01, sampleCount: 5, updatedAt: 1,
    };
    const out = byId(
      greenInput({
        expectations,
        signals: {
          ...MEASURED_SIGNALS,
          speechSource: "silero-vad",
          shotSpeech: [
            { shotId: "s1", ordinal: 1, speechSeconds: 3.1 },
            { shotId: "s2", ordinal: 2, speechSeconds: 0 },
          ],
        },
        calibration: { seriesId: "p1", baselines: [coverageBaseline] },
      }),
      "speech-integrity",
    );
    // 本系列别的片台词镜 100% 带语音,这章只有一半 ⇒ 下界 0.9,0.5 越带
    expect(out?.verdict).toBe("fail");
    expect(out?.missing?.[0]).toContain("越出本系列带");

    // 同一份数字,VAD 没接(口径不可信)时不许判病——退回缺证
    const unprobed = byId(
      greenInput({
        expectations,
        signals: {
          ...MEASURED_SIGNALS,
          speechSource: "silencedetect-complement",
          shotSpeech: [
            { shotId: "s1", ordinal: 1, speechSeconds: 3.1 },
            { shotId: "s2", ordinal: 2, speechSeconds: 0 },
          ],
        },
        calibration: { seriesId: "p1", baselines: [coverageBaseline] },
      }),
      "speech-integrity",
    );
    expect(unprobed?.verdict).toBe("unverified");
    expect(unprobed?.missing?.[0]).toContain("VAD 未接");
  });

  it("逐镜动态门:越带但未越绝对病线只记线索,不判病也不静默吞掉", () => {
    const item = byId(
      greenInput({
        expectations: THREE_SHOT_EXPECTATIONS,
        signals: {
          ...MEASURED_SIGNALS,
          shotMotion: [
            { shotId: "s1", ordinal: 1, sampleCount: 120, tiMean: 12.4, staticFrameRatio: 0.42 },
            { shotId: "s2", ordinal: 2, sampleCount: 120, tiMean: 18.9, staticFrameRatio: 0.04 },
          ],
        },
        calibration: { seriesId: "p1", baselines: [SHOT_STATIC_RATIO_BASELINE] },
      }),
      "motion-plan-consistent",
    );
    expect(item?.verdict).toBe("pass");
    expect(item?.note).toContain("越带未越病线 1 镜");
    expect(item?.note).toContain("42.0%");
  });

  it("加权分:pass 计分,缺证与越限都不计分(releasable 仍看三态不看分)", () => {
    const board = buildChapterQcRequirements(greenInput());
    const summary = summarizeChapterQcRequirements(board);
    const passedWeight = board
      .filter((item) => item.verdict === "pass")
      .reduce((sum, item) => sum + (item.weight ?? 0), 0);
    expect(summary.score).toBe(Number(((passedWeight / CHAPTER_QC_WEIGHT_TOTAL) * 100).toFixed(1)));
    expect(summary.score).toBeGreaterThan(0);
    expect(summary.score).toBeLessThan(100);
    expect(summary.releasable).toBe(false);
  });
});

describe("applyChapterQcRequirements(三层回写后重算)", () => {
  it("把需求板写回报告对象,L4 回写后 unverified 才会退场", () => {
    const report: Parameters<typeof applyChapterQcRequirements>[0] = {
      layers: { ...PASSED_LAYERS, semantic: { status: "pending" } },
      findings: [],
      scanSignals: MEASURED_SIGNALS,
    };
    expect(byId(applyChapterQcRequirements(report), "semantic-reviewed")?.verdict).toBe("unverified");
    report.layers.semantic = { status: "passed" };
    const after = applyChapterQcRequirements(report);
    expect(report.requirements).toBe(after);
    expect(after.find((item) => item.requirementId === "semantic-reviewed")?.verdict).toBeDefined();
  });
});
