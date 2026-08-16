// Depth runtime IPC — settings-facing lifecycle for the depth estimation
// model. Mirrors the tts-ipc.ts channel conventions (kebab-case domain prefix
// + verb). All handlers fail closed with structured errors.
//
// NOTE: channels are string literals (not constants) because the IPC contract
// test scans for ipcMain.handle with literal channel strings.

import { ipcMain } from "electron";
import path from "node:path";

import {
  DEPTH_SCHEMA_VERSION,
  validateDepthRuntimeActionReply,
  validateDepthRuntimeLifecycleRequest,
  validateDepthRuntimeStatus,
  type DepthRuntimeActionReplyV1,
  type DepthRuntimeStatusV1,
} from "@rendering/contracts/depth-workflow";
import type {
  DepthRuntimeController,
  DepthRuntimeStatus,
} from "@rendering/plugins/depth/depth-runtime-controller";
import {
  createVideoPipelineLogBundle,
  writeLogBundle,
} from "@rendering/plugins/video-workflow/video-pipeline-log-bundle";

export interface RegisterDepthIpcOptions {
  controller: DepthRuntimeController;
  /** Project data root for the log bundle export. */
  getDataRoot: () => string;
  /** Diagnostics JSONL directory. */
  getDiagnosticsDir: () => string;
  /** Export directory for log bundles. */
  getExportDir: () => string;
}

export interface DepthIpc {
  dispose: () => void;
}

function lifecycleStatus(status: DepthRuntimeStatus): DepthRuntimeStatusV1 {
  const rawModelCacheDir = typeof status.modelCacheDir === "string" && status.modelCacheDir.length > 0
    ? status.modelCacheDir
    : ".";
  const modelCacheDir = path.isAbsolute(rawModelCacheDir) || /^[A-Za-z]:[\\/]/.test(rawModelCacheDir)
    ? rawModelCacheDir
    : path.resolve(rawModelCacheDir);
  const candidate: Record<string, unknown> = {
    schemaVersion: DEPTH_SCHEMA_VERSION,
    state: status.state,
    model: "depth-anything-v2-small",
    modelCacheDir,
    modelDownloaded: status.modelDownloaded === true,
  };
  const message = status.setupMessage ?? status.message;
  if (typeof message === "string" && message.length > 0) candidate.message = message;
  const validated = validateDepthRuntimeStatus(candidate);
  if (validated.success) return validated.value;
  return {
    schemaVersion: DEPTH_SCHEMA_VERSION,
    state: "error",
    model: "depth-anything-v2-small",
    modelCacheDir,
    modelDownloaded: false,
    message: "深度运行时状态无效",
  };
}

function readStringMap(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const map: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") return null;
    map[key] = entry;
  }
  return map;
}

function readModelCacheDir(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const dir = Object.entries(value).find(([key]) => key === "dir")?.[1];
  return typeof dir === "string" ? dir : undefined;
}

function lifecycleAction(
  status: DepthRuntimeStatus,
  success: boolean,
  message?: string,
  code?: string,
  issues?: DepthRuntimeActionReplyV1["issues"],
): DepthRuntimeActionReplyV1 {
  const reply: DepthRuntimeActionReplyV1 = {
    schemaVersion: DEPTH_SCHEMA_VERSION,
    success,
    status: lifecycleStatus(status),
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...(issues ? { issues } : {}),
  };
  const validated = validateDepthRuntimeActionReply(reply);
  if (validated.success) return validated.value;
  return {
    schemaVersion: DEPTH_SCHEMA_VERSION,
    success: false,
    status: lifecycleStatus(status),
    code: "invalid-reply",
    message: "深度运行时返回了无效的生命周期回复",
    issues: validated.issues,
  };
}

function invalidLifecycleAction(
  controller: DepthRuntimeController,
  issues: DepthRuntimeActionReplyV1["issues"],
): DepthRuntimeActionReplyV1 {
  return lifecycleAction(controller.status(), false, "生命周期请求无效", "invalid-request", issues);
}

