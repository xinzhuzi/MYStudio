import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildChapterEditingProject,
  createTimelineRenderRecord,
  renderChapterEditingProject,
} from "@/lib/studio/editing/chapter-editing-pipeline";
import {
  validateAutoEditingRun,
  validateEditingProject,
} from "@/lib/studio/editing/validation";
import { createTimelineRenderRuntime } from "@/electron/timeline-render-runtime";
import {
  resolveLocalMediaPath,
  resolveProjectFileUrl,
} from "@/electron/storage-paths";
import type {
  AutoEditingRun,
  EditingProjectV1,
  TimelineRenderEvidence,
  TimelineRenderProgress,
} from "@/types/editing";
import type {
  ProductionTrack,
  ScriptPlan,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";

const EPISODE_ID = "chapter-001";
const DEFAULT_PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec0";

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

function resolveProjectDir() {
  if (process.env.MYSTUDIO_DAOJIE_PROJECT_DIR?.trim()) {
    return path.resolve(process.env.MYSTUDIO_DAOJIE_PROJECT_DIR);
  }
  const home = requireString(process.env.HOME, "HOME");
  return path.join(
    home,
    "Library",
    "Application Support",
    "漫影工作室",
    "projects",
    "_p",
    DEFAULT_PROJECT_ID,
  );
}

export function deriveStorageRoots(projectDir: string) {
  const projectBucket = path.dirname(projectDir);
  if (path.basename(projectBucket) !== "_p") {
    throw new Error(`项目目录必须位于 projects/_p/<projectId>: ${projectDir}`);
  }
  const dataRoot = path.dirname(projectBucket);
  if (path.basename(dataRoot) !== "projects") {
    throw new Error(`项目数据根目录必须命名为 projects: ${dataRoot}`);
  }
  const storageBase = path.dirname(dataRoot);
  return {
    projectId: path.basename(projectDir),
    dataRoot,
    mediaRoot: path.join(storageBase, "media"),
    renderRoot: path.join(storageBase, "media", "studio-render"),
  };
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

export function resolveTimelineSourcePath(input: {
  sourcePath: string;
  dataRoot: string;
  mediaRoot: string;
}) {
  let resolved: string;
  if (input.sourcePath.startsWith("file://")) {
    resolved = fileURLToPath(input.sourcePath);
  } else if (input.sourcePath.startsWith("project-file://")) {
    resolved = resolveProjectFileUrl(input.dataRoot, input.sourcePath);
  } else if (
    input.sourcePath.startsWith("local-image://")
    || input.sourcePath.startsWith("local-video://")
  ) {
    resolved = resolveLocalMediaPath(input.mediaRoot, input.sourcePath);
  } else {
    resolved = input.sourcePath;
  }
  if (!path.isAbsolute(resolved)) {
    throw new Error(`时间线素材路径不是绝对路径: ${input.sourcePath}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`时间线素材不可读或为空: ${input.sourcePath}`);
  }
  fs.accessSync(resolved, fs.constants.R_OK);
  return resolved;
}

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
  const { projectId, dataRoot, mediaRoot, renderRoot } = deriveStorageRoots(projectDir);
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
    existingProjects: loadExistingEditingProject(editingProjectPath),
    runId: `auto-edit-${projectId}-${EPISODE_ID}-${startedAt}`,
    editingProjectId: `editing-${projectId}-${EPISODE_ID}-${startedAt}`,
    now: nextTime,
  });
  if (!buildResult.success) {
    writeJson(autoEditingRunPath, buildResult.run);
    throw new Error(`自动剪辑失败: ${buildResult.run.error || buildResult.run.stage}`);
  }

  const editingProject = buildResult.result.project;
  const jobId = `timeline-${projectId}-${EPISODE_ID}-${startedAt}`;
  const progressHistory: TimelineRenderProgress[] = [];
  writeJson(editingProjectPath, editingProject);
  writeJson(autoEditingRunPath, buildResult.result.run);
  const runtime = createTimelineRenderRuntime({
    renderRoot,
    resolveSourcePath: (sourcePath) => resolveTimelineSourcePath({ sourcePath, dataRoot, mediaRoot }),
    emitProgress: (progress) => progressHistory.push(progress),
  });
  const renderResult = await renderChapterEditingProject({
    project: editingProject,
    jobId,
    createdAt: nextTime(),
    render: (plan) => runtime.render(plan),
  });
  writeJson(progressHistoryPath, progressHistory);
  if (!renderResult.success) {
    throw new Error(`timeline runtime 失败: ${renderResult.jobId} / ${renderResult.error}`);
  }
  requireTimelineArtifacts(renderResult.evidence, {
    renderRoot,
    minimumMtimeMs: startedAt,
  });
  const recordValidation = createTimelineRenderRecord(
    editingProject,
    renderResult.evidence,
    nextTime(),
  );
  if (!recordValidation.success) {
    throw new Error(
      `TimelineRenderRecord 无效: ${recordValidation.issues.map((issue) => issue.message).join("；")}`,
    );
  }
  const autoRunValidation = validateAutoEditingRun({
    ...buildResult.result.run,
    renderJobId: jobId,
    updatedAt: nextTime(),
  } satisfies AutoEditingRun);
  if (!autoRunValidation.success) {
    throw new Error(
      `AutoEditingRun 回写无效: ${autoRunValidation.issues.map((issue) => issue.message).join("；")}`,
    );
  }

  writeJson(autoEditingRunPath, autoRunValidation.value);
  writeJson(timelineRenderPlanPath, renderResult.plan);
  writeJson(timelineRenderRecordPath, recordValidation.value);
  const report = {
    ok: true,
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
    },
    reusedExistingDraft: buildResult.result.reusedExistingDraft,
    editingProject: editingProject,
    autoEditingRun: autoRunValidation.value,
    timelineRenderPlan: renderResult.plan,
    progressHistory,
    timelineRenderRecord: recordValidation.value,
    editingProjectPath,
    autoEditingRunPath,
    timelineRenderPlanPath,
    progressHistoryPath,
    timelineRenderRecordPath,
    runnerReportPath,
    finalVideo: recordValidation.value.evidence.path,
    finalVideoEvidence: recordValidation.value.evidence,
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
