import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildMediaUrlMap } from "@rendering/plugins/remotion/media-bridge/media-bridge-source-map";
import {
  BUNDLED_REMOTION_COMPOSITION_IDS,
  LEGACY_TIMELINE_COMPATIBILITY_COMPOSITION_ID,
  STORYBOARD_SHOT_COMPOSITION_ID,
} from "@rendering/plugins/remotion/composition/composition-id";
import {
  validateStoryboardShotCompositionProps,
} from "@rendering/plugins/remotion/composition/composition-props-validation";
import type { StoryboardShotCompositionProps } from "@rendering/plugins/remotion/composition/composition-props";
import {
  createRemotionEnsureBrowserAdapters,
  type RemotionEnsureBrowser,
} from "@rendering/plugins/remotion/browser/remotion-browser-worker-service";
import {
  assertRenderedMediaEvidence,
  hashFileSha256,
  measureRenderedMediaLoudness,
  probeRenderedMedia,
} from "./render-smoke-evidence";
import {
  deriveStorageRoots,
  readStudioWorkflowStoreState,
  resolveProjectDir,
  resolveRemotionRuntimeDir,
  resolveTimelineSourcePath,
} from "../timeline/storage-paths";

const appsRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const remotionVersion = "4.0.499";
const projectRoot = resolveProjectDir();
const projectStorageRoots = deriveStorageRoots(projectRoot);
const projectId = projectStorageRoots.projectId;
const chapterId = "chapter-001";
const shotId = "sb-chapter-001-001";
const shotIndex = 1;
const durationTarget = 4.2;
const fps = 30;
const width = 1920;
const height = 1080;
const runtimeDir = resolveRemotionRuntimeDir();
const sourceStorePath = path.join(projectRoot, "studio-workflow-store.json");
const scriptPath = path.join(projectRoot, "script.json");
const imagePath = path.join(projectRoot, "exports/chapter-001/storyboard-frames/shot-001.png");
const audioPath = path.join(projectRoot, "exports/chapter-001/voice-audio/shot-001.wav");
const bundlePath = path.join(appsRoot, ".cache", "remotion-bundle");
const outputRoot = path.join(appsRoot, "output", "automation", "remotion-chapter001-shot001");
const outputPath = path.join(outputRoot, "output.mp4");
const sourceSnapshotPath = path.join(outputRoot, "source-snapshot.json");
const ffprobePath = path.join(outputRoot, "ffprobe.json");
const loudnessLogPath = path.join(outputRoot, "loudness-measurement.log");
const loudnessReportPath = path.join(outputRoot, "loudness-measurement.json");
const reportPath = path.join(outputRoot, "report.json");
const cleanOutputRoot = path.join(appsRoot, "output", "automation", "remotion-chapter001-shot001-clean-preview");
const a08Root = path.join(appsRoot, "output", "automation", "chapter001-v2-pilot-shot001-20260721-a08");
const a08ReportPath = path.join(a08Root, "report.json");
const a08HumanApprovalsPath = path.join(a08Root, "human-approvals.json");
const a08ImagePath = path.join(a08Root, "shot-001.png");
const a08ImageSha256 = "9e90eb74e24fcd1ba10d0c6c6ff67c6ba6529ffc8cfa87f5c2913519ae3d2839";
const approvedProductionImagePath = path.join(
  projectRoot,
  "workflow-images/storyboards/chapter-001/approved-revisions/shot-001-9e90eb74e24f.png",
);
// 存量 a08 台账为 legacy 风格契约 v2;契约本体已升级 v3(MA ma-gongbi-v1 对齐),两者均为有效渲染来源。
const acceptedStyleContractVersions = new Set(["daojie-gongbi-v2", "daojie-gongbi-v3"]);
const isAcceptedStyleContractVersion = (value: string) => acceptedStyleContractVersions.has(value);
const freshnessClockToleranceMs = 5;

export type FirstShotSourceMode = "composite" | "a08-clean-candidate";
export type FirstShotReplayMode = "none" | "approved-production";

export interface FirstShotSourceLoadOptions {
  replay?: FirstShotReplayMode;
}

export interface FirstShotOutputPaths {
  outputRoot: string;
  outputPath: string;
  sourceSnapshotPath: string;
  ffprobePath: string;
  loudnessLogPath: string;
  loudnessReportPath: string;
  reportPath: string;
}

export interface A08CleanCandidateIdentity {
  reportPath: string;
  imagePath: string;
  imageSha256: string;
  status: "awaiting-human-approval" | "completed";
  mutatedProductionProject: false;
  styleContractVersion: "daojie-gongbi-v2" | "daojie-gongbi-v3";
  assetVersionsApproved: true;
  colorAuditStatus: "pass";
  promptAuditStatus: "pass";
  promptAuditViolations: [];
  humanApproval?: {
    path: string;
    status: "approved";
    reviewer: "human";
    outputPath: string;
    outputSha256: string;
    approvalFingerprint: string;
    reviewChecklist: Record<string, true>;
  };
}

export interface A08CleanCandidateProvenance extends A08CleanCandidateIdentity {
  reportSha256: string;
  reportMtimeMs: number;
  imageMtimeMs: number;
}

export interface FirstShotSource {
  projectId: string;
  chapterId: string;
  shotId: string;
  index: number;
  sourceStorePath: string;
  scriptPath: string;
  sourceStoreSha256: string;
  scriptSha256: string;
  imagePath: string;
  imageSha256: string;
  audioPath: string;
  audioSha256: string;
  subtitle: string;
  prompt: string;
  durationTarget: number;
  state: string;
  stale: boolean;
  staleReason: string;
  visualReview: Record<string, unknown>;
  replayKind?: "approved-production";
  replayFromSnapshot?: {
    path: string;
    sha256: string;
  };
}

export interface CleanFirstShotSource extends FirstShotSource {
  sourceKind: "a08-clean-candidate";
  productionImage: {
    path: string;
    sha256: string;
  };
  candidate: A08CleanCandidateProvenance;
}

export interface FirstShotRunOptions extends FirstShotSourceLoadOptions {}

export interface FirstShotMediaUrls {
  visual: string;
  voice: string;
}

