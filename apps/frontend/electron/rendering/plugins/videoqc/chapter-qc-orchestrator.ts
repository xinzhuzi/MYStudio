/**
 * 章节成片 QC 编排器(08-19-chapter-video-qc parent 集成件)。
 *
 * L1 结构比对 → L2 ffmpeg 逐帧 → L3 DOVER 观感(skip-able)→ L4 语义(留 pending
 * 给渲染端)。fire-and-forget:任何一层失败只进报告,不向调用方(渲染队列)抛错。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { readStudioWorkflowStore } from "../../../storage/studio-workflow-store-io";
import { createProjectFileUrl } from "../../../storage/storage-paths";
import { readLatestVideoWorkflowChapterArtifacts } from "../video-workflow/video-workflow-artifact-store";
import type { VideoUseEdlEntryV1, VideoUseSubtitleCueV1 } from "../../contracts/video-workflow";
import type { VideoQcRuntimeController } from "./dover-runtime-controller";
import { extractShotKeyframes } from "./chapter-qc-fftools";
import { describeFrameChoices, pickShotFrameTimes } from "./chapter-qc-frame-select";
import { runFfmpegScanLayer } from "./chapter-qc-ffmpeg-scan";
import { buildFaceFindings, runChapterQcFace, runChapterQcFaceCrops, summarizeFaceCrops } from "./chapter-qc-face";
import { readChapterQcReport, writeChapterQcReport, chapterQcReportDir } from "./chapter-qc-report-store";
import {
  appendCalibrationSamples,
  deriveSignalBaselines,
  readCalibrationStore,
  scoreCalibrationSet,
  writeCalibrationStore,
  type ChapterQcSignalSampleV1,
} from "./chapter-qc-calibration";
import { assertionCoverage, buildShotExpectations, type ChapterQcExpectationShotInput } from "./chapter-qc-expectations";
import { buildSupplyFindings, runSupplyCheck } from "./chapter-qc-supply-check";
import { runStructuralLayer } from "./chapter-qc-structural";
import { buildShotSpans, buildShotSpansFromRenderPlan, type ChapterQcRenderPlanSpans } from "./chapter-qc-timeline";
import { buildVisionDecisions, registerFaceCropFrames, runVisionLayer } from "./chapter-qc-vision";
import { resolveVadPythonExecutable, runChapterQcVad } from "./chapter-qc-vad";
import { applyChapterQcRequirements } from "./chapter-qc-verdicts";
import type { ChapterQcFaceCropV1, ChapterQcFaceSignalsV1, ChapterQcScanSignalsV1, ChapterQcVisionResultV1 } from "./chapter-qc-types";
import type { FrameMetricPoint } from "./parse-ffmpeg-probe";
import {
  CHAPTER_QC_SCHEMA_VERSION,
  summarizeChapterQcFindings,
  type ChapterQcFindingV1,
  type ChapterQcLayerResultV1,
  type ChapterQcReportV1,
} from "./chapter-qc-types";

export interface ChapterQcOrchestratorDeps {
  /** remotion 工作区根:<projectRoot>/remotion */
  remotionWorkspaceRootForProject: (projectId: string) => string;
  /** video-use 工件根:<projectRoot>/video-use */
  videoUseWorkspaceRootForProject: (projectId: string) => string;
  /** 项目数据根(getDataDir()),readStudioWorkflowStore 用 */
  dataRoot: string;
  /** L3 控制器;缺省=观感层 skipped-no-controller */
  videoQc?: Pick<VideoQcRuntimeController, "runVideoQcScore" | "readBaselines" | "status">;
  /**
   * QC 侧车 Python 运行时(Silero VAD + YuNet 人脸共用同一支托管 Python 与同一个 apps/backend 根)。
   * 缺省=不跑 VAD 也不跑人脸:语音挤压/音画同步退回 silencedetect 补集、人脸维落 unverified,
   * 并在 notes 里写明退化原因。
   */
  vadRuntime?: { storageBasePath: () => string; backendRoot: string };
  now?: () => number;
}

export interface ChapterQcRunInput {
  projectId: string;
  chapterId: string;
  /** 成片绝对路径;缺省按 slot 约定 outputs/chapters/{chapterId}/current.mp4 */
  outputPath?: string;
}

