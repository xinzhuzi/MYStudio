/**
 * 章节成片四层 QC 链——共享类型与错误码族(08-19-chapter-video-qc)。
 *
 * 错误码命名空间 `chapter-qc.<domain>.<detail>`,独立于字幕 authority 的
 * `subtitle.authority.*`(那是渲染前正确性门禁;本链是出片后体检)。
 */

export const CHAPTER_QC_SCHEMA_VERSION = 1;

export type ChapterQcLayerId = "structural" | "ffmpegScan" | "aesthetic" | "semantic" | "vision";

export type ChapterQcSeverity = "blocker" | "warn" | "info";

export interface ChapterQcFindingV1 {
  /** 形如 `chapter-qc.<domain>.<detail>` 的稳定错误码 */
  code: string;
  layer: ChapterQcLayerId;
  severity: ChapterQcSeverity;
  /** 定位到镜(时间轴映射结果);结构性问题可无镜 */
  shotId?: string;
  /** 第几镜(1 起,人类可读) */
  shotOrdinal?: number;
  message: string;
  /** 原始证据:时间戳/分数/比对差值/探测器输出片段 */
  evidence: Record<string, unknown>;
}

export type ChapterQcLayerStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface ChapterQcLayerResultV1 {
  status: ChapterQcLayerStatus;
  /** skipped 原因 / failed 摘要 / passed 附注 */
  reason?: string;
  startedAt?: number;
  finishedAt?: number;
}

/** L3 观感层结果(缺模型/未跑时整个字段缺省或 layers.aesthetic=skipped) */
export interface ChapterQcAestheticResultV1 {
  /** ITU 归一总分 [0,1](DOVER fused) */
  fused: number;
  aesthetic: number;
  technical: number;
  baseline?: {
    seriesId: string;
    meanFused: number;
    sigma: number;
    sampleCount: number;
  };
  /** 整片分异常时的按镜切片重跑结果(粗到细定位) */
  slices?: Array<{ shotId: string; ordinal: number; fused: number }>;
  elapsedMs?: number;
}

/** L4 语义层结果(渲染端跑完回写) */
export interface ChapterQcSemanticResultV1 {
  checked: number;
  passed: number;
  failed: number;
  skipped: number;
  /** 使用的模型标识(provider/model,留审计) */
  model?: string;
  finishedAt: number;
}

/** L5 视觉审计帧物料种类:镜中/边界前/转场中/边界后 */
export type ChapterQcVisionFrameKind = "mid" | "pre" | "blend" | "post";

export interface ChapterQcVisionFrameTaskV1 {
  shotId: string;
  ordinal: number;
  kind: ChapterQcVisionFrameKind;
  /** 成片时间轴上的秒(压缩口径,与帧内容一致) */
  tS: number;
  frameUrl: string;
}

export interface ChapterQcVisionDecisionV1 {
  shotId: string;
  ordinal: number;
  description?: string;
  effects: Array<{ effectId: string; template?: string }>;
  outgoingTransition?: {
    toShotId: string;
    toOrdinal: number;
    effectId: string;
    durationS: number;
  };
}

export interface ChapterQcVisionPreflightResultV1 {
  checked: number;
  passed: number;
  failed: number;
  skipped: number;
  model?: string;
  finishedAt: number;
}

/**
 * L5 视觉审计层(08-22-video-use-vision-release R2)。
 * 确定性部分主进程即时跑:转场密度闸(08-22 裁定:连续 5 边界禁同款)。
 * 模型判读部分:主进程只产帧物料(frames),渲染端 runner 按清单调图像理解
 * 模型(L4 semantic 同款 pending 语义),跑完回写 findings。
 */
export interface ChapterQcVisionResultV1 {
  frameCount: number;
  frames: ChapterQcVisionFrameTaskV1[];
  /** 确认前预审的最小 EDL/转场/装饰决策上下文。 */
  decisions: ChapterQcVisionDecisionV1[];
  /** 密度闸检查的转场数(0=无转场) */
  densityChecked: number;
  /** 帧提取失败数(单帧跳过不整体失败) */
  frameErrors: number;
  /** 渲染端图片理解预审回写；缺省=尚未运行或无 binding。 */
  preflight?: ChapterQcVisionPreflightResultV1;
}