export interface FirstShotReport {
  schemaVersion: 1;
  ok: true;
  generatedAt: string;
  verificationAt: string;
  renderStartedAt: string;
  renderCompletedAt: string;
  projectWriteback: false;
  source: FirstShotSource | CleanFirstShotSource;
  gate: {
    state: string;
    stale: boolean;
    staleReason: string;
    visualReview: Record<string, unknown>;
  };
  renderer: {
    requested: "remotion";
    actual: "remotion";
    version: string;
    bundleVersion: string;
  };
  compositionId: typeof STORYBOARD_SHOT_COMPOSITION_ID;
  bundle: {
    manifestPath: string;
    manifestMtimeMs: number;
    schemaVersion: number;
    templateId: string;
    templateVersion: string;
    remotionVersion: string;
    compositionIds: string[];
    compositionId: string;
    contentHash: string;
  };
  outputPath: string;
  reportPath: string;
  sourceSnapshotPath: string;
  ffprobePath: string;
  duration: number;
  expectedDuration: number;
  width: number;
  height: number;
  fps: number;
  streams: string[];
  codecs: { video: string; audio: string };
  sha256: string;
  outputSizeBytes: number;
  outputMtimeMs: number;
  ffprobeMtimeMs: number;
  loudnessReportMtimeMs: number;
  loudnessMeasurement: Awaited<ReturnType<typeof measureRenderedMediaLoudness>>;
}

export function resolveFirstShotSourceMode(value: string | undefined): FirstShotSourceMode {
  if (value === undefined || value === "composite") return "composite";
  if (value === "a08-clean-candidate") return value;
  throw new Error(`首镜 source mode 无效: ${value}`);
}

export function resolveFirstShotReplayMode(value: string | undefined): FirstShotReplayMode {
  if (value === undefined || value === "none") return "none";
  if (value === "approved-production") return value;
  throw new Error(`首镜 replay mode 无效: ${value}`);
}

export function getFirstShotOutputPaths(mode: FirstShotSourceMode): FirstShotOutputPaths {
  const selectedRoot = mode === "composite" ? outputRoot : cleanOutputRoot;
  if (mode === "composite") {
    return {
      outputRoot,
      outputPath,
      sourceSnapshotPath,
      ffprobePath,
      loudnessLogPath,
      loudnessReportPath,
      reportPath,
    };
  }
  return {
    outputRoot: selectedRoot,
    outputPath: path.join(selectedRoot, "output.mp4"),
    sourceSnapshotPath: path.join(selectedRoot, "source-snapshot.json"),
    ffprobePath: path.join(selectedRoot, "ffprobe.json"),
    loudnessLogPath: path.join(selectedRoot, "loudness-measurement.log"),
    loudnessReportPath: path.join(selectedRoot, "loudness-measurement.json"),
    reportPath: path.join(selectedRoot, "report.json"),
  };
}

export function validateA08CleanCandidateReport(
  value: unknown,
  actualImageSha256: string,
): A08CleanCandidateIdentity {
  const report = requireRecord(value, "A08 report");
  if (report.ok !== true
    || report.status !== "awaiting-human-approval"
    || report.mutatedProductionProject !== false) {
    throw new Error("A08 report 状态或 production mutation 标记无效");
  }
  if (!Array.isArray(report.shots)
    || report.shots.length !== 1
    || report.shots[0] !== shotIndex) {
    throw new Error("A08 report 必须精确锁定 shot index 1");
  }
  const entries = requireArray(report.entries, "A08 report.entries");
  if (entries.length !== 1 || !isRecord(entries[0])) {
    throw new Error("A08 report 必须只包含一个有效 entry");
  }
  const entry = entries[0];
  if (entry.index !== shotIndex || entry.storyboardId !== shotId) {
    throw new Error("A08 entry 首镜身份无效");
  }
  if (entry.outputPath !== a08ImagePath
    || entry.outputSha256 !== a08ImageSha256
    || actualImageSha256 !== a08ImageSha256) {
    throw new Error("A08 entry 输出路径或当前 PNG SHA 无效");
  }
  if (!isAcceptedStyleContractVersion(entry.styleContractVersion)
    || entry.assetVersionsApproved !== true) {
    throw new Error("A08 entry 风格合同或资产版本批准无效");
  }
  const colorAudit = requireRecord(entry.colorAudit, "A08 entry.colorAudit");
  if (colorAudit.status !== "pass") throw new Error("A08 color audit 未通过");
  const promptAudit = requireRecord(entry.promptAudit, "A08 entry.promptAudit");
  const promptAuditV2 = requireRecord(promptAudit.v2, "A08 entry.promptAudit.v2");
  if (!isAcceptedStyleContractVersion(promptAuditV2.styleContractVersion)
    || promptAuditV2.status !== "pass"
    || !Array.isArray(promptAuditV2.violations)
    || promptAuditV2.violations.length !== 0) {
    throw new Error("A08 prompt v2 audit 未通过或存在 violations");
  }
  return {
    reportPath: a08ReportPath,
    imagePath: a08ImagePath,
    imageSha256: a08ImageSha256,
    status: "awaiting-human-approval",
    mutatedProductionProject: false,
    styleContractVersion: "daojie-gongbi-v2",
    assetVersionsApproved: true,
    colorAuditStatus: "pass",
    promptAuditStatus: "pass",
    promptAuditViolations: [],
  };
}

export function validateApprovedA08CleanCandidateReport(
  value: unknown,
  actualImageSha256: string,
  humanApproval: A08CleanCandidateIdentity["humanApproval"],
): A08CleanCandidateIdentity {
  const report = requireRecord(value, "A08 approved report");
  if (report.ok !== true
    || report.status !== "completed"
    || report.mode !== "selected-shots"
    || report.mutatedProductionProject !== false
    || report.generatedImages !== 1
    || report.reusedImages !== 0
    || !Array.isArray(report.approvedShots)
    || report.approvedShots.length !== 1
    || report.approvedShots[0] !== shotIndex) {
    throw new Error("A08 approved report 状态、scope 或 mutation 标记无效");
  }
  const identity = validateA08CleanCandidateReport({ ...report, status: "awaiting-human-approval" }, actualImageSha256);
  if (humanApproval?.status !== "approved"
    || humanApproval.reviewer !== "human"
    || humanApproval.outputPath !== a08ImagePath
    || humanApproval.outputSha256 !== a08ImageSha256
    || !isSha256(humanApproval.approvalFingerprint)
    || !isCompleteReviewChecklist(humanApproval.reviewChecklist)) {
    throw new Error("A08 approved report 缺少当前 human approval 证据");
  }
  return {
    ...identity,
    status: "completed",
    humanApproval,
  };
}