interface StoryboardLike {
  episodeId?: string;
  duration?: number;
  durationTarget?: number;
  ttsSpokenText?: string;
  shotAudioBindings?: Array<{ role?: string; sourceDurationUs?: number }>;
  /** 骨干②:逐镜期望断言读的四组声明字段(全部可选——旧 store 缺列即 unknown,不冒充 pass) */
  shotSemantics?: {
    personFree?: boolean;
    shotSize?: string;
    cameraMove?: string;
    actionIn?: string;
    actionOut?: string;
    visibleCharacters?: Array<{ name?: string }>;
  };
  continuityState?: {
    actionIn?: string;
    actionOut?: string;
    dialogueText?: string;
  };
  shotFx?: { motion?: string };
  state?: string;
  stale?: boolean;
  orderedReferenceManifest?: Array<{ missing?: boolean }>;
}

interface AgentWorkLike {
  key?: string;
  episodeId?: string;
  data?: unknown;
  updatedAt?: number;
}

function sha256File(filePath: string): string {
  const digest = createHash("sha256");
  const file = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(file, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(file);
  }
  return digest.digest("hex");
}

function latestScriptDraft(agentWork: unknown, chapterId: string): string | undefined {
  if (!Array.isArray(agentWork)) return undefined;
  const entries = agentWork
    .filter((entry): entry is AgentWorkLike =>
      typeof entry === "object" && entry !== null && entry.key === "scriptDraft")
    .filter((entry) => typeof entry.data === "string" && (entry.data as string).trim().length > 0)
    // scriptDraft 优先本章,退而取最新(章节级工作数据缺省时兜底)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const chapterScoped = entries.find((entry) => entry.episodeId === chapterId);
  const chosen = chapterScoped ?? entries[0];
  return typeof chosen?.data === "string" ? chosen.data : undefined;
}

/** 分镜条目 → 逐镜期望断言入参(骨干②):只搬「声明」,成片侧一律不看。 */
function toExpectationShot(
  shotId: string,
  ordinal: number,
  item: StoryboardLike,
): ChapterQcExpectationShotInput {
  const semantics = item.shotSemantics;
  const continuity = item.continuityState;
  const cameraMove = semantics?.cameraMove?.trim() ?? "";
  const actionIn = semantics?.actionIn?.trim() ?? continuity?.actionIn?.trim() ?? "";
  const actionOut = semantics?.actionOut?.trim() ?? continuity?.actionOut?.trim() ?? "";
  const shotSize = semantics?.shotSize?.trim() ?? "";
  const dialogueText = continuity?.dialogueText?.trim() ?? "";
  const ttsSpokenText = item.ttsSpokenText?.trim() ?? "";
  const visibleCharacters = semantics?.visibleCharacters;
  const duration = Number.isFinite(item.duration ?? Number.NaN) ? (item.duration as number) : 0;
  const durationTarget = Number(item.durationTarget ?? 0);
  return {
    shotId,
    ordinal,
    durationS: duration,
    ...(durationTarget > 0 ? { durationTargetS: durationTarget } : {}),
    ...(cameraMove ? { cameraMove } : {}),
    ...(actionIn ? { actionIn } : {}),
    ...(actionOut ? { actionOut } : {}),
    ...(typeof semantics?.personFree === "boolean" ? { personFree: semantics.personFree } : {}),
    ...(shotSize ? { shotSize } : {}),
    ...(Array.isArray(visibleCharacters) ? { visibleCharacterCount: visibleCharacters.length } : {}),
    ...(item.shotFx?.motion ? { shotFxMotion: item.shotFx.motion } : {}),
    ...(dialogueText ? { dialogueText } : {}),
    ...(ttsSpokenText ? { ttsSpokenText } : {}),
    ...(item.shotAudioBindings?.some((binding) => binding.role === "voice") ? { hasVoiceBinding: true } : {}),
  };
}

/** 观感层基线告警:偏离 mean - max(2σ, 0.05) 报 warn;无基线只记录。 */
function evaluateAestheticAgainstBaseline(
  controller: ChapterQcOrchestratorDeps["videoQc"],
  seriesId: string,
  fused: number,
): { baseline?: NonNullable<ChapterQcReportV1["aesthetic"]>["baseline"]; finding?: ChapterQcFindingV1 } {
  const baselines = controller?.readBaselines() ?? {};
  const baseline = baselines[seriesId] ?? baselines["default"];
  if (!baseline || baseline.sampleCount < 2) return {};
  const threshold = baseline.meanFused - Math.max(2 * baseline.sigma, 0.05);
  if (fused < threshold) {
    return {
      baseline,
      finding: {
        code: "chapter-qc.aesthetic.below-baseline",
        layer: "aesthetic",
        severity: "warn",
        message: `观感总分 ${fused.toFixed(3)} 低于系列基线 ${baseline.meanFused.toFixed(3)}(阈值 ${threshold.toFixed(3)})`,
        evidence: { fused, meanFused: baseline.meanFused, sigma: baseline.sigma, seriesId: baseline.seriesId },
      },
    };
  }
  return { baseline };
}

function finiteValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * 本轮实测信号 → 标定样本(骨干③攒基线的数据源)。
 * 只搬「这一轮真测出来的数」:测不到就不写,写进去的必须是实测,不许拿默认值凑。
 * `speech.coverageRatio` 用分镜声明做分母——没有「该说几镜」的锚,语音秒数本身不成信号。
 */
export function collectCalibrationSamples(input: {
  chapterId: string;
  at: number;
  findings: readonly ChapterQcFindingV1[];
  scanSignals?: ChapterQcScanSignalsV1;
  aesthetic?: ChapterQcReportV1["aesthetic"];
  faceSignals?: ChapterQcFaceSignalsV1;
  speechDeclaredShots: number;
}): ChapterQcSignalSampleV1[] {
  const out: ChapterQcSignalSampleV1[] = [];
  const push = (signalId: ChapterQcSignalSampleV1["signalId"], value: number | undefined): void => {
    if (value !== undefined && Number.isFinite(value)) out.push({ signalId, value, chapterId: input.chapterId, at: input.at });
  };
  const motionSummary = input.findings.find((finding) => finding.code === "chapter-qc.motion.summary")?.evidence;
  push("motion.tiMean", finiteValue(motionSummary?.tiMean));
  push("motion.staticFrameRatio", finiteValue(motionSummary?.staticFrameRatio));
  push("visual.blurMean", finiteValue(motionSummary?.blurMean) ?? input.scanSignals?.blurMean);
  push("aesthetic.fused", input.aesthetic?.fused);
  push("face.readableRatio", input.faceSignals?.readableRatio);
  // 逐镜口径单独一条带:全片静止占比天然远低于离群镜,拿它画出来的带去判单镜会成片误杀。
  const shotRatios = (input.scanSignals?.shotMotion ?? [])
    .map((row) => row.staticFrameRatio)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (shotRatios.length > 0) push("shot.motion.staticFrameRatio", Math.max(...shotRatios));
  const shotSpeech = input.scanSignals?.shotSpeech ?? [];
  // 语音两条信号只在 VAD 真接上时入库:silencedetect 补集在带 BGM 的片子里把整片当语音,
  // 那种数进库会把本系列的带整体抬高——宁缺勿混。
  const vadEvidenced = input.scanSignals?.speechSource === "silero-vad";
  if (vadEvidenced && input.speechDeclaredShots > 0 && shotSpeech.length > 0) {
    const covered = shotSpeech.filter((row) => row.speechSeconds > 0).length;
    push("speech.coverageRatio", Number((covered / input.speechDeclaredShots).toFixed(6)));
    const seconds = shotSpeech.reduce((sum, row) => sum + row.speechSeconds, 0);
    push("speech.secondsPerDeclaredShot", Number((seconds / input.speechDeclaredShots).toFixed(6)));
  }
  return out;
}

