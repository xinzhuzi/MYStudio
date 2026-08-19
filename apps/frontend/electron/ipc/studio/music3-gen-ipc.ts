// MiniMax-Music3 runtime IPC — literal channels (contract test).

import { ipcMain } from "electron";

import type {
  Music3GenRuntimeController,
  Music3GenRuntimeStatus,
} from "@rendering/plugins/music3_gen/music3-gen-runtime-controller";

export interface RegisterMusic3GenIpcOptions {
  controller: Music3GenRuntimeController;
  /** Export directory for generated BGM files. */
  getExportDir: () => string;
}

export interface Music3GenIpc {
  dispose: () => void;
}

export function registerMusic3GenIpcHandlers(options: RegisterMusic3GenIpcOptions): Music3GenIpc {
  const { controller } = options;

  ipcMain.handle("music3-gen-runtime-status", (): Music3GenRuntimeStatus => controller.status());
  ipcMain.handle("music3-gen-runtime-setup", async (): Promise<Music3GenRuntimeStatus> => controller.setup());
  ipcMain.handle("music3-gen-runtime-scan-model", async () => {
    const models = await controller.scanModelInventory();
    return { models };
  });
  ipcMain.handle("music3-gen-runtime-download-model", async (_event, payload: unknown) => {
    const input = payload as { model?: unknown } | null;
    const model = typeof input?.model === "string" && input.model.trim() ? input.model.trim() : "minimax-music3-mlx";
    return controller.downloadModel(model);
  });
  ipcMain.handle("music3-gen-runtime-generate", async (_event, payload: unknown) => {
    const input = payload as { prompt?: unknown; seed?: unknown; seconds?: unknown; steps?: unknown; outputDir?: unknown } | null;
    if (!input || typeof input.prompt !== "string" || !input.prompt.trim()) {
      return { status: "blocked" as const, code: "invalid-request", message: "prompt 必填" };
    }
    // The renderer may pass the sentinel "__APP_EXPORTS__"; the main process
    // resolves it to its own export dir so no absolute paths cross the bridge.
    const requestedDir = typeof input.outputDir === "string" ? input.outputDir : "";
    const outputDir = requestedDir === "__APP_EXPORTS__" || !requestedDir.startsWith("/")
      ? options.getExportDir()
      : requestedDir;
    return controller.generateMusic3({
      prompt: input.prompt,
      ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
      ...(typeof input.seconds === "number" ? { seconds: input.seconds } : {}),
      ...(typeof input.steps === "number" ? { steps: input.steps } : {}),
      outputDir,
    });
  });

  return {
    dispose: () => {
      ipcMain.removeHandler("music3-gen-runtime-status");
      ipcMain.removeHandler("music3-gen-runtime-setup");
      ipcMain.removeHandler("music3-gen-runtime-scan-model");
      ipcMain.removeHandler("music3-gen-runtime-download-model");
      ipcMain.removeHandler("music3-gen-runtime-generate");
    },
  };
}
