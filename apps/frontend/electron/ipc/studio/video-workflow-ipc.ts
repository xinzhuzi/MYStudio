import { ipcMain } from "electron";
import path from "node:path";
import type { RemotionBrowserStatus } from "@rendering/contracts/remotion-browser-status";
import {
  assertVideoWorkflowIpcRequest,
  VIDEO_WORKFLOW_PREPARE_CHANNEL,
  VIDEO_WORKFLOW_UPDATE_CHANNEL,
  VIDEO_WORKFLOW_REPAIR_CHANNEL,
  VIDEO_WORKFLOW_ROLLBACK_CHANNEL,
  VIDEO_WORKFLOW_REVIEW_CHANNEL,
  VIDEO_WORKFLOW_RUN_CHAPTER_CHANNEL,
  VIDEO_WORKFLOW_APPLY_CHAPTER_CHANNEL,
  VIDEO_WORKFLOW_STATUS_CHANNEL,
  VIDEO_WORKFLOW_READ_CHAPTER_CHANNEL,
  validateVideoWorkflowPluginActionRequest,
  validateVideoWorkflowReviewRequest,
  validateVideoWorkflowChapterRunRequest,
  validateVideoWorkflowChapterApplyRequest,
  validateVideoWorkflowChapterReadRequest,
  type VideoWorkflowChapterRunReplyV1,
  type VideoWorkflowChapterApplyReplyV1,
  type VideoWorkflowChapterRunRequestV1,
  type VideoWorkflowChapterApplyRequestV1,
  type VideoWorkflowReviewReplyV1,
  type VideoWorkflowReviewRequestV1,
  type VideoWorkflowActionReplyV1,
 
  type VideoWorkflowStatusReplyV1,
  type VideoWorkflowChapterReadReplyV1,
} from "@rendering/contracts/video-workflow-ipc";
import type { VideoWorkflowPluginId, VideoWorkflowPluginStatusV1 } from "@rendering/contracts/video-workflow";
import type { VideoUseChapterRunV1 } from "@rendering/contracts/video-workflow";
import {
  readLatestVideoWorkflowChapterArtifacts,
  readVideoWorkflowChapterArtifacts,
  type VideoWorkflowChapterArtifacts,
} from "@rendering/plugins/video-workflow/video-workflow-artifact-store";
import {
  HYPERFRAMES_NPM_VERSION,
  HYPERFRAMES_SOURCE_COMMIT,
 
  VIDEO_USE_SOURCE_COMMIT,
  probeVideoWorkflowRuntime,
  resolveVideoWorkflowRuntimePaths,
  type VideoWorkflowRuntimeProbeResult,
} from "@rendering/plugins/video-workflow/video-workflow-runtime";
import type {
  RuntimeActionResult,
  RuntimePluginId,
  VideoWorkflowRuntimeManager,
} from "@rendering/plugins/video-workflow/video-workflow-runtime-manager";
import type { VideoUseProbeResult } from "@rendering/plugins/video-use/video-use-adapter";
import type { HyperFramesProbeResult } from "@rendering/plugins/hyperframes/hyperframes-adapter";
import type { VideoUseAdapterResult } from "@rendering/plugins/video-use/video-use-adapter";
import type { VideoWorkflowChapterApplyResult } from "@rendering/plugins/video-workflow/video-workflow-chapter-service";

export interface RegisterVideoWorkflowIpcOptions {
  getStorageBasePath: () => string;
  appVersion: string;
  remotionVersion: string;
  probeRemotion: () => Promise<RemotionBrowserStatus>;
  prepareRemotion?: () => Promise<RemotionBrowserStatus>;
  probeVideoUse?: () => Promise<VideoUseProbeResult>;
  probeHyperFrames?: () => Promise<HyperFramesProbeResult>;
  prepareVideoUseModel?: () => Promise<{ success: boolean; error?: string }>;
  runtimeManager?: VideoWorkflowRuntimeManager;
  reviewVideoUse?: (request: VideoWorkflowReviewRequestV1) => Promise<VideoWorkflowReviewReplyV1>;
  runVideoUseChapter?: (run: VideoUseChapterRunV1) => Promise<VideoUseAdapterResult>;
  applyVideoWorkflowChapter?: (request: VideoWorkflowChapterApplyRequestV1) => Promise<VideoWorkflowChapterApplyResult>;
  buildVideoUseChapterRun?: (request: VideoWorkflowChapterRunRequestV1) => VideoUseChapterRunV1;
  now?: () => number;
}