export function registerDepthIpcHandlers(options: RegisterDepthIpcOptions): DepthIpc {
  const { controller } = options;

  ipcMain.handle("depth-runtime-probe", (_event, payload: unknown): DepthRuntimeStatusV1 => {
    const request = validateDepthRuntimeLifecycleRequest(payload === undefined ? { schemaVersion: DEPTH_SCHEMA_VERSION } : payload);
    if (!request.success) {
      const blocked = lifecycleStatus({
        ...controller.status(),
        state: "blocked",
        message: "生命周期请求无效",
      });
      return { ...blocked, message: request.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ") };
    }
    const status = lifecycleStatus(controller.status());
    const validated = validateDepthRuntimeStatus(status);
    return validated.success
      ? validated.value
      : { ...status, state: "error", message: "深度运行时状态无效" };
  });

  ipcMain.handle("depth-runtime-prepare", async (_event, payload: unknown): Promise<DepthRuntimeActionReplyV1> => {
    const request = validateDepthRuntimeLifecycleRequest(payload === undefined ? { schemaVersion: DEPTH_SCHEMA_VERSION } : payload);
    if (!request.success) return invalidLifecycleAction(controller, request.issues);
    try {
      const status = await controller.setup();
      return lifecycleAction(status, status.state === "ready", status.setupMessage ?? status.message, status.state === "ready" ? undefined : status.state);
    } catch (error) {
      const status = controller.status();
      return lifecycleAction(status, false, error instanceof Error ? error.message : String(error), "prepare-failed");
    }
  });

  ipcMain.handle("depth-runtime-rollback", async (_event, payload: unknown): Promise<DepthRuntimeActionReplyV1> => {
    const request = validateDepthRuntimeLifecycleRequest(payload === undefined ? { schemaVersion: DEPTH_SCHEMA_VERSION } : payload);
    if (!request.success) return invalidLifecycleAction(controller, request.issues);
    try {
      const status = await controller.rollback();
      return lifecycleAction(status, status.state === "needs-runtime", status.setupMessage ?? status.message, status.state === "needs-runtime" ? undefined : "rollback-failed");
    } catch (error) {
      const status = controller.status();
      return lifecycleAction(status, false, error instanceof Error ? error.message : String(error), "rollback-failed");
    }
  });

  ipcMain.handle("depth-runtime-status", (): DepthRuntimeStatus => controller.status());
  ipcMain.handle("depth-runtime-setup", async (): Promise<DepthRuntimeStatus> => controller.setup());
  ipcMain.handle("depth-runtime-refresh", async (): Promise<DepthRuntimeStatus> => controller.refresh());
  ipcMain.handle("depth-runtime-scan-model", async () => controller.scanModelInventory());
  ipcMain.handle("depth-runtime-download-model", async () => controller.downloadModel());
  ipcMain.handle("depth-runtime-download-progress", () => controller.readDownloadProgress());
  ipcMain.handle("depth-runtime-set-cinematic-preset", (_event, preset: unknown) => {
    if (typeof preset !== "string") return { accepted: false, message: "preset 必须是字符串" };
    const accepted = controller.setCinematicPreset(preset);
    return accepted
      ? { accepted: true, message: "已更新 3D 相机预设" }
      : { accepted: false, message: `未知的相机预设: ${preset}` };
  });

  // AI auto mode: per-shot preset map produced by the script analysis.
  ipcMain.handle("depth-runtime-set-cinematic-mode", (_event, mode: unknown) => {
    if (mode !== "auto" && mode !== "manual") {
      return { accepted: false, message: "mode 必须是 auto 或 manual" };
    }
    controller.setCinematicPresetMode(mode);
    return { accepted: true, message: mode === "auto" ? "已切换为 AI 自动镜头语言" : "已切换为手动预设" };
  });
  ipcMain.handle("depth-runtime-set-preset-map", (_event, payload: unknown) => {
    const map = readStringMap(payload);
    if (!map) {
      return { accepted: false, count: 0, message: "payload 必须是 shotId->preset 对象" };
    }
    const count = controller.setCinematicPresetMap(map);
    return { accepted: count > 0, count, message: count > 0 ? `已应用 ${count} 条分镜预设` : "没有有效的预设条目" };
  });

  // Model cache directory management (mirrors tts-runtime-set-model-cache-dir).
  ipcMain.handle("depth-runtime-get-config", () => ({
    modelCacheDir: controller.getModelCacheDir(),
  }));
  ipcMain.handle("depth-runtime-set-model-cache-dir", async (_event, payload: unknown) => {
    const dirPath = readModelCacheDir(payload);
    if (typeof dirPath !== "string") {
      return { success: false, error: "dirPath 必须是字符串" };
    }
    return controller.setModelCacheDir(dirPath);
  });
  ipcMain.handle("depth-runtime-delete-model", async () => controller.deleteModel());

  // 三段链路日志打包导出: Remotion evidence + video-use + HyperFrames + 诊断日志.
  ipcMain.handle("video-pipeline-export-log-bundle", async (_event, payload: { projectId?: unknown; chapterId?: unknown; revision?: unknown }): Promise<{ success: boolean; path?: string; error?: string }> => {
      const { projectId, chapterId, revision } = payload ?? {};
      if (typeof projectId !== "string" || typeof chapterId !== "string"
        || !/^[A-Za-z0-9._-]+$/.test(projectId) || !/^[A-Za-z0-9._-]+$/.test(chapterId)) {
        return { success: false, error: "projectId 和 chapterId 必须是安全路径段" };
      }
      try {
        const bundle = createVideoPipelineLogBundle({
          dataRoot: options.getDataRoot(),
          projectId,
          chapterId,
          ...(typeof revision === "number" && revision > 0 ? { revision } : {}),
          diagnosticsDir: options.getDiagnosticsDir(),
        });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outputPath = writeLogBundle(
          bundle,
          path.join(options.getExportDir(), `video-pipeline-bundle-${projectId}-${chapterId}-${stamp}.json`),
        );
        return { success: true, path: outputPath };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

  return {
    dispose: () => {
      ipcMain.removeHandler("depth-runtime-probe");
      ipcMain.removeHandler("depth-runtime-prepare");
      ipcMain.removeHandler("depth-runtime-rollback");
      ipcMain.removeHandler("depth-runtime-status");
      ipcMain.removeHandler("depth-runtime-setup");
      ipcMain.removeHandler("depth-runtime-refresh");
      ipcMain.removeHandler("depth-runtime-scan-model");
      ipcMain.removeHandler("depth-runtime-download-model");
      ipcMain.removeHandler("depth-runtime-download-progress");
      ipcMain.removeHandler("depth-runtime-set-cinematic-preset");
      ipcMain.removeHandler("depth-runtime-set-cinematic-mode");
      ipcMain.removeHandler("depth-runtime-set-preset-map");
      ipcMain.removeHandler("depth-runtime-get-config");
      ipcMain.removeHandler("depth-runtime-set-model-cache-dir");
      ipcMain.removeHandler("depth-runtime-delete-model");
      ipcMain.removeHandler("video-pipeline-export-log-bundle");
    },
  };
}