/**
 * 三态验收(1030 单镜分析门口径):`unverified` 永不计为通过。
 * pass=客观信号越限为零;fail=任一客观门越限;unverified=层没跑到/物料缺/阈值未标定/
 * 缺人工复核——「查不出来」不得冒充「查过没问题」。
 */
export type ChapterQcRequirementVerdict = "pass" | "fail" | "unverified";

export interface ChapterQcRequirementV1 {
  /** 稳定需求 id,UI 与回执按此对账 */
  requirementId: string;
  label: string;
  verdict: ChapterQcRequirementVerdict;
  /** 本条盯的 finding code(unverified 时为期望但拿不到的证据) */
  watchedCodes: string[];
  /** 实际命中的 finding code(pass 恒空) */
  evidenceCodes: string[];
  /** 缺什么证据(仅 unverified;逐条写明,便于直接列待办) */
  missing?: string[];
  /** 数字回执:已记录的均值/占比等,不改变 verdict */
  note?: string;
  /** 骨干①:所属能力类别(注册表带下来的分组,UI 按此折叠) */
  category?: ChapterQcDimensionCategory;
  /** 骨干④:证据由谁产(自研信号 / 托管 Python 侧车 / 多模态模型 / 上游评价器 / 人证) */
  evaluator?: ChapterQcEvaluatorKind;
  /** 骨干③:加权总分里的权重(0~100 整数;缺省=注册表没这条) */
  weight?: number;
  /** 越限时的定位:哪几镜把这条打下来的(逐镜期望门用) */
  failingShotOrdinals?: number[];
}

/* ------------------------------------------------------------------ *
 * 骨干层(1102 吸收 VBench 四件套后的本仓形态)。
 *
 * 上游是「问题锚定」:`vbench/VBench_full_info.json` 946 条 / `vbench2/VBench2_full_info.json`
 * 1230 条 `{prompt, dimension[]}` 先定问题,`vbench/<dim>.py` 再配评价器,`integrity_check/`
 * 先验供给,`scripts/cal_final_score.py`+`constant.py` 用人类偏好定权重。
 * 我们此前是「信号锚定」:一行存在是因为恰好造出了那个检测器——这就是 15 行里 10 行
 * 恒 unverified 的结构原因。下面四组类型把那四件套接进产线侧(我们的逐镜 H3 prompt
 * 与分镜语义天生就是 VBench 缺的那份 prompt suite)。
 * ------------------------------------------------------------------ */

/** 一支信号要画带(拿到可用阈值)所需的最少实测样本数;不足则相关行只能记「未标定」。 */
export const QC_CALIBRATION_MIN_SAMPLES = 5;

/**
 * 单镜静止帧占比的绝对病线:L2 从这里起记「伪动态线索」,逐镜判定也必须从这里起判。
 * 放纯类型层是为了让 ffmpeg-scan(出线索)与 verdicts(判病)共用一条线,不各写各的。
 */
export const SHOT_STATIC_RATIO_LIMIT = 0.5;

/** 能力类别(本仓自定,借 VBench-2.0 的五大类思路按产线口径重划)。 */
export type ChapterQcDimensionCategory =
  | "supply"
  | "timeline"
  | "audio"
  | "motion"
  | "visual-quality"
  | "character"
  | "text"
  | "coherence"
  | "human";

/**
 * 骨干④:评价器绑定。`upstream-vbench*` 是**声明的委托位**,不是已装好的东西——
 * 上游栈(numpy<2.0 / opencv-python 与托管 Python 的 opencv-contrib 抢同一个 cv2 / decord)
 * 只能住 `python/profiles/<name>` 隔离 venv,未经供应批准不得安装。
 * 缺位时对应行只能落 unverified 并指名委托对象,不许假装自研信号顶替。
 */
export type ChapterQcEvaluatorKind =
  | "deterministic-signal"
  | "managed-python-sidecar"
  | "multimodal-model"
  | "upstream-vbench"
  | "upstream-vbench2"
  | "human-review";

