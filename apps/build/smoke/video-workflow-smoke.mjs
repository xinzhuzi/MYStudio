import { spawn } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { terminateSpawnedApp } from "./smoke-process-lifecycle.mjs";

const REQUIRED_PLUGIN_IDS = ["remotion", "video-use", "hyperframes", "seedance-prompt"];
const EXECUTION_PLUGIN_IDS = ["remotion", "video-use", "hyperframes"];
const DEFAULT_TIMEOUT_MS = 30_000;
const VIDEO_WORKFLOW_STORE_FILES = [
  "director.json",
  "script.json",
  "sclass.json",
  "timeline.json",
  "tts.json",
  "studio-workflow-store.json",
  "characters.json",
  "media.json",
  "scenes.json",
  "props.json",
];
const VIDEO_WORKFLOW_SHARED_FILES = [
  "mystudio-app-settings.json",
  "mystudio-media-store.json",
  "mystudio-project-store.json",
];

export function evaluateVideoWorkflowStatus(reply) {
  const issues = [];
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) {
    return { ok: false, state: "invalid", issues: [{ code: "status.invalid", message: "status reply 必须是对象" }] };
  }
  if (reply.schemaVersion !== 1) issues.push({ code: "status.schema", message: "status schemaVersion 必须为 1" });
  if (!Number.isFinite(reply.checkedAt) || reply.checkedAt <= 0) issues.push({ code: "status.checked-at", message: "status checkedAt 无效" });
  const plugins = Array.isArray(reply.plugins) ? reply.plugins : [];
  if (plugins.length !== REQUIRED_PLUGIN_IDS.length) issues.push({ code: "status.plugins", message: `插件数量必须为 ${REQUIRED_PLUGIN_IDS.length}` });
  const byId = new Map();
  for (const plugin of plugins) {
    if (!plugin || typeof plugin !== "object" || typeof plugin.pluginId !== "string") {
      issues.push({ code: "status.plugin-entry", message: "插件状态项无效" });
      continue;
    }
    if (byId.has(plugin.pluginId)) issues.push({ code: "status.plugin-duplicate", message: `插件重复: ${plugin.pluginId}` });
    byId.set(plugin.pluginId, plugin);
    if (plugin.checkedAt !== reply.checkedAt) issues.push({ code: "status.plugin-time", message: `${plugin.pluginId} checkedAt 与顶层不一致` });
  }
  for (const pluginId of REQUIRED_PLUGIN_IDS) {
    if (!byId.has(pluginId)) issues.push({ code: "status.plugin-missing", message: `缺少插件状态: ${pluginId}` });
  }
  if (issues.length > 0) return { ok: false, state: "invalid", issues };

  const videoUse = byId.get("video-use");
  if (videoUse.runtimeState === "blocked" && videoUse.runtimeCode === "alignment-model-missing") {
    return {
      ok: false,
      state: "blocked",
      code: "alignment-model-missing",
      message: videoUse.message || "本地 Whisper/Tokenizer 模型缺失；只读探针停止，不下载模型",
      issues: [{ code: "video-use.alignment-model-missing", message: videoUse.message || "alignment-model-missing" }],
      videoUse,
      plugins: Object.fromEntries(byId),
    };
  }
  if (videoUse.runtimeState !== "ready") {
    return {
      ok: false,
      state: "blocked",
      code: videoUse.runtimeCode || "video-use-not-ready",
      message: videoUse.message || "video-use 未就绪",
      issues: [{ code: "video-use.not-ready", message: videoUse.message || "video-use 未就绪" }],
      videoUse,
      plugins: Object.fromEntries(byId),
    };
  }
  const notReady = EXECUTION_PLUGIN_IDS
    .map((pluginId) => byId.get(pluginId))
    .filter((plugin) => plugin.runtimeState !== "ready");
  if (notReady.length > 0) {
    return {
      ok: false,
      state: "blocked",
      code: "plugin-runtime-not-ready",
      message: notReady.map((plugin) => `${plugin.pluginId}: ${plugin.message || plugin.runtimeState}`).join("; "),
      issues: notReady.map((plugin) => ({ code: `plugin.${plugin.pluginId}.not-ready`, message: plugin.message || plugin.runtimeState })),
      videoUse,
      plugins: Object.fromEntries(byId),
    };
  }
  return { ok: true, state: "ready", message: "四项视频工作流插件状态均已就绪", issues: [], videoUse, plugins: Object.fromEntries(byId) };
}

function sha256File(filePath) {
  return existsSync(filePath)
    ? createHash("sha256").update(readFileSync(filePath)).digest("hex")
    : null;
}

function copyIfExists(sourcePath, targetPath) {
  if (!existsSync(sourcePath)) return false;
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  return true;
}

function copyDirectoryIfExists(sourcePath, targetPath) {
  if (!existsSync(sourcePath)) return false;
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, { recursive: true, dereference: true, preserveTimestamps: true });
  return true;
}

