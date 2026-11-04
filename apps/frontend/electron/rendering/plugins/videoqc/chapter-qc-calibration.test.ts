import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    CHAPTER_QC_DIMENSIONS,
    CHAPTER_QC_WEIGHT_TOTAL,
    dimensionSpec,
    groupDimensionsByCategory,
} from "./chapter-qc-registry";
import {
    QC_CALIBRATION_MIN_SAMPLES,
    appendCalibrationSamples,
    calibrationBlocker,
    chapterQcCalibrationPath,
    deriveSignalBaselines,
    evaluateSignalAgainstBaseline,
    isBaselineUsable,
    isChapterQcSignalId,
    meanSigma,
    missingSpecIds,
    readCalibrationStore,
    scoreCalibrationSet,
    scoreDimensionBoard,
    signalLabel,
    signalThreshold,
    writeCalibrationStore,
    type ChapterQcCalibrationStoreV1,
    type ChapterQcSignalSampleV1,
} from "./chapter-qc-calibration";
import type { ChapterQcCalibrationCaseV1, ChapterQcRequirementV1, ChapterQcSignalBaselineV1 } from "./chapter-qc-types";

function sample(signalId: ChapterQcSignalSampleV1["signalId"], value: number, chapterId: string, at = 1): ChapterQcSignalSampleV1 {
  return { signalId, value, chapterId, at };
}

function baseline(partial: Partial<ChapterQcSignalBaselineV1> & { signalId: string }): ChapterQcSignalBaselineV1 {
  return { seriesId: "p1", mean: 0.2, sigma: 0.02, sampleCount: QC_CALIBRATION_MIN_SAMPLES, updatedAt: 1, ...partial };
}

function baselines(...items: ChapterQcSignalBaselineV1[]): Map<string, ChapterQcSignalBaselineV1> {
  return new Map(items.map((item) => [item.signalId, item]));
}

function requirement(requirementId: string, verdict: ChapterQcRequirementV1["verdict"]): ChapterQcRequirementV1 {
  return { requirementId, label: requirementId, verdict, watchedCodes: [], evidenceCodes: [] };
}

function calibrationCase(requirementId: string, label: "green" | "red", caseId = `${requirementId}-${label}`): ChapterQcCalibrationCaseV1 {
  return { caseId, videoSha256: "a".repeat(64), requirementId, label, note: "标定集条目" };
}

function emptyStore(seriesId = "p1"): ChapterQcCalibrationStoreV1 {
  return { schemaVersion: 1, seriesId, samples: [], cases: [] };
}

