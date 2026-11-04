/**
 * 三态验收口径(1030 单镜分析门 · 吸收 `magichourhq/skills@ai-media-quality-review` 的裁定文案;
 * 1102 起改为**注册表解释器**)。
 *
 * 取代「层绿=片子好」:`pass` / `fail` / `unverified` 三态,**unverified 永不计为通过**。
 * 判定优先级恒为:客观门越限 → `fail`;越限为零但证据不全 → `unverified`;证据齐且零越限 → `pass`。
 * 只有 blocker/warn 算越限;先记不判的 info 不参与,免得攒基线期自我否决。
 *
 * 1102 骨干化(对标 `Vchitect/VBench` 的四件套):
 *   - 行序/类别/权重/评价器绑定/是否需标定 = `chapter-qc-registry.ts`(唯一真源);
 *   - 本件只留「每行怎么从证据得出 verdict」的 assessor,按 requirementId 挂接;
 *   - 加一行=在注册表加一条,只有需要新证据时才在这里加一个 assessor。
 * 派生规则全部可追溯:每个 verdict 都能回指一条 finding code、一句「缺什么」或一条逐镜台账。
 */

import { FACE_READABLE_MIN_RATIO } from "./chapter-qc-face";
import { CHAPTER_QC_DIMENSIONS } from "./chapter-qc-registry";
import {
  calibrationBlocker,
  evaluateSignalAgainstBaseline,
  isBaselineUsable,
  scoreDimensionBoard,
  type ChapterQcSignalEvaluation,
} from "./chapter-qc-calibration";
import { assertionCoverage, describeAssertionCoverage, shotsWithAssertion } from "./chapter-qc-expectations";
import { QC_CALIBRATION_MIN_SAMPLES, SHOT_STATIC_RATIO_LIMIT } from "./chapter-qc-types";
import type {
  ChapterQcDimensionSpecV1,
  ChapterQcExpectationSetV1,
  ChapterQcFindingV1,
  ChapterQcHumanReviewV1,
  ChapterQcLayerId,
  ChapterQcLayerResultV1,
  ChapterQcReportV1,
  ChapterQcRequirementV1,
  ChapterQcRequirementVerdict,
  ChapterQcScanSignalsV1,
  ChapterQcSignalBaselineV1,
  ChapterQcSupplyCheckV1,
} from "./chapter-qc-types";

/** 一条需求所需层的最低状态:未跑到该状态即无证据,判不了。 */
const LAYER_EVIDENCED: ReadonlySet<ChapterQcLayerResultV1["status"]> = new Set(["passed", "failed"]);

/** 越限严重度:info 属「先记不判」,不推翻任何需求。 */
function isViolation(finding: ChapterQcFindingV1): boolean {
  return finding.severity === "blocker" || finding.severity === "warn";
}

function layerMissingReason(layerId: ChapterQcLayerId, layer: ChapterQcLayerResultV1 | undefined): string | undefined {
  if (!layer) return `${layerId} 层无记录`;
  if (LAYER_EVIDENCED.has(layer.status)) return undefined;
  return `${layerId}=${layer.status}${layer.reason ? `(${layer.reason})` : ""}`;
}

/** 精确码族匹配器。 */
function codes(...exact: string[]): (finding: ChapterQcFindingV1) => boolean {
  return (finding) => exact.includes(finding.code);
}

export interface ChapterQcRequirementInput {
  layers: Record<ChapterQcLayerId, ChapterQcLayerResultV1>;
  findings: ChapterQcFindingV1[];
  /** L2 实测台账:没测出来 ≠ 没越限 */
  signals?: ChapterQcScanSignalsV1;
  aesthetic?: ChapterQcReportV1["aesthetic"];
  semantic?: ChapterQcReportV1["semantic"];
  vision?: ChapterQcReportV1["vision"];
  /** 人脸可判读度台账(YuNet 侧车出数;缺省=没证据,不是没问题) */
  faceSignals?: ChapterQcReportV1["faceSignals"];
  /** 人工复核回写:缺省即「没人看过」,不许机器绿冒充人证 */
  humanReview?: ChapterQcHumanReviewV1;
  /** 骨干⓪:供给自检结果(缺省=本轮没跑自检,supply-integrity 行只能缺证) */
  supplyChecks?: ChapterQcSupplyCheckV1;
  /** 骨干②:逐镜期望断言集(缺省=分镜语义没读到) */
  expectations?: ChapterQcExpectationSetV1;
  /** 骨干③:本系列的信号基线(缺某信号=该阈值未标定,只能记账不许放行) */
  calibration?: Pick<NonNullable<ChapterQcReportV1["calibration"]>, "seriesId" | "baselines">;
}

/** assessor 产出的裸判定,注册表信息由解释器补齐。 */
interface Assessed {
  verdict: ChapterQcRequirementVerdict;
  evidenceCodes?: string[];
  missing?: string[];
  note?: string;
  failingShotOrdinals?: number[];
}

