// Local image generation runtime IPC — mirrors depth-ipc.ts conventions.
// Channels are string literals (IPC contract test scans for literals).

import { ipcMain } from "electron";

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

export function registerImageGenIpcHandlers(options: RegisterImageGenIpcOptions): ImageGenIpc {
  const { controller } = options;

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
      ipcMain.removeHandler("image-gen-runtime-status");
      ipcMain.removeHandler("image-gen-runtime-setup");
      ipcMain.removeHandler("image-gen-runtime-stop");
      ipcMain.removeHandler("image-gen-runtime-scan-model");
      ipcMain.removeHandler("image-gen-runtime-download-model");
      ipcMain.removeHandler("image-gen-runtime-set-active-model");
    },
  };
}