describe("chapter-qc-calibration:样本统计与阈值", () => {
  it("meanSigma 用 n-1 方差(样本 σ),少于 2 条不出数", () => {
    expect(meanSigma([1])).toBeNull();
    expect(meanSigma([])).toBeNull();
    const stats = meanSigma([2, 4]);
    expect(stats?.mean).toBe(3);
    // n-1:方差 = ((1)^2+(1)^2)/1 = 2
    expect(stats?.sigma).toBeCloseTo(Math.SQRT2, 6);
  });

  it("meanSigma 剔除 NaN/Infinity,不污染基线", () => {
    const stats = meanSigma([1, 3, Number.NaN, Number.POSITIVE_INFINITY]);
    expect(stats?.mean).toBeCloseTo(2, 6);
  });

  it("low-bad 画下界、high-bad 画上界,带宽不小于护栏", () => {
    // motion.tiMean low-bad,护栏 1.0;σ=0.02 → 2σ=0.04 < 护栏 ⇒ 带宽取 1.0
    expect(signalThreshold(baseline({ signalId: "motion.tiMean", mean: 6, sigma: 0.02 }))).toBeCloseTo(5, 6);
    // 静止帧占比 high-bad,护栏 0.1;σ=0.02 → 2σ=0.04 < 护栏 ⇒ 上界 0.05+0.1
    expect(signalThreshold(baseline({ signalId: "motion.staticFrameRatio", mean: 0.05, sigma: 0.02 }))).toBeCloseTo(0.15, 6);
    // σ 够大时将护栏挤开,取 2σ
    expect(signalThreshold(baseline({ signalId: "motion.staticFrameRatio", mean: 0.05, sigma: 0.2 }))).toBeCloseTo(0.45, 6);
  });

  it("未知信号没有方向口径,不硬编阈值", () => {
    expect(signalThreshold(baseline({ signalId: "made.up" }))).toBeNull();
  });

  it("isBaselineUsable 卡样本数下限;缺基线=不可用", () => {
    expect(isBaselineUsable(undefined)).toBe(false);
    expect(isBaselineUsable(baseline({ signalId: "motion.tiMean", sampleCount: QC_CALIBRATION_MIN_SAMPLES - 1 }))).toBe(false);
    expect(isBaselineUsable(baseline({ signalId: "motion.tiMean", sampleCount: QC_CALIBRATION_MIN_SAMPLES }))).toBe(true);
    expect(isBaselineUsable(baseline({ signalId: "motion.tiMean", sampleCount: 2 }), 2)).toBe(true);
  });

  it("未出数与样本不足都判 uncalibrated,并写明差多少条", () => {
    const map = baselines(baseline({ signalId: "motion.tiMean", sampleCount: 3 }));
    const noValue = evaluateSignalAgainstBaseline("motion.tiMean", undefined, map);
    expect(noValue.status).toBe("uncalibrated");
    if (noValue.status === "uncalibrated") expect(noValue.reason).toContain("未出数");

    const thin = evaluateSignalAgainstBaseline("motion.tiMean", 7, map);
    expect(thin.status).toBe("uncalibrated");
    if (thin.status === "uncalibrated") {
      expect(thin.reason).toContain(signalLabel("motion.tiMean"));
      expect(thin.reason).toContain("样本 3 条");
      expect(thin.reason).toContain(`须 ≥${QC_CALIBRATION_MIN_SAMPLES} 条`);
    }
  });

  it("已标定:low-bad 低于下界出界,high-bad 高于上界出界,其余在带内", () => {
    const map = baselines(
      baseline({ signalId: "motion.tiMean", mean: 6, sigma: 0.6 }),
      baseline({ signalId: "motion.staticFrameRatio", mean: 0.05, sigma: 0.01 }),
    );
    expect(evaluateSignalAgainstBaseline("motion.tiMean", 4.5, map).status).toBe("out");
    expect(evaluateSignalAgainstBaseline("motion.tiMean", 5.9, map).status).toBe("in");
    const high = evaluateSignalAgainstBaseline("motion.staticFrameRatio", 0.4, map);
    expect(high.status).toBe("out");
    if (high.status !== "uncalibrated") expect(high.threshold).toBeCloseTo(0.15, 6);
  });
});

