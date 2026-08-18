// Video QC runtime IPC — 设置面生命周期通道,镜像 upscale-ipc.ts 惯例
// (kebab-case 字面量通道名;契约测试扫描字面量)。
// chapter-qc-* 报告通道在 chapter-qc-ipc.ts(编排器配套),不在此处。

import { ipcMain } from "electron";

import type { VideoQcRuntimeController } from "@rendering/plugins/videoqc/dover-runtime-controller";

export interface RegisterVideoQcIpcOptions {
  controller: VideoQcRuntimeController;
}

export interface VideoQcIpc {
  dispose: () => void;
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

export function registerVideoQcIpcHandlers(options: RegisterVideoQcIpcOptions): VideoQcIpc {
  const { controller } = options;

  ipcMain.handle("video-qc-runtime-probe", () => controller.status());
  ipcMain.handle("video-qc-runtime-status", () => controller.status());
  ipcMain.handle("video-qc-runtime-setup", async () => controller.setup());
  ipcMain.handle("video-qc-runtime-rollback", async () => controller.rollback());
  ipcMain.handle("video-qc-runtime-refresh", async () => controller.refresh());
  ipcMain.handle("video-qc-runtime-scan-model", async () => controller.scanModelInventory());
  ipcMain.handle("video-qc-runtime-download-model", async (_event, payload: unknown) => {
    const modelName = readModelName(payload) ?? "dover-mobile";
    return controller.downloadModel(modelName);
  });
  ipcMain.handle("video-qc-runtime-download-progress", () => controller.readDownloadProgress());
  ipcMain.handle("video-qc-runtime-get-config", () => ({
    modelCacheDir: controller.getModelCacheDir(),
  }));
  ipcMain.handle("video-qc-runtime-set-model-cache-dir", async (_event, payload: unknown) => {
    const dirPath = readModelCacheDir(payload);
    if (typeof dirPath !== "string") {
      return { success: false, error: "dirPath 必须是字符串" };
    }
    return controller.setModelCacheDir(dirPath);
  });
  ipcMain.handle("video-qc-runtime-delete-model", async (_event, payload: unknown) => {
    const modelName = readModelName(payload);
    if (typeof modelName !== "string") {
      return { success: false, error: "model 必须是字符串" };
    }
    return controller.deleteModel(modelName);
  });

  return {
    dispose: () => {
      ipcMain.removeHandler("video-qc-runtime-probe");
      ipcMain.removeHandler("video-qc-runtime-status");
      ipcMain.removeHandler("video-qc-runtime-setup");
      ipcMain.removeHandler("video-qc-runtime-rollback");
      ipcMain.removeHandler("video-qc-runtime-refresh");
      ipcMain.removeHandler("video-qc-runtime-scan-model");
      ipcMain.removeHandler("video-qc-runtime-download-model");
      ipcMain.removeHandler("video-qc-runtime-download-progress");
      ipcMain.removeHandler("video-qc-runtime-get-config");
      ipcMain.removeHandler("video-qc-runtime-set-model-cache-dir");
      ipcMain.removeHandler("video-qc-runtime-delete-model");
    },
  };
}