interface AssessContext {
  input: Required<Pick<ChapterQcRequirementInput, "layers" | "findings">> & ChapterQcRequirementInput;
  spec: ChapterQcDimensionSpecV1;
  baselineMap: ReadonlyMap<string, ChapterQcSignalBaselineV1>;
}

type Assessor = (context: AssessContext) => Assessed;

/** 观测点:一条码族 + 一个依赖层 + 可选的附加缺证条件与数字回执。 */
interface GenericShape {
  watched: readonly string[];
  layer?: ChapterQcLayerId;
  /** 层已跑到但这条需求还需要的具体证据缺失原因(返回 undefined=不缺) */
  gap?: (context: AssessContext) => string | undefined;
  note?: (context: AssessContext) => string | undefined;
  staticNote?: string;
}

function genericAssessor(shape: GenericShape): Assessor {
  return (context) => {
    const match = codes(...shape.watched);
    const hits = context.input.findings.filter((finding) => isViolation(finding) && match(finding));
    const missing = hits.length > 0
      ? undefined
      : (shape.layer ? layerMissingReason(shape.layer, context.input.layers[shape.layer]) : undefined) ?? shape.gap?.(context);
    const note = shape.note?.(context) ?? shape.staticNote;
    return {
      verdict: hits.length > 0 ? "fail" : missing ? "unverified" : "pass",
      evidenceCodes: hits.map((finding) => finding.code),
      ...(missing ? { missing: [missing] } : {}),
      ...(note ? { note } : {}),
    };
  };
}

/** 标定证据:该信号在本系列是否已能画带。 */
function calibrationFor(
  context: AssessContext,
  signalId: Parameters<typeof evaluateSignalAgainstBaseline>[0],
  value: number | undefined,
  minSamples?: number,
): ChapterQcSignalEvaluation {
  return evaluateSignalAgainstBaseline(signalId, value, context.baselineMap, minSamples);
}

/* ---------------- 逐行 assessor ---------------- */

const supplyIntegrity: Assessor = (context) => {
  const supply = context.input.supplyChecks;
  if (!supply) {
    return {
      verdict: "unverified",
      evidenceCodes: [],
      missing: ["本轮未跑供给自检(旧报告或调用方未接):成片可读性、镜区间口径、侧车可用性均未核实"],
    };
  }
  const blocked = supply.checks.filter((check) => check.verdict === "blocked");
  const gaps = supply.checks.filter((check) => check.verdict === "gap");
  if (blocked.length > 0) {
    return {
      verdict: "fail",
      evidenceCodes: ["chapter-qc.supply.blocked"],
      missing: blocked.map((check) => `${check.label}:${check.detail ?? ""}`),
      note: `${supply.checks.length} 项自检:${supply.checks.length - supply.gaps - supply.blocked} 过 / ${supply.gaps} 缺料 / ${supply.blocked} 硬矛盾`,
    };
  }
  if (gaps.length > 0) {
    return {
      verdict: "unverified",
      evidenceCodes: [],
      missing: gaps.map((check) => `${check.label}:${check.detail ?? ""}`),
      note: `${supply.checks.length} 项自检:${supply.checks.length - supply.gaps} 过 / ${supply.gaps} 缺料`,
    };
  }
  return {
    verdict: "pass",
    evidenceCodes: [],
    note: `供给自检 ${supply.checks.length} 项全过`,
  };
};

