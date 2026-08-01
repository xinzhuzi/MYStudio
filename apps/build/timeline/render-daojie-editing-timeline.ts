import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  buildChapterEditingProject,
} from "@/lib/studio/editing/chapter-editing-pipeline";
import { compileTimelineRenderPlan } from "@/lib/studio/editing/timeline-render-compiler";
import {
  validateAutoEditingRun,
  validateEditingProject,
} from "@/lib/studio/editing/validation";
import {
  deriveStorageRoots,
  resolveProjectDir,
  resolveStorageBasePath,
  resolveProjectId,
  resolveTimelineSourcePath,
  resolveUserDataDir,
} from "./daojie-storage-paths";
import type {
  AutoEditingRun,
  EditingProjectV1,
  TimelineRenderEvidence,
} from "@/types/editing";
import type {
  ProductionTrack,
  ScriptPlan,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import { validateCurrentSlot } from "@/lib/studio/remotion/remotion-current-slot";

const EPISODE_ID = "chapter-001";

type JsonRecord = Record<string, unknown>;

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value as JsonRecord;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} 必须是非空字符串`);
  }
  return value;
}

function requireStringValue(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} 必须是字符串`);
  return value;
}

function requireNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} 必须是有限数字`);
  }
  return value;
}

function requireArray(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value;
}

function readJson(filePath: string): unknown {
  if (!fs.existsSync(filePath)) throw new Error(`JSON 文件不存在: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

export function parseStoryboard(value: unknown, index: number): StoryboardItem {
  const item = requireRecord(value, `storyboards[${index}]`);
  requireString(item.id, `storyboards[${index}].id`);
  requireString(item.episodeId, `storyboards[${index}].episodeId`);
  requireNumber(item.index, `storyboards[${index}].index`);
  requireString(item.trackKey, `storyboards[${index}].trackKey`);
  requireStringValue(item.trackId, `storyboards[${index}].trackId`);
  requireNumber(item.duration, `storyboards[${index}].duration`);
  requireString(item.prompt, `storyboards[${index}].prompt`);
  requireString(item.videoDesc, `storyboards[${index}].videoDesc`);
  requireArray(item.assetIds, `storyboards[${index}].assetIds`);
  requireString(item.state, `storyboards[${index}].state`);
  const mediaRef = requireRecord(item.mediaRef, `storyboards[${index}].mediaRef`);
  requireString(mediaRef.kind, `storyboards[${index}].mediaRef.kind`);
  requireString(mediaRef.path, `storyboards[${index}].mediaRef.path`);
  const audioRef = requireRecord(item.audioRef, `storyboards[${index}].audioRef`);
  requireString(audioRef.kind, `storyboards[${index}].audioRef.kind`);
  requireString(audioRef.path, `storyboards[${index}].audioRef.path`);
  return item as unknown as StoryboardItem;
}

export function parseProductionTrack(value: unknown, index: number): ProductionTrack {
  const item = requireRecord(value, `productionTracks[${index}]`);
  requireString(item.id, `productionTracks[${index}].id`);
  requireString(item.episodeId, `productionTracks[${index}].episodeId`);
  requireString(item.trackKey, `productionTracks[${index}].trackKey`);
  requireArray(item.storyboardIds, `productionTracks[${index}].storyboardIds`);
  requireString(item.prompt, `productionTracks[${index}].prompt`);
  requireNumber(item.duration, `productionTracks[${index}].duration`);
  requireArray(item.candidateVideoIds, `productionTracks[${index}].candidateVideoIds`);
  requireString(item.state, `productionTracks[${index}].state`);
  return item as unknown as ProductionTrack;
}

export function parseVideoCandidate(value: unknown, index: number): VideoCandidate {
  const item = requireRecord(value, `videoCandidates[${index}]`);
  requireString(item.id, `videoCandidates[${index}].id`);
  requireString(item.trackId, `videoCandidates[${index}].trackId`);
  requireString(item.provider, `videoCandidates[${index}].provider`);
  requireString(item.filePath, `videoCandidates[${index}].filePath`);
  requireString(item.state, `videoCandidates[${index}].state`);
  requireNumber(item.createdAt, `videoCandidates[${index}].createdAt`);
  return item as unknown as VideoCandidate;
}