export async function loadFirstShotSource(
  options: FirstShotSourceLoadOptions = {},
): Promise<FirstShotSource> {
  const approvedReplay = options.replay === "approved-production";
  // store 读取走分片感知入口（legacy 单文件已随分片化改名）；sourceStorePath 仅作快照身份锚点保留。
  const sourceStore = readStudioWorkflowStoreState(projectRoot);
  if (!sourceStore) throw new Error(`studio-workflow store 不存在（分片/单文件均缺失）: ${projectRoot}`);
  const script = await readJsonRecord(scriptPath);
  const state = sourceStore.state;
  const storyboards = requireArray(state.storyboards, `${sourceStorePath}.state.storyboards`);
  const storyboard = storyboards.find((value) => isRecord(value) && value.id === shotId);
  if (!isRecord(storyboard)) throw new Error(`未找到首镜 storyboard: ${projectId}/${chapterId}/${shotId}`);
  const shots = requireArray(script.shots, `${scriptPath}.shots`);
  const shot = shots.find((value) => isRecord(value) && value.id === shotId);
  if (!isRecord(shot)) throw new Error(`未找到首镜 script shot: ${projectId}/${chapterId}/${shotId}`);

  assertIdentity(storyboard, "storyboard");
  assertIdentity(shot, "script shot");
  if (storyboard.state !== "ready" || shot.state !== "ready") {
    throw new Error("首镜必须处于 ready 状态才能生成预览");
  }
  const visualReview = requireRecord(storyboard.visualReview, "storyboard.visualReview");
  if (approvedReplay) {
    if (storyboard.stale !== false
      || visualReview.status !== "approved"
      || visualReview.reviewer !== "human"
      || typeof visualReview.inputFingerprint !== "string"
      || visualReview.inputFingerprint.length === 0) {
      throw new Error("首镜 approved-production replay 要求当前 stale=false 且 human visualReview 已批准");
    }
  } else {
    if (storyboard.stale !== true) throw new Error("首镜 stale 状态已变化，拒绝使用非当前预览输入");
    if (visualReview.status !== "pending") throw new Error("首镜 visualReview 状态已变化，拒绝使用非当前预览输入");
  }

  const mediaRef = requireRecord(storyboard.mediaRef, "storyboard.mediaRef");
  const persistedImagePath = requireString(mediaRef.path, "storyboard.mediaRef.path");
  const persistedAudioPath = requireString(requireRecord(shot.audioRef, "script shot.audioRef").path, "script shot.audioRef.path");
  let resolvedImagePath = imagePath;
  if (approvedReplay) {
    if (mediaRef.contentSha256 !== a08ImageSha256) {
      throw new Error("首镜 approved-production replay 的 production image SHA 不是当前 A08 SHA");
    }
    const evidencePaths = requireArray(visualReview.evidencePaths, "storyboard.visualReview.evidencePaths");
    if (!evidencePaths.includes(persistedImagePath)) {
      throw new Error("首镜 approved-production replay 的 visualReview evidence 未绑定当前 production image");
    }
    resolvedImagePath = resolveTimelineSourcePath({
      sourcePath: persistedImagePath,
      dataRoot: projectStorageRoots.dataRoot,
      mediaRoot: projectStorageRoots.mediaRoot,
    });
  } else if (persistedImagePath !== imagePath) {
    throw new Error("首镜媒体路径不是锁定的 shot-001.png/shot-001.wav");
  }
  if (persistedAudioPath !== audioPath) {
    throw new Error("首镜媒体路径不是锁定的 shot-001.png/shot-001.wav");
  }
  const prompt = requireString(shot.prompt, "script shot.prompt");
  if (prompt !== requireString(storyboard.prompt, "storyboard.prompt")) throw new Error("首镜 prompt 在 store/script 中不一致");
  const subtitle = requireString(shot.ttsSpokenText, "script shot.ttsSpokenText");
  if (subtitle !== requireString(shot.line, "script shot.line")) throw new Error("首镜字幕在 script.json 中不一致");
  if (subtitle !== requireString(storyboard.ttsSpokenText, "storyboard.ttsSpokenText")) throw new Error("首镜字幕在 store/script 中不一致");
  if (requireNumber(shot.durationTarget, "script shot.durationTarget") !== durationTarget) throw new Error("首镜 durationTarget 不是 4.2 秒");
  if (requireNumber(storyboard.durationTarget, "storyboard.durationTarget") !== durationTarget) throw new Error("store 首镜 durationTarget 不是 4.2 秒");

  for (const [label, filePath] of [["图像", resolvedImagePath], ["旁白", audioPath]] as const) {
    const stat = await fs.promises.stat(filePath).catch(() => undefined);
    if (!stat?.isFile() || stat.size <= 0) throw new Error(`首镜${label}不存在或为空: ${filePath}`);
  }
  const [sourceStoreSha256, scriptSha256, imageSha256, audioSha256] = await Promise.all([
    Promise.resolve(crypto.createHash("sha256").update(sourceStore.raw, "utf8").digest("hex")),
    hashFileSha256(scriptPath),
    hashFileSha256(resolvedImagePath),
    hashFileSha256(audioPath),
  ]);
  if (approvedReplay && imageSha256 !== a08ImageSha256) {
    throw new Error("首镜 approved-production replay 的 production image 当前文件 SHA 无效");
  }
  const source: FirstShotSource = {
    projectId,
    chapterId,
    shotId,
    index: shotIndex,
    sourceStorePath,
    scriptPath,
    sourceStoreSha256,
    scriptSha256,
    imagePath: resolvedImagePath,
    imageSha256,
    audioPath,
    audioSha256,
    subtitle,
    prompt,
    durationTarget,
    state: "ready",
    stale: approvedReplay ? false : true,
    staleReason: approvedReplay ? "" : requireString(storyboard.staleReason, "storyboard.staleReason"),
    visualReview,
  };
  if (approvedReplay) {
    source.replayKind = "approved-production";
    source.replayFromSnapshot = await loadPreProductionSourceSnapshot(sourceSnapshotPath, source);
  }
  return source;
}

