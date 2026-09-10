// Local music generation runtime IPC — literal channels (contract test).

import { ipcMain } from "electron";

import type {
  AudioGenRuntimeController,
  AudioGenRuntimeStatus,
} from "@rendering/plugins/audio_gen/audio-gen-runtime-controller";

export interface RegisterAudioGenIpcOptions {
  controller: AudioGenRuntimeController;
  /** Export directory for generated BGM files. */
  getExportDir: () => string;
}

export interface AudioGenIpc {
  dispose: () => void;
}

export function registerAudioGenIpcHandlers(options: RegisterAudioGenIpcOptions): AudioGenIpc {
  const { controller } = options;

  ipcMain.handle("audio-gen-runtime-status", (): AudioGenRuntimeStatus => controller.status());
  ipcMain.handle("audio-gen-runtime-setup", async (): Promise<AudioGenRuntimeStatus> => controller.setup());
  ipcMain.handle("audio-gen-runtime-scan-model", async () => {
    const models = await controller.scanModelInventory();
    return { models };
  });
  ipcMain.handle("audio-gen-runtime-download-model", async () => controller.downloadModel());
  ipcMain.handle("audio-gen-runtime-generate", async (_event, payload: unknown) => {
    const input = payload as { prompt?: unknown; seconds?: unknown; outputDir?: unknown } | null;
    if (!input || typeof input.prompt !== "string" || !input.prompt.trim()) {
      return { status: "blocked" as const, code: "invalid-request", message: "prompt 必填" };
    }
    // The renderer may pass the sentinel "__APP_EXPORTS__"; the main process
    // resolves it to its own export dir so no absolute paths cross the bridge.
    const requestedDir = typeof input.outputDir === "string" ? input.outputDir : "";
    // 09-10 P1:绝对路径一律拒绝——此前绝对路径原样过桥,renderer 可写任意目录
    if (requestedDir.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(requestedDir)) {
      return { status: "blocked" as const, code: "invalid-request", message: "不支持自定义绝对路径,请使用应用导出目录" };
    }
    const outputDir = options.getExportDir();
    return controller.generateMusic({
      prompt: input.prompt,
      ...(typeof input.seconds === "number" ? { seconds: input.seconds } : {}),
      outputDir,
    });
  });

  return {
    dispose: () => {
      ipcMain.removeHandler("audio-gen-runtime-status");
      ipcMain.removeHandler("audio-gen-runtime-setup");
      ipcMain.removeHandler("audio-gen-runtime-scan-model");
      ipcMain.removeHandler("audio-gen-runtime-download-model");
      ipcMain.removeHandler("audio-gen-runtime-generate");
    },
  };
}