export async function runChapterQc(
  deps: ChapterQcOrchestratorDeps,
  input: ChapterQcRunInput,
): Promise<ChapterQcReportV1 | null> {
  const now = deps.now ?? Date.now;
  const workspaceRoot = deps.remotionWorkspaceRootForProject(input.projectId);
  const outputPath =
    input.outputPath ?? path.join(workspaceRoot, "outputs", "chapters", input.chapterId, "current.mp4");
  if (!fs.existsSync(outputPath)) return null;

  const layers: Record<string, ChapterQcLayerResultV1> = {
    structural: { status: "running", startedAt: now() },
    ffmpegScan: { status: "pending" },
    aesthetic: { status: "pending" },
    semantic: { status: "pending" },
    vision: { status: "pending" },
  };
  const findings: ChapterQcFindingV1[] = [];
  const notes: string[] = [];

  // ---- 上下文组装 ----
  let edl: VideoUseEdlEntryV1[] = [];
  let cues: VideoUseSubtitleCueV1[] = [];
  try {
    const artifacts = await readLatestVideoWorkflowChapterArtifacts(
      deps.videoUseWorkspaceRootForProject,
      { projectId: input.projectId, chapterId: input.chapterId },
    );
    if (artifacts.success && artifacts.value?.artifacts.videoUseArtifact) {
      edl = artifacts.value.artifacts.videoUseArtifact.edl ?? [];
      cues = artifacts.value.artifacts.videoUseArtifact.subtitles ?? [];
    } else if (!artifacts.success) {
      notes.push("video-use 工件读取失败");
    }
  } catch (error) {
    notes.push(`video-use 工件读取异常: ${error instanceof Error ? error.message : String(error)}`);
  }

  let plannedVoiceDurationUs: number | undefined;
  let scriptText: string | undefined;
  const descriptionByShotId = new Map<string, string>();
  /** 本章分镜条目原样(骨干②③的声明侧:期望断言 + 供给自检都吃它,不含成片信息) */
  const chapterShots: Array<{ shotId: string; item: StoryboardLike }> = [];
  try {
    const store = readStudioWorkflowStore(deps.dataRoot, input.projectId);
    if (store) {
      const storyboards = Array.isArray(store.state.storyboards)
        ? (store.state.storyboards as Array<StoryboardLike & { id?: string; videoDesc?: string; prompt?: string }>)
        : [];
      const chapterStoryboards = storyboards.filter((item) => item.episodeId === input.chapterId);
      plannedVoiceDurationUs = chapterStoryboards.reduce(
        (sum, item) =>
          sum + (item.shotAudioBindings ?? [])
            .filter((binding) => binding.role === "voice")
            .reduce((inner, binding) => inner + (binding.sourceDurationUs ?? 0), 0),
        0,
      );
      for (const item of chapterStoryboards) {
        if (typeof item.id === "string") {
          const description = item.videoDesc?.trim() || item.prompt?.trim() || item.ttsSpokenText?.trim();
          if (description) descriptionByShotId.set(item.id, description);
          chapterShots.push({ shotId: item.id, item });
        }
      }
      scriptText = latestScriptDraft(store.state.agentWorkData, input.chapterId);
    } else {
      notes.push("no-workflow-store");
    }
  } catch (error) {
    notes.push(`workflow store 读取异常: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ---- 镜区间:render-plan(压缩时间轴权威)优先,artifact EDL 兜底 ----
  // artifact timelineStartS 是未压缩口径(2026-08-22 审计:43 镜 174.9s vs
  // 成片 145.1s,尾段漂移 ~30s),只在没有渲染计划时退回并留痕。
  let renderPlanSpans: ChapterQcRenderPlanSpans | null = null;
  try {
    const planPath = path.join(workspaceRoot, "jobs", "chapter", input.chapterId, "current-render-plan.json");
    if (fs.existsSync(planPath)) {
      renderPlanSpans = buildShotSpansFromRenderPlan(JSON.parse(fs.readFileSync(planPath, "utf8")));
      if (!renderPlanSpans) notes.push("render-plan 形状不完整,镜区间退回 artifact EDL 口径");
    } else {
      notes.push("render-plan 缺失,镜区间退回 artifact EDL 口径(未压缩,镜归因可能漂移)");
    }
  } catch (error) {
    notes.push(`render-plan 读取异常: ${error instanceof Error ? error.message : String(error)}`);
  }
  const spans = renderPlanSpans ? renderPlanSpans.spans : buildShotSpans(edl);

  // ---- 逐镜期望断言(骨干②):分镜声明 → 成片必须满足什么 ----
  // 镜号取自时间轴(与 L2 台账、finding 的 shotOrdinal 同一套编号),
  // 时间轴里没有的镜(未出片/被裁)顺延到成片最大镜号之后:拿分镜序号顶替会和真镜撞号,
  // 板上「第 N 镜越带」就会指到另一支镜上。
  const ordinalByShotId = new Map(spans.map((span) => [span.shotId, span.ordinal]));
  let nextOffTimelineOrdinal = Math.max(0, ...spans.map((span) => span.ordinal)) + 1;
  const expectations = buildShotExpectations(
    chapterShots.map((row) =>
      toExpectationShot(row.shotId, ordinalByShotId.get(row.shotId) ?? nextOffTimelineOrdinal++, row.item),
    ),
  );

  // ---- L1 结构比对 ----
  let probeDurationS: number | undefined;
  let probeFps: number | undefined;
  try {
    const structural = await runStructuralLayer({
      videoPath: outputPath,
      spans,
      cues,
      scriptText,
      plannedVoiceDurationUs,
    });
    findings.push(...structural.findings);
    notes.push(...structural.notes);
    probeDurationS = structural.probe?.durationS;
    probeFps = structural.probe?.fps;
    layers.structural = { status: structural.findings.some((f) => f.severity === "blocker") ? "failed" : "passed", finishedAt: now() };
  } catch (error) {
    layers.structural = { status: "failed", reason: error instanceof Error ? error.message : String(error), finishedAt: now() };
  }

  const structuralBlocked = layers.structural.status === "failed";

  // ---- L2 ffmpeg 逐帧 ----
  let scanFramePoints: FrameMetricPoint[] = [];
  let scanSignals: ChapterQcScanSignalsV1 | undefined;
  let faceSignals: ChapterQcFaceSignalsV1 | undefined;
  let vadAvailable = false;
  let faceAvailable = false;
  if (structuralBlocked) {
    layers.ffmpegScan = { status: "skipped", reason: "structural blocker 短路" };
  } else {
    // 语音段先取 VAD(带 BGM 成片里 silencedetect 看不见语音间隙,L2 的挤压/同步子项会静默退化)
    let vadSpeech: { segments: Array<{ startS: number; endS: number }>; model?: string } | undefined;
    let vadReason: string | undefined;
    if (!deps.vadRuntime) {
      vadReason = "未配置 vadRuntime";
    } else {
      const vad = await runChapterQcVad({
        videoPath: outputPath,
        pythonExecutable: resolveVadPythonExecutable(deps.vadRuntime.storageBasePath()),
        backendRoot: deps.vadRuntime.backendRoot,
      });
      if (vad.available) {
        vadAvailable = true;
        vadSpeech = { segments: vad.segments, ...(vad.model ? { model: vad.model } : {}) };
      } else {
        vadReason = vad.reason ?? "VAD 不可用";
      }

      // 人脸可判读度(1102 吸收件①):同一支托管 Python,另一条 sidecar。
      // 它只回答「自动检出的脸够不够大、能不能拿来判五官」,不回答「脸好不好看」。
      const face = await runChapterQcFace({
        videoPath: outputPath,
        pythonExecutable: resolveVadPythonExecutable(deps.vadRuntime.storageBasePath()),
        backendRoot: deps.vadRuntime.backendRoot,
      });
      if (face.available && face.signals) {
        faceAvailable = true;
        faceSignals = face.signals;
        findings.push(...buildFaceFindings(face.signals));
      } else {
        notes.push(`人脸可判读度无证据: ${face.reason ?? "未知"}`);
      }
    }
    try {
      const scan = await runFfmpegScanLayer({
        videoPath: outputPath,
        spans,
        durationS: probeDurationS,
        fps: probeFps,
        plannedVoiceS: plannedVoiceDurationUs ? plannedVoiceDurationUs / 1e6 : undefined,
        cues,
        ...(vadSpeech ? { vadSpeech } : {}),
        ...(vadReason ? { vadReason } : {}),
      });
      findings.push(...scan.findings);
      notes.push(...scan.notes);
      scanFramePoints = scan.framePoints;
      scanSignals = scan.raw;
      layers.ffmpegScan = { status: "passed", finishedAt: now() };
    } catch (error) {
      layers.ffmpegScan = { status: "failed", reason: error instanceof Error ? error.message : String(error), finishedAt: now() };
    }
  }

  // ---- 代表帧提取(L4 消费;L1 过了才抽,省 CPU)----
  // 择帧吃 L2 同一趟的逐帧 blur/YAVG(清晰度优先、剔近黑过曝),挑不成的镜回退中点并留痕。
  let extractedFrames: Array<{ shotId: string; ordinal: number; framePath: string }> = [];
  if (!structuralBlocked && spans.length > 0) {
    const framesDir = path.join(chapterQcReportDir(workspaceRoot, input.chapterId), "frames");
    const choices = pickShotFrameTimes(spans, scanFramePoints);
    const stats = describeFrameChoices(choices);
    if (scanFramePoints.length === 0) {
      notes.push("代表帧全部走镜中点(L2 逐帧统计无采样点,未做清晰度择帧)");
    } else {
      notes.push(
        `代表帧按清晰度择帧 ${stats.picked}/${stats.total} 镜(出曝光窗剔 ${stats.rejected} 帧候选,中点兜底 ${stats.fallback} 镜)`,
      );
    }
    try {
      const extraction = await extractShotKeyframes({
        videoPath: outputPath,
        spans,
        outDir: framesDir,
        preferredTimesByShotId: new Map(
          [...choices.values()].map((choice) => [choice.shotId, choice.tS] as const),
        ),
      });
      extractedFrames = extraction.frames;
      if (extraction.errors.length > 0) {
        notes.push(`代表帧提取失败 ${extraction.errors.length}/${spans.length} 镜`);
      }
    } catch (error) {
      notes.push(`代表帧提取异常: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ---- L3 DOVER 观感 ----
  let aesthetic: ChapterQcReportV1["aesthetic"];
  // 模型就绪与否是配置事实,与本片跑不跑得动无关:供给自检在短路路径上也要拿得到真话。
  const aestheticModelReady = deps.videoQc?.status().modelReady ?? false;
  if (structuralBlocked) {
    layers.aesthetic = { status: "skipped", reason: "structural blocker 短路" };
  } else if (!deps.videoQc) {
    layers.aesthetic = { status: "skipped", reason: "skipped-no-controller" };
  } else {
    const controllerStatus = deps.videoQc.status();
    if (!controllerStatus.modelReady) {
      layers.aesthetic = {
        status: "skipped",
        reason: controllerStatus.modelCode === "arch-unavailable" ? "skipped-arch-unavailable" : "skipped-model-missing",
      };
      notes.push(`观感层跳过: ${controllerStatus.modelMessage ?? controllerStatus.modelCode ?? "模型未就绪"}`);
    } else {
      try {
        const outcome = await deps.videoQc.runVideoQcScore({
          projectId: input.projectId,
          chapterId: input.chapterId,
          videoPath: outputPath,
          mode: "whole",
        });
        if (outcome.status === "accepted" && outcome.mode === "whole") {
          // seriesId v1 用 projectId(系列级基线的数据源在设置页录入,此处先项目级)
          const evaluation = evaluateAestheticAgainstBaseline(deps.videoQc, input.projectId, outcome.overall.fused);
          aesthetic = { ...outcome.overall, ...(evaluation.baseline ? { baseline: evaluation.baseline } : {}), elapsedMs: outcome.elapsedMs };
          if (evaluation.finding) findings.push(evaluation.finding);
          // 整片低于基线 → 按镜切片粗到细定位
          if (evaluation.finding && spans.length > 0) {
            const sliceOutcome = await deps.videoQc.runVideoQcScore({
              projectId: input.projectId,
              chapterId: input.chapterId,
              videoPath: outputPath,
              mode: "slices",
              slices: spans.map((span) => ({ shotId: span.shotId, startS: span.startS, durationS: span.durationS })),
            });
            if (sliceOutcome.status === "accepted" && sliceOutcome.slices) {
              aesthetic.slices = sliceOutcome.slices.map((slice) => {
                const span = spans.find((candidate) => candidate.shotId === slice.shotId);
                return { shotId: slice.shotId, ordinal: span?.ordinal ?? 0, fused: slice.fused };
              });
              for (const slice of aesthetic.slices) {
                if (slice.fused < (evaluation.baseline?.meanFused ?? 1) * 0.8) {
                  findings.push({
                    code: "chapter-qc.aesthetic.shot-below-baseline",
                    layer: "aesthetic",
                    severity: "warn",
                    shotId: slice.shotId,
                    shotOrdinal: slice.ordinal,
                    message: `第 ${slice.ordinal} 镜观感分 ${slice.fused.toFixed(3)} 显著低于基线`,
                    evidence: { fused: slice.fused },
                  });
                }
              }
            }
          }
          layers.aesthetic = { status: "passed", finishedAt: now() };
        } else if (outcome.status === "blocked") {
          layers.aesthetic = { status: "failed", reason: `${outcome.code}: ${outcome.message}`, finishedAt: now() };
        } else {
          // slices artifact 意外混入 whole 调用:视为无效产物而非崩溃
          layers.aesthetic = { status: "failed", reason: "invalid-artifact: slices outcome on whole request", finishedAt: now() };
        }
      } catch (error) {
        layers.aesthetic = { status: "failed", reason: error instanceof Error ? error.message : String(error), finishedAt: now() };
      }
    }
  }

  // ---- L5 视觉审计:密度闸(确定性)+ 帧物料(模型侧 runner 消费) ----
  let vision: ChapterQcVisionResultV1 | undefined;
  if (structuralBlocked) {
    layers.vision = { status: "skipped", reason: "structural blocker 短路" };
  } else if (!renderPlanSpans) {
    layers.vision = { status: "skipped", reason: "skipped-no-render-plan" };
  } else {
    try {
      const outcome = await runVisionLayer({
        projectId: input.projectId,
        chapterId: input.chapterId,
        videoPath: outputPath,
        spans: renderPlanSpans.spans,
        transitions: renderPlanSpans.transitions,
        visualClipIds: renderPlanSpans.visualClipIds,
        reportDir: chapterQcReportDir(workspaceRoot, input.chapterId),
      });
      findings.push(...outcome.findings);
      const frames = [...outcome.frames];
      const decisions = buildVisionDecisions({
        spans: renderPlanSpans.spans,
        visualClipIds: renderPlanSpans.visualClipIds,
        descriptionsByShotId: descriptionByShotId,
        transitions: renderPlanSpans.transitions,
        effects: renderPlanSpans.effects,
      });
      // 人脸裁片(1107 吸收件②):探针整帧限宽 1280 后,1080P 成片的脸只剩 ~47px(1102 标定原生中位 71px),
      // 预审模型对五官回「看不清就不判」。这里按镜中点时刻出原始分辨率头部裁片,以 kind="face" 的帧物料
      // 一起交给 L5——每条裁片恰好一次调用,预审覆盖式 frames + decisions - 1 仍然成立。
      let faceCrops: ChapterQcFaceCropV1[] | undefined;
      let faceCropReason: string | undefined;
      if (!deps.vadRuntime) {
        notes.push("人脸裁片未尝试:未配置 vadRuntime(托管 Python 缺位)");
      } else if (!faceAvailable) {
        notes.push("人脸裁片未尝试:可判读度侧车本轮未出数");
      } else {
        const midFrames = frames.filter((frame) => frame.kind === "mid");
        const cropRun = await runChapterQcFaceCrops({
          videoPath: outputPath,
          pythonExecutable: resolveVadPythonExecutable(deps.vadRuntime.storageBasePath()),
          backendRoot: deps.vadRuntime.backendRoot,
          timestamps: midFrames.map((frame) => frame.tS),
          cropsDir: path.join(chapterQcReportDir(workspaceRoot, input.chapterId), "vision-frames"),
        });
        faceCrops = cropRun.crops;
        frames.push(...registerFaceCropFrames(midFrames, cropRun, {
          projectId: input.projectId,
          chapterId: input.chapterId,
        }));
        const counts = summarizeFaceCrops(cropRun.crops);
        if (!cropRun.available) {
          faceCropReason = cropRun.reason ?? "人脸裁片无台账";
        }
        // 不采信的批次不出「裁片 N/N 镜」:那串数字看着像覆盖率,实际只是 worker 回了什么——
        // 头部特写一张都没进预审(见 registerFaceCropFrames),报了就是缺证藏进统计。
        if (cropRun.available && cropRun.crops.length > 0) {
          findings.push({
            code: "chapter-qc.face.crop",
            layer: "vision",
            severity: "info",
            message: `人脸裁片 ${counts.produced}/${midFrames.length} 镜(本镜无脸 ${counts.noFace} 镜,裁片失败 ${counts.gaps} 镜):`
              + "头部特写交预审判五官;裁片不新增细节,只是让脸占满输入视野",
            evidence: { ...counts, requested: midFrames.length },
          });
        }
        if (counts.gaps > 0 || !cropRun.available) {
          // 镜号也靠 index 认领:批次不采信时连「哪几镜缺」都点不准,只报整批原因。
          const gapOrdinals = cropRun.available
            ? [...new Set(cropRun.crops
              .filter((crop) => crop.status === "read-failed" || crop.status === "write-failed")
              .map((crop) => midFrames[crop.index]?.ordinal)
              .filter((ordinal): ordinal is number => ordinal !== undefined))].sort((left, right) => left - right)
            : [];
          findings.push({
            code: "chapter-qc.face.crop-gap",
            layer: "vision",
            severity: "warn",
            ...(gapOrdinals.length > 0 ? { shotOrdinal: gapOrdinals[0] } : {}),
            message: gapOrdinals.length > 0
              ? `第 ${gapOrdinals.join("、")} 镜人脸裁片没出成(读帧/写盘失败),这几镜的五官特写无证据`
              : `人脸裁片整批不采信:${faceCropReason ?? "未知"}——头部特写一张都没进预审,五官维只有整帧探针`,
            evidence: { ...counts, requested: midFrames.length, gapOrdinals },
          });
        }
      }
      vision = {
        frameCount: frames.length,
        frames,
        decisions,
        densityChecked: outcome.densityChecked,
        frameErrors: outcome.frameErrors,
        ...(faceCrops ? { faceCrops } : {}),
        ...(faceCropReason ? { faceCropReason } : {}),
      };
      if (outcome.frameErrors > 0) notes.push(`视觉审计帧提取失败 ${outcome.frameErrors} 帧(已跳过)`);
      layers.vision = { status: "passed", finishedAt: now() };
    } catch (error) {
      layers.vision = { status: "failed", reason: error instanceof Error ? error.message : String(error), finishedAt: now() };
    }
  }

  // ---- 骨干⓪:供给完整性自检(先证物料与口径,再谈结论)----
  // 侧车两条只在真跑过的那一轮报实测;短路轮显式记「未实探」——配置在场不是这一趟跑通的证据。
  const speechDeclaredShots = assertionCoverage(expectations, "speech").expected;
  const supplyChecks = runSupplyCheck({
    mediaReadable: (probeDurationS ?? 0) > 0,
    ...(probeDurationS !== undefined ? { durationS: probeDurationS } : {}),
    ...(probeFps !== undefined ? { fps: probeFps } : {}),
    spanCount: spans.length,
    declaredShotCount: chapterShots.length,
    timelineSource: renderPlanSpans ? "render-plan" : spans.length > 0 ? "edl" : "none",
    expectationShotCount: expectations.shots.length,
    speechDeclaredShots,
    subtitleCueCount: cues.length,
    scriptPresent: scriptText !== undefined,
    extractedFrameCount: extractedFrames.length,
    vadAvailable,
    faceAvailable,
    sidecarsEvidenced: !structuralBlocked,
    aestheticModelReady,
    unreadyShotCount: chapterShots.filter(({ item }) => item.state !== "ready" || item.stale === true).length,
    missingReferenceCount: chapterShots.reduce(
      (sum, { item }) => sum + (item.orderedReferenceManifest ?? []).filter((ref) => ref.missing === true).length,
      0,
    ),
  });
  findings.push(...buildSupplyFindings(supplyChecks));

  // ---- 骨干③:系列标定库(攒样本 → 画带 → 出加权分)----
  // seriesId 暂用 projectId(观感基线同口径);设置页的系列录入接上后一并换。
  const seriesId = input.projectId;
  let calibration: ChapterQcReportV1["calibration"];
  try {
    const store = readCalibrationStore(workspaceRoot, seriesId);
    const merged = appendCalibrationSamples(store, collectCalibrationSamples({
      chapterId: input.chapterId,
      at: now(),
      findings,
      ...(scanSignals ? { scanSignals } : {}),
      ...(aesthetic ? { aesthetic } : {}),
      ...(faceSignals ? { faceSignals } : {}),
      speechDeclaredShots,
    }));
    if (merged !== store) writeCalibrationStore(workspaceRoot, merged);
    // 画带剔掉本章自己的样本:n≤5 时任何成员离均值都不到 2σ,含自己的带永远罩得住自己。
    calibration = {
      seriesId,
      baselines: deriveSignalBaselines(merged, input.chapterId),
      caseCount: merged.cases.length,
      // 召回账吃的是打标当时记下的机器判定(库里那份),不是本轮这章的 verdict:
      // 本轮还没有金标可言,拿它算召回等于自己给自己打分。
      caseScores: scoreCalibrationSet(merged.cases, (item) => item.verdict),
    };
  } catch (error) {
    notes.push(`标定库读写异常(本轮按未标定处理): ${error instanceof Error ? error.message : String(error)}`);
  }

  // ---- 报告落盘 ----
  const summary = summarizeChapterQcFindings(findings);
  const report: ChapterQcReportV1 = {
    schemaVersion: CHAPTER_QC_SCHEMA_VERSION,
    projectId: input.projectId,
    chapterId: input.chapterId,
    outputPath,
    outputSha256: sha256File(outputPath),
    createdAt: now(),
    durationS: probeDurationS,
    shotCount: spans.length,
    layers: layers as ChapterQcReportV1["layers"],
    findings,
    summary,
    ...(notes.length > 0 ? { notes } : {}),
    ...(extractedFrames.length > 0
      ? {
          shots: extractedFrames.map((frame) => ({
            shotId: frame.shotId,
            ordinal: frame.ordinal,
            frameUrl: createProjectFileUrl(input.projectId, `remotion/qc/chapters/${input.chapterId}/frames/${path.basename(frame.framePath)}`),
            ...(descriptionByShotId.get(frame.shotId) ? { description: descriptionByShotId.get(frame.shotId) } : {}),
          })),
        }
      : {}),
    ...(aesthetic ? { aesthetic } : {}),
    ...(vision ? { vision } : {}),
    ...(scanSignals ? { scanSignals } : {}),
    ...(faceSignals ? { faceSignals } : {}),
    expectations,
    supplyChecks,
    ...(calibration ? { calibration } : {}),
  };
  applyChapterQcRequirements(report);
  await writeChapterQcReport(workspaceRoot, input.chapterId, report);
  return report;
}

export async function readReport(
  deps: Pick<ChapterQcOrchestratorDeps, "remotionWorkspaceRootForProject">,
  identity: { projectId: string; chapterId: string },
): Promise<ChapterQcReportV1 | null> {
  return readChapterQcReport(deps.remotionWorkspaceRootForProject(identity.projectId), identity.chapterId);
}