export async function loadA08CleanFirstShotSource(
  options: FirstShotSourceLoadOptions = {},
): Promise<CleanFirstShotSource> {
  const productionSource = await loadFirstShotSource(options);
  const [candidateReportStat, candidateImageStat] = await Promise.all([
    fs.promises.stat(a08ReportPath).catch(() => undefined),
    fs.promises.stat(a08ImagePath).catch(() => undefined),
  ]);
  if (!candidateReportStat?.isFile() || candidateReportStat.size <= 0) {
    throw new Error(`A08 report 不存在或为空: ${a08ReportPath}`);
  }
  if (!candidateImageStat?.isFile() || candidateImageStat.size <= 0) {
    throw new Error(`A08 PNG 不存在或为空: ${a08ImagePath}`);
  }
  const [candidateReport, candidateReportSha256, candidateImageSha256] = await Promise.all([
    readJsonRecord(a08ReportPath),
    hashFileSha256(a08ReportPath),
    hashFileSha256(a08ImagePath),
  ]);
  if (options.replay === "approved-production") {
    const replaySnapshot = await loadPreProductionCleanSnapshot(productionSource);
    const humanApproval = await loadA08HumanApproval();
    const candidateIdentity = validateApprovedA08CleanCandidateReport(
      candidateReport,
      candidateImageSha256,
      humanApproval,
    );
    return {
      ...productionSource,
      sourceKind: "a08-clean-candidate",
      replayKind: "approved-production",
      replayFromSnapshot: replaySnapshot,
      productionImage: {
        path: productionSource.imagePath,
        sha256: productionSource.imageSha256,
      },
      imagePath: candidateIdentity.imagePath,
      imageSha256: candidateIdentity.imageSha256,
      candidate: {
        ...candidateIdentity,
        reportSha256: candidateReportSha256,
        reportMtimeMs: candidateReportStat.mtimeMs,
        imageMtimeMs: candidateImageStat.mtimeMs,
      },
    };
  }
  const candidateIdentity = validateA08CleanCandidateReport(candidateReport, candidateImageSha256);
  return {
    ...productionSource,
    sourceKind: "a08-clean-candidate",
    productionImage: {
      path: productionSource.imagePath,
      sha256: productionSource.imageSha256,
    },
    imagePath: candidateIdentity.imagePath,
    imageSha256: candidateIdentity.imageSha256,
    candidate: {
      ...candidateIdentity,
      reportSha256: candidateReportSha256,
      reportMtimeMs: candidateReportStat.mtimeMs,
      imageMtimeMs: candidateImageStat.mtimeMs,
    },
  };
}

async function loadPreProductionCleanSnapshot(
  currentProductionSource: FirstShotSource,
): Promise<NonNullable<FirstShotSource["replayFromSnapshot"]>> {
  const snapshotPath = path.join(cleanOutputRoot, "source-snapshot.json");
  const snapshotStat = await fs.promises.stat(snapshotPath).catch(() => undefined);
  if (!snapshotStat?.isFile() || snapshotStat.size <= 0) {
    throw new Error(`approved-production replay 缺少预生产 source snapshot: ${snapshotPath}`);
  }
  const [snapshot, snapshotSha256, currentScriptSha256, currentAudioSha256] = await Promise.all([
    readJsonRecord(snapshotPath),
    hashFileSha256(snapshotPath),
    hashFileSha256(scriptPath),
    hashFileSha256(audioPath),
  ]);
  const source = snapshot;
  const visualReview = requireRecord(source.visualReview, "预生产 source snapshot.visualReview");
  const candidate = requireRecord(source.candidate, "预生产 source snapshot.candidate");
  const approvedSnapshot = isApprovedReplaySnapshot(source, visualReview);
  if (snapshot.schemaVersion !== 1
    || source.projectId !== projectId
    || source.chapterId !== chapterId
    || source.shotId !== shotId
    || source.index !== shotIndex
    || source.sourceStorePath !== sourceStorePath
    || source.scriptPath !== scriptPath
    || source.imagePath !== a08ImagePath
    || source.audioPath !== audioPath
    || (!approvedSnapshot && (source.stale !== true || visualReview.status !== "pending"))
    || source.scriptSha256 !== currentScriptSha256
    || source.audioSha256 !== currentAudioSha256
    || source.subtitle !== currentProductionSource.subtitle
    || source.prompt !== currentProductionSource.prompt
    || source.durationTarget !== durationTarget
    || candidate.reportPath !== a08ReportPath
    || candidate.imagePath !== a08ImagePath
    || candidate.imageSha256 !== a08ImageSha256
    || (approvedSnapshot
      ? candidate.status !== "completed"
      : candidate.status !== "awaiting-human-approval")
    || candidate.mutatedProductionProject !== false
    || !isSha256(source.sourceStoreSha256)
    || !isSha256(source.scriptSha256)
    || !isSha256(source.imageSha256)
    || !isSha256(source.audioSha256)
    || source.imageSha256 !== a08ImageSha256
    || !isSha256(candidate.reportSha256)
    || !isSha256(snapshotSha256)) {
    throw new Error("approved-production replay 的预生产 source snapshot 与当前首镜不一致");
  }
  if (approvedSnapshot) {
    const replayFromSnapshot = requireRecord(source.replayFromSnapshot, "预生产 source snapshot.replayFromSnapshot");
    if (!isSha256(replayFromSnapshot.sha256)) {
      throw new Error("approved-production replay 的 clean source snapshot provenance 无效");
    }
    const humanApproval = requireRecord(candidate.humanApproval, "预生产 source snapshot.candidate.humanApproval");
    if (humanApproval.status !== "approved"
      || humanApproval.reviewer !== "human"
      || humanApproval.outputPath !== a08ImagePath
      || humanApproval.outputSha256 !== a08ImageSha256
      || !isCompleteReviewChecklist(humanApproval.reviewChecklist)) {
      throw new Error("approved-production replay 的 clean snapshot human approval 无效");
    }
  }
  const snapshotImageSha256 = await hashFileSha256(a08ImagePath);
  if (snapshotImageSha256 !== a08ImageSha256) {
    throw new Error("approved-production replay 的 A08 PNG 当前 SHA 无效");
  }
  return { path: snapshotPath, sha256: snapshotSha256 };
}

