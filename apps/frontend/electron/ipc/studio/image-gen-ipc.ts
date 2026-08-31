// Local image generation runtime IPC — mirrors depth-ipc.ts conventions.
// Channels are string literals (IPC contract test scans for literals).

import { ipcMain } from "electron";

import {
  IMAGE_GEN_SCHEMA_VERSION,
  validateImageGenRuntimeActionReply,
  validateImageGenRuntimeLifecycleRequest,
  validateImageGenRuntimeStatus,
  type ImageGenModelId,
  type ImageGenRuntimeActionReplyV1,
  type ImageGenRuntimeStatusV1,
} from "@rendering/contracts/image-gen-workflow";
import type {
  ImageGenRuntimeController,
  ImageGenRuntimeStatus,
} from "@rendering/plugins/image_gen/image-gen-runtime-controller";

export interface RegisterImageGenIpcOptions {
  controller: ImageGenRuntimeController;
}

export interface ImageGenIpc {
  dispose: () => void;
}

function lifecycleStatus(controller: ImageGenRuntimeController): ImageGenRuntimeStatusV1 {
  const legacy = controller.status();
  // Keep the lifecycle contract aligned with the controller's persisted/current
  // engine.  Hard-coding Qwen here made FLUX/Z-Image selections report the
  // wrong model and readiness state through the IPC bridge.
  const activeModel: ImageGenModelId =
    legacy.activeModel === "z-image-turbo" ||
    legacy.activeModel === "flux2-klein-9b" ||
    legacy.activeModel === "krea2-turbo"
      ? legacy.activeModel
      : "qwen-image-edit-2511";
  const modelDownloaded = legacy.models.some(
    (model) =>
      model.modelName === activeModel &&
      model.downloaded === true &&
      model.smallPiecesReady !== false,
  );
  const status: ImageGenRuntimeStatusV1 = {
    schemaVersion: IMAGE_GEN_SCHEMA_VERSION,
    state: legacy.running && modelDownloaded ? "ready" : "needs-runtime",
    activeModel,
    modelCacheDir: controller.getModelCacheDir(),
    modelDownloaded,
    ...(legacy.setupMessage ? { message: legacy.setupMessage } : {}),
  };
  const validated = validateImageGenRuntimeStatus(status);
  if (validated.success) return validated.value;
  return {
    schemaVersion: IMAGE_GEN_SCHEMA_VERSION,
    state: "error",
    activeModel,
    modelCacheDir: controller.getModelCacheDir(),
    modelDownloaded: false,
    message: "本地图像运行时状态无效",
  };
}

function lifecycleAction(
  controller: ImageGenRuntimeController,
  status: ImageGenRuntimeStatusV1,
  success: boolean,
  code?: string,
  message?: string,
  issues?: ImageGenRuntimeActionReplyV1["issues"],
): ImageGenRuntimeActionReplyV1 {
  const reply: ImageGenRuntimeActionReplyV1 = {
    schemaVersion: IMAGE_GEN_SCHEMA_VERSION,
    success,
    status,
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...(issues ? { issues } : {}),
  };
  const validated = validateImageGenRuntimeActionReply(reply);
  if (validated.success) return validated.value;
  return {
    schemaVersion: IMAGE_GEN_SCHEMA_VERSION,
    success: false,
    status: lifecycleStatus(controller),
    code: "invalid-reply",
    message: "本地图像运行时返回了无效的生命周期回复",
    issues: validated.issues,
  };
}