export interface VideoWorkflowIpcHandle {
  dispose: () => void;
}

const sourceUrls = {
  remotion: "https://github.com/remotion-dev/remotion",
  "video-use": "https://github.com/browser-use/video-use",
  hyperframes: "https://github.com/heygen-com/hyperframes",
  "seedance-prompt": "https://github.com/songguoxs/seedance-prompt-skill",
} as const;

function pluginStatus(
  pluginId: VideoWorkflowPluginId,
  appVersion: string,
  pluginVersion: string,
  sourceCommit: string,
  runtimeState: VideoWorkflowPluginStatusV1["runtimeState"],
  checkedAt: number,
  dependencies: VideoWorkflowPluginStatusV1["dependencies"],
  message?: string,
  paths?: { runtimePath?: string; profilePath?: string },
  runtimeCode?: string,
): VideoWorkflowPluginStatusV1 {
  return {
    schemaVersion: 1,
    pluginId,
    displayName: pluginId === "video-use" ? "video-use" : pluginId === "hyperframes" ? "HyperFrames" : pluginId === "seedance-prompt" ? "Seedance Prompt Skill" : "Remotion",
    sourceUrl: sourceUrls[pluginId],
    sourceCommit,
    license: pluginId === "seedance-prompt" ? "MIT (上游声明以仓库为准)" : "MIT",
    appVersion,
    pluginVersion,
    runtimeState,
    ...(paths?.runtimePath ? { runtimePath: paths.runtimePath } : {}),
    ...(paths?.profilePath ? { profilePath: paths.profilePath } : {}),
    dependencies,
    checkedAt,
    ...(runtimeCode ? { runtimeCode } : {}),
    ...(message ? { message } : {}),
  };
}

function runtimeStateToPluginState(result: VideoWorkflowRuntimeProbeResult): VideoWorkflowPluginStatusV1["runtimeState"] {
  return result.state;
}