function rebaseProjectPaths(value, sourceProjectDir, targetProjectDir) {
  if (typeof value === "string") {
    return value.startsWith(`${sourceProjectDir}/`)
      ? `${targetProjectDir}${value.slice(sourceProjectDir.length)}`
      : value;
  }
  if (Array.isArray(value)) return value.map((entry) => rebaseProjectPaths(entry, sourceProjectDir, targetProjectDir));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    rebaseProjectPaths(entry, sourceProjectDir, targetProjectDir),
  ]));
}

function rebaseJsonFiles(rootPath, sourceProjectDir, targetProjectDir) {
  if (!existsSync(rootPath)) return 0;
  let changed = 0;
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      changed += rebaseJsonFiles(entryPath, sourceProjectDir, targetProjectDir);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const original = readFileSync(entryPath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(original);
    } catch {
      continue;
    }
    const next = `${JSON.stringify(rebaseProjectPaths(parsed, sourceProjectDir, targetProjectDir), null, 2)}\n`;
    if (next !== original) {
      writeFileSync(entryPath, next, "utf8");
      changed += 1;
    }
  }
  return changed;
}

function snapshotSourceProject(sourceProjectDir, chapterId, revision) {
  const revisionDir = join(sourceProjectDir, "video-use", chapterId, `r${revision}`);
  return {
    editing: sha256File(join(sourceProjectDir, "editing.json")),
    videoUseArtifact: sha256File(join(revisionDir, "video-use-artifact.json")),
    hyperFramesArtifact: sha256File(join(revisionDir, "hyperframes-artifact.json")),
  };
}

function sameSnapshot(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}

