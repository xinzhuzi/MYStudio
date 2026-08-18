// Local sfx generation runtime IPC — literal channels (contract test).

import { ipcMain } from "electron";

import type {
  SfxGenRuntimeController,
  SfxGenRuntimeStatus,
} from "@rendering/plugins/sfx_gen/sfx-gen-runtime-controller";

export interface RegisterSfxGenIpcOptions {
  controller: SfxGenRuntimeController;
  /** Export directory for generated sfx files. */
  getExportDir: () => string;
}

export interface SfxGenIpc {
  dispose: () => void;
}

export function registerSfxGenIpcHandlers(options: RegisterSfxGenIpcOptions): SfxGenIpc {
  const { controller } = options;

  ipcMain.handle("sfx-gen-runtime-status", (): SfxGenRuntimeStatus => controller.status());
  ipcMain.handle("sfx-gen-runtime-setup", async (): Promise<SfxGenRuntimeStatus> => controller.setup());
  ipcMain.handle("sfx-gen-runtime-scan-model", async () => {
    const models = await controller.scanModelInventory();
    return { models };
  });
  ipcMain.handle("sfx-gen-runtime-download-model", async (_event, payload: unknown) => {
    const input = payload as { model?: unknown } | null;
    const model = typeof input?.model === "string" && input.model.trim() ? input.model.trim() : "sfx-musicgen-small";
    return controller.downloadModel(model);
  });
  ipcMain.handle("sfx-gen-runtime-generate", async (_event, payload: unknown) => {
    const input = payload as { prompt?: unknown; seed?: unknown; seconds?: unknown; model?: unknown; outputDir?: unknown } | null;
    if (!input || typeof input.prompt !== "string" || !input.prompt.trim()) {
      return { status: "blocked" as const, code: "invalid-request", message: "prompt 必填" };
    }
    // The renderer may pass the sentinel "__APP_EXPORTS__"; the main process
    // resolves it to its own export dir so no absolute paths cross the bridge.
    const requestedDir = typeof input.outputDir === "string" ? input.outputDir : "";
    const outputDir = requestedDir === "__APP_EXPORTS__" || !requestedDir.startsWith("/")
      ? options.getExportDir()
      : requestedDir;
    return controller.generateSfx({
      prompt: input.prompt,
      ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
      ...(typeof input.seconds === "number" ? { seconds: input.seconds } : {}),
      ...(typeof input.model === "string" ? { model: input.model } : {}),
      outputDir,
    });
  });

  return {
    dispose: () => {
      ipcMain.removeHandler("sfx-gen-runtime-status");
      ipcMain.removeHandler("sfx-gen-runtime-setup");
      ipcMain.removeHandler("sfx-gen-runtime-scan-model");
      ipcMain.removeHandler("sfx-gen-runtime-download-model");
      ipcMain.removeHandler("sfx-gen-runtime-generate");
    },
  };
}