const speechIntegrity: Assessor = (context) => {
  const { input } = context;
  const scanMissing = layerMissingReason("ffmpegScan", input.layers.ffmpegScan);
  const match = codes("chapter-qc.audio.speech-compressed", "chapter-qc.audio.cue-offset");
  const hits = input.findings.filter((finding) => isViolation(finding) && match(finding));
  const declared = assertionCoverage(input.expectations, "speech");
  // 客观门越限优先;否则逐层缺证 → 口径缺证 → 标定缺证三级递进。
  const evidenceMissing = scanMissing
    ?? (input.signals?.speechSource === "silero-vad"
      ? undefined
      : "VAD 未接:BGM 掩盖下 silencedetect(-35dB) 不触发,无段不等于台词可懂(须人耳听全轨)");
  // ② 的增量:台词镜有没有被语音覆盖,现在是可数的(即便阈值还没标定)。
  const speechLedger = input.signals?.shotSpeech ?? [];
  const declaredShots = declared.expected;
  const measured = speechLedger.filter((row) => row.speechSeconds > 0).length;
  const coverage = declaredShots > 0 && speechLedger.length > 0 ? measured / declaredShots : undefined;
  const calibration = calibrationFor(context, "speech.coverageRatio", coverage);
  // 越带就是病,不是「没数」:低于本系列覆盖率带 ⇒ 该说的镜没配上语音或被挤掉。
  // 口径本身不可信(VAD 未接)时不许拿这条带判病——退回缺证。
  const bandViolation = coverage !== undefined && evidenceMissing === undefined && calibration.status === "out"
    ? `台词镜语音覆盖 ${measured}/${declaredShots}(=${coverage.toFixed(2)})越出本系列带(下界 ${calibration.threshold.toFixed(2)}):该说的镜没配上语音或被挤掉`
    : undefined;
  const missing = hits.length > 0
    ? undefined
    : evidenceMissing ?? (declaredShots === 0
        ? `分镜未声明任何台词镜(${describeAssertionCoverage(input.expectations, "speech")}):挤压/同步门无对照对象`
        : bandViolation
          ?? (calibration.status === "uncalibrated"
            ? `${calibration.reason};已测 ${measured}/${declaredShots} 台词镜带语音`
            : undefined));
  return {
    verdict: hits.length > 0 || bandViolation !== undefined ? "fail" : missing ? "unverified" : "pass",
    evidenceCodes: hits.map((finding) => finding.code),
    ...(missing ? { missing: [missing] } : {}),
    note: input.signals
      ? `语音段口径 ${input.signals.speechSource ?? "不可用(未看见死寂段,补集等于全片)"} / 实测语音 ${input.signals.speechSeconds?.toFixed(2) ?? "NA"}s / 死寂段 ${input.signals.silences} 段 / 台词镜 ${measured}/${declaredShots} 带语音`
      : undefined,
  };
};

const realMotion: Assessor = (context) => {
  const { input } = context;
  const scanMissing = layerMissingReason("ffmpegScan", input.layers.ffmpegScan);
  const motionSummary = input.findings.find((finding) => finding.code === "chapter-qc.motion.summary");
  const samplePoints = Number(motionSummary?.evidence.samplePoints ?? 0);
  const violation = input.findings.find(
    (finding) => isViolation(finding) && finding.code === "chapter-qc.motion.static-heavy",
  );
  const tiSamples = context.baselineMap.get("motion.tiMean")?.sampleCount ?? 0;
  const pendingBand = "阈值未标定(先记不判):持帧轴实测咬得住(已知静帧片静止占比 1.000、每 4 帧持 1 帧 0.753),"
    + "但 38 支真单镜 27 支恒 0=产线不产这病;要裁定的是 TI 水平线;委托位=上游 VBench dynamic_degree(未供)"
    + (tiSamples > 0
      ? `;本系列 TI 已攒 ${tiSamples}/${QC_CALIBRATION_MIN_SAMPLES} 条样本——攒够也不自动放行,水平线得有人拍板`
      : "");
  const missing = violation
    ? undefined
    : scanMissing ?? (samplePoints === 0 ? "逐帧统计未出数(siti/metadata 无采样点)" : pendingBand);
  return {
    verdict: violation ? "fail" : missing ? "unverified" : "pass",
    evidenceCodes: violation ? [violation.code] : [],
    ...(missing ? { missing: [missing] } : {}),
    note: `已记录 TI 均值 ${motionSummary?.evidence.tiMean ?? "NA"} / 静止帧占比 ${motionSummary?.evidence.staticFrameRatio ?? "NA"} / 采样点 ${samplePoints}`,
  };
};

/**
 * 逐镜动态期望门(1102 骨干②的新行):分镜声明了「这镜要动」,成片就得动。
 *
 * 与 `real-motion` 的分工:那行看全片 TI 水平线(委托位=上游 dynamic_degree);
 * 这行吃本产线自己的逐镜声明(shotFx.motion=hold 的定格镜不算病,声明了运镜/动作差的镜
 * 静止占比越带才算病)。`static-heavy` 一直是 info(记录不判),所以「没出那条」从来
 * 不等于「测过没问题」——这一行必须看逐镜台账,不看 finding。
 */
