// Upscale runtime IPC — settings-facing lifecycle + run channel for the local
// image super-resolution models. Mirrors the depth-ipc.ts channel conventions
// (kebab-case domain prefix + verb). All handlers fail closed with structured
// errors.
//
// NOTE: channels are string literals (not constants) because the IPC contract
// test scans for ipcMain.handle with literal channel strings.

import { ipcMain } from "electron";

import {
  UPSCALE_SCHEMA_VERSION,
  validateUpscaleRuntimeActionReply,
  validateUpscaleRuntimeLifecycleRequest,
  validateUpscaleRuntimeStatus,
  type UpscaleRuntimeActionReplyV1,
  type UpscaleRuntimeStatusV1,
} from "@rendering/contracts/upscale-workflow";
import type {
  UpscaleRuntimeController,
  UpscaleRuntimeStatus,
} from "@rendering/plugins/upscale/upscale-runtime-controller";

export interface RegisterUpscaleIpcOptions {
  controller: UpscaleRuntimeController;
}

export interface UpscaleIpc {
  dispose: () => void;
}

function lifecycleStatus(status: UpscaleRuntimeStatus): UpscaleRuntimeStatusV1 {
  return {
    schemaVersion: UPSCALE_SCHEMA_VERSION,
    state: status.state,
    activeModel: status.activeModel,
    modelCacheDir: status.modelCacheDir,
    modelDownloaded: status.modelDownloaded,
    ...(status.message ? { message: status.message } : {}),
  };
}

function lifecycleAction(
  status: UpscaleRuntimeStatus,
  success: boolean,
  message?: string,
  code?: string,
  issues?: UpscaleRuntimeActionReplyV1["issues"],
): UpscaleRuntimeActionReplyV1 {
  const reply: UpscaleRuntimeActionReplyV1 = {
    schemaVersion: UPSCALE_SCHEMA_VERSION,
    success,
    status: lifecycleStatus(status),
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...(issues ? { issues } : {}),
  };
  const validated = validateUpscaleRuntimeActionReply(reply);
  if (validated.success) return validated.value;
  return {
    schemaVersion: UPSCALE_SCHEMA_VERSION,
    success: false,
    status: lifecycleStatus(status),
    code: "invalid-reply",
    message: "超分运行时返回了无效的生命周期回复",
    issues: validated.issues,
  };
}

function invalidLifecycleAction(
  controller: UpscaleRuntimeController,
  issues: UpscaleRuntimeActionReplyV1["issues"],
): UpscaleRuntimeActionReplyV1 {
  return lifecycleAction(controller.status(), false, "生命周期请求无效", "invalid-request", issues);
}

function readModelCacheDir(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const dir = Object.entries(value).find(([key]) => key === "dir")?.[1];
  return typeof dir === "string" ? dir : undefined;
}

function readModelName(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const model = Object.entries(value).find(([key]) => key === "model" || key === "modelName")?.[1];
  return typeof model === "string" ? model : undefined;
}