function preparePendingVideoUseArtifact(artifactPath) {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  if (artifact.status !== "accepted" || artifact.stage !== "ready" || !artifact.review) {
    throw new Error(`真实 video-use artifact 不是可重放的 accepted/ready revision: ${artifactPath}`);
  }
  delete artifact.review;
  artifact.status = "pending";
  artifact.stage = "awaiting-review";
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function requireDirectory(directoryPath, label) {
  if (!existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) {
    throw new Error(`${label} 不存在或不是目录: ${directoryPath}`);
  }
}

export function evaluateSourceStoryboardGate(storyboards, chapterId, storyboardSourcePolicy = "current-ready") {
  if (!Array.isArray(storyboards)) {
    return {
      ok: false,
      state: "blocked",
      storyboardCount: 0,
      blockedStoryboards: [],
      message: "源项目缺少 studio-workflow-store.state.storyboards",
    };
  }
  const chapterStoryboards = storyboards.filter((storyboard) => storyboard?.episodeId === chapterId);
  if (chapterStoryboards.length === 0) {
    return {
      ok: false,
      state: "blocked",
      storyboardCount: 0,
      blockedStoryboards: [],
      message: `源项目缺少章节 ${chapterId} 的 StoryboardShot`,
    };
  }
  const blockedStoryboards = chapterStoryboards
    .filter((storyboard) => storyboard?.state !== "ready" || (storyboard?.stale === true && storyboardSourcePolicy !== "reuse-existing"))
    .map((storyboard) => ({
      id: typeof storyboard?.id === "string" ? storyboard.id : "unknown",
      state: typeof storyboard?.state === "string" ? storyboard.state : "unknown",
      stale: storyboard?.stale === true,
      reason: typeof storyboard?.staleReason === "string" ? storyboard.staleReason : undefined,
    }));
  if (blockedStoryboards.length > 0) {
    return {
      ok: false,
      state: "blocked",
      storyboardCount: chapterStoryboards.length,
      blockedStoryboards,
      message: storyboardSourcePolicy === "reuse-existing"
        ? `源项目有 ${blockedStoryboards.length}/${chapterStoryboards.length} 个分镜未处于 ready 状态`
        : `源项目有 ${blockedStoryboards.length}/${chapterStoryboards.length} 个分镜未处于 ready 且未过期状态`,
    };
  }
  return {
    ok: true,
    state: "ready",
    storyboardCount: chapterStoryboards.length,
    blockedStoryboards: [],
    message: storyboardSourcePolicy === "reuse-existing"
      ? "源章节 StoryboardShot 已按显式 reuse-existing 策略满足 video-use/EditingProject 投影前置条件"
      : "源章节 StoryboardShot 已满足 video-use/EditingProject 投影前置条件",
  };
}

function inspectSourceStoryboardGate(sourceProjectDir, chapterId, storyboardSourcePolicy = "current-ready") {
  const sourcePath = join(sourceProjectDir, "studio-workflow-store.json");
  if (!existsSync(sourcePath)) {
    return {
      ok: false,
      state: "blocked",
      storyboardCount: 0,
      blockedStoryboards: [],
      message: `源项目缺少 studio-workflow-store.json: ${sourcePath}`,
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(sourcePath, "utf8"));
    return evaluateSourceStoryboardGate(parsed?.state?.storyboards, chapterId, storyboardSourcePolicy);
  } catch (error) {
    return {
      ok: false,
      state: "blocked",
      storyboardCount: 0,
      blockedStoryboards: [],
      message: `无法读取源项目 storyboard 状态: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function cloneAcceptedVideoWorkflowProject({ sourceStorageBasePath, projectId, chapterId, revision, mode }) {
  if (!sourceStorageBasePath || !projectId || !chapterId || !Number.isInteger(revision) || revision <= 0) {
    throw new Error("隔离确认冒烟需要 sourceStorageBasePath、projectId、chapterId 与正整数 revision");
  }
  const sourceStorageRoot = resolve(sourceStorageBasePath);
  const sourceProjectsDir = join(sourceStorageRoot, "projects");
  const sourceProjectDir = join(sourceProjectsDir, "_p", projectId);
  const sourceRevisionDir = join(sourceProjectDir, "video-use", chapterId, `r${revision}`);
  requireDirectory(sourceProjectsDir, "源 projects 目录");
  requireDirectory(sourceProjectDir, "源项目目录");
  requireDirectory(sourceRevisionDir, "源 video-use revision 目录");

  const sourceProjectStorePath = join(sourceProjectsDir, "mystudio-project-store.json");
  if (!existsSync(sourceProjectStorePath)) throw new Error(`源项目索引不存在: ${sourceProjectStorePath}`);
  const projectStore = JSON.parse(readFileSync(sourceProjectStorePath, "utf8"));
  const project = projectStore?.state?.projects?.find((entry) => entry?.id === projectId);
  if (!project) throw new Error(`源项目索引不包含 projectId: ${projectId}`);

  const userDataDir = mkdtempSync(resolve(tmpdir(), "mystudio-video-workflow-apply-"));
  const targetProjectsDir = join(userDataDir, "projects");
  const targetProjectDir = join(targetProjectsDir, "_p", projectId);
  mkdirSync(targetProjectDir, { recursive: true });
  const copiedStoreFiles = [];
  for (const fileName of VIDEO_WORKFLOW_SHARED_FILES) {
    if (copyIfExists(join(sourceProjectsDir, fileName), join(targetProjectsDir, fileName))) copiedStoreFiles.push(fileName);
  }
  for (const fileName of VIDEO_WORKFLOW_STORE_FILES) {
    if (copyIfExists(join(sourceProjectDir, fileName), join(targetProjectDir, fileName))) copiedStoreFiles.push(fileName);
  }
  // The smoke must prove the UI creates this file. Do not seed source editing.json.
  if (existsSync(join(targetProjectDir, "editing.json"))) throw new Error("隔离副本不应预置 editing.json");

  const remotionPaths = [
    `chapters/${chapterId}.json`,
    `evidence/shots/${chapterId}`,
    `jobs/shot/${chapterId}`,
    `outputs/shots/${chapterId}`,
  ];
  for (const relativePath of remotionPaths) {
    const sourcePath = join(sourceProjectDir, "remotion", relativePath);
    const targetPath = join(targetProjectDir, "remotion", relativePath);
    if (sourcePath.endsWith(".json")) copyIfExists(sourcePath, targetPath);
    else copyDirectoryIfExists(sourcePath, targetPath);
  }
  copyDirectoryIfExists(sourceRevisionDir, join(targetProjectDir, "video-use", chapterId, `r${revision}`));
  copyDirectoryIfExists(join(sourceProjectDir, "tts"), join(targetProjectDir, "tts"));

  const rebasedJsonFiles =
    rebaseJsonFiles(join(targetProjectDir, "remotion"), sourceProjectDir, targetProjectDir)
    + rebaseJsonFiles(join(targetProjectDir, "video-use"), sourceProjectDir, targetProjectDir);
  const targetArtifactPath = join(targetProjectDir, "video-use", chapterId, `r${revision}`, "video-use-artifact.json");
  if (!existsSync(targetArtifactPath)) throw new Error(`隔离副本缺少 video-use artifact: ${targetArtifactPath}`);
  const sourceArtifact = JSON.parse(readFileSync(targetArtifactPath, "utf8"));
  if (mode && sourceArtifact.mode !== mode) {
    throw new Error(`源 video-use artifact mode=${sourceArtifact.mode || "unknown"} 与请求 mode=${mode} 不一致`);
  }
  preparePendingVideoUseArtifact(targetArtifactPath);

  return {
    userDataDir,
    targetProjectDir,
    projectId,
    projectName: String(project.name || projectId),
    chapterId,
    revision,
    mode: sourceArtifact.mode,
    copiedStoreFiles,
    rebasedJsonFiles,
    reviewSeed: "pending-from-accepted-copy",
  };
}

function inspectEditingProjection(projectDir, chapterId, revision) {
  const editingPath = join(projectDir, "editing.json");
  if (!existsSync(editingPath)) return { persisted: false, editingPath, reason: "editing.json 不存在" };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(editingPath, "utf8"));
  } catch (error) {
    return { persisted: false, editingPath, reason: error instanceof Error ? error.message : String(error) };
  }
  const state = parsed?.state ?? parsed;
  const editingProjectId = state?.currentEditingProjectIdByEpisode?.[chapterId];
  const project = editingProjectId ? state?.editingProjects?.[editingProjectId] : undefined;
  const persisted = Boolean(
    project
    && project.episodeId === chapterId
    && project.revision === revision
    && Array.isArray(project.clips)
    && project.clips.length > 0,
  );
  return {
    persisted,
    editingPath,
    editingProjectId,
    revision: project?.revision,
    clipCount: Array.isArray(project?.clips) ? project.clips.length : 0,
    trackCount: Array.isArray(project?.tracks) ? project.tracks.length : 0,
    visualSourcePath: Array.isArray(project?.clips)
      ? project.clips.find((clip) => clip?.source?.kind === "storyboardVideo" && clip?.source?.path)?.source?.path
      : undefined,
  };
}

function inspectCloneApplyArtifacts(projectDir, chapterId, revision, reviewer) {
  const revisionDir = join(projectDir, "video-use", chapterId, `r${revision}`);
  const videoUsePath = join(revisionDir, "video-use-artifact.json");
  const hyperFramesPath = join(revisionDir, "hyperframes-artifact.json");
  const videoUse = existsSync(videoUsePath) ? JSON.parse(readFileSync(videoUsePath, "utf8")) : undefined;
  const hyperFrames = existsSync(hyperFramesPath) ? JSON.parse(readFileSync(hyperFramesPath, "utf8")) : undefined;
  return {
    videoUsePath,
    hyperFramesPath,
    videoUseMode: videoUse?.mode,
    videoUseStatus: videoUse?.status,
    videoUseStage: videoUse?.stage,
    flatShotMp4Path: videoUse?.flatShotMp4Path,
    previewPath: videoUse?.preview?.path,
    previewSubtitlesBurnedIn: videoUse?.preview?.subtitlesBurnedIn,
    flatPathDiffersFromPreview: Boolean(videoUse?.flatShotMp4Path && videoUse?.flatShotMp4Path !== videoUse?.preview?.path),
    reviewer: videoUse?.review?.reviewer,
    reviewerMatches: videoUse?.review?.reviewer === reviewer,
    hyperFramesStatus: hyperFrames?.status,
  };
}

export function evaluateAcceptedApplySmoke({ ui, sourceUnchanged, projection, artifacts, expectedMode = "editable-edl" }) {
  const issues = [];
  if (!ui?.projectOpened) issues.push({ code: "ui.project", message: "未通过界面打开隔离项目" });
  if (!ui?.workflowOpened || !ui?.workbenchOpened) issues.push({ code: "ui.navigation", message: "未通过界面进入视频工作台" });
  if (ui?.reviewResult !== "accepted" || ui?.reviewPending !== "false" || ui?.reviewStatus !== "已确认") {
    issues.push({ code: "ui.review", message: "video-use 用户确认未完成" });
  }
  if (ui?.reviewAlert) issues.push({ code: "ui.review-alert", message: `确认或应用出现错误: ${ui.reviewAlert}` });
  if (ui?.videoUseMode !== expectedMode) issues.push({ code: "ui.mode", message: `视频工作流 mode=${ui?.videoUseMode || "unknown"}，期望 ${expectedMode}` });
  if (ui?.previewStatus !== "accepted") issues.push({ code: "ui.apply", message: "video-use 应用后状态不是 accepted" });
  if (!(["accepted", "noop"].includes(ui?.hyperFramesStatus))) {
    issues.push({ code: "ui.hyperframes", message: "HyperFrames 未进入 accepted/noop" });
  }
  if (!ui?.remotionReady) issues.push({ code: "ui.remotion-handoff", message: "确认后没有进入原生 Remotion Studio 交接" });
  const currentShotSlots = ui?.remotionScope?.currentShotSlots;
  if (!Number.isInteger(currentShotSlots) || currentShotSlots <= 0) {
    issues.push({ code: "ui.remotion-slots", message: "确认后未读取到当前章节的 Remotion current slot" });
  } else if (ui?.workbenchSlotCount !== String(currentShotSlots) || ui?.workbenchSlotReady !== "true") {
    issues.push({ code: "ui.remotion-slot-diagnostic", message: "工作台 current slot 诊断与确认后的队列快照不一致" });
  }
  if (!sourceUnchanged) issues.push({ code: "source.mutated", message: "真实项目的 editing/artifact sidecar 哈希发生变化" });
  if (!projection?.persisted) issues.push({ code: "clone.editing", message: "隔离副本没有持久化 EditingProject revision" });
  if (artifacts?.videoUseStatus !== "accepted" || artifacts?.videoUseStage !== "ready" || !artifacts?.reviewerMatches) {
    issues.push({ code: "clone.review-sidecar", message: "隔离副本的 review sidecar 未按确认人写入" });
  }
  if (!(["accepted", "noop"].includes(artifacts?.hyperFramesStatus))) {
    issues.push({ code: "clone.hyperframes", message: "隔离副本缺少 HyperFrames accepted/noop artifact" });
  }
  if (artifacts?.videoUseMode !== expectedMode) {
    issues.push({ code: "clone.mode", message: `隔离副本 video-use mode=${artifacts?.videoUseMode || "unknown"}，期望 ${expectedMode}` });
  }
  if (expectedMode === "flat-shot-mp4") {
    if (!artifacts?.flatShotMp4Path || !/\.mp4$/i.test(artifacts.flatShotMp4Path)) {
      issues.push({ code: "clone.flat-missing", message: "flat 模式缺少独立 clean MP4" });
    }
    if (!artifacts?.flatPathDiffersFromPreview || artifacts?.previewSubtitlesBurnedIn !== true) {
      issues.push({ code: "clone.flat-preview-reuse", message: "flat 模式必须独立保存 clean MP4，preview 必须保留烧录字幕且不可复用" });
    }
    if (projection?.visualSourcePath !== artifacts?.flatShotMp4Path) {
      issues.push({ code: "clone.flat-projection", message: "EditingProject 未投影到 clean flat MP4" });
    }
  }
  return {
    ok: issues.length === 0,
    state: issues.length === 0 ? "accepted" : "blocked",
    issues,
  };
}

export function buildApplyAcceptedExpression({ projectId, projectName, chapterId, revision, reviewer, timeoutMs, mode = "editable-edl", storyboardSourcePolicy = "current-ready" }) {
  return `(async () => {
    const projectId = ${JSON.stringify(projectId)};
    const projectName = ${JSON.stringify(projectName)};
    const chapterId = ${JSON.stringify(chapterId)};
    const reviewer = ${JSON.stringify(reviewer)};
    const revision = ${Number(revision)};
    const timeoutMs = ${Number(timeoutMs)};
    const mode = ${JSON.stringify(mode)};
    const storyboardSourcePolicy = ${JSON.stringify(storyboardSourcePolicy)};
    const normalize = (node) => (node?.textContent || '').replace(/\\s+/g, ' ').trim();
    const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
    const interactiveSelector = 'button, [role="menuitem"], [cmdk-item], [role="button"], .dashboard-project-card';
    const interactiveSummary = () => Array.from(document.querySelectorAll(interactiveSelector))
      .map((node) => ({ role: node.getAttribute('role') || '', text: normalize(node) }))
      .filter((item) => item.text)
      .slice(0, 80);
    const waitFor = async (predicate, label) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await wait(120);
      }
      throw new Error('等待超时: ' + label + '; 可交互元素: ' + JSON.stringify(interactiveSummary()));
    };
    const waitForOptional = async (predicate, timeout) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await wait(120);
      }
      return null;
    };
    const activate = (node) => {
      if (!node) return false;
      node.scrollIntoView?.({ block: 'center', inline: 'center' });
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, view: window }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    };
    const clickText = (text, exact = false) => {
      const nodes = Array.from(document.querySelectorAll(interactiveSelector));
      const node = nodes.find((candidate) => exact ? normalize(candidate) === text : normalize(candidate).includes(text));
      return activate(node);
    };
    const projectCard = await waitFor(() => Array.from(document.querySelectorAll('.dashboard-project-card')).find((node) => normalize(node).includes(projectName)), '隔离项目卡片');
    const projectOpened = activate(projectCard);
    const workflowButton = await waitFor(() => Array.from(document.querySelectorAll('button, [role="button"]')).find((node) => normalize(node) === '工作流'), '工作流入口');
    const workflowOpened = activate(workflowButton);
    await waitFor(() => Array.from(document.querySelectorAll('button, [role="button"]')).find((node) => normalize(node).includes('切换阶段')), '阶段切换器');
    if (!clickText('切换阶段')) throw new Error('无法打开阶段切换器');
    const workbenchStage = await waitFor(() => Array.from(document.querySelectorAll('[role="menuitem"], [cmdk-item]')).find((node) => normalize(node).includes('视频工作台')), '视频工作台阶段');
    const workbenchOpened = activate(workbenchStage);
    const modeSelect = await waitFor(() => document.querySelector('[data-video-use-mode-select]'), 'video-use 模式选择');
    if (modeSelect.value !== mode) {
      modeSelect.value = mode;
      modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const sourcePolicySelect = await waitFor(() => document.querySelector('[data-video-use-storyboard-source-policy-select]'), '分镜来源策略选择');
    if (sourcePolicySelect.value !== storyboardSourcePolicy) {
      sourcePolicySelect.value = storyboardSourcePolicy;
      sourcePolicySelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const preview = await waitFor(() => {
      const node = document.querySelector('[data-video-use-preview]');
      return node?.getAttribute('data-video-use-status') === 'pending'
        && node.querySelector('[data-video-use-revision]')?.getAttribute('data-video-use-revision') === String(revision)
        ? node
        : null;
    }, '待确认 video-use preview');
    const review = await waitFor(() => document.querySelector('[data-video-use-review]'), 'video-use 确认面板');
    const reviewerInput = await waitFor(() => document.querySelector('[aria-label="video-use 确认人"]'), '确认人输入框');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!valueSetter) throw new Error('无法设置确认人输入框');
    valueSetter.call(reviewerInput, reviewer);
    reviewerInput.dispatchEvent(new Event('input', { bubbles: true }));
    reviewerInput.dispatchEvent(new Event('change', { bubbles: true }));
    const confirmButton = await waitFor(() => {
      const node = document.querySelector('[data-video-use-review-confirm]');
      return node && !node.disabled ? node : null;
    }, '确认按钮可用');
    if (!activate(confirmButton)) throw new Error('无法点击确认按钮');
    const applyDeadline = Date.now() + timeoutMs;
    let applyResult = {
      reviewResult: review.getAttribute('data-video-use-review-result') || '',
      previewStatus: preview.getAttribute('data-video-use-status') || '',
      hyperFramesStatus: preview.querySelector('[data-hyperframes-status]')?.getAttribute('data-hyperframes-status') || '',
      reviewAlert: review.querySelector('[role="alert"]')?.textContent?.trim() || '',
      timedOut: false,
    };
    while (Date.now() < applyDeadline) {
      applyResult = {
        reviewResult: review.getAttribute('data-video-use-review-result') || '',
        previewStatus: preview.getAttribute('data-video-use-status') || '',
        hyperFramesStatus: preview.querySelector('[data-hyperframes-status]')?.getAttribute('data-hyperframes-status') || '',
        reviewAlert: review.querySelector('[role="alert"]')?.textContent?.trim() || '',
        timedOut: false,
      };
      if (applyResult.reviewResult === 'accepted' && applyResult.previewStatus !== 'applying'
        && applyResult.previewStatus === 'accepted'
        && (applyResult.hyperFramesStatus === 'accepted' || applyResult.hyperFramesStatus === 'noop' || applyResult.hyperFramesStatus === 'blocked' || applyResult.reviewAlert)) break;
      await wait(120);
    }
    if (applyResult.reviewResult !== 'accepted' || applyResult.previewStatus === 'applying'
      || applyResult.previewStatus !== 'accepted'
      || !(applyResult.hyperFramesStatus === 'accepted' || applyResult.hyperFramesStatus === 'noop' || applyResult.hyperFramesStatus === 'blocked' || applyResult.reviewAlert)) {
      applyResult.timedOut = true;
    }
    const remotionHost = await waitForOptional(
      () => document.querySelector('[data-remotion-handoff][data-remotion-host-readiness="ready"]'),
      timeoutMs,
    );
    const remotionHandoff = document.querySelector('[data-remotion-handoff]');
    const reviewAlert = review.querySelector('[role="alert"]')?.textContent?.trim() || '';
    const remotionScope = await window.remotionQueue?.get?.({ projectId, chapterId });
    return {
      projectOpened,
      workflowOpened,
      workbenchOpened,
      reviewResult: review.getAttribute('data-video-use-review-result'),
      reviewPending: review.getAttribute('data-video-use-review-pending'),
      reviewStatus: review.querySelector('[data-video-use-review-status]')?.textContent?.trim() || '',
      videoUseMode: preview.getAttribute('data-video-use-mode') || '',
      reviewAlert,
      previewStatus: applyResult.previewStatus,
      applyHyperFramesStatus: applyResult.hyperFramesStatus,
      applyTimedOut: applyResult.timedOut,
      workbenchSlotCount: document.querySelector('[data-remotion-handoff]')?.getAttribute('data-remotion-current-slot-count') || '',
      workbenchSlotReady: document.querySelector('[data-remotion-handoff]')?.getAttribute('data-remotion-current-slot-ready') || '',
      remotionScope: remotionScope ? {
        jobs: remotionScope.jobs.length,
        currentShotSlots: remotionScope.currentShotSlots.length,
        shotIds: remotionScope.currentShotSlots
          .filter((slot) => slot.target?.kind === 'shot')
          .map((slot) => slot.target.shotId)
          .sort(),
      } : null,
      hyperFramesStatus: preview.querySelector('[data-hyperframes-status]')?.getAttribute('data-hyperframes-status') || '',
      remotionReady: Boolean(remotionHost),
      remotionHandoffState: remotionHandoff?.getAttribute('data-remotion-host-readiness') || '',
      remotionHandoffText: remotionHandoff ? normalize(remotionHandoff) : '',
    };
  })()`;
}

function readJson(url) {
  return new Promise((resolveJson, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolveJson(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
  });
}

async function waitForPageTarget(debugPort, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await readJson(`http://127.0.0.1:${debugPort}/json/list`);
      const page = Array.isArray(targets) ? targets.find((target) => target.type === "page") : null;
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Electron exposes the debugging endpoint shortly after launch.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`未找到 Electron page target: ${debugPort}`);
}