/** 一条维度注册项(骨干①的表行;解释器按此顺序出板)。 */
export interface ChapterQcDimensionSpecV1 {
  requirementId: string;
  label: string;
  category: ChapterQcDimensionCategory;
  /** 依赖的层;该层未跑到即缺证 */
  layer?: ChapterQcLayerId;
  evaluator: ChapterQcEvaluatorKind;
  /** 委托上游时它对应的 VBench 维名(留审计与未来接线用) */
  upstreamDimension?: string;
  /**
   * 本行是否要拿系列实测带才能判。**解释器按此硬拦**:
   * 该行的 `calibrationSignals` 任一条没有可用基线 ⇒ 不许 pass,只能 unverified。
   */
  requiresCalibration: boolean;
  /** 本行判定实际消费的信号;`requiresCalibration` 为真时必须声明(不声明=永远缺证)。 */
  calibrationSignals?: readonly ChapterQcSignalId[];
  /**
   * 本行「算标定过」所需的最少系列样本数,缺省 `QC_CALIBRATION_MIN_SAMPLES`(5)。
   * 只有 `aesthetic-in-baseline` 会改它:标定库还没攒出带时它接受 DOVER 控制器那份补位,2 条起判。
   */
  minCalibrationSamples?: number;
  /** 骨干③权重(0~100);全表合计 100 */
  weight: number;
}

/** 逐镜期望的单个断言键(②的词表;每键都能由分镜字段推导,推不出=unknown)。 */
export type ChapterQcExpectationKey =
  | "motion"
  | "speech"
  | "subtitle"
  | "cast-visible"
  | "face-readable"
  | "duration-in-target";

export type ChapterQcExpectationValue = "expected" | "forbidden" | "unknown";

export interface ChapterQcShotExpectationV1 {
  shotId: string;
  ordinal: number;
  /** 每条断言的三态;`unknown` = 分镜没这个字段,不许拿它当通过依据 */
  assertions: Record<ChapterQcExpectationKey, ChapterQcExpectationValue>;
  /** 期望来源留痕(哪个字段推出这条),缺证时是「去补哪一列」的指名 */
  provenance: Partial<Record<ChapterQcExpectationKey, string>>;
  durationS: number;
  durationTargetS?: number;
}

export interface ChapterQcExpectationSetV1 {
  shots: ChapterQcShotExpectationV1[];
  /** 逐键计数:expected/forbidden/unknown 各多少镜。UI 与标定都吃这个 */
  coverage: Array<{
    key: ChapterQcExpectationKey;
    expected: number;
    forbidden: number;
    unknown: number;
  }>;
}

/** 骨干⓪:供给完整性自检的单条结果。跑分之前先证「物料在、可读、条数对」。 */
export interface ChapterQcSupplyCheckV1 {
  checks: Array<{
    checkId: string;
    label: string;
    verdict: "ok" | "gap" | "blocked";
    detail?: string;
  }>;
  /** gap/blocked 计数;>0 时 supply-integrity 行不许 pass,unverified/fail 不阻断但必须写明原因 */
  gaps: number;
  blocked: number;
  /** 缺料项清单(供 missing 文案) */
  missing?: readonly string[];
}

/**
 * 骨干③:可标定信号词表(闭集;越限方向与 σ 护栏见 `chapter-qc-calibration.ts`)。
 * 放纯类型层是为了让注册表(渲染进程也要 value-import)不必 import 带 node:fs 的标定件。
 */
export type ChapterQcSignalId =
  | "aesthetic.fused"
  | "motion.tiMean"
  | "motion.staticFrameRatio"
  /** 逐镜口径(本章最差镜):与全片均值 `motion.staticFrameRatio` 单位不同,禁止混用同一条带。 */
  | "shot.motion.staticFrameRatio"
  | "speech.coverageRatio"
  | "speech.secondsPerDeclaredShot"
  | "visual.blurMean"
  | "face.readableRatio";