export function registerImageGenIpcHandlers(options: RegisterImageGenIpcOptions): ImageGenIpc {
  const { controller } = options;

  ipcMain.handle("image-gen-runtime-probe", async (_event, payload: unknown): Promise<ImageGenRuntimeStatusV1> => {
    const request = validateImageGenRuntimeLifecycleRequest(
      payload === undefined ? { schemaVersion: IMAGE_GEN_SCHEMA_VERSION } : payload,
    );
    if (!request.success) {
      return {
        ...lifecycleStatus(controller),
        state: "blocked",
        message: request.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
      };
    }
    const status = await controller.probeLifecycle();
    const validated = validateImageGenRuntimeStatus(status);
    return validated.success
      ? validated.value
      : { ...lifecycleStatus(controller), state: "error", message: "本地图像运行时状态无效" };
  });

  ipcMain.handle("image-gen-runtime-prepare", async (_event, payload: unknown): Promise<ImageGenRuntimeActionReplyV1> => {
    const request = validateImageGenRuntimeLifecycleRequest(
      payload === undefined ? { schemaVersion: IMAGE_GEN_SCHEMA_VERSION } : payload,
    );
    if (!request.success) {
      return lifecycleAction(controller, lifecycleStatus(controller), false, "invalid-request", "生命周期请求无效", request.issues);
    }
    try {
      const status = await controller.prepareLifecycle();
      return lifecycleAction(
        controller,
        status,
        status.state === "ready",
        status.state === "ready" ? undefined : status.state,
        status.message,
      );
    } catch (error) {
      return lifecycleAction(
        controller,
        lifecycleStatus(controller),
        false,
        "prepare-failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  ipcMain.handle("image-gen-runtime-rollback", async (_event, payload: unknown): Promise<ImageGenRuntimeActionReplyV1> => {
    const request = validateImageGenRuntimeLifecycleRequest(
      payload === undefined ? { schemaVersion: IMAGE_GEN_SCHEMA_VERSION } : payload,
    );
    if (!request.success) {
      return lifecycleAction(controller, lifecycleStatus(controller), false, "invalid-request", "生命周期请求无效", request.issues);
    }
    try {
      const status = await controller.rollbackLifecycle();
      return lifecycleAction(
        controller,
        status,
        status.state === "needs-runtime",
        status.state === "needs-runtime" ? undefined : "rollback-failed",
        status.message,
      );
    } catch (error) {
      return lifecycleAction(
        controller,
        lifecycleStatus(controller),
        false,
        "rollback-failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  ipcMain.handle("image-gen-runtime-status", (): ImageGenRuntimeStatus => controller.status());
  ipcMain.handle("image-gen-runtime-setup", async (): Promise<ImageGenRuntimeStatus> => controller.setup());
  ipcMain.handle("image-gen-runtime-stop", async (): Promise<ImageGenRuntimeStatus> => {
    await controller.stop();
    return controller.status();
  });
  ipcMain.handle("image-gen-runtime-scan-model", async () => {
    const models = await controller.scanModelInventory();
    return { models };
  });
  ipcMain.handle("image-gen-runtime-download-model", async (_event, payload: unknown) => {
    const modelName = typeof payload === "string" ? payload : (payload as { model?: unknown })?.model;
    if (typeof modelName !== "string" || !modelName) {
      return { accepted: false, message: "model 必须是非空字符串" };
    }
    return controller.downloadModel(modelName);
  });
  ipcMain.handle("image-gen-runtime-set-active-model", (_event, payload: unknown) => {
    if (typeof payload !== "string") return { accepted: false, message: "model 必须是字符串" };
    const accepted = controller.setActiveModel(payload);
    return accepted
      ? { accepted: true, message: "已切换本地生图模型" }
      : { accepted: false, message: `未知模型: ${payload}` };
  });

  return {
    dispose: () => {
      ipcMain.removeHandler("image-gen-runtime-probe");
      ipcMain.removeHandler("image-gen-runtime-prepare");
      ipcMain.removeHandler("image-gen-runtime-rollback");
      ipcMain.removeHandler("image-gen-runtime-status");
      ipcMain.removeHandler("image-gen-runtime-setup");
      ipcMain.removeHandler("image-gen-runtime-stop");
      ipcMain.removeHandler("image-gen-runtime-scan-model");
      ipcMain.removeHandler("image-gen-runtime-download-model");
      ipcMain.removeHandler("image-gen-runtime-set-active-model");
    },
  };
}