async function loadPreProductionSourceSnapshot(
  snapshotPath: string,
  currentProductionSource: FirstShotSource,
): Promise<NonNullable<FirstShotSource["replayFromSnapshot"]>> {
  const snapshotStat = await fs.promises.stat(snapshotPath).catch(() => undefined);
  if (!snapshotStat?.isFile() || snapshotStat.size <= 0) {
    throw new Error(`approved-production replay 缺少 composite source snapshot: ${snapshotPath}`);
  }
  const [snapshot, snapshotSha256, currentScriptSha256, currentAudioSha256, currentImageSha256] = await Promise.all([
    readJsonRecord(snapshotPath),
    hashFileSha256(snapshotPath),
    hashFileSha256(scriptPath),
    hashFileSha256(audioPath),
    hashFileSha256(imagePath),
  ]);
  const visualReview = requireRecord(snapshot.visualReview, "预生产 composite source snapshot.visualReview");
  const approvedSnapshot = isApprovedReplaySnapshot(snapshot, visualReview);
  if (snapshot.schemaVersion !== 1
    || snapshot.projectId !== projectId
    || snapshot.chapterId !== chapterId
    || snapshot.shotId !== shotId
    || snapshot.index !== shotIndex
    || snapshot.sourceStorePath !== sourceStorePath
    || snapshot.scriptPath !== scriptPath
    || snapshot.imagePath !== imagePath
    || snapshot.audioPath !== audioPath
    || (!approvedSnapshot && (snapshot.stale !== true || visualReview.status !== "pending"))
    || snapshot.scriptSha256 !== currentScriptSha256
    || snapshot.audioSha256 !== currentAudioSha256
    || snapshot.imageSha256 !== currentImageSha256
    || snapshot.subtitle !== currentProductionSource.subtitle
    || snapshot.prompt !== currentProductionSource.prompt
    || snapshot.durationTarget !== durationTarget
    || !isSha256(snapshot.sourceStoreSha256)
    || !isSha256(snapshot.scriptSha256)
    || !isSha256(snapshot.imageSha256)
    || !isSha256(snapshot.audioSha256)
    || !isSha256(snapshotSha256)) {
    throw new Error("approved-production replay 的 composite source snapshot 与当前首镜不一致");
  }
  return { path: snapshotPath, sha256: snapshotSha256 };
}

function isApprovedReplaySnapshot(
  source: Record<string, unknown>,
  visualReview: Record<string, unknown>,
): boolean {
  return source.replayKind === "approved-production"
    && source.stale === false
    && visualReview.status === "approved"
    && visualReview.reviewer === "human"
    && typeof visualReview.inputFingerprint === "string"
    && visualReview.inputFingerprint.length > 0;
}

async function loadA08HumanApproval(): Promise<NonNullable<A08CleanCandidateIdentity["humanApproval"]>> {
  const approvals = await readJsonRecord(a08HumanApprovalsPath);
  const approvalMap = requireRecord(approvals.approvals, "A08 human-approvals.approvals");
  const approval = requireRecord(approvalMap[String(shotIndex)], "A08 human approval shot 1");
  const checklist = requireRecord(approval.reviewChecklist, "A08 human approval reviewChecklist");
  const normalized = {
    path: a08HumanApprovalsPath,
    status: approval.status,
    reviewer: approval.reviewer,
    outputPath: approval.outputPath,
    outputSha256: approval.outputSha256,
    approvalFingerprint: approval.approvalFingerprint,
    reviewChecklist: checklist as Record<string, true>,
  };
  if (normalized.status !== "approved"
    || normalized.reviewer !== "human"
    || normalized.outputPath !== a08ImagePath
    || normalized.outputSha256 !== a08ImageSha256
    || !isSha256(normalized.approvalFingerprint)
    || !isCompleteReviewChecklist(normalized.reviewChecklist)) {
    throw new Error("A08 human approval 台账不是当前首镜完整批准");
  }
  return normalized;
}

