/**
 * 三态验收口径的视觉与人脸判定组(1123 归位役自 `chapter-qc-verdicts.ts` 拆出)。
 *
 * 三段原序迁入:LAYER_EVIDENCED/isViolation/layerMissingReason/codes 基础助手、
 * `ChapterQcRequirementInput` 与 `Assessed`/`AssessContext`/`Assessor` 类型契约、
 * 自 `preflightCode` 起到 `humanFullWatch` 止的视觉与人脸 assessor 组。
 * 三态口径与判定优先级的总注释见 `chapter-qc-verdicts.ts` 文件头,此处不重复。
 */

import { FACE_READABLE_MIN_RATIO, summarizeFaceCrops } from "./chapter-qc-face";
import { assertionCoverage } from "./chapter-qc-expectations";
import type {
  ChapterQcDimensionSpecV1,
  ChapterQcExpectationSetV1,
  ChapterQcFindingV1,
  ChapterQcHumanReviewV1,
  ChapterQcLayerId,
  ChapterQcLayerResultV1,
  ChapterQcReportV1,
  ChapterQcRequirementVerdict,
  ChapterQcScanSignalsV1,
  ChapterQcSignalBaselineV1,
  ChapterQcSupplyCheckV1,
} from "./chapter-qc-types";

/** 一条需求所需层的最低状态:未跑到该状态即无证据,判不了。 */
const LAYER_EVIDENCED: ReadonlySet<ChapterQcLayerResultV1["status"]> = new Set(["passed", "failed"]);

/** 越限严重度:info 属「先记不判」,不推翻任何需求。 */
export function isViolation(finding: ChapterQcFindingV1): boolean {
  return finding.severity === "blocker" || finding.severity === "warn";
}

export function layerMissingReason(layerId: ChapterQcLayerId, layer: ChapterQcLayerResultV1 | undefined): string | undefined {
  if (!layer) return `${layerId} 层无记录`;
  if (LAYER_EVIDENCED.has(layer.status)) return undefined;
  return `${layerId}=${layer.status}${layer.reason ? `(${layer.reason})` : ""}`;
}

/** 精确码族匹配器。 */
export function codes(...exact: string[]): (finding: ChapterQcFindingV1) => boolean {
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
  /** 骨干③:本系列的信号基线(缺某信号=该阈值未标定,只能记账不许放行)+ 金标集逐行召回账 */
  calibration?: Pick<NonNullable<ChapterQcReportV1["calibration"]>, "seriesId" | "baselines" | "caseScores">;
}

/** assessor 产出的裸判定,注册表信息由解释器补齐。 */
export interface Assessed {
  verdict: ChapterQcRequirementVerdict;
  evidenceCodes?: string[];
  missing?: string[];
  note?: string;
  failingShotOrdinals?: number[];
}

export interface AssessContext {
  input: Required<Pick<ChapterQcRequirementInput, "layers" | "findings">> & ChapterQcRequirementInput;
  spec: ChapterQcDimensionSpecV1;
  baselineMap: ReadonlyMap<string, ChapterQcSignalBaselineV1>;
}

export type Assessor = (context: AssessContext) => Assessed;

/** L5 预审 finding 分组(1102 拆行;一条 finding 只落一行,免得一个烂脸在板上算两次 fail)。 */
const preflightCode = (code: string) => `chapter-qc.vision.preflight.${code}`;
export const ASSEMBLY_CODES = ["black-or-garbled", "subtitle-obstruction", "decorative-clutter", "transition-content-mismatch"].map(preflightCode);
export const CHARACTER_CODES = ["face-anomaly", "hand-anomaly", "pose-anomaly", "lip-sync-suspect"].map(preflightCode);
export const TEXT_CODES = ["text-garbled"].map(preflightCode);
export const COHERENCE_CODES = ["identity-drift", "style-inconsistency"].map(preflightCode);

/**
 * 人脸裁片缺口(1107 吸收件②)——只压人物相关的两行,不碰装配/文字/跨镜。
 * 整帧探针被限宽到 1280 后 1080P 的脸只剩 ~47px,模型对五官的回话是「看不清就不判」;
 * 这一镜的头部特写既然没出成,「人物没问题」就没有近景证据,pass 必须退回缺证。
 */