export function registerUpscaleIpcHandlers(options: RegisterUpscaleIpcOptions): UpscaleIpc {
  const { controller } = options;

  ipcMain.handle("upscale-runtime-probe", (_event, payload: unknown): UpscaleRuntimeStatusV1 => {
    const request = validateUpscaleRuntimeLifecycleRequest(payload === undefined ? { schemaVersion: UPSCALE_SCHEMA_VERSION } : payload);
    if (!request.success) {
      const blocked = lifecycleStatus({
        ...controller.status(),
        state: "blocked",
        message: "生命周期请求无效",
      });
      return { ...blocked, message: request.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ") };
    }
    const status = lifecycleStatus(controller.status());
    const validated = validateUpscaleRuntimeStatus(status);
    return validated.success
      ? validated.value
      : { ...status, state: "error", message: "超分运行时状态无效" };
  });

  ipcMain.handle("upscale-runtime-prepare", async (_event, payload: unknown): Promise<UpscaleRuntimeActionReplyV1> => {
    const request = validateUpscaleRuntimeLifecycleRequest(payload === undefined ? { schemaVersion: UPSCALE_SCHEMA_VERSION } : payload);
    if (!request.success) return invalidLifecycleAction(controller, request.issues);
    try {
      const status = await controller.setup();
      return lifecycleAction(status, status.state === "ready", status.setupMessage ?? status.message, status.state === "ready" ? undefined : status.state);
    } catch (error) {
      const status = controller.status();
      return lifecycleAction(status, false, error instanceof Error ? error.message : String(error), "prepare-failed");
    }
  });

  ipcMain.handle("upscale-runtime-rollback", async (_event, payload: unknown): Promise<UpscaleRuntimeActionReplyV1> => {
    const request = validateUpscaleRuntimeLifecycleRequest(payload === undefined ? { schemaVersion: UPSCALE_SCHEMA_VERSION } : payload);
    if (!request.success) return invalidLifecycleAction(controller, request.issues);
    try {
      const status = await controller.rollback();
      return lifecycleAction(status, status.state === "needs-runtime", status.setupMessage ?? status.message, status.state === "needs-runtime" ? undefined : "rollback-failed");
    } catch (error) {
      const status = controller.status();
      return lifecycleAction(status, false, error instanceof Error ? error.message : String(error), "rollback-failed");
    }
  });

  ipcMain.handle("upscale-runtime-status", (): UpscaleRuntimeStatus => controller.status());
  ipcMain.handle("upscale-runtime-setup", async (): Promise<UpscaleRuntimeStatus> => controller.setup());
  ipcMain.handle("upscale-runtime-refresh", async (): Promise<UpscaleRuntimeStatus> => controller.refresh());
  ipcMain.handle("upscale-runtime-scan-model", async () => controller.scanModelInventory());
  ipcMain.handle("upscale-runtime-download-model", async (_event, payload: unknown) => {
    const modelName = readModelName(payload) ?? controller.status().activeModel;
    return controller.downloadModel(modelName);
  });
  ipcMain.handle("upscale-runtime-download-progress", () => controller.readDownloadProgress());
  ipcMain.handle("upscale-runtime-set-active-model", (_event, payload: unknown) => {
    const modelName = readModelName(payload);
    if (typeof modelName !== "string") {
      return { success: false, error: "model 必须是字符串" };
    }
    return controller.setActiveModel(modelName);
  });
  ipcMain.handle("upscale-run", async (_event, payload: unknown) => controller.runUpscale(payload));

  // Model cache directory management (mirrors depth-runtime-set-model-cache-dir).
  ipcMain.handle("upscale-runtime-get-config", () => ({
    modelCacheDir: controller.getModelCacheDir(),
  }));
  ipcMain.handle("upscale-runtime-set-model-cache-dir", async (_event, payload: unknown) => {
    const dirPath = readModelCacheDir(payload);
    if (typeof dirPath !== "string") {
      return { success: false, error: "dirPath 必须是字符串" };
    }
    return controller.setModelCacheDir(dirPath);
  });
  ipcMain.handle("upscale-runtime-delete-model", async (_event, payload: unknown) => {
    const modelName = readModelName(payload);
    if (typeof modelName !== "string") {
      return { success: false, error: "model 必须是字符串" };
    }
    return controller.deleteModel(modelName);
  });

  return {
    dispose: () => {
      ipcMain.removeHandler("upscale-runtime-probe");
      ipcMain.removeHandler("upscale-runtime-prepare");
      ipcMain.removeHandler("upscale-runtime-rollback");
      ipcMain.removeHandler("upscale-runtime-status");
      ipcMain.removeHandler("upscale-runtime-setup");
      ipcMain.removeHandler("upscale-runtime-refresh");
      ipcMain.removeHandler("upscale-runtime-scan-model");
      ipcMain.removeHandler("upscale-runtime-download-model");
      ipcMain.removeHandler("upscale-runtime-download-progress");
      ipcMain.removeHandler("upscale-runtime-set-active-model");
      ipcMain.removeHandler("upscale-run");
      ipcMain.removeHandler("upscale-runtime-get-config");
      ipcMain.removeHandler("upscale-runtime-set-model-cache-dir");
      ipcMain.removeHandler("upscale-runtime-delete-model");
    },
  };
}