export function buildFirstShotCompositionProps(
  source: FirstShotSource,
  mediaUrls: FirstShotMediaUrls,
  mode: FirstShotSourceMode = "composite",
): StoryboardShotCompositionProps {
  const durationInFrames = Math.round(source.durationTarget * fps);
  const props: StoryboardShotCompositionProps = {
    target: "shot",
    projectId: source.projectId,
    chapterId: source.chapterId,
    shotId: source.shotId,
    shotRevision: 1,
    width,
    height,
    fps,
    durationInFrames,
    visualClips: [{
      clipId: source.shotId,
      kind: "image",
      src: mediaUrls.visual,
      from: 0,
      durationInFrames,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      fit: "contain",
    }],
    transitions: [],
    audioClips: [{
      clipId: `voice:${source.shotId}`,
      kind: "voice",
      src: mediaUrls.voice,
      from: 0,
      durationInFrames,
      volume: 1,
      renderScope: "shot",
    }],
    subtitles: mode === "a08-clean-candidate"
      ? [{
        cueId: `subtitle:${source.shotId}`,
        text: source.subtitle,
        from: 0,
        durationInFrames,
      }]
      : [],
  };
  const validation = validateStoryboardShotCompositionProps(props);
  if (!validation.success) {
    throw new Error(validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return validation.value;
}

export async function runFirstShot(
  mode: FirstShotSourceMode = "composite",
  options: FirstShotRunOptions = {},
): Promise<FirstShotReport> {
  const source = mode === "composite"
    ? await loadFirstShotSource(options)
    : await loadA08CleanFirstShotSource(options);
  const selectedPaths = getFirstShotOutputPaths(mode);
  await fs.promises.mkdir(selectedPaths.outputRoot, { recursive: true });
  await fs.promises.writeFile(selectedPaths.sourceSnapshotPath, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...source,
    projectWriteback: false,
  }, null, 2)}\n`, "utf8");
  const bundle = readBundleManifest();
  const runtimeStat = await fs.promises.stat(runtimeDir).catch(() => undefined);
  if (!runtimeStat?.isDirectory()) throw new Error(`Remotion runtime 目录不存在: ${runtimeDir}`);
  const binariesDirectory = path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64");
  const compositorPackage = path.join(binariesDirectory, "package.json");
  if (!(await fs.promises.stat(compositorPackage).catch(() => undefined))?.isFile()) {
    throw new Error(`Remotion compositor 不存在: ${compositorPackage}`);
  }

  const previousCwd = process.cwd();
  process.chdir(runtimeDir);
  const bridge = new MediaBridgeServer();
  let session: ReturnType<MediaBridgeServer["createSession"]> | undefined;
  try {
    const browser = await createRemotionEnsureBrowserAdapters(ensureBrowser as unknown as RemotionEnsureBrowser)
      .probe.ensureBrowser({ onDownload: () => { throw new Error("首镜预览禁止下载 Headless Shell"); } });
    if (!browser.executablePath || !path.isAbsolute(browser.executablePath)) throw new Error("Headless Shell executable path 无效");
    const browserStat = await fs.promises.stat(browser.executablePath).catch(() => undefined);
    if (!browserStat?.isFile()) throw new Error(`Headless Shell executable 不存在: ${browser.executablePath}`);
    await fs.promises.access(browser.executablePath, fs.constants.X_OK);

    await bridge.listen();
    session = bridge.createSession();
    const urls = buildMediaUrlMap(bridge, session, [
      { clipId: `visual:${source.shotId}`, absolutePath: source.imagePath },
      { clipId: `voice:${source.shotId}`, absolutePath: source.audioPath },
    ]);
    const props = buildFirstShotCompositionProps(source, {
      visual: urls[`visual:${source.shotId}`]!,
      voice: urls[`voice:${source.shotId}`]!,
    }, mode);
    const renderStartedAt = new Date().toISOString();
    const composition = await selectComposition({
      serveUrl: bundlePath,
      id: STORYBOARD_SHOT_COMPOSITION_ID,
      inputProps: props,
      browserExecutable: browser.executablePath,
      binariesDirectory,
      chromeMode: "headless-shell",
      onBrowserDownload: () => { throw new Error("首镜预览 selectComposition 禁止下载 Headless Shell"); },
    });
    await renderMedia({
      serveUrl: bundlePath,
      composition,
      inputProps: props,
      outputLocation: selectedPaths.outputPath,
      codec: "h264",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      browserExecutable: browser.executablePath,
      binariesDirectory,
      chromeMode: "headless-shell",
      enforceAudioTrack: true,
      overwrite: true,
      onBrowserDownload: () => { throw new Error("首镜预览 renderMedia 禁止下载 Headless Shell"); },
    });
    const renderCompletedAt = new Date().toISOString();
    const outputStat = await fs.promises.stat(selectedPaths.outputPath).catch(() => undefined);
    if (!outputStat?.isFile() || outputStat.size <= 0) throw new Error(`首镜 MP4 不存在或为空: ${selectedPaths.outputPath}`);
    const probe = await probeRenderedMedia(selectedPaths.outputPath);
    assertRenderedMediaEvidence({
      label: `StoryboardShot ${source.shotId}`,
      probe,
      expectedDuration: durationTarget,
      fps,
      width,
      height,
    });
    await fs.promises.writeFile(selectedPaths.ffprobePath, `${JSON.stringify(probe.raw, null, 2)}\n`, "utf8");
    const ffprobeStat = await fs.promises.stat(selectedPaths.ffprobePath);
    const loudnessMeasurement = await measureRenderedMediaLoudness({
      filePath: selectedPaths.outputPath,
      rawLogPath: selectedPaths.loudnessLogPath,
      reportPath: selectedPaths.loudnessReportPath,
    });
    const loudnessReportStat = await fs.promises.stat(selectedPaths.loudnessReportPath);
    const outputSha256 = await hashFileSha256(selectedPaths.outputPath);
    const generatedAt = new Date().toISOString();
    const verificationAt = new Date().toISOString();
    const report: FirstShotReport = {
      schemaVersion: 1,
      ok: true,
      generatedAt,
      verificationAt,
      renderStartedAt,
      renderCompletedAt,
      projectWriteback: false,
      source,
      gate: {
        state: source.state,
        stale: source.stale,
        staleReason: source.staleReason,
        visualReview: source.visualReview,
      },
      renderer: {
        requested: "remotion",
        actual: "remotion",
        version: remotionVersion,
        bundleVersion: bundle.contentHash,
      },
      compositionId: STORYBOARD_SHOT_COMPOSITION_ID,
      bundle,
      outputPath: selectedPaths.outputPath,
      reportPath: selectedPaths.reportPath,
      sourceSnapshotPath: selectedPaths.sourceSnapshotPath,
      ffprobePath: selectedPaths.ffprobePath,
      duration: probe.duration,
      expectedDuration: durationTarget,
      width: probe.width,
      height: probe.height,
      fps,
      streams: probe.streams,
      codecs: { video: probe.videoCodec, audio: probe.audioCodec },
      sha256: outputSha256,
      outputSizeBytes: outputStat.size,
      outputMtimeMs: outputStat.mtimeMs,
      ffprobeMtimeMs: ffprobeStat.mtimeMs,
      loudnessReportMtimeMs: loudnessReportStat.mtimeMs,
      loudnessMeasurement,
    };
    assertFirstShotReportEvidence(report);
    await fs.promises.writeFile(selectedPaths.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  } finally {
    if (session) await bridge.revokeSession(session).catch(() => undefined);
    else await bridge.close().catch(() => undefined);
    process.chdir(previousCwd);
  }
}

export function validateFirstShotBundleManifest(value: unknown): FirstShotReport["bundle"] {
  const manifest = requireRecord(value, "Remotion bundle manifest");
  const manifestPath = requireString(manifest.manifestPath, "bundle.manifestPath");
  const manifestMtimeMs = requireNumber(manifest.manifestMtimeMs, "bundle.manifestMtimeMs");
  const compositionIds = manifest.compositionIds;
  if (!path.isAbsolute(manifestPath)
    || manifestMtimeMs <= 0
    || manifest.schemaVersion !== 2
    || manifest.templateId !== "mystudio-remotion-v1"
    || manifest.templateVersion !== "1.0.0"
    || manifest.remotionVersion !== remotionVersion
    || manifest.compositionId !== LEGACY_TIMELINE_COMPATIBILITY_COMPOSITION_ID
    || !sameOrderedStrings(compositionIds, BUNDLED_REMOTION_COMPOSITION_IDS)
    || typeof manifest.contentHash !== "string"
    || !/^[a-f0-9]{64}$/.test(manifest.contentHash)) {
    throw new Error("Remotion bundle manifest 与固定首镜预览合同不一致");
  }
  return {
    manifestPath,
    manifestMtimeMs,
    schemaVersion: 2,
    templateId: "mystudio-remotion-v1",
    templateVersion: "1.0.0",
    remotionVersion,
    compositionIds: [...BUNDLED_REMOTION_COMPOSITION_IDS],
    compositionId: LEGACY_TIMELINE_COMPATIBILITY_COMPOSITION_ID,
    contentHash: manifest.contentHash,
  };
}

export function assertFirstShotReportEvidence(value: unknown): asserts value is FirstShotReport {
  const report = requireRecord(value, "首镜 report");
  if (report.schemaVersion !== 1 || report.ok !== true || report.projectWriteback !== false) {
    throw new Error("首镜 report schemaVersion/ok/projectWriteback 无效");
  }
  const renderStartedAt = requireIsoTimestamp(report.renderStartedAt, "report.renderStartedAt");
  const renderCompletedAt = requireIsoTimestamp(report.renderCompletedAt, "report.renderCompletedAt");
  const generatedAt = requireIsoTimestamp(report.generatedAt, "report.generatedAt");
  const verificationAt = requireIsoTimestamp(report.verificationAt, "report.verificationAt");
  if (renderStartedAt > renderCompletedAt
    || renderCompletedAt > generatedAt
    || generatedAt > verificationAt) {
    throw new Error("首镜 report 时间戳顺序无效");
  }

  const source = requireRecord(report.source, "report.source");
  const sourceReview = requireRecord(source.visualReview, "report.source.visualReview");
  let mode: FirstShotSourceMode = "composite";
  if (source.sourceKind !== undefined) {
    if (source.sourceKind !== "a08-clean-candidate") throw new Error("首镜 report sourceKind 无效");
    mode = "a08-clean-candidate";
  }
  const replayKind = source.replayKind;
  if (replayKind !== undefined && replayKind !== "approved-production") {
    throw new Error("首镜 report replayKind 无效");
  }
  const approvedReplay = replayKind === "approved-production";
  const selectedPaths = getFirstShotOutputPaths(mode);
  const expectedImagePath = mode === "composite" ? imagePath : a08ImagePath;
  const expectedStale = approvedReplay ? false : true;
  const expectedReviewStatus = approvedReplay ? "approved" : "pending";
  if (source.projectId !== projectId || source.chapterId !== chapterId || source.shotId !== shotId
    || source.index !== shotIndex || source.imagePath !== expectedImagePath || source.audioPath !== audioPath
    || source.durationTarget !== durationTarget || source.state !== "ready" || source.stale !== expectedStale
    || sourceReview.status !== expectedReviewStatus
    || !isSha256(source.sourceStoreSha256) || !isSha256(source.scriptSha256)
    || !isSha256(source.imageSha256) || !isSha256(source.audioSha256)
    || typeof source.subtitle !== "string" || source.subtitle.length === 0) {
    throw new Error("首镜 report source schema 或身份无效");
  }
  if (approvedReplay
    && (sourceReview.reviewer !== "human"
      || typeof sourceReview.inputFingerprint !== "string"
      || sourceReview.inputFingerprint.length === 0)) {
    throw new Error("首镜 approved-production report 缺少当前 human visualReview 指纹");
  }
  if (approvedReplay) {
    const replayFromSnapshot = requireRecord(source.replayFromSnapshot, "report.source.replayFromSnapshot");
    const expectedReplaySnapshotPath = mode === "composite"
      ? sourceSnapshotPath
      : path.join(cleanOutputRoot, "source-snapshot.json");
    if (replayFromSnapshot.path !== expectedReplaySnapshotPath
      || !isSha256(replayFromSnapshot.sha256)) {
      throw new Error("首镜 approved-production replay source snapshot provenance 无效");
    }
  }
  if (mode === "a08-clean-candidate") assertA08CleanReportSource(source, approvedReplay);

  const gate = requireRecord(report.gate, "report.gate");
  const gateReview = requireRecord(gate.visualReview, "report.gate.visualReview");
  if (gate.state !== source.state || gate.stale !== expectedStale || gate.staleReason !== source.staleReason
    || gateReview.status !== sourceReview.status) {
    throw new Error("首镜 report gate 与 source 不一致");
  }

  const renderer = requireRecord(report.renderer, "report.renderer");
  const bundle = validateFirstShotBundleManifest(report.bundle);
  if (renderer.requested !== "remotion" || renderer.actual !== "remotion"
    || renderer.version !== remotionVersion || renderer.bundleVersion !== bundle.contentHash
    || report.compositionId !== STORYBOARD_SHOT_COMPOSITION_ID) {
    throw new Error("首镜 report renderer/bundle identity 无效");
  }

  if (report.outputPath !== selectedPaths.outputPath || report.reportPath !== selectedPaths.reportPath
    || report.sourceSnapshotPath !== selectedPaths.sourceSnapshotPath || report.ffprobePath !== selectedPaths.ffprobePath
    || report.expectedDuration !== durationTarget || report.width !== width || report.height !== height
    || report.fps !== fps || !sameStringMembers(report.streams, ["video", "audio"])) {
    throw new Error("首镜 report 输出路径或媒体 schema 无效");
  }
  const codecs = requireRecord(report.codecs, "report.codecs");
  const duration = requireNumber(report.duration, "report.duration");
  const outputSizeBytes = requireNumber(report.outputSizeBytes, "report.outputSizeBytes");
  if (codecs.video !== "h264" || codecs.audio !== "aac" || duration <= 0
    || Math.abs(duration - durationTarget) > 1 / fps || outputSizeBytes <= 0
    || !isSha256(report.sha256)) {
    throw new Error("首镜 report 媒体证据无效");
  }

  const outputMtimeMs = requireNumber(report.outputMtimeMs, "report.outputMtimeMs");
  const ffprobeMtimeMs = requireNumber(report.ffprobeMtimeMs, "report.ffprobeMtimeMs");
  const loudnessReportMtimeMs = requireNumber(report.loudnessReportMtimeMs, "report.loudnessReportMtimeMs");
  if (bundle.manifestMtimeMs > renderStartedAt + freshnessClockToleranceMs
    || outputMtimeMs + freshnessClockToleranceMs < renderStartedAt
    || outputMtimeMs > renderCompletedAt + freshnessClockToleranceMs
    || ffprobeMtimeMs + freshnessClockToleranceMs < outputMtimeMs
    || loudnessReportMtimeMs + freshnessClockToleranceMs < outputMtimeMs
    || ffprobeMtimeMs > verificationAt + freshnessClockToleranceMs
    || loudnessReportMtimeMs > verificationAt + freshnessClockToleranceMs) {
    throw new Error("首镜 report freshness 时间关系无效");
  }

  const loudness = requireRecord(report.loudnessMeasurement, "report.loudnessMeasurement");
  if (loudness.schemaVersion !== 1 || loudness.inputPath !== selectedPaths.outputPath
    || loudness.reportPath !== selectedPaths.loudnessReportPath
    || !Number.isFinite(loudness.integratedLufs) || !Number.isFinite(loudness.peakDbfs)) {
    throw new Error("首镜 report loudness schema 无效");
  }
  requireIsoTimestamp(loudness.generatedAt, "report.loudnessMeasurement.generatedAt");
}

function assertA08CleanReportSource(source: Record<string, unknown>, approvedReplay = false): void {
  if (source.imagePath !== a08ImagePath || source.imageSha256 !== a08ImageSha256) {
    throw new Error("首镜 clean report A08 PNG 身份无效");
  }
  const productionImage = requireRecord(source.productionImage, "report.source.productionImage");
  const expectedProductionImagePath = approvedReplay ? approvedProductionImagePath : imagePath;
  if (productionImage.path !== expectedProductionImagePath
    || !isSha256(productionImage.sha256)
    || (approvedReplay && productionImage.sha256 !== source.imageSha256)) {
    throw new Error("首镜 clean report production image 身份无效");
  }
  const candidate = requireRecord(source.candidate, "report.source.candidate");
  if (candidate.reportPath !== a08ReportPath
    || !isSha256(candidate.reportSha256)
    || requireNumber(candidate.reportMtimeMs, "report.source.candidate.reportMtimeMs") <= 0
    || candidate.imagePath !== a08ImagePath
    || candidate.imageSha256 !== a08ImageSha256
    || requireNumber(candidate.imageMtimeMs, "report.source.candidate.imageMtimeMs") <= 0
    || candidate.status !== (approvedReplay ? "completed" : "awaiting-human-approval")
    || candidate.mutatedProductionProject !== false
    || !isAcceptedStyleContractVersion(candidate.styleContractVersion)
    || candidate.assetVersionsApproved !== true
    || candidate.colorAuditStatus !== "pass"
    || candidate.promptAuditStatus !== "pass"
    || !Array.isArray(candidate.promptAuditViolations)
    || candidate.promptAuditViolations.length !== 0) {
    throw new Error("首镜 clean report A08 provenance 无效");
  }
  if (approvedReplay) {
    const humanApproval = requireRecord(candidate.humanApproval, "report.source.candidate.humanApproval");
    if (humanApproval.path !== a08HumanApprovalsPath
      || humanApproval.status !== "approved"
      || humanApproval.reviewer !== "human"
      || humanApproval.outputPath !== a08ImagePath
      || humanApproval.outputSha256 !== a08ImageSha256
      || !isSha256(humanApproval.approvalFingerprint)
      || !isCompleteReviewChecklist(humanApproval.reviewChecklist)) {
      throw new Error("首镜 clean report human approval provenance 无效");
    }
  }
}

function readBundleManifest(): FirstShotReport["bundle"] {
  const manifestPath = path.join(bundlePath, "manifest.json");
  const manifestStat = fs.statSync(manifestPath);
  const value = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
  return validateFirstShotBundleManifest({
    ...requireRecord(value, "Remotion bundle manifest"),
    manifestPath,
    manifestMtimeMs: manifestStat.mtimeMs,
  });
}

function sameOrderedStrings(value: unknown, expected: readonly string[]): value is string[] {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

function sameStringMembers(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && new Set(value).size === expected.length
    && expected.every((item) => value.includes(item));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isCompleteReviewChecklist(value: unknown): value is Record<string, true> {
  if (!isRecord(value)) return false;
  const required = ["linework", "colorBalance", "clothingIntegrity", "cleanliness", "continuity", "text", "watermark"];
  return required.every((key) => value[key] === true);
}

function requireIsoTimestamp(value: unknown, label: string): number {
  const text = requireString(value, label);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== text) {
    throw new Error(`${label} 必须是规范 ISO 时间戳`);
  }
  return timestamp;
}

function assertIdentity(value: Record<string, unknown>, label: string): void {
  if (value.episodeId !== chapterId || value.id !== shotId || value.index !== shotIndex) {
    throw new Error(`${label} 身份不匹配: 需要 ${chapterId}/${shotId}/index=${shotIndex}`);
  }
}

async function readJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await fs.promises.readFile(filePath, "utf8")) as unknown;
  return requireRecord(value, filePath);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} 必须是非空字符串`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} 必须是有限数字`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (process.env.MYSTUDIO_FIRST_SHOT === "1") {
  const mode = resolveFirstShotSourceMode(process.env.MYSTUDIO_FIRST_SHOT_MODE);
  const replay = resolveFirstShotReplayMode(process.env.MYSTUDIO_FIRST_SHOT_REPLAY);
  runFirstShot(mode, { replay })
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exit(1);
    });
}