export const FACE_CROP_GAP_CODE = "chapter-qc.face.crop-gap";

function faceCropBlocker(input: ChapterQcRequirementInput): string | undefined {
  const gap = input.findings.find((finding) => finding.code === FACE_CROP_GAP_CODE && isViolation(finding));
  return gap?.message;
}

function faceCropNote(input: ChapterQcRequirementInput): string {
  // 整批不采信时台账只剩「回了什么」的记录价值:它自己都不确定哪条对应哪镜,
  // 再报一个 X/Y 就是在给读者第二套分母(那边的「裁片 N/N 镜」用的是请求数)。
  const reason = input.vision?.faceCropReason;
  if (reason) return `人脸裁片整批不采信(${reason})`;
  const crops = input.vision?.faceCrops;
  if (!crops || crops.length === 0) return "人脸裁片未跑本轮";
  const counts = summarizeFaceCrops(crops);
  return `头部特写 ${counts.produced}/${crops.length} 镜(本镜无脸 ${counts.noFace} / 裁片失败 ${counts.gaps})`;
}

function visionPreflightMissing(input: ChapterQcRequirementInput): string | undefined {
  const layerMissing = layerMissingReason("vision", input.layers.vision);
  if (layerMissing) return layerMissing;
  if (input.layers.vision.status === "failed") return "vision 层执行失败，不能确认视觉证据完整";
  const vision = input.vision;
  const preflight = vision?.preflight;
  if (!vision || !preflight) return "视觉预审未回写(图片理解绑定缺/帧物料缺)";
  if (vision.frameErrors > 0) return `视觉抽帧失败 ${vision.frameErrors} 张，缺帧不算通过`;
  if (vision.frames.length === 0 || vision.frameCount !== vision.frames.length) return "视觉探针帧缺失或帧数与台账不符";
  if (vision.decisions.length === 0) return "分镜决策台账为空，无法确认单镜与相邻镜覆盖";
  const uncovered = vision.decisions.filter((decision) => !vision.frames.some(
    (frame) => frame.kind === "mid" && frame.ordinal === decision.ordinal && frame.shotId === decision.shotId,
  )).map((decision) => decision.ordinal);
  // 点名是哪一镜没探针:短于抽帧窗口的镜会被 visionSamplePoints 丢掉 mid,读者要能自己去修,
  // 而不是对着一句「覆盖不全」无从下手。
  if (uncovered.length > 0) return `第 ${uncovered.join("、")} 镜没有中帧探针(镜头短于抽帧窗口或未落盘)，该镜单帧与相邻配对都无证据`;
  const expectedCalls = vision.frames.length + vision.decisions.length - 1;
  if (preflight.checked !== preflight.passed + preflight.failed || preflight.skipped !== 0 || preflight.checked !== expectedCalls) {
    return `视觉预审覆盖不全：应检查 ${expectedCalls} 次 / 已检查 ${preflight.checked} / 缺证或跳过 ${preflight.skipped}`;
  }
  const incomplete = input.findings.find((finding) => finding.code === preflightCode("incomplete"));
  if (incomplete) return incomplete.message;
  if (preflight.failed > 0 && !input.findings.some((finding) => isViolation(finding)
    && [...ASSEMBLY_CODES, ...CHARACTER_CODES, ...TEXT_CODES, ...COHERENCE_CODES].includes(finding.code))) {
    return "视觉预审报失败但异常明细未回写，无法判定受影响维度";
  }
  return undefined;
}

function visionGroup(codeList: readonly string[], extraCodes: readonly string[] = []): Assessor {
  return (context) => {
    const watched = [...extraCodes, ...codeList];
    const match = codes(...watched);
    const hits = context.input.findings.filter((finding) => isViolation(finding) && match(finding));
    const missing = hits.length > 0 ? undefined : visionPreflightMissing(context.input);
    return {
      verdict: hits.length > 0 ? "fail" : missing ? "unverified" : "pass",
      evidenceCodes: hits.map((finding) => finding.code),
      failingShotOrdinals: [...new Set(hits.flatMap((finding) => finding.shotOrdinal === undefined ? [] : [finding.shotOrdinal]))].sort((a, b) => a - b),
      ...(missing ? { missing: [missing] } : {}),
    };
  };
}