const motionPlanConsistent: Assessor = (context) => {
  const { input } = context;
  const scanMissing = layerMissingReason("ffmpegScan", input.layers.ffmpegScan);
  const expectedShots = shotsWithAssertion(input.expectations, "motion", "expected");
  const ledger = input.signals?.shotMotion ?? [];
  const byShotId = new Map(ledger.map((row) => [row.shotId, row]));

  if (scanMissing) {
    return { verdict: "unverified", evidenceCodes: [], missing: [scanMissing] };
  }
  if (expectedShots.length === 0) {
    return {
      verdict: "unverified",
      evidenceCodes: [],
      missing: [`分镜未声明任何「要动」的镜(${describeAssertionCoverage(input.expectations, "motion")}):伪动态门没有对照对象`],
      note: ledger.length > 0 ? `逐镜台账已记 ${ledger.length} 镜运动数据` : undefined,
    };
  }
  if (ledger.length === 0) {
    return {
      verdict: "unverified",
      evidenceCodes: [],
      missing: ["逐镜运动台账未出数(L2 未回算 shotMotion,拿全片均值顶不上逐镜判定)"],
    };
  }

  const unmeasured = expectedShots.filter((shot) => !byShotId.has(shot.shotId));
  const measured = expectedShots
    .map((shot) => byShotId.get(shot.shotId))
    .filter((row): row is NonNullable<typeof row> => row !== undefined);
  const evaluations = measured.map((row) => ({
    row,
    evaluation: calibrationFor(context, "shot.motion.staticFrameRatio", row.staticFrameRatio),
  }));
  // 判病要两个条件同时成立:越出本系列带(逐镜口径的带)**且**越过绝对线 SHOT_STATIC_RATIO_LIMIT。
  // 只查带会误杀——慢摇/叠化的镜静止占比天生 0.3~0.4,系列里大家都低时就把正常镜判成病;
  // 绝对线是 L2 自己记「伪动态线索」用的同一条(现由 types 层共用),它兜住带画得过窄的情形。
  const outOfBand = evaluations.flatMap((item) =>
    item.evaluation.status === "out" && (item.row.staticFrameRatio ?? 0) >= SHOT_STATIC_RATIO_LIMIT
      ? [{
        ordinal: item.row.ordinal,
        ratio: item.row.staticFrameRatio ?? 0,
        threshold: item.evaluation.threshold,
      }]
      : [],
  );
  // 越带却没到病线的镜不成病,但也不许静悄悄:记在 note 里,免得「绝对线兜底」变成藏线索的口子。
  const softOutliers = evaluations.flatMap((item) =>
    item.evaluation.status === "out" && (item.row.staticFrameRatio ?? 0) < SHOT_STATIC_RATIO_LIMIT
      ? [item.row.staticFrameRatio ?? 0]
      : [],
  );
  const uncalibrated = evaluations
    .map((item) => item.evaluation)
    .find((evaluation): evaluation is Extract<ChapterQcSignalEvaluation, { status: "uncalibrated" }> =>
      evaluation.status === "uncalibrated");

  const note = `声明要动 ${expectedShots.length} 镜 / 台账覆盖 ${measured.length} 镜`
    + ` / 静止占比中位 ${medianStaticRatio(measured).toFixed(3)}`
    + ` / 声明定格 ${shotsWithAssertion(input.expectations, "motion", "forbidden").length} 镜`
    + ` / 绝对病线 ${(SHOT_STATIC_RATIO_LIMIT * 100).toFixed(0)}%`
    + (softOutliers.length > 0
      ? ` / 越带未越病线 ${softOutliers.length} 镜(最高 ${(Math.max(...softOutliers) * 100).toFixed(1)}%,记线索不判)`
      : "");

  if (outOfBand.length > 0) {
    return {
      verdict: "fail",
      evidenceCodes: ["chapter-qc.motion.static-heavy"],
      failingShotOrdinals: outOfBand.map((item) => item.ordinal),
      missing: outOfBand.map((item) => `第 ${item.ordinal} 镜声明要动,静止帧占比 ${item.ratio.toFixed(
        3)} 越过绝对病线 ${SHOT_STATIC_RATIO_LIMIT.toFixed(2)} 且越出系列带(上界 ${item.threshold.toFixed(3)})`),
      note,
    };
  }
  const missing = unmeasured.length > 0
    ? `${unmeasured.length} 镜声明要动但逐镜台账无数据(采样点不足或区间无覆盖),缺证不算通过`
    : uncalibrated
      ? uncalibrated.reason
      : undefined;
  return {
    verdict: missing ? "unverified" : "pass",
    evidenceCodes: [],
    ...(missing ? { missing: [missing] } : {}),
    note,
  };
};