export function parseScriptPlan(value: unknown, index: number): ScriptPlan {
  const item = requireRecord(value, `scriptPlans[${index}]`);
  requireString(item.id, `scriptPlans[${index}].id`);
  requireString(item.episodeId, `scriptPlans[${index}].episodeId`);
  requireString(item.theme, `scriptPlans[${index}].theme`);
  requireString(item.visualStyle, `scriptPlans[${index}].visualStyle`);
  requireString(item.narrativeRhythm, `scriptPlans[${index}].narrativeRhythm`);
  requireArray(item.sceneIntents, `scriptPlans[${index}].sceneIntents`);
  requireString(item.soundDirection, `scriptPlans[${index}].soundDirection`);
  requireString(item.transitions, `scriptPlans[${index}].transitions`);
  requireArray(item.derivedAssetPlan, `scriptPlans[${index}].derivedAssetPlan`);
  return item as unknown as ScriptPlan;
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function loadProjectName(dataRoot: string, projectId: string) {
  const catalogPath = path.join(dataRoot, "mystudio-project-store.json");
  const catalog = requireRecord(readJson(catalogPath), "project catalog");
  const state = requireRecord(catalog.state, "project catalog.state");
  const projects = requireArray(state.projects, "project catalog.state.projects");
  for (const [index, value] of projects.entries()) {
    const project = requireRecord(value, `project catalog.projects[${index}]`);
    if (project.id === projectId) {
      return requireString(project.name, `project catalog.projects[${index}].name`);
    }
  }
  throw new Error(`项目目录未在 mystudio-project-store.json 注册: ${projectId}`);
}

export {
  deriveStorageRoots,
  resolveProjectDir,
  resolveStorageBasePath,
  resolveProjectId,
  resolveTimelineSourcePath,
  resolveUserDataDir,
} from "./daojie-storage-paths";

function loadExistingEditingProject(editingProjectPath: string): EditingProjectV1[] {
  if (!fs.existsSync(editingProjectPath)) return [];
  const validation = validateEditingProject(readJson(editingProjectPath));
  if (!validation.success) {
    throw new Error(
      `已有 EditingProject artifact 无效: ${validation.issues.map((issue) => issue.message).join("；")}`,
    );
  }
  return [validation.value];
}

function loadRemotionShotSlots(artifactDir: string, projectId: string, episodeId: string): RemotionCurrentSlotV1[] {
  const reportPath = process.env.MYSTUDIO_DAOJIE_SHOT_REPORT
    || path.join(process.cwd(), "output", "automation", "daojie-chapter001-shot-slots.json");
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Remotion shot slot report 不存在，请先执行逐镜渲染: ${reportPath}`);
  }
  const report = requireRecord(readJson(reportPath), "Remotion shot slot report");
  if (report.projectId !== projectId || report.chapterId !== episodeId || report.renderer && requireRecord(report.renderer, "report.renderer").actual !== "remotion") {
    throw new Error(`Remotion shot slot report identity 不匹配: ${reportPath}`);
  }
  const rawSlots = requireArray(report.slots, "report.slots");
  const slots = rawSlots.map((value, index) => {
    const validation = validateCurrentSlot(value);
    if (!validation.success) {
      throw new Error(`Remotion shot slot ${index} 无效: ${validation.issues.map((issue) => issue.message).join("；")}`);
    }
    if (validation.value.projectId !== projectId || validation.value.target.kind !== "shot" || validation.value.target.chapterId !== episodeId) {
      throw new Error(`Remotion shot slot ${index} 不属于当前项目/章节`);
    }
    return validation.value;
  });
  if (slots.length === 0) throw new Error(`Remotion shot slot report 为空: ${artifactDir}`);
  return slots;
}

export function removeRemotionEditingAudioTracks(project: EditingProjectV1): EditingProjectV1 {
  const audioTrackIds = new Set(project.tracks
    .filter((track) => track.kind === "voice" || track.kind === "bgm" || track.kind === "sfx")
    .map((track) => track.id));
  if (audioTrackIds.size === 0) return project;
  return {
    ...project,
    tracks: project.tracks.filter((track) => !audioTrackIds.has(track.id)),
    clips: project.clips.filter((clip) => !audioTrackIds.has(clip.trackId)),
    updatedAt: Date.now(),
  };
}

function sha256File(filePath: string) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function requireTimelineArtifacts(
  evidence: TimelineRenderEvidence,
  options: { renderRoot?: string; minimumMtimeMs?: number } = {},
) {
  if (!evidence.path.toLowerCase().endsWith(".mp4")) {
    throw new Error(`timeline 最终输出不是 MP4: ${evidence.path}`);
  }
  if (!evidence.streams.includes("video") || !evidence.streams.includes("audio")) {
    throw new Error(`timeline 最终输出缺少音视频流: ${evidence.streams.join(",")}`);
  }
  if (!Number.isFinite(evidence.duration) || evidence.duration <= 0) {
    throw new Error("timeline 最终输出时长无效");
  }
  if (!Number.isFinite(evidence.width) || evidence.width <= 0 || !Number.isFinite(evidence.height) || evidence.height <= 0) {
    throw new Error("timeline 最终输出尺寸无效");
  }
  let renderRoot: string | undefined;
  if (options.renderRoot) {
    if (!path.isAbsolute(options.renderRoot)) {
      throw new Error(`timeline renderRoot 不是绝对路径: ${options.renderRoot}`);
    }
    renderRoot = fs.realpathSync(options.renderRoot);
  }
  let outputStat: fs.Stats | undefined;
  for (const [label, artifactPath] of Object.entries({
    outputPath: evidence.path,
    snapshotPath: evidence.snapshotPath,
    renderPlanPath: evidence.renderPlanPath,
    inputManifestPath: evidence.inputManifestPath,
    filterGraphPath: evidence.filterGraphPath,
    logPath: evidence.logPath,
    ffprobePath: evidence.ffprobePath,
  })) {
    if (!artifactPath || !fs.existsSync(artifactPath) || fs.statSync(artifactPath).size <= 0) {
      throw new Error(`timeline artifact 缺失或为空: ${label} / ${artifactPath ?? "missing"}`);
    }
    const stat = fs.statSync(artifactPath);
    if (!stat.isFile()) {
      throw new Error(`timeline artifact 不是普通文件: ${label} / ${artifactPath}`);
    }
    if (options.minimumMtimeMs !== undefined && stat.mtimeMs < options.minimumMtimeMs) {
      throw new Error(`timeline artifact 早于本次运行: ${label} / ${artifactPath}`);
    }
    if (renderRoot) {
      const artifactRoot = fs.realpathSync(artifactPath);
      const relative = path.relative(renderRoot, artifactRoot);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`timeline artifact 路径逃逸 renderRoot: ${label} / ${artifactPath}`);
      }
    }
    if (label === "outputPath") outputStat = stat;
  }
  if (!outputStat) {
    throw new Error("timeline 最终输出缺少文件状态");
  }
  if (outputStat.size !== evidence.sizeBytes) {
    throw new Error("timeline evidence sizeBytes 与输出文件不一致");
  }
  if (Math.abs(outputStat.mtimeMs - evidence.mtimeMs) > 1) {
    throw new Error("timeline evidence mtimeMs 与输出文件不一致");
  }
  if (sha256File(evidence.path) !== evidence.sha256) {
    throw new Error("timeline evidence sha256 与输出文件不一致");
  }
  if (sha256File(evidence.snapshotPath) !== evidence.snapshotHash) {
    throw new Error("timeline snapshotHash 与 editing-project artifact 不一致");
  }
}

async function main() {
  const projectDir = resolveProjectDir();
  const { projectId, dataRoot } = deriveStorageRoots(projectDir);
  const projectName = loadProjectName(dataRoot, projectId);
  const storePath = path.join(projectDir, "studio-workflow-store.json");
  const store = requireRecord(readJson(storePath), "studio-workflow-store");
  const state = requireRecord(store.state, "studio-workflow-store.state");
  const storyboards = requireArray(state.storyboards, "state.storyboards")
    .filter((value) => requireRecord(value, "state.storyboards[]").episodeId === EPISODE_ID)
    .map(parseStoryboard);
  const productionTracks = requireArray(state.productionTracks, "state.productionTracks")
    .filter((value) => requireRecord(value, "state.productionTracks[]").episodeId === EPISODE_ID)
    .map(parseProductionTrack);
  const trackIds = new Set(productionTracks.map((item) => item.id));
  const videoCandidates = requireArray(state.videoCandidates, "state.videoCandidates")
    .filter((value) => trackIds.has(String(requireRecord(value, "state.videoCandidates[]").trackId || "")))
    .map(parseVideoCandidate);
  const directorPlan = requireArray(state.scriptPlans, "state.scriptPlans")
    .filter((value) => requireRecord(value, "state.scriptPlans[]").episodeId === EPISODE_ID)
    .map(parseScriptPlan)
    .at(0);
  if (!directorPlan) throw new Error(`未找到导演计划: ${EPISODE_ID}`);
  if (storyboards.length === 0) throw new Error(`未找到分镜: ${EPISODE_ID}`);
  if (productionTracks.length === 0) throw new Error(`未找到生产轨: ${EPISODE_ID}`);
  const seriesBible = requireRecord(state.seriesBible, "state.seriesBible");
  if (requireString(seriesBible.projectId, "state.seriesBible.projectId") !== projectId) {
    throw new Error(`seriesBible projectId 与项目目录不一致: ${seriesBible.projectId} / ${projectId}`);
  }
  const aspectRatio = requireString(seriesBible.aspectRatio, "state.seriesBible.aspectRatio");

  const artifactDir = path.resolve(
    process.env.MYSTUDIO_DAOJIE_TIMELINE_ARTIFACT_DIR
      || path.join(process.cwd(), "output", "automation", "daojie-chapter001-timeline"),
  );
  const editingProjectPath = path.join(artifactDir, "editing-project.json");
  const autoEditingRunPath = path.join(artifactDir, "auto-editing-run.json");
  const timelineRenderPlanPath = path.join(artifactDir, "timeline-render-plan.json");
  const progressHistoryPath = path.join(artifactDir, "progress-history.json");
  const timelineRenderRecordPath = path.join(artifactDir, "timeline-render-record.json");
  const runnerReportPath = path.join(artifactDir, "timeline-runner-report.json");
  const remotionOnly = process.env.MYSTUDIO_DAOJIE_REMOTION_ONLY === "1";
  const remotionShotSlots = remotionOnly ? loadRemotionShotSlots(artifactDir, projectId, EPISODE_ID) : undefined;
  const startedAt = Date.now();
  let clock = startedAt;
  const nextTime = () => clock++;
  const buildResult = await buildChapterEditingProject({
    projectId,
    episodeId: EPISODE_ID,
    projectName,
    aspectRatio,
    directorPlan,
    storyboards,
    productionTracks,
    videoCandidates,
    remotionShotSlots,
    existingProjects: loadExistingEditingProject(editingProjectPath),
    runId: `auto-edit-${projectId}-${EPISODE_ID}-${startedAt}`,
    editingProjectId: `editing-${projectId}-${EPISODE_ID}-${startedAt}`,
    now: nextTime,
  });
  if (!buildResult.success) {
    writeJson(autoEditingRunPath, buildResult.run);
    throw new Error(`自动剪辑失败: ${buildResult.run.error || buildResult.run.stage}`);
  }

  const editingProject = remotionOnly
    ? removeRemotionEditingAudioTracks(buildResult.result.project)
    : buildResult.result.project;
  const jobId = `timeline-${projectId}-${EPISODE_ID}-${startedAt}`;
  writeJson(editingProjectPath, editingProject);
  writeJson(autoEditingRunPath, buildResult.result.run);
  const compiled = compileTimelineRenderPlan(editingProject, {
    jobId,
    createdAt: nextTime(),
  });
  if (!compiled.success) {
    throw new Error(`TimelineRenderPlan 编译失败: ${compiled.issues.map((issue) => issue.message).join("；")}`);
  }
  const progressHistory: unknown[] = [];
  writeJson(progressHistoryPath, progressHistory);
  writeJson(timelineRenderPlanPath, compiled.value);
  const autoRunValidation = validateAutoEditingRun({
    ...buildResult.result.run,
    updatedAt: nextTime(),
  } satisfies AutoEditingRun);
  if (!autoRunValidation.success) {
    throw new Error(
      `AutoEditingRun 回写无效: ${autoRunValidation.issues.map((issue) => issue.message).join("；")}`,
    );
  }

  writeJson(autoEditingRunPath, autoRunValidation.value);
  // The Remotion runner owns final rendering and TimelineRenderRecord publication.
  // Invalidate any previous record so a compile-only run cannot expose an old MP4 as current.
  writeJson(timelineRenderRecordPath, {
    schemaVersion: 1,
    status: "stale",
    projectId,
    episodeId: EPISODE_ID,
    editingProjectId: editingProject.id,
    editingRevision: editingProject.revision,
    sourceSnapshotHash: editingProject.sourceSnapshotHash,
    reason: "awaiting-remotion-render",
  });
  const report = {
    ok: true,
    stage: "compiled",
    generatedAt: new Date().toISOString(),
    projectDir,
    projectId,
    projectName,
    episodeId: EPISODE_ID,
    storePath,
    sourceCounts: {
      storyboards: storyboards.length,
      productionTracks: productionTracks.length,
      videoCandidates: videoCandidates.length,
      remotionShotSlots: remotionShotSlots?.length ?? 0,
    },
    reusedExistingDraft: buildResult.result.reusedExistingDraft,
    editingProject: editingProject,
    autoEditingRun: autoRunValidation.value,
    timelineRenderPlan: compiled.value,
    progressHistory,
    editingProjectPath,
    autoEditingRunPath,
    timelineRenderPlanPath,
    progressHistoryPath,
    timelineRenderRecordPath,
    runnerReportPath,
  };
  writeJson(runnerReportPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function isDirectExecution() {
  const entryPath = process.argv[1];
  return process.env.MYSTUDIO_DAOJIE_TIMELINE_RUNNER === "1"
    || (Boolean(entryPath) && pathToFileURL(path.resolve(entryPath)).href === import.meta.url);
}

if (isDirectExecution()) await main();