describe("chapter-qc-calibration:落盘与样本维护", () => {
  const dir = mkdtempSync(join(tmpdir(), "qc-calibration-"));

  it("seriesId 段校验拒绝逃逸;合法名落 qc/calibration/{seriesId}.json", () => {
    expect(() => chapterQcCalibrationPath(dir, "../escape")).toThrow(/非法字符/);
    expect(chapterQcCalibrationPath(dir, "proj-001")).toBe(join(dir, "qc", "calibration", "proj-001.json"));
  });

  it("缺文件回空库;坏 JSON / 错 schema 回空库并把原件搬成坏档(不许无声吃掉攒的样本)", () => {
    expect(readCalibrationStore(dir, "series-none")).toEqual(emptyStore("series-none"));
    mkdirSync(join(dir, "qc", "calibration"), { recursive: true });
    writeFileSync(chapterQcCalibrationPath(dir, "series-bad"), "{oops", "utf-8");
    expect(readCalibrationStore(dir, "series-bad").samples).toEqual([]);
    expect(quarantinedCalibrationFiles(dir)).toHaveLength(1);
    // 第二次读:原件已被搬走,不再重复留档(也不该反复刷屏)
    expect(readCalibrationStore(dir, "series-bad").samples).toEqual([]);
    writeFileSync(chapterQcCalibrationPath(dir, "series-v2"), JSON.stringify({ schemaVersion: 2, samples: [], cases: [] }), "utf-8");
    expect(readCalibrationStore(dir, "series-v2").schemaVersion).toBe(1);
    expect(quarantinedCalibrationFiles(dir)).toHaveLength(2);
  });

  it("写第二次留 .prev.json:一次写坏还能退回上一版", () => {
    const store = appendCalibrationSamples(emptyStore("series-prev"), [sample("motion.tiMean", 5, "c1", 1)]);
    writeCalibrationStore(dir, store);
    const next = appendCalibrationSamples(readCalibrationStore(dir, "series-prev"), [sample("motion.tiMean", 6, "c2", 2)]);
    writeCalibrationStore(dir, next);
    expect(readFileSync(`${chapterQcCalibrationPath(dir, "series-prev")}.prev.json`, "utf-8")).toContain("\"c1\"");
    expect(readCalibrationStore(dir, "series-prev").samples.map((item) => item.chapterId)).toEqual(["c1", "c2"]);
  });

  it("读写往返;畸形样本/case 在回读时被剔掉", () => {
    const store: ChapterQcCalibrationStoreV1 = {
      schemaVersion: 1,
      seriesId: "series-round",
      samples: [
        sample("motion.tiMean", 5.5, "c1"),
        sample("face.readableRatio", Number.NaN, "c1"),
        { ...sample("speech.coverageRatio", 1, "c1"), signalId: "made.up" } as unknown as ChapterQcSignalSampleV1,
      ],
      cases: [calibrationCase("real-motion", "green"), { ...calibrationCase("real-motion", "red"), label: "maybe" } as unknown as ChapterQcCalibrationCaseV1],
    };
    writeCalibrationStore(dir, store);
    expect(JSON.parse(readFileSync(chapterQcCalibrationPath(dir, "series-round"), "utf-8")).samples).toHaveLength(3);
    const readBack = readCalibrationStore(dir, "series-round");
    expect(readBack.samples.map((item) => item.signalId)).toEqual(["motion.tiMean"]);
    expect(readBack.cases.map((item) => item.label)).toEqual(["green"]);
    expect(leftoverTmpFiles(dir)).toEqual([]);
  });

  it("appendCalibrationSamples:同章同信号覆盖新值,不重复堆积;空追加原样返回", () => {
    const store = emptyStore();
    expect(appendCalibrationSamples(store, [])).toBe(store);
    const once = appendCalibrationSamples(store, [sample("motion.tiMean", 5, "c1", 1)]);
    const twice = appendCalibrationSamples(once, [sample("motion.tiMean", 9, "c1", 2)]);
    expect(twice.samples).toHaveLength(1);
    expect(twice.samples[0].value).toBe(9);
    expect(once.samples[0].value).toBe(5);
  });

  it("appendCalibrationSamples:每支信号只留最近 keep 条,按时间升序", () => {
    let store = emptyStore();
    for (let i = 0; i < 7; i += 1) {
      store = appendCalibrationSamples(store, [sample("visual.blurMean", i, `c${i}`, i)], 3);
    }
    const kept = store.samples.filter((item) => item.signalId === "visual.blurMean");
    expect(kept.map((item) => item.chapterId)).toEqual(["c4", "c5", "c6"]);
  });

  it("deriveSignalBaselines:逐信号成带;单样本记得到数但画不出带", () => {
    const store = appendCalibrationSamples(emptyStore(), [
      sample("motion.tiMean", 4, "c1", 10),
      sample("motion.tiMean", 6, "c2", 20),
      sample("speech.coverageRatio", 0.5, "c1", 30),
    ]);
    const derived = deriveSignalBaselines(store);
    expect(derived.map((item) => item.signalId).sort()).toEqual(["motion.tiMean", "speech.coverageRatio"]);
    const motion = derived.find((item) => item.signalId === "motion.tiMean")!;
    expect(motion.mean).toBeCloseTo(5, 6);
    expect(motion.sampleCount).toBe(2);
    expect(motion.updatedAt).toBe(20);
    expect(motion.seriesId).toBe("p1");
    const speech = derived.find((item) => item.signalId === "speech.coverageRatio")!;
    expect(speech).toMatchObject({ mean: 0.5, sigma: 0, sampleCount: 1 });
    // 单样本不可用:计数留着给「差几条」文案,阈值一律不画
    expect(isBaselineUsable(speech)).toBe(false);
    const thin = evaluateSignalAgainstBaseline("speech.coverageRatio", 0.9, new Map([[speech.signalId, speech]]));
    expect(thin.status).toBe("uncalibrated");
    if (thin.status === "uncalibrated") expect(thin.reason).toContain("样本 1 条");
  });

  it("画带剔本章:含自己的带罩得住自己(n≤5 时成员离均值恒 <2σ),剔掉才判得出离群", () => {
    const store = appendCalibrationSamples(emptyStore(), [
      sample("motion.tiMean", 5, "c1", 1),
      sample("motion.tiMean", 5.2, "c2", 2),
      sample("motion.tiMean", 4.8, "c3", 3),
      sample("motion.tiMean", 5.1, "c4", 4),
      sample("motion.tiMean", 0.1, "c5", 5), // c5 自己就是那支几乎静止的片
    ]);
    const selfIncluded = deriveSignalBaselines(store).find((item) => item.signalId === "motion.tiMean")!;
    expect(selfIncluded.sampleCount).toBe(5);
    // 含 c5 的带被 c5 自己撑宽:TI 0.1 照样「在带内」——这条带在它自己的样本上永远抓不住病
    expect(evaluateSignalAgainstBaseline("motion.tiMean", 0.1, new Map([["motion.tiMean", selfIncluded]])).status).toBe("in");
    const others = deriveSignalBaselines(store, "c5").find((item) => item.signalId === "motion.tiMean")!;
    expect(others.sampleCount).toBe(4);
    // 画带凭 4 条,但库里确实攒了 5 条:两个数都要在,「差几条」才不说瞎话
    expect(others.seriesSampleCount).toBe(5);
    // 剔掉本章后别章只有 4 条:够不上画带门槛,判不成病也不许冒充判过
    expect(isBaselineUsable(others)).toBe(false);
    const usableOthers = { ...others, sampleCount: QC_CALIBRATION_MIN_SAMPLES };
    const verdict = evaluateSignalAgainstBaseline("motion.tiMean", 0.1, new Map([["motion.tiMean", usableOthers]]));
    expect(verdict.status).toBe("out");
    if (verdict.status === "out") expect(verdict.threshold).toBeGreaterThan(0.1);
  });

  it("库里只有本章这一条:条目照出(别章 0 条/本系列 1 条),不能剔完就人间蒸发", () => {
    const store = appendCalibrationSamples(emptyStore(), [sample("motion.tiMean", 5, "c5", 6)]);
    const selfOnly = deriveSignalBaselines(store, "c5").find((item) => item.signalId === "motion.tiMean")!;
    expect(selfOnly).toMatchObject({ sampleCount: 0, seriesSampleCount: 1 });
    const thin = evaluateSignalAgainstBaseline("motion.tiMean", 5.1, new Map([["motion.tiMean", selfOnly]]));
    expect(thin.status).toBe("uncalibrated");
    if (thin.status === "uncalibrated") {
      expect(thin.reason).toContain("样本 0 条");
      expect(thin.reason).toContain("本系列已攒 1 条");
    }
    // 全片口径同样:一条攒在库里的信号,在「差几条」账上不能显示成 0 条攒过
    const blocker = calibrationBlocker(
      CHAPTER_QC_DIMENSIONS.find((spec) => spec.requirementId === "motion-plan-consistent")!,
      "pass",
      new Map([["shot.motion.staticFrameRatio", selfOnly]]),
    );
    expect(blocker).toContain("样本 0/5 条(本系列已攒 1 条,含本章)");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("chapter-qc-calibration:标定集与加权分", () => {
  it("正例看召回、负例看抓得住,未判定按不通过计", () => {
    const cases = [
      calibrationCase("real-motion", "green", "g1"),
      calibrationCase("real-motion", "green", "g2"),
      calibrationCase("real-motion", "red", "r1"),
      calibrationCase("real-motion", "red", "r2"),
      calibrationCase("no-blackout", "red", "r3"),
    ];
    const scored = scoreCalibrationSet(cases, (item) => {
      if (item.caseId === "g1") return "pass";
      if (item.caseId === "r1") return "fail";
      if (item.caseId === "g2") return "unverified";
      return undefined;
    });
    const motion = scored.find((row) => row.requirementId === "real-motion")!;
    expect(motion).toMatchObject({ greenTotal: 2, greenPassed: 1, redTotal: 2, redCaught: 1 });
    const blackout = scored.find((row) => row.requirementId === "no-blackout")!;
    expect(blackout).toMatchObject({ greenTotal: 0, redTotal: 1, redCaught: 0 });
  });

  it("加权分:pass 才计分,分母恒为注册表满分(不是本轮送进来的那几行之和)", () => {
    const scored = scoreDimensionBoard([requirement("speech-integrity", "pass"), requirement("real-motion", "unverified")]);
    // speech-integrity 8 / 满分 100 ⇒ 8 分。两条 pass 也只值它那两行的权重,
    // 分母换成「本轮行数和」的话,部分板会报满分——那是假绿的一种。
    expect(scored.weightPassed).toBe(8);
    expect(scored.score).toBeCloseTo(8, 6);
    expect(scored.weightTotal).toBe(CHAPTER_QC_WEIGHT_TOTAL);
    expect(scored.deducted).toEqual([{ requirementId: "real-motion", weight: 5, reason: "unverified" }]);
  });

  it("deducted 按权重从大到小排,fail 与 unverified 分得清", () => {
    const scored = scoreDimensionBoard([
      requirement("face-readability", "fail"),
      requirement("motion-plan-consistent", "unverified"),
      requirement("human-full-watch", "pass"),
    ]);
    expect(scored.deducted.map((row) => row.requirementId)).toEqual(["motion-plan-consistent", "face-readability"]);
    expect(scored.deducted.map((row) => row.reason)).toEqual(["unverified", "fail"]);
  });

  it("注册表外的 requirementId 计不进权重,但被 missingSpecIds 点名", () => {
    const scored = scoreDimensionBoard([requirement("ghost-row", "unverified"), requirement("no-freeze", "pass")]);
    expect(scored.weightTotal).toBe(CHAPTER_QC_WEIGHT_TOTAL);
    expect(scored.weightPassed).toBe(5);
    expect(scored.score).toBeCloseTo(5, 6);
    expect(missingSpecIds([requirement("ghost-row", "pass")])).toEqual(["ghost-row"]);
  });

  it("全表 pass 得满分,权重合计恰 100", () => {
    const all = scoreDimensionBoard(CHAPTER_QC_DIMENSIONS.map((spec) => requirement(spec.requirementId, "pass")));
    expect(all.score).toBe(100);
    expect(CHAPTER_QC_DIMENSIONS.reduce((sum, spec) => sum + spec.weight, 0)).toBe(CHAPTER_QC_WEIGHT_TOTAL);
    expect(CHAPTER_QC_DIMENSIONS.every((spec) => dimensionSpec(spec.requirementId)?.weight === spec.weight)).toBe(true);
  });

  it("分组只收注册表里的类别,顺序即注册表首次出现顺序", () => {
    const groups = groupDimensionsByCategory();
    expect(groups.reduce((sum, group) => sum + group.specs.length, 0)).toBe(CHAPTER_QC_DIMENSIONS.length);
    expect(new Set(groups.map((group) => group.category)).size).toBe(groups.length);
    expect(groups.map((group) => group.category)).toEqual([...new Set(CHAPTER_QC_DIMENSIONS.map((spec) => spec.category))]);
    expect(groups.reduce((sum, group) => sum + group.weight, 0)).toBe(CHAPTER_QC_WEIGHT_TOTAL);
  });
});

describe("calibrationBlocker(骨干③:注册表级标定兜底)", () => {
  const motionSpec = dimensionSpec("motion-plan-consistent")!;

  it("只兜 pass:fail/unverified 原样放过——绝对越限不许被「没标定」压回缺证", () => {
    expect(calibrationBlocker(motionSpec, "fail", baselines())).toBeUndefined();
    expect(calibrationBlocker(motionSpec, "unverified", baselines())).toBeUndefined();
    expect(calibrationBlocker(dimensionSpec("no-blackout")!, "pass", baselines())).toBeUndefined();
  });

  it("声明需标定却没绑信号 → 拦下并指名注册表缺项(不是静默变绿)", () => {
    expect(calibrationBlocker({ ...motionSpec, calibrationSignals: undefined }, "pass", baselines()))
      .toContain("没绑信号");
  });

  it("样本不足 → 逐信号写明「样本 n/5 条」;够 5 条才放行", () => {
    // 逐镜行吃逐镜口径的信号(shot.*),不是全片那条:单位不同,共用一条带会成片误杀
    expect(motionSpec.calibrationSignals).toEqual(["shot.motion.staticFrameRatio"]);
    expect(calibrationBlocker(motionSpec, "pass", baselines(baseline({ signalId: "shot.motion.staticFrameRatio", sampleCount: 3 }))))
      .toBe("静止帧占比(本章最差镜) 样本 3/5 条:阈值还没有本系列实测撑,pass 不给");
    expect(calibrationBlocker(motionSpec, "pass", baselines(baseline({ signalId: "shot.motion.staticFrameRatio" }))))
      .toBeUndefined();
    // 多信号行只点名缺的那几条
    const realMotion = dimensionSpec("real-motion")!;
    expect(calibrationBlocker(realMotion, "pass", baselines(baseline({ signalId: "motion.tiMean", sampleCount: 9 }))))
      .toBe("静止帧占比(全片) 样本 0/5 条:阈值还没有本系列实测撑,pass 不给");
  });

  it("行自带门槛:观感行的系列基线由 DOVER 控制器供,2 条起判(与全表默认 5 条不同)", () => {
    const aesthetic = dimensionSpec("aesthetic-in-baseline")!;
    expect(aesthetic.minCalibrationSamples).toBe(2);
    expect(aesthetic.calibrationSignals).toEqual(["aesthetic.fused"]);
    expect(calibrationBlocker(aesthetic, "pass", baselines(baseline({ signalId: "aesthetic.fused", sampleCount: 2 }))))
      .toBeUndefined();
    expect(calibrationBlocker(aesthetic, "pass", baselines(baseline({ signalId: "aesthetic.fused", sampleCount: 1 }))))
      ?.toContain("1/2 条");
  });

  it("注册表自检:每条要标定的行都绑了真信号,不要标定的行不许偷偷绑", () => {
    const needing = CHAPTER_QC_DIMENSIONS.filter((spec) => spec.requiresCalibration);
    expect(needing.map((spec) => spec.requirementId))
      .toEqual(["speech-integrity", "real-motion", "motion-plan-consistent", "aesthetic-in-baseline"]);
    for (const spec of needing) {
      expect(spec.calibrationSignals?.length ?? 0).toBeGreaterThan(0);
      expect((spec.calibrationSignals ?? []).every(isChapterQcSignalId)).toBe(true);
      // 绑了的信号必须真能画带(有方向口径),否则永远是 uncalibrated
      for (const signalId of spec.calibrationSignals ?? []) {
        expect(signalLabel(signalId)).toBeTruthy();
      }
    }
    expect(CHAPTER_QC_DIMENSIONS
      .filter((spec) => !spec.requiresCalibration)
      .every((spec) => spec.calibrationSignals === undefined)).toBe(true);
    // evaluator 答的是「谁产的证」:real-motion 由自研 TI 判,不许挂到未供的上游名下
    expect(dimensionSpec("real-motion")?.evaluator).toBe("deterministic-signal");
    expect(dimensionSpec("real-motion")?.upstreamDimension).toBe("dynamic_degree");
  });
});

function quarantinedCalibrationFiles(root: string): string[] {
  return readdirSync(join(root, "qc", "calibration")).filter((name) => name.includes(".坏档-"));
}

function leftoverTmpFiles(root: string): string[] {
  return readdirSync(join(root, "qc", "calibration")).filter((name) => name.endsWith(".tmp"));
}