async function evaluateInPage(pageTarget, expression) {
  const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  let messageId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const callback = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
    else callback.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolveResult, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve: resolveResult, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    const result = await send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression });
    if (result?.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || "unknown page exception";
      throw new Error(`CDP page evaluation failed: ${detail}`);
    }
    if (!result?.result || !("value" in result.result)) {
      throw new Error(`CDP page evaluation returned no serializable value: ${JSON.stringify(result?.result ?? {})}`);
    }
    return result.result.value;
  } finally {
    for (const callback of pending.values()) callback.reject(new Error("CDP socket closed"));
    pending.clear();
    socket.close();
  }
}

function resolveAppBinary() {
  const candidates = [
    process.env.MYSTUDIO_SMOKE_APP_BIN,
    resolve(process.cwd(), "release", "build", "mac-arm64", "mac-arm64", "漫影工作室.app", "Contents", "MacOS", "漫影工作室"),
    resolve(process.cwd(), "release", "build", "mac-arm64", "漫影工作室.app", "Contents", "MacOS", "漫影工作室"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

function parseArgs(argv) {
  const result = { reportPath: process.env.MYSTUDIO_VIDEO_WORKFLOW_SMOKE_REPORT_PATH || resolve(process.cwd(), "output", "automation", "video-workflow-smoke-report.json") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--status-file") result.statusFile = resolve(argv[++index]);
    else if (argv[index] === "--debug-port") result.debugPort = Number(argv[++index]);
    else if (argv[index] === "--user-data-dir") result.userDataDir = resolve(argv[++index]);
    else if (argv[index] === "--report") result.reportPath = resolve(argv[++index]);
    else if (argv[index] === "--apply-accepted") result.applyAccepted = true;
    else if (argv[index] === "--reuse-existing-storyboard") result.reuseExistingStoryboard = true;
    else if (argv[index] === "--source-storage-base-path") result.sourceStorageBasePath = resolve(argv[++index]);
    else if (argv[index] === "--project-id") result.projectId = argv[++index];
    else if (argv[index] === "--chapter-id") result.chapterId = argv[++index];
    else if (argv[index] === "--revision") result.revision = Number(argv[++index]);
    else if (argv[index] === "--reviewer") result.reviewer = argv[++index];
    else if (argv[index] === "--mode") result.mode = argv[++index];
    else if (argv[index] === "--timeout") result.timeoutMs = Number(argv[++index]);
    else if (argv[index] === "--help") result.help = true;
    else throw new Error(`未知参数: ${argv[index]}`);
  }
  return result;
}

async function runAcceptedApplySmoke(options) {
  const sourceStorageBasePath = options.sourceStorageBasePath
    || process.env.MYSTUDIO_VIDEO_WORKFLOW_SOURCE_STORAGE_BASE_PATH;
  const projectId = options.projectId || process.env.MYSTUDIO_VIDEO_WORKFLOW_PROJECT_ID;
  const chapterId = options.chapterId || process.env.MYSTUDIO_VIDEO_WORKFLOW_CHAPTER_ID;
  const revision = Number(options.revision || process.env.MYSTUDIO_VIDEO_WORKFLOW_REVISION);
  const reviewer = String(options.reviewer || process.env.MYSTUDIO_VIDEO_WORKFLOW_REVIEWER || "video-workflow-isolated-smoke").trim();
  const mode = String(options.mode || process.env.MYSTUDIO_VIDEO_WORKFLOW_MODE || "editable-edl");
  if (mode !== "editable-edl" && mode !== "flat-shot-mp4") throw new Error(`不支持的 smoke video-use mode: ${mode}`);
  if (!sourceStorageBasePath || !projectId || !chapterId || !Number.isInteger(revision) || revision <= 0 || !reviewer) {
    throw new Error("--apply-accepted 需要 source storage base path、project/chapter/revision 与 reviewer");
  }

  const sourceProjectDir = join(resolve(sourceStorageBasePath), "projects", "_p", projectId);
  const sourceBefore = snapshotSourceProject(sourceProjectDir, chapterId, revision);
  const storyboardSourcePolicy = options.reuseExistingStoryboard ? "reuse-existing" : "current-ready";
  const sourceGate = inspectSourceStoryboardGate(sourceProjectDir, chapterId, storyboardSourcePolicy);
  if (!sourceGate.ok) {
    return {
      ok: false,
      state: "blocked",
      issues: [{ code: "source.storyboard-ready", message: sourceGate.message }],
      source: "accepted-apply-source-preflight",
      reviewer,
      mode,
      storyboardSourcePolicy,
      sourceBefore,
      sourceAfter: sourceBefore,
      sourceUnchanged: true,
      sourceGate,
      projection: { persisted: false, reason: "源章节分镜未通过 accepted-apply 前置门禁" },
      artifacts: {},
      probeCalls: 0,
      mutatingCalls: 0,
    };
  }
  const clone = cloneAcceptedVideoWorkflowProject({ sourceStorageBasePath, projectId, chapterId, revision, mode });
  const debugPort = Number(options.debugPort || process.env.MYSTUDIO_VIDEO_WORKFLOW_DEBUG_PORT || (9400 + Math.floor(Math.random() * 400)));
  const appBin = options.appBin || resolveAppBinary();
  if (!appBin || !existsSync(appBin)) throw new Error(`Packaged app 不存在: ${appBin || "empty"}`);
  const child = spawn(appBin, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${clone.userDataDir}`], {
    cwd: process.cwd(),
    detached: true,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1", MYSTUDIO_SMOKE_BACKGROUND: "1" },
    stdio: "ignore",
  });

  let ui;
  let errorMessage;
  try {
    const page = await waitForPageTarget(debugPort, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
    ui = await evaluateInPage(page, buildApplyAcceptedExpression({
      projectId: clone.projectId,
      projectName: clone.projectName,
      chapterId,
      revision,
      reviewer,
      mode,
      storyboardSourcePolicy,
      timeoutMs: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS),
    }));
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    await terminateSpawnedApp(child, { logPrefix: "[video-workflow-apply]" }).catch(() => undefined);
  }

  const sourceAfter = snapshotSourceProject(sourceProjectDir, chapterId, revision);
  const sourceUnchanged = sameSnapshot(sourceBefore, sourceAfter);
  const projection = inspectEditingProjection(clone.targetProjectDir, chapterId, revision);
  const artifacts = inspectCloneApplyArtifacts(clone.targetProjectDir, chapterId, revision, reviewer);
  if (errorMessage) {
    return {
      ok: false,
      state: "error",
      issues: [{ code: "apply.smoke.error", message: errorMessage }],
      source: "packaged-electron-cdp-accepted-apply",
      appBin,
      debugPort,
      reviewer,
      mode,
      storyboardSourcePolicy,
      sourceBefore,
      sourceAfter,
      sourceUnchanged,
      sourceGate,
      projection,
      artifacts,
      clone,
      probeCalls: 0,
      mutatingCalls: 2,
    };
  }
  const evaluated = evaluateAcceptedApplySmoke({ ui, sourceUnchanged, projection, artifacts, expectedMode: mode });
  return {
    ...evaluated,
    source: "packaged-electron-cdp-accepted-apply",
    appBin,
    debugPort,
    reviewer,
    mode,
    sourceBefore,
    sourceAfter,
    sourceUnchanged,
    sourceGate,
    projection,
    artifacts,
    clone,
    ui,
    probeCalls: 0,
    mutatingCalls: 2,
  };
}

export async function runVideoWorkflowSmoke(options = {}) {
  if (options.applyAccepted) return runAcceptedApplySmoke(options);
  if (options.statusFile) {
    const status = JSON.parse(readFileSync(options.statusFile, "utf8"));
    return { ...evaluateVideoWorkflowStatus(status), source: "status-file", mutatingCalls: 0 };
  }
  const debugPort = Number(options.debugPort || process.env.MYSTUDIO_VIDEO_WORKFLOW_DEBUG_PORT || (9400 + Math.floor(Math.random() * 400)));
  const appBin = options.appBin || resolveAppBinary();
  if (!appBin || !existsSync(appBin)) throw new Error(`Packaged app 不存在: ${appBin || "empty"}`);
  const userDataDir = options.userDataDir || process.env.MYSTUDIO_VIDEO_WORKFLOW_SMOKE_USER_DATA_DIR || mkdtempSync(resolve(tmpdir(), "mystudio-video-workflow-smoke-"));
  const child = spawn(appBin, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`], {
    cwd: process.cwd(), detached: true, env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" }, stdio: "ignore",
  });
  try {
    const page = await waitForPageTarget(debugPort, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
    const status = await evaluateInPage(page, "window.videoWorkflowPlugins?.status?.() || null");
    const evaluated = evaluateVideoWorkflowStatus(status);
    return { ...evaluated, source: "packaged-electron-cdp", appBin, userDataDir, debugPort, status, probeCalls: 1, mutatingCalls: 0 };
  } finally {
    await terminateSpawnedApp(child, { force: true }).catch(() => undefined);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node ./build/smoke/video-workflow-smoke.mjs [--status-file file] [--debug-port port] [--user-data-dir dir] [--report file]");
    console.log("       node ./build/smoke/video-workflow-smoke.mjs --apply-accepted --source-storage-base-path <storage> --project-id <id> --chapter-id <id> --revision <n> [--mode editable-edl|flat-shot-mp4] [--reuse-existing-storyboard] [--reviewer <name>] [--timeout <ms>]");
    return;
  }
  const startedAt = Date.now();
  let report;
  try {
    report = { schemaVersion: 1, generatedAt: new Date().toISOString(), startedAt, ...(await runVideoWorkflowSmoke(args)) };
  } catch (error) {
    report = { schemaVersion: 1, generatedAt: new Date().toISOString(), startedAt, ok: false, state: "error", issues: [{ code: "smoke.error", message: error instanceof Error ? error.message : String(error) }], mutatingCalls: 0 };
  }
  mkdirSync(dirname(args.reportPath), { recursive: true });
  writeFileSync(args.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.url.replace("file://", ""))) await main();