/** 骨干③:一条可标定信号的系列基线(mean±2σ,DOVER 那套泛化到逐信号)。 */
export interface ChapterQcSignalBaselineV1 {
  /** 落库字段故意留宽:库里出现本仓还不认的信号 id 时,读侧要能跳过而不是整库作废。 */
  signalId: string;
  seriesId: string;
  mean: number;  sigma: number;
  /**
   * 画带用的样本数:带是「别章」攒出来的,本章那份已被剔出去(见 `deriveSignalBaselines`)。
   * 判定门槛看这一个,不能拿 `seriesSampleCount` 冒充。
   */
  sampleCount: number;
  /** 本系列这一信号的落库总数(含本章):「差几条才够标定」报的是这个,不报成 0 让人以为没攒。 */
  seriesSampleCount?: number;
  updatedAt: number;
}

/** 骨干③:正/负标定 case(对标上游 sampled_videos/ + 打标集;没它就没资格谈阈值)。 */
export interface ChapterQcCalibrationCaseV1 {
  caseId: string;
  /** 标定片内容 sha256(片子换了 case 就失效) */
  videoSha256: string;
  requirementId: string;
  /** green=已知应 pass;red=已知应 fail(人为注入口子的负例) */
  label: "green" | "red";
  note: string;
}

/** 骨干③:加权维度分。缺证不计分(「查不出来」不给分也不倒扣)。 */
export interface ChapterQcDimensionScoreV1 {
  /** 0~100:已通过行的权重和 / 全表权重和 */
  score: number;
  /** 参与计算的权重和(注册表全表恒 100;缺行时小于 100 并留痕) */
  weightTotal: number;
  weightPassed: number;
  /** 权重被谁扣住:requirementId → 缺证/越限 */
  deducted: Array<{ requirementId: string; weight: number; reason: "unverified" | "fail" }>;
}


/**
 * L2 实测台账(1030 三态验收需要):区分「测到了且没越限」和「压根没测出来」。
 * 缺这一份数,响度/语音一类需求只能恒判 unverified——那正是本板要防的假绿。
 */
export interface ChapterQcScanSignalsV1 {
  blacks: number;
  freezes: number;
  silences: number;
  /** loudnorm 未出数时缺省(=响度这条测不了,不许当通过) */
  loudnessInputI?: number;
  /** 语音补集秒数(无时长口径时缺省) */
  speechSeconds?: number;
  /** 语音段口径:VAD 到位= silero-vad;否则 silencedetect 补集(带 BGM 会退化) */
  speechSource?: "silero-vad" | "silencedetect-complement";
  /** blurdetect 全片均值(越大越糊) */
  blurMean?: number;
  frameSampleCount?: number;
  frameSampleStep: number;
  /**
   * 逐镜运动台账(1102 骨干②的证据前提):每镜在 L2 同趟里的 TI/静止占比实测。
   * 缺这份数,「该动的镜没动」只能靠 `motion.static-heavy`(超记录线才出)反推——
   * 而没出那条 ≠ 测过没问题,正是三态板要防的假绿。
   */
  shotMotion?: Array<{
    shotId: string;
    ordinal: number;
    sampleCount: number;
    tiMean?: number;
    staticFrameRatio?: number;
  }>;
  /** 逐镜语音台账:该镜窗口内的语音秒数(口径同 speechSource)。 */
  shotSpeech?: Array<{ shotId: string; ordinal: number; speechSeconds: number }>;
}

/**
 * 人脸可判读度台账(1102 吸收件①,YuNet via 托管 Python)。
 *
 * 它是**证据质量**读数,不是内容判定:1102 实测本片检出脸中位短边 22.2px(可辨线 24),
 * 覆盖率 0.542——所以「五官有没有崩」这条自动侧根本判不了,只能声明判不了。
 * 零检出也不等于崩坏(背面/靴子特写是合理内容,已亲检)。
 */
export interface ChapterQcFaceSignalsV1 {
  /** yunet-face@cv2-5.0.0 之类,留审计 */
  model?: string;
  framesRead: number;
  framesWithFace: number;
  /** 检出到脸的采样帧占比;无采样帧时缺省 */
  coverage?: number;
  faceCount: number;
  readableFaceCount: number;
  /** 短边 ≥ 可辨线的脸占比;< FACE_READABLE_MIN_RATIO 时人脸维落 unverified */
  readableRatio?: number;
  minReadableFacePx: number;
  medianFaceShortSidePx?: number;
  maxFaceScore?: number;
  /** 相邻采样帧最大脸的表观距离(未标定,只记账) */
  driftDistanceP50?: number;
  driftDistanceP95?: number;
  driftPairs: number;
  /** 不可用时的一句话原因(silero 同款语义:缺证 ≠ 没问题) */
  reason?: string;
}