function medianStaticRatio(rows: readonly { staticFrameRatio?: number }[]): number {
  const values = rows
    .map((row) => row.staticFrameRatio)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (values.length === 0) return Number.NaN;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

const aestheticInBaseline: Assessor = (context) => {
  const { input } = context;
  const match = codes("chapter-qc.aesthetic.below-baseline", "chapter-qc.aesthetic.shot-below-baseline");
  const hits = input.findings.filter((finding) => isViolation(finding) && match(finding));
  const layerMissing = layerMissingReason("aesthetic", input.layers.aesthetic);
  const evaluation = calibrationFor(context, "aesthetic.fused", input.aesthetic?.fused, 2);
  // 观感分越带 = 比本系列正常片明显差,这是病不是缺证(与控制器那条 below-baseline warn 同方向,
  // 那条走 finding,这条管只有标定库带的情形)。层没跑到时不判——数字本身不存在。
  const bandViolation = !layerMissing && evaluation.status === "out" && input.aesthetic
    ? `观感总分 ${input.aesthetic.fused.toFixed(3)} 越出本系列带(下界 ${evaluation.threshold.toFixed(3)},带凭 ${evaluation.baseline.sampleCount} 条系列样本):比同系列的片明显差`
    : undefined;
  const uncalibrated = evaluation.status === "uncalibrated"
    ? `${evaluation.reason}(观感分离群与否不可判)`
    : undefined;
  const missing = hits.length > 0 ? undefined : layerMissing ?? bandViolation ?? uncalibrated;
  return {
    verdict: hits.length > 0 || bandViolation !== undefined ? "fail" : missing ? "unverified" : "pass",
    evidenceCodes: hits.map((finding) => finding.code),
    ...(missing ? { missing: [missing] } : {}),
    note: input.aesthetic
      ? `fused ${input.aesthetic.fused.toFixed(3)}(aesthetic ${input.aesthetic.aesthetic.toFixed(3)} / technical ${input.aesthetic.technical.toFixed(3)})${input.aesthetic.baseline ? ` · 控制器基线 mean ${input.aesthetic.baseline.meanFused.toFixed(3)}/σ ${input.aesthetic.baseline.sigma.toFixed(3)}(${input.aesthetic.baseline.sampleCount} 次评分)` : ""}`
      : undefined,
  };
};

const semanticReviewed: Assessor = (context) => {
  const { input } = context;
  const missing = layerMissingReason("semantic", input.layers.semantic)
    ?? (input.semantic && input.semantic.checked > 0 ? undefined : "语义层未消费任何镜(模型绑定或帧/描述物料缺)");
  const violations = input.findings.filter((finding) => finding.layer === "semantic" && isViolation(finding));
  const failed = (input.semantic?.failed ?? 0) > 0;
  return {
    verdict: violations.length > 0 || failed ? "fail" : missing ? "unverified" : "pass",
    evidenceCodes: violations.map((finding) => finding.code),
    ...(missing ? { missing: [missing] } : {}),
    note: input.semantic
      ? `checked ${input.semantic.checked} / passed ${input.semantic.passed} / failed ${input.semantic.failed} / skipped ${input.semantic.skipped}${input.semantic.model ? ` · ${input.semantic.model}` : ""}`
      : undefined,
  };
};

/** L5 预审 finding 分组(1102 拆行;一条 finding 只落一行,免得一个烂脸在板上算两次 fail)。 */
const preflightCode = (code: string) => `chapter-qc.vision.preflight.${code}`;
const ASSEMBLY_CODES = ["black-or-garbled", "subtitle-obstruction", "decorative-clutter", "transition-content-mismatch"].map(preflightCode);
const CHARACTER_CODES = ["face-anomaly", "hand-anomaly", "pose-anomaly", "lip-sync-suspect"].map(preflightCode);
const TEXT_CODES = ["text-garbled"].map(preflightCode);
const COHERENCE_CODES = ["identity-drift", "style-inconsistency"].map(preflightCode);

function visionGroup(codeList: readonly string[], extraCodes: readonly string[] = []): Assessor {
  return (context) => {
    const watched = [...extraCodes, ...codeList];
    const match = codes(...watched);
    const hits = context.input.findings.filter((finding) => isViolation(finding) && match(finding));
    const missing = hits.length > 0
      ? undefined
      : layerMissingReason("vision", context.input.layers.vision)
        ?? (context.input.vision?.preflight ? undefined : "视觉预审未回写(图片理解绑定缺/帧物料缺)");
    return {
      verdict: hits.length > 0 ? "fail" : missing ? "unverified" : "pass",
      evidenceCodes: hits.map((finding) => finding.code),
      ...(missing ? { missing: [missing] } : {}),
    };
  };
}

const visionReviewed: Assessor = (context) => {
  const base = visionGroup(ASSEMBLY_CODES, ["chapter-qc.vision.transition-density"])(context);
  const vision = context.input.vision;
  return {
    ...base,
    note: vision
      ? `密度闸复检 ${vision.densityChecked} 处转场 · 抽帧 ${vision.frameCount} 张(失败 ${vision.frameErrors})${vision.preflight ? ` · 预审 failed ${vision.preflight.failed}` : ""}`
      : undefined,
  };
};

const characterIntegrity: Assessor = (context) => {
  const base = visionGroup(CHARACTER_CODES)(context);
  const cast = assertionCoverage(context.input.expectations, "cast-visible");
  return {
    ...base,
    note: `分镜声明出镜 ${cast.expected} 镜 / 声明空镜 ${cast.forbidden} 镜 / 未记 ${cast.unknown} 镜;由图片理解模型逐探针帧判——1102 实测 608×352 下 YuNet 五官几何比值自然区间 0.28–1.02,几何门会误伤,故此维只信模型不信信号过滤器`,
  };
};

const textIntegrity: Assessor = (context) => {
  const base = visionGroup(TEXT_CODES)(context);
  return { ...base, note: "1102 亲检 h3_edition_v3 牌匾「金水」可读、两侧对联为伪汉字——产线无 OCR,这条只由模型判" };
};

const crossShotCoherence: Assessor = (context) => {
  const base = visionGroup(COHERENCE_CODES)(context);
  return { ...base, note: "成对调用(相邻两镜同送)才判得出漂移;单帧调用无对照物" };
};

/**
 * 人脸可判读度(1102 吸收件①):这是「五官/手指维有没有自动证据」的行,不是内容行。
 * 恒不产 fail——零检出在 1102 亲检里对应靴子特写/背面/侧脸(合理内容),几何越限区间宽到无法画线。
 * 1102 骨干②的增量:分镜若声明了出镜,零检出就从「合理内容」升级成「指名缺证」。
 */
const faceReadability: Assessor = (context) => {
  const face = context.input.faceSignals;
  const cast = assertionCoverage(context.input.expectations, "cast-visible");
  const closeUp = assertionCoverage(context.input.expectations, "face-readable");
  if (!face) {
    return {
      verdict: "unverified",
      evidenceCodes: [],
      missing: ["人脸侧车未出数(YuNet 模型未下载 / 托管 Python 未配置 / cv2 缺位)"],
    };
  }
  if (face.framesRead === 0) {
    return {
      verdict: "unverified",
      evidenceCodes: ["chapter-qc.face.summary"],
      missing: ["人脸采样 0 帧可读:成片解不开或时长为 0,五官维无自动证据"],
    };
  }
  if (face.faceCount === 0) {
    return {
      verdict: "unverified",
      evidenceCodes: ["chapter-qc.face.summary"],
      missing: [cast.expected > 0
        ? `分镜声明 ${cast.expected} 镜有人出镜,${face.framesRead} 帧采样却零检出:要不在时间轴外,要么检出失效——五官维仍无自动证据(须人工看或提分辨率)`
        : "全片采样帧零检出:1102 亲检零检出样本分别是靴子特写、背面行走、侧脸——合理内容,不是崩坏;五官维无自动证据"],
    };
  }
  const readableRatio = face.readableRatio ?? 0;
  if (readableRatio < FACE_READABLE_MIN_RATIO) {
    return {
      verdict: "unverified",
      evidenceCodes: ["chapter-qc.face.summary"],
      missing: [`检出的脸仅 ${(readableRatio * 100).toFixed(0)}% 达可辨尺寸(线 ${FACE_READABLE_MIN_RATIO * 100}% / 短边 ${face.minReadableFacePx}px):中位 ${face.medianFaceShortSidePx ?? "NA"}px`],
      note: faceNote(face),
    };
  }
  return {
    verdict: "pass",
    evidenceCodes: ["chapter-qc.face.summary"],
    note: `${faceNote(face)} / 近景特写声明 ${closeUp.expected} 镜`,
  };
};

function faceNote(face: NonNullable<ChapterQcRequirementInput["faceSignals"]>): string {
  return `检出 ${face.framesWithFace}/${face.framesRead} 帧 / 脸 ${face.faceCount} 张(可辨 ${face.readableFaceCount}) / 表观漂移 p50 ${face.driftDistanceP50 ?? "NA"}(未标定只记账)`;
}

/**
 * 人证行(1031 补齐):三态定义里 pass 的第二半——机器全绿也不够,必须有人全速看过、听过。
 * 回写通道已接进应用侧体检单,所以缺省含义从「通道不存在」变成「还没人提交」:
 * 两者都判 unverified,但只有后者是勾一下就完成的待办。
 */
const humanFullWatch: Assessor = (context) => {
  const review = context.input.humanReview;
  const missing: string[] = [];
  if (!review) {
    missing.push("尚无人工复核回写:须人眼全速看全片 + 人耳听全轨(抽帧全绿不等于口型准/动作连贯)");
  } else {
    if (!review.fullWatched) missing.push(`${review.reviewer} 的复核未确认「人眼全速看完全片」`);
    if (!review.audioListened) missing.push(`${review.reviewer} 的复核未确认「人耳听完全轨」`);
  }
  return {
    verdict: missing.length === 0 ? "pass" : "unverified",
    evidenceCodes: [],
    ...(missing.length > 0 ? { missing } : {}),
    ...(review && missing.length === 0 ? { note: `复核人 ${review.reviewer}` } : {}),
  };
};

const GENERIC_ASSESSORS: Record<string, Assessor> = {
  "duration-in-plan": genericAssessor({
    watched: ["chapter-qc.duration.truncated", "chapter-qc.duration.overlong"],
    layer: "structural",
    // 逐镜时长目标(`duration-in-target` 断言)在这里记账:成片侧逐镜对照要先定容差才许判病,
    // 容差没裁定就把声明数摆出来,免得这份声明变成注册表上的空字段。
    note: (context) => {
      const declared = assertionCoverage(context.input.expectations, "duration-in-target");
      return declared.expected > 0
        ? `分镜声明时长目标 ${declared.expected} 镜(逐镜成片对照待容差裁定;本行只判全片总时长)`
        : undefined;
    },
  }),
  "subtitle-text-consistent": genericAssessor({
    watched: ["chapter-qc.subtitle.text-mismatch", "chapter-qc.subtitle.coverage-low"],
    layer: "structural",
    // 字幕声明侧的覆盖数(骨干②的 `subtitle` 断言)一并记在板上:零声明=该维本来就无对照物。
    note: (context) => {
      const speech = assertionCoverage(context.input.expectations, "speech");
      return `分镜声明台词 ${speech.expected} 镜 / 定格 ${speech.forbidden} 镜 / 未记 ${speech.unknown} 镜`;
    },
  }),
  "no-blackout": genericAssessor({
    watched: ["chapter-qc.black.segment", "chapter-qc.black.out-of-timeline"],
    layer: "ffmpegScan",
    staticNote: "整镜暗另记 black.full-shot(info);渐进淡入淡出可不越 blackdetect 阈值,黑场为零不等于画面没压暗,归 exposure 信号",
  }),
  "no-freeze": genericAssessor({
    watched: ["chapter-qc.freeze.segment"],
    layer: "ffmpegScan",
    staticNote: "freezedetect 无段 ≠ 运动是真的;真动态归 real-motion",
  }),
  "audio-loudness": genericAssessor({
    watched: ["chapter-qc.audio.loudness-out-of-range"],
    layer: "ffmpegScan",
    gap: (context) => (context.input.signals?.loudnessInputI === undefined
      ? "响度未出数(loudnorm 无解析结果)"
      : undefined),
    note: (context) => (context.input.signals?.loudnessInputI !== undefined
      ? `实测 I=${context.input.signals.loudnessInputI.toFixed(1)} LUFS(sanity 窗 [-30, -10])`
      : undefined),
  }),
};

const ASSESSORS: Record<string, Assessor> = {
  "supply-integrity": supplyIntegrity,
  "speech-integrity": speechIntegrity,
  "real-motion": realMotion,
  "motion-plan-consistent": motionPlanConsistent,
  "aesthetic-in-baseline": aestheticInBaseline,
  "semantic-reviewed": semanticReviewed,
  "vision-reviewed": visionReviewed,
  "character-integrity": characterIntegrity,
  "text-integrity": textIntegrity,
  "cross-shot-coherence": crossShotCoherence,
  "face-readability": faceReadability,
  "human-full-watch": humanFullWatch,
  ...GENERIC_ASSESSORS,
};

export function buildChapterQcRequirements(input: ChapterQcRequirementInput): ChapterQcRequirementV1[] {
  const baselineMap = new Map(
    (input.calibration?.baselines ?? []).map((baseline) => [baseline.signalId, baseline]),
  );
  // 观感基线有两个来源:标定库(每章一条,画带时已剔本章)与 DOVER 控制器(每评一次累加一条)。
  // 两边的 sampleCount 数的不是同一件事,比谁多是假比较;统一以标定库为口径,
  // 控制器那份只在标定库还没攒出可用带时补位(它另外已通过 below-baseline finding 直接参与判定)。
  const aestheticBaseline = input.aesthetic?.baseline;
  if (aestheticBaseline && !isBaselineUsable(baselineMap.get("aesthetic.fused"), 2)) {
    baselineMap.set("aesthetic.fused", {
      signalId: "aesthetic.fused",
      seriesId: aestheticBaseline.seriesId,
      mean: aestheticBaseline.meanFused,
      sigma: aestheticBaseline.sigma,
      sampleCount: aestheticBaseline.sampleCount,
      updatedAt: 0,
    });
  }
  const base: Omit<AssessContext, "spec"> = {
    input: input as AssessContext["input"],
    baselineMap,
  };
  const requirements: ChapterQcRequirementV1[] = [];
  for (const spec of CHAPTER_QC_DIMENSIONS) {
    const assessor = ASSESSORS[spec.requirementId];
    if (!assessor) {
      // 注册表加了行但没接判定 = 宁可显式缺证,也不给一条自动 pass
      requirements.push({
        requirementId: spec.requirementId,
        label: spec.label,
        verdict: "unverified",
        watchedCodes: [],
        evidenceCodes: [],
        missing: ["本行还没有 assessor(注册表已声明,判定逻辑未接):不许注册即放行"],
        category: spec.category,
        evaluator: spec.evaluator,
        weight: spec.weight,
      });
      continue;
    }
    const assessed = assessor({ ...base, spec });
    const blocker = calibrationBlocker(spec, assessed.verdict, baselineMap);
    const verdict: ChapterQcRequirementVerdict = blocker ? "unverified" : assessed.verdict;
    const missing = blocker ? [...(assessed.missing ?? []), blocker] : assessed.missing;
    requirements.push({
      requirementId: spec.requirementId,
      label: spec.label,
      verdict,
      watchedCodes: watchedCodesFor(spec.requirementId),
      evidenceCodes: assessed.evidenceCodes ?? [],
      ...(missing && missing.length > 0 ? { missing } : {}),
      ...(assessed.note ? { note: assessed.note } : {}),
      ...(assessed.failingShotOrdinals && assessed.failingShotOrdinals.length > 0
        ? { failingShotOrdinals: assessed.failingShotOrdinals }
        : {}),
      category: spec.category,
      evaluator: spec.evaluator,
      weight: spec.weight,
    });
  }
  return requirements;
}

/** watchedCodes 的展示口径:与 1102 拆行时一致(逐行盯哪几条码)。 */
const WATCHED_BY_ID: Record<string, readonly string[]> = {
  "supply-integrity": ["chapter-qc.supply.blocked", "chapter-qc.supply.gap", "chapter-qc.supply.ok"],
  "duration-in-plan": ["chapter-qc.duration.truncated", "chapter-qc.duration.overlong"],
  "subtitle-text-consistent": ["chapter-qc.subtitle.text-mismatch", "chapter-qc.subtitle.coverage-low"],
  "no-blackout": ["chapter-qc.black.segment", "chapter-qc.black.out-of-timeline"],
  "no-freeze": ["chapter-qc.freeze.segment"],
  "audio-loudness": ["chapter-qc.audio.loudness-out-of-range"],
  "speech-integrity": ["chapter-qc.audio.speech-compressed", "chapter-qc.audio.cue-offset"],
  "real-motion": ["chapter-qc.motion.summary", "chapter-qc.motion.static-heavy"],
  "motion-plan-consistent": ["chapter-qc.motion.static-heavy", "chapter-qc.motion.summary"],
  "aesthetic-in-baseline": ["chapter-qc.aesthetic.below-baseline", "chapter-qc.aesthetic.shot-below-baseline"],
  "semantic-reviewed": ["<本层任意 blocker/warn>"],
  "vision-reviewed": ["chapter-qc.vision.transition-density", ...ASSEMBLY_CODES],
  "character-integrity": CHARACTER_CODES,
  "text-integrity": TEXT_CODES,
  "cross-shot-coherence": COHERENCE_CODES,
  "face-readability": ["chapter-qc.face.summary", "chapter-qc.face.unreadable"],
  "human-full-watch": [],
};

function watchedCodesFor(requirementId: string): string[] {
  return [...(WATCHED_BY_ID[requirementId] ?? [])];
}

export interface ChapterQcRequirementSummary {
  total: number;
  passed: number;
  failed: number;
  unverified: number;
  /** 放行判据:零 fail 且零 unverified——缺证即不放行 */
  releasable: boolean;
  /** 骨干③:加权维度分(0~100;缺证不计分) */
  score: number;
}

export function summarizeChapterQcRequirements(
  requirements: readonly ChapterQcRequirementV1[],
): ChapterQcRequirementSummary {
  let passed = 0;
  let failed = 0;
  let unverified = 0;
  for (const requirement of requirements) {
    if (requirement.verdict === "pass") passed += 1;
    else if (requirement.verdict === "fail") failed += 1;
    else unverified += 1;
  }
  return {
    total: requirements.length,
    passed,
    failed,
    unverified,
    releasable: requirements.length > 0 && failed === 0 && unverified === 0,
    score: scoreDimensionBoard(requirements).score,
  };
}

/**
 * 就地重算需求板 + 加权分。三层写报告时(编排器 / L4 语义回写 / L5 预审回写)都要过这里,
 * 否则回写后板子还是旧层状态,unverified 会赖着不走。
 */
export function applyChapterQcRequirements(
  report: Pick<
    ChapterQcReportV1,
    | "layers"
    | "findings"
    | "aesthetic"
    | "semantic"
    | "vision"
    | "scanSignals"
    | "faceSignals"
    | "humanReview"
    | "requirements"
    | "dimensionScore"
    | "supplyChecks"
    | "expectations"
    | "calibration"
  >,
): ChapterQcRequirementV1[] {
  const requirements = buildChapterQcRequirements({
    layers: report.layers,
    findings: report.findings,
    ...(report.scanSignals ? { signals: report.scanSignals } : {}),
    ...(report.faceSignals ? { faceSignals: report.faceSignals } : {}),
    ...(report.aesthetic ? { aesthetic: report.aesthetic } : {}),
    ...(report.semantic ? { semantic: report.semantic } : {}),
    ...(report.vision ? { vision: report.vision } : {}),
    ...(report.humanReview ? { humanReview: report.humanReview } : {}),
    ...(report.supplyChecks ? { supplyChecks: report.supplyChecks } : {}),
    ...(report.expectations ? { expectations: report.expectations } : {}),
    ...(report.calibration ? { calibration: report.calibration } : {}),
  });
  report.requirements = requirements;
  report.dimensionScore = scoreDimensionBoard(requirements);
  return requirements;
}