export const visionReviewed: Assessor = (context) => {
  const base = visionGroup(ASSEMBLY_CODES, ["chapter-qc.vision.transition-density"])(context);
  const vision = context.input.vision;
  return {
    ...base,
    note: vision
      ? `密度闸复检 ${vision.densityChecked} 处转场 · 抽帧 ${vision.frameCount} 张(失败 ${vision.frameErrors})${vision.preflight ? ` · 预审 failed ${vision.preflight.failed}` : ""}`
      : undefined,
  };
};

export const characterIntegrity: Assessor = (context) => {
  const base = visionGroup(CHARACTER_CODES)(context);
  const cast = assertionCoverage(context.input.expectations, "cast-visible");
  const lipSyncUnverified = context.input.vision?.decisions.filter((decision) => {
    const shot = context.input.expectations?.shots.find((item) => item.shotId === decision.shotId && item.ordinal === decision.ordinal);
    return shot?.assertions["cast-visible"] !== "forbidden" && shot?.assertions.speech !== "forbidden";
  }) ?? [];
  const blockers = [
    ...(base.missing ?? []),
    ...(base.verdict === "pass" && lipSyncUnverified.length > 0
      ? [`${lipSyncUnverified.length} 镜未排除出镜说话，口型同步缺证：静帧没有连续嘴部画面和音频，须音画时序检测或专项人工复核`]
      : []),
    ...(base.verdict === "pass" ? [faceCropBlocker(context.input)].filter((message): message is string => message !== undefined) : []),
  ];
  return {
    ...base,
    ...(base.verdict === "fail" || blockers.length === 0 ? {} : {
      verdict: "unverified" as const,
      missing: blockers,
    }),
    note: `分镜声明出镜 ${cast.expected} 镜 / 声明空镜 ${cast.forbidden} 镜 / 未记 ${cast.unknown} 镜；图片理解仅检查探针帧可见的脸、手和肢体，不代表全片逐帧无异常；YuNet 只记可判读度；${faceCropNote(context.input)}`,
  };
};

export const textIntegrity: Assessor = (context) => {
  const base = visionGroup(TEXT_CODES)(context);
  return { ...base, note: "1102 亲检 h3_edition_v3 牌匾「金水」可读、两侧对联为伪汉字——产线无 OCR,这条只由模型判" };
};

export const crossShotCoherence: Assessor = (context) => {
  const base = visionGroup(COHERENCE_CODES)(context);
  return {
    ...base,
    ...(base.verdict === "pass" && (context.input.vision?.decisions.length ?? 0) < 2
      ? { verdict: "unverified" as const, missing: ["没有相邻两镜对照，跨镜一致性无证据"] }
      : {}),
    note: "成对调用(相邻两镜同送)才判得出漂移;单帧调用无对照物",
  };
};

/**
 * 人脸可判读度(1102 吸收件①):这是「五官/手指维有没有自动证据」的行,不是内容行。
 * 恒不产 fail——零检出在 1102 亲检里对应靴子特写/背面/侧脸(合理内容),几何越限区间宽到无法画线。
 * 1102 骨干②的增量:分镜若声明了出镜,零检出就从「合理内容」升级成「指名缺证」。
 */
export const faceReadability: Assessor = (context) => {
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
  const cropBlocker = faceCropBlocker(context.input);
  return {
    verdict: cropBlocker ? "unverified" : "pass",
    evidenceCodes: ["chapter-qc.face.summary", ...(cropBlocker ? [FACE_CROP_GAP_CODE] : [])],
    ...(cropBlocker ? { missing: [cropBlocker] } : {}),
    note: `${faceNote(face)} / 近景特写声明 ${closeUp.expected} 镜 / ${faceCropNote(context.input)}`,
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
export const humanFullWatch: Assessor = (context) => {
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