/**
 * 人工复核回写(1031 补 C 组缺口,1102 去重:本接口原样双声明过一次,
 * declaration merging 让它合法但读起来像两份口径)。
 * pass 的第二半不是「层都绿了」,而是「有人全速看过、有人耳听过」——
 * 所以两问必须分列勾选,且署名留痕;缺省(未提交)= 无证据,三态板记 unverified。
 * 重跑 QC 会重建报告,本字段随之清空:片子或口径变了,上一次签字不再算数。
 */
export interface ChapterQcHumanReviewV1 {
  /** 人眼全速看完全片(非抽帧、非倍速) */
  fullWatched: boolean;
  /** 人耳听完全轨 */
  audioListened: boolean;
  /** 复核人署名,留审计(不接受匿名放行) */
  reviewer: string;
  /** 复核时刻 */
  at: number;
  /** 复核人备注(看到的问题、听出的问题);IPC 侧截 500 字 */
  notes?: string;
}

export interface ChapterQcReportV1 {
  schemaVersion: typeof CHAPTER_QC_SCHEMA_VERSION;
  projectId: string;
  chapterId: string;
  outputPath: string;
  outputSha256?: string;
  createdAt: number;
  /** 成片时长(秒)与镜数,报告头快照 */
  durationS?: number;
  shotCount?: number;
  layers: Record<ChapterQcLayerId, ChapterQcLayerResultV1>;
  findings: ChapterQcFindingV1[];
  summary: { blockers: number; warns: number; infos: number };
  /** L4 消费:每镜代表帧(project-file URL)+镜描述(无帧/无描述的镜 runner 跳过) */
  shots?: Array<{ shotId: string; ordinal: number; frameUrl: string; description?: string }>;
  aesthetic?: ChapterQcAestheticResultV1;
  semantic?: ChapterQcSemanticResultV1;
  vision?: ChapterQcVisionResultV1;
  /** 三态需求板(由五层结果派生,任何层回写后整体重算;缺省=旧报告未带) */
  requirements?: ChapterQcRequirementV1[];
  /** L2 实测台账,供需求板区分「没越限」与「没测出来」 */
  scanSignals?: ChapterQcScanSignalsV1;
  /** 人脸可判读度台账(自动侧证据质量,不是内容判定) */
  faceSignals?: ChapterQcFaceSignalsV1;
  /** 人工复核回写(缺省=尚未复核;重跑 QC 即失效) */
  humanReview?: ChapterQcHumanReviewV1;
  /** 骨干②:逐镜期望断言集(分镜语义派生;缺省=无分镜数据,一切逐镜门只能缺证) */
  expectations?: ChapterQcExpectationSetV1;
  /** 骨干⓪:供给完整性自检(先证物料与口径,再谈结论) */
  supplyChecks?: ChapterQcSupplyCheckV1;
  /** 骨干③:参与本轮判定的信号基线(按 signalId 索引;缺该键=该信号未标定) */
  calibration?: {
    seriesId: string;
    baselines: ChapterQcSignalBaselineV1[];
    /** 标定 case 数(正/负例集规模;0=阈值全靠猜,相关行不许 pass) */
    caseCount: number;
  };
  /** 骨干③:加权维度分(三态不因此松动,releasable 仍看零 fail 零缺证) */
  dimensionScore?: ChapterQcDimensionScoreV1;
}

export function summarizeChapterQcFindings(findings: ChapterQcFindingV1[]): ChapterQcReportV1["summary"] {
  let blockers = 0;
  let warns = 0;
  let infos = 0;
  for (const finding of findings) {
    if (finding.severity === "blocker") blockers += 1;
    else if (finding.severity === "warn") warns += 1;
    else infos += 1;
  }
  return { blockers, warns, infos };
}