export function registerVideoWorkflowIpcHandlers({
  getStorageBasePath,
  appVersion,
  remotionVersion,
  probeRemotion,
  prepareRemotion,
  probeVideoUse,
  probeHyperFrames,
  prepareVideoUseModel,
  runtimeManager,
  reviewVideoUse,
  runVideoUseChapter,
  applyVideoWorkflowChapter,
  buildVideoUseChapterRun,
  now = Date.now,
}: RegisterVideoWorkflowIpcOptions): VideoWorkflowIpcHandle {
  const buildStatus = async (): Promise<VideoWorkflowStatusReplyV1> => {
    const checkedAt = now();
    const paths = resolveVideoWorkflowRuntimePaths(getStorageBasePath());
    const runtime = await probeVideoWorkflowRuntime(paths);
    const remotion = await probeRemotion().catch((error) => ({
      state: "error",
      remotionVersion,
      message: error instanceof Error ? error.message : String(error),
    } satisfies RemotionBrowserStatus));
    const [videoUse, hyperFrames] = await Promise.all([
      probeVideoUse?.().catch((error) => ({ state: "error" as const, message: error instanceof Error ? error.message : String(error), runtime } as VideoUseProbeResult)),
      probeHyperFrames?.().catch((error) => ({ state: "error" as const, message: error instanceof Error ? error.message : String(error), runtime } as HyperFramesProbeResult)),
    ]);
    const remotionState: VideoWorkflowPluginStatusV1["runtimeState"] = remotion.state === "ready"
      ? "ready"
      : remotion.state === "update-required"
        ? "update-available"
        : remotion.state === "not-installed"
        ? "needs-runtime"
        : "error";
    const dependencies = {
      python: runtime.versions.python,
      node: runtime.versions.node,
      ffmpeg: runtime.versions.ffmpeg,
      ffprobe: runtime.versions.ffprobe,
    };
    return {
      schemaVersion: 1,
      checkedAt,
      plugins: [
        pluginStatus("remotion", appVersion, remotionVersion, "bundled-app", remotionState, checkedAt, { browser: remotionState, ffmpeg: dependencies.ffmpeg, ffprobe: dependencies.ffprobe }, remotion.message),
        pluginStatus("video-use", appVersion, VIDEO_USE_SOURCE_COMMIT, VIDEO_USE_SOURCE_COMMIT, videoUse ? (videoUse.runtime.state === "update-available" ? "update-available" : videoUse.state === "ready" ? "ready" : videoUse.state === "blocked" ? "blocked" : "error") : runtimeStateToPluginState(runtime), checkedAt, dependencies, videoUse?.message ?? runtime.message, { runtimePath: paths.pythonExecutable, profilePath: paths.videoUseMarkerPath }, videoUse?.code),
        pluginStatus("hyperframes", appVersion, HYPERFRAMES_NPM_VERSION, HYPERFRAMES_SOURCE_COMMIT, hyperFrames ? (hyperFrames.runtime.state === "update-available" ? "update-available" : hyperFrames.state === "ready" ? "ready" : hyperFrames.state === "blocked" ? "blocked" : "error") : runtimeStateToPluginState(runtime), checkedAt, { node: dependencies.node, browser: remotionState, ffmpeg: dependencies.ffmpeg, ffprobe: dependencies.ffprobe }, hyperFrames?.message ?? runtime.message, { runtimePath: paths.nodeExecutable, profilePath: paths.hyperFramesMarkerPath }),
        pluginStatus("seedance-prompt", appVersion, "deferred", "deferred", "deferred", checkedAt, {}, "本轮仅保留提示词来源，不进入执行门禁"),
      ],
    };
  };

  const handleAction = async (payload: unknown, action: "prepare" | "update" | "repair" | "rollback"): Promise<VideoWorkflowActionReplyV1> => {
    const request = assertVideoWorkflowIpcRequest(validateVideoWorkflowPluginActionRequest(payload));
    let actionMessage: string | undefined;
    let success = false;
    const verifyPlugin = async (pluginId: RuntimePluginId): Promise<void> => {
      const probe = pluginId === "video-use" ? await probeVideoUse?.() : await probeHyperFrames?.();
      if (probe && probe.state !== "ready") {
        success = false;
        actionMessage = probe.message;
      }
    };
    const applyRuntimeAction = async (pluginId: RuntimePluginId): Promise<void> => {
      if (!runtimeManager) return;
      const result: RuntimeActionResult = action === "prepare"
        ? await runtimeManager.prepare(pluginId)
        : action === "update"
          ? await runtimeManager.update(pluginId)
          : action === "repair"
            ? await runtimeManager.repair(pluginId)
            : await runtimeManager.rollback(pluginId);
      success = result.success;
      if (!result.success) {
        actionMessage = result.message;
        return;
      }
      await verifyPlugin(pluginId);
    };
    if (request.pluginId === "remotion" && (action === "prepare" || action === "update" || action === "repair") && prepareRemotion) {
      await prepareRemotion();
      success = true;
    } else if (request.pluginId === "video-use" && runtimeManager) {
      if ((action === "prepare" || action === "update" || action === "repair") && prepareVideoUseModel) {
        const modelResult = await prepareVideoUseModel();
        if (!modelResult.success) {
          success = false;
          actionMessage = modelResult.error ?? "Whisper 对齐模型未准备";
          const status = await buildStatus();
          return { ...status, success, message: actionMessage };
        }
      }
      await applyRuntimeAction("video-use");
    } else if (request.pluginId === "hyperframes" && runtimeManager) {
      await applyRuntimeAction("hyperframes");
    } else if (request.pluginId === "video-use" && (action === "prepare" || action === "repair") && probeVideoUse) {
      const result = await probeVideoUse();
      success = result.state === "ready";
      if (!success) actionMessage = result.message;
    } else if (request.pluginId === "hyperframes" && (action === "prepare" || action === "repair") && probeHyperFrames) {
      const result = await probeHyperFrames();
      success = result.state === "ready";
      if (!success) actionMessage = result.message;
    } else if (request.pluginId === "seedance-prompt") {
      actionMessage = "Seedance Prompt Skill 本轮暂缓，不执行运行时准备";
    } else {
      actionMessage = action === "rollback"
        ? "当前插件尚无可回滚的已验证组合"
        : "当前插件运行时尚未满足准备条件；请先完成共享 Python/Node 22/FFmpeg/浏览器配置";
    }
    const status = await buildStatus();
    return { ...status, success, ...(actionMessage ? { message: actionMessage } : {}) };
  };

  const handleReview = async (payload: unknown): Promise<VideoWorkflowReviewReplyV1> => {
    const request = assertVideoWorkflowIpcRequest(validateVideoWorkflowReviewRequest(payload));
    if (!reviewVideoUse) {
      return {
        schemaVersion: 1,
        success: false,
        projectId: request.projectId,
        chapterId: request.chapterId,
        revision: request.revision,
        status: "blocked",
        message: "当前应用未接入 video-use 用户确认服务",
      };
    }
    return reviewVideoUse(request);
  };

  const handleRunChapter = async (payload: unknown): Promise<VideoWorkflowChapterRunReplyV1> => {
    const request = assertVideoWorkflowIpcRequest(validateVideoWorkflowChapterRunRequest(payload));
    const identity = { projectId: request.projectId, chapterId: request.chapterId, revision: request.revision };
    if (!runVideoUseChapter || !buildVideoUseChapterRun) {
      return { schemaVersion: 1, success: false, ...identity, state: "blocked", code: "video-use-unavailable", message: "当前应用未接入 video-use 章节服务" };
    }
    try {
      const result = await runVideoUseChapter(buildVideoUseChapterRun(request));
      if (result.state === "blocked" || result.state === "error") {
        return { schemaVersion: 1, success: false, ...identity, state: "blocked", code: result.code, artifactPath: result.artifactPath, message: result.message };
      }
      if (result.state !== "pending" && result.state !== "ready") {
        return { schemaVersion: 1, success: false, ...identity, state: "blocked", code: "video-use-invalid-state", message: "video-use 返回了未知状态" };
      }
      return { schemaVersion: 1, success: true, ...identity, state: result.state, artifact: result.artifact, artifactPath: result.artifactPath };
    } catch (error) {
      return { schemaVersion: 1, success: false, ...identity, state: "blocked", code: "video-use-ipc-failed", message: error instanceof Error ? error.message : String(error) };
    }
  };

  const handleApplyChapter = async (payload: unknown): Promise<VideoWorkflowChapterApplyReplyV1> => {
    const request = assertVideoWorkflowIpcRequest(validateVideoWorkflowChapterApplyRequest(payload));
    const identity = { projectId: request.projectId, chapterId: request.chapterId, revision: request.revision };
    if (!applyVideoWorkflowChapter) {
      return { schemaVersion: 1, success: false, ...identity, code: "video-workflow-unavailable", message: "当前应用未接入视频工作流应用服务" };
    }
    try {
      const result = await applyVideoWorkflowChapter(request);
      if (!result.success) return { schemaVersion: 1, success: false, ...identity, code: result.code, message: result.message, videoUseArtifactPath: result.videoUseArtifactPath, hyperFramesArtifactPath: result.hyperFramesArtifactPath };
      return {
        schemaVersion: 1,
        success: true,
        ...identity,
        videoUseArtifact: result.videoUseArtifact,
        hyperFramesArtifact: result.hyperFramesArtifact,
        videoUseArtifactPath: result.videoUseArtifactPath,
        hyperFramesArtifactPath: result.hyperFramesArtifactPath,
      };
    } catch (error) {
      return { schemaVersion: 1, success: false, ...identity, code: "video-workflow-ipc-failed", message: error instanceof Error ? error.message : String(error) };
    }
  };

  const handleReadChapter = async (payload: unknown): Promise<VideoWorkflowChapterReadReplyV1> => {
    const request = assertVideoWorkflowIpcRequest(validateVideoWorkflowChapterReadRequest(payload));
    const workspaceRootForProject = (projectId: string) => path.join(getStorageBasePath(), "projects", "_p", projectId, "video-use");
    const base = { schemaVersion: 1 as const, projectId: request.projectId, chapterId: request.chapterId };
    let revision: number | undefined;
    let artifacts: VideoWorkflowChapterArtifacts | undefined;
    if (request.revision === undefined) {
      const latest = await readLatestVideoWorkflowChapterArtifacts(workspaceRootForProject, request);
      if (!latest.success) return { ...base, videoUseState: "blocked", hyperFramesState: "blocked", message: latest.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；") };
      revision = latest.value?.revision;
      artifacts = latest.value?.artifacts;
    } else {
      const exact = await readVideoWorkflowChapterArtifacts(workspaceRootForProject, { projectId: request.projectId, chapterId: request.chapterId, revision: request.revision });
      if (!exact.success) return { ...base, videoUseState: "blocked", hyperFramesState: "blocked", message: exact.issues.map((issue) => `${issue.path}: ${issue.message}`).join("；") };
      revision = request.revision;
      artifacts = exact.value;
    }
    const video = artifacts?.videoUseArtifact;
    const hyper = artifacts?.hyperFramesArtifact;
    if (!video || !revision) return { ...base, videoUseState: "idle", hyperFramesState: "idle" };
    const hyperFramesState = !hyper ? "idle" : hyper.status === "accepted" ? "accepted" : hyper.status === "noop" ? "noop" : "blocked";
    const videoUseState = video.status === "pending"
      ? "pending"
      : video.status === "accepted" && video.review && (hyperFramesState === "accepted" || hyperFramesState === "noop")
        ? "accepted"
        : video.status === "accepted" && hyperFramesState === "idle"
          ? "pending"
          : "blocked";
    return { ...base, revision, videoUseState, hyperFramesState, inputSha256: video.evidence.inputSha256 };
  };

  ipcMain.handle(VIDEO_WORKFLOW_STATUS_CHANNEL, async () => buildStatus());
  ipcMain.handle(VIDEO_WORKFLOW_PREPARE_CHANNEL, async (_event, payload: unknown) => handleAction(payload, "prepare"));
  ipcMain.handle(VIDEO_WORKFLOW_UPDATE_CHANNEL, async (_event, payload: unknown) => handleAction(payload, "update"));
  ipcMain.handle(VIDEO_WORKFLOW_REPAIR_CHANNEL, async (_event, payload: unknown) => handleAction(payload, "repair"));
  ipcMain.handle(VIDEO_WORKFLOW_ROLLBACK_CHANNEL, async (_event, payload: unknown) => handleAction(payload, "rollback"));
  ipcMain.handle(VIDEO_WORKFLOW_REVIEW_CHANNEL, async (_event, payload: unknown) => handleReview(payload));
  ipcMain.handle(VIDEO_WORKFLOW_RUN_CHAPTER_CHANNEL, async (_event, payload: unknown) => handleRunChapter(payload));
  ipcMain.handle(VIDEO_WORKFLOW_APPLY_CHAPTER_CHANNEL, async (_event, payload: unknown) => handleApplyChapter(payload));
  ipcMain.handle(VIDEO_WORKFLOW_READ_CHAPTER_CHANNEL, async (_event, payload: unknown) => handleReadChapter(payload));

  return {
    dispose() {
      ipcMain.removeHandler(VIDEO_WORKFLOW_STATUS_CHANNEL);
      ipcMain.removeHandler(VIDEO_WORKFLOW_PREPARE_CHANNEL);
      ipcMain.removeHandler(VIDEO_WORKFLOW_UPDATE_CHANNEL);
      ipcMain.removeHandler(VIDEO_WORKFLOW_REPAIR_CHANNEL);
      ipcMain.removeHandler(VIDEO_WORKFLOW_ROLLBACK_CHANNEL);
      ipcMain.removeHandler(VIDEO_WORKFLOW_REVIEW_CHANNEL);
      ipcMain.removeHandler(VIDEO_WORKFLOW_RUN_CHAPTER_CHANNEL);
      ipcMain.removeHandler(VIDEO_WORKFLOW_APPLY_CHAPTER_CHANNEL);
      ipcMain.removeHandler(VIDEO_WORKFLOW_READ_CHAPTER_CHANNEL);
    },
  };
}
