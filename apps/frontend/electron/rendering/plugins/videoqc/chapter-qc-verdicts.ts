/**
 * 三态验收口径(1030 单镜分析门 · 吸收 `magichourhq/skills@ai-media-quality-review` 的裁定文案)。
 *
 * 取代「层绿=片子好」:`pass` / `fail` / `unverified` 三态,**unverified 永不计为通过**。
 * 本件把那五条「不可从绿推的结论」(docs/comfyui-kb/分镜H3视频产线.md §九.六)编成可执行判定——
 * 信号没接、物料没到、阈值没标定、缺人眼人耳复核,一律落 `unverified` 并写明缺什么,
 * 而不是让「查不出来」冒充「查过没问题」。
 *
 * 判定优先级恒为:客观门越限 → `fail`;越限为零但证据不全 → `unverified`;证据齐且零越限 → `pass`。
 * 只有 blocker/warn 算越限;先记不判的 info(运动/曝光/清晰度/意外切换)不参与,免得攒基线期自我否决。
 */

import { FACE_READABLE_MIN_RATIO } from "./chapter-qc-face";
import type {
  ChapterQcFindingV1,
  ChapterQcHumanReviewV1,
  ChapterQcLayerId,
  ChapterQcLayerResultV1,
  ChapterQcReportV1,
  ChapterQcRequirementV1,
  ChapterQcRequirementVerdict,
  ChapterQcScanSignalsV1,
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

/** 精确码族匹配器;`watchedCodes` 里以 `*` 结尾的写法对应前缀匹配。 */
function codes(...exact: string[]): (finding: ChapterQcFindingV1) => boolean {
  return (finding) => exact.includes(finding.code);
}

/**
 * 人证行(1031 补齐):三态定义里 pass 的第二半——机器全绿也不够,必须有人全速看过、听过。
 * 回写通道已接进应用侧体检单,所以缺省含义从「通道不存在」变成「还没人提交」:
 * 两者都判 unverified,但只有后者是勾一下就完成的待办。
 */
function humanReviewRequirement(review?: ChapterQcHumanReviewV1): ChapterQcRequirementV1 {
  const missing: string[] = [];
  if (!review) {
    missing.push("尚无人工复核回写:须人眼全速看全片 + 人耳听全轨(抽帧全绿不等于口型准/动作连贯)");
  } else {
    if (!review.fullWatched) missing.push(`${review.reviewer} 的复核未确认「人眼全速看完全片」`);
    if (!review.audioListened) missing.push(`${review.reviewer} 的复核未确认「人耳听完全轨」`);
  }
  return {
    requirementId: "human-full-watch",
    label: "人眼全速看全片 + 人耳听全轨",
    verdict: missing.length === 0 ? "pass" : "unverified",
    watchedCodes: [],
    evidenceCodes: [],
    ...(missing.length > 0 ? { missing } : {}),
    ...(review && missing.length === 0 ? { note: `复核人 ${review.reviewer}` } : {}),
  };
}

function verdictOf(
  violations: readonly ChapterQcFindingV1[],
  missing: string | undefined,
): ChapterQcRequirementVerdict {
  if (violations.length > 0) return "fail";
  return missing ? "unverified" : "pass";
}

function requirement(
  requirementId: string,
  label: string,
  watchedCodes: readonly string[],
  match: (finding: ChapterQcFindingV1) => boolean,
  findings: readonly ChapterQcFindingV1[],
  missing: string | undefined,
  note?: string,
): ChapterQcRequirementV1 {
  const hits = findings.filter((finding) => isViolation(finding) && match(finding));
  return {
    requirementId,
    label,
    verdict: verdictOf(hits, missing),
    watchedCodes: [...watchedCodes],
    evidenceCodes: hits.map((finding) => finding.code),
    ...(missing ? { missing: [missing] } : {}),
    ...(note ? { note } : {}),
  };
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
}

/**
 * 由既有五层结果与 finding 派生需求板。派生规则全部可追溯:每个 verdict 都能回指
 * 一条 finding code 或一句「缺什么」,不留自由裁量位。
 */
export function buildChapterQcRequirements(input: ChapterQcRequirementInput): ChapterQcRequirementV1[] {
  const scanMissing = layerMissingReason("ffmpegScan", input.layers.ffmpegScan);
  const structuralMissing = layerMissingReason("structural", input.layers.structural);
  const requirements: ChapterQcRequirementV1[] = [];

  requirements.push(
    requirement(
      "duration-in-plan",
      "成片时长与计划对齐",
      ["chapter-qc.duration.truncated", "chapter-qc.duration.overlong"],
      codes("chapter-qc.duration.truncated", "chapter-qc.duration.overlong"),
      input.findings,
      structuralMissing,
    ),
    requirement(
      "subtitle-text-consistent",
      "字幕文本与台词稿一致且覆盖到位",
      ["chapter-qc.subtitle.text-mismatch", "chapter-qc.subtitle.coverage-low"],
      codes("chapter-qc.subtitle.text-mismatch", "chapter-qc.subtitle.coverage-low"),
      input.findings,
      structuralMissing,
    ),
    requirement(
      "no-blackout",
      "无异常黑场",
      ["chapter-qc.black.segment", "chapter-qc.black.out-of-timeline"],
      codes("chapter-qc.black.segment", "chapter-qc.black.out-of-timeline"),
      input.findings,
      scanMissing,
      "整镜暗另记 black.full-shot(info);渐进淡入淡出可不越 blackdetect 阈值,黑场为零不等于画面没压暗,归 exposure 信号",
    ),
    requirement(
      "no-freeze",
      "无画面冻结",
      ["chapter-qc.freeze.segment"],
      codes("chapter-qc.freeze.segment"),
      input.findings,
      scanMissing,
      "freezedetect 无段 ≠ 运动是真的;真动态归 real-motion",
    ),
    requirement(
      "audio-loudness",
      "整体响度在 sanity 窗内",
      ["chapter-qc.audio.loudness-out-of-range"],
      codes("chapter-qc.audio.loudness-out-of-range"),
      input.findings,
      scanMissing ?? (input.signals?.loudnessInputI === undefined
        ? "响度未出数(loudnorm 无解析结果)"
        : undefined),
      input.signals?.loudnessInputI !== undefined
        ? `实测 I=${input.signals.loudnessInputI.toFixed(1)} LUFS(sanity 窗 [-30, -10])`
        : undefined,
    ),
  );

  // 语音完整性:客观挤压/偏移门照跑,但 silencedetect 在 BGM 大声下不触发(§九.六 反过度声称③)。
  // VAD 到位时口径已修好,剩「末字被截/发音清晰度只有人耳能判」这一条 —— 仍不许冒 pass。
  const speechMissing =
    scanMissing ??
    (input.signals?.speechSource === "silero-vad"
      ? "须人耳听全轨:VAD 只能给出语音段,末字截断与发音可懂度它判不了"
      : "VAD 未接:BGM 掩盖下 silencedetect(-35dB) 不触发,无段不等于台词可懂(须人耳听全轨)");
  const speech = requirement(
    "speech-integrity",
    "台词未被挤压/音画同步",
    ["chapter-qc.audio.speech-compressed", "chapter-qc.audio.cue-offset"],
    codes("chapter-qc.audio.speech-compressed", "chapter-qc.audio.cue-offset"),
    input.findings,
    speechMissing,
    input.signals
      ? `语音段口径 ${input.signals.speechSource ?? "不可用(未看见死寂段,补集等于全片)"} / 实测语音 ${input.signals.speechSeconds?.toFixed(2) ?? "NA"}s / 死寂段 ${input.signals.silences} 段`
      : undefined,
  );
  requirements.push(speech);

  // 伪动态主判据:阈值未标定前恒 unverified(§九.六「阈值先记不判」的可执行形式)。
  const motionSummary = input.findings.find((finding) => finding.code === "chapter-qc.motion.summary");
  const samplePoints = Number(motionSummary?.evidence.samplePoints ?? 0);
  const motionMissing =
    scanMissing ?? (!motionSummary || samplePoints === 0
      ? "逐帧统计未出数(siti/metadata 无采样点)"
      : "阈值未标定(先记不判):持帧轴实测咬得住(已知静帧片静止占比 1.000、每 4 帧持 1 帧 0.753),但 38 支真单镜 27 支恒 0=产线不产这病;要裁定的是 TI 水平线");
  requirements.push({
    requirementId: "real-motion",
    label: "画面有真动态(伪动态门)",
    verdict: verdictOf(
      input.findings.filter((finding) => isViolation(finding) && finding.code === "chapter-qc.motion.static-heavy"),
      motionMissing,
    ),
    watchedCodes: ["chapter-qc.motion.summary", "chapter-qc.motion.static-heavy"],
    evidenceCodes: [],
    missing: [motionMissing],
    note: `已记录 TI 均值 ${motionSummary?.evidence.tiMean ?? "NA"} / 静止帧占比 ${motionSummary?.evidence.staticFrameRatio ?? "NA"} / 采样点 ${samplePoints}`,
  });

  requirements.push(
    requirement(
      "aesthetic-in-baseline",
      "观感分在系列基线内",
      ["chapter-qc.aesthetic.below-baseline", "chapter-qc.aesthetic.shot-below-baseline"],
      codes("chapter-qc.aesthetic.below-baseline", "chapter-qc.aesthetic.shot-below-baseline"),
      input.findings,
      layerMissingReason("aesthetic", input.layers.aesthetic) ??
        (input.aesthetic?.baseline ? undefined : "无系列基线(样本不足,不可判离群)"),
      "无参考观感分在基线内 ≠ 身份不漂;身份漂移须逐镜对设定卡",
    ),
  );

  // L4/L5 由模型判读:无稳定 finding code(语义层 code 由模型给出、视觉预审按前缀过滤),
  // 故按「层是否跑到 + 回写计数」派生,越限另计本层 blocker/warn finding。
  const semanticMissing =
    layerMissingReason("semantic", input.layers.semantic) ??
    (input.semantic && input.semantic.checked > 0 ? undefined : "语义层未消费任何镜(模型绑定或帧/描述物料缺)");
  const semanticViolations = input.findings.filter((finding) => finding.layer === "semantic" && isViolation(finding));
  requirements.push({
    requirementId: "semantic-reviewed",
    label: "逐镜语义与画面一致",
    verdict:
      semanticViolations.length > 0 || (input.semantic?.failed ?? 0) > 0
        ? "fail"
        : semanticMissing
          ? "unverified"
          : "pass",
    watchedCodes: ["<本层任意 blocker/warn>"],
    evidenceCodes: semanticViolations.map((finding) => finding.code),
    ...(semanticMissing ? { missing: [semanticMissing] } : {}),
    note: input.semantic
      ? `checked ${input.semantic.checked} / passed ${input.semantic.passed} / failed ${input.semantic.failed} / skipped ${input.semantic.skipped}${input.semantic.model ? ` · ${input.semantic.model}` : ""}`
      : undefined,
  });

  const visionMissing =
    layerMissingReason("vision", input.layers.vision) ??
    (input.vision?.preflight ? undefined : "视觉预审未回写(图片理解绑定缺/帧物料缺)");
  // 1102 拆行:预审 finding 现在分四组(装配/角色形体/画面文字/跨镜一致),每组一条独立需求。
  // 一条 finding 只落一行——`vision-reviewed` 不再兜 `preflight.*` 全前缀,免得一个烂脸在板上算两次 fail。
  const preflightCode = (code: string) => `chapter-qc.vision.preflight.${code}`;
  const assemblyCodes = ["black-or-garbled", "subtitle-obstruction", "decorative-clutter", "transition-content-mismatch"].map(preflightCode);
  const characterCodes = ["face-anomaly", "hand-anomaly", "pose-anomaly", "lip-sync-suspect"].map(preflightCode);
  const textCodes = ["text-garbled"].map(preflightCode);
  const coherenceCodes = ["identity-drift", "style-inconsistency"].map(preflightCode);
  const inSet = (...codeList: string[]) => (finding: ChapterQcFindingV1) => codeList.includes(finding.code);

  requirements.push(
    requirement(
      "vision-reviewed",
      "转场密度与画面装配预审",
      ["chapter-qc.vision.transition-density", ...assemblyCodes],
      (finding) =>
        finding.code === "chapter-qc.vision.transition-density" || assemblyCodes.includes(finding.code),
      input.findings,
      visionMissing,
      input.vision
        ? `密度闸复检 ${input.vision.densityChecked} 处转场 · 抽帧 ${input.vision.frameCount} 张(失败 ${input.vision.frameErrors})${input.vision.preflight ? ` · 预审 failed ${input.vision.preflight.failed}` : ""}`
        : undefined,
    ),
    requirement(
      "character-integrity",
      "角色形体成立(五官/手/姿势/口型无崩坏)",
      characterCodes,
      inSet(...characterCodes),
      input.findings,
      visionMissing,
      "由图片理解模型逐探针帧判;1102 实测 608×352 下 YuNet 五官几何比值自然区间 0.28–1.02,几何门会误伤,故此维只信模型不信信号过滤器",
    ),
    requirement(
      "text-integrity",
      "画面内文字成立(无伪字/乱码)",
      textCodes,
      inSet(...textCodes),
      input.findings,
      visionMissing,
      "1102 亲检 h3_edition_v3 牌匾「金水」可读、两侧对联为伪汉字——产线无 OCR,这条只由模型判",
    ),
    requirement(
      "cross-shot-coherence",
      "跨镜一致(同角色不漂移、画风同属一片)",
      coherenceCodes,
      inSet(...coherenceCodes),
      input.findings,
      visionMissing,
      "成对调用(相邻两镜同送)才判得出漂移;单帧调用无对照物",
    ),
  );

  // 人脸可判读度(1102 吸收件①):这是「五官/手指维有没有自动证据」的行,不是内容行。
  // 恒不产 fail——零检出在 1102 亲检里对应靴子特写/背面/侧脸(合理内容),几何越限区间宽到无法画线。
  const face = input.faceSignals;
  const faceVerdict: ChapterQcRequirementVerdict = !face
    ? "unverified"
    : face.framesRead === 0 || face.faceCount === 0
      ? "unverified"
      : (face.readableRatio ?? 0) >= FACE_READABLE_MIN_RATIO
        ? "pass"
        : "unverified";
  const faceMissing = faceVerdict === "unverified"
    ? (!face
        ? "人脸侧车未出数(YuNet 模型未下载 / 托管 Python 未配置 / cv2 缺位)"
        : face.faceCount === 0
          ? "全片采样帧零检出:1102 亲检零检出样本分别是靴子特写、背面行走、侧脸——合理内容,不是崩坏;五官维无自动证据"
          : `检出的脸仅 ${(((face.readableRatio ?? 0) * 100).toFixed(0))}% 达可辨尺寸(线 ${FACE_READABLE_MIN_RATIO * 100}% / 短边 ${face.minReadableFacePx}px):中位 ${face.medianFaceShortSidePx ?? "NA"}px`)
    : undefined;
  requirements.push({
    requirementId: "face-readability",
    label: "人脸可自动判读(五官/手指维的证据前提)",
    verdict: faceVerdict,
    watchedCodes: ["chapter-qc.face.summary", "chapter-qc.face.unreadable"],
    evidenceCodes: face ? ["chapter-qc.face.summary"] : [],
    ...(faceMissing ? { missing: [faceMissing] } : {}),
    note: face
      ? `检出 ${face.framesWithFace}/${face.framesRead} 帧 / 脸 ${face.faceCount} 张(可辨 ${face.readableFaceCount}) / 表观漂移 p50 ${face.driftDistanceP50 ?? "NA"}(未标定只记账)`
      : undefined,
  });

  // 三态板的人证行:通道已接进应用侧体检单,所以缺证含义是「还没人签」,不是「签不了」。
  requirements.push(humanReviewRequirement(input.humanReview));

  return requirements;
}

export interface ChapterQcRequirementSummary {
  total: number;
  passed: number;
  failed: number;
  unverified: number;
  /** 放行判据:零 fail 且零 unverified——缺证即不放行 */
  releasable: boolean;
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
  };
}

/**
 * 就地重算需求板。三层写报告时(编排器 / L4 语义回写 / L5 预审回写)都要过这里,
 * 否则回写后板子还是旧层状态,unverified 会赖着不走。
 */
export function applyChapterQcRequirements(
  report: Pick<
    ChapterQcReportV1,
    "layers" | "findings" | "aesthetic" | "semantic" | "vision" | "scanSignals" | "faceSignals" | "humanReview" | "requirements"
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
  });
  report.requirements = requirements;
  return requirements;
}
