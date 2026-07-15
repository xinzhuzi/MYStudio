import fs from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import type { TtsRuntimeController } from "../tts-runtime";

type RunTtsDiagnostics = <T>(
  action: string,
  context: Record<string, unknown>,
  run: () => Promise<T>,
) => Promise<T>;

type RegisterTtsIpcHandlersContext = {
  controller: TtsRuntimeController;
  runDiagnostics: RunTtsDiagnostics;
  resolveSourcePath: (sourcePath: string) => string;
};

export function registerTtsIpcHandlers({
  controller,
  runDiagnostics,
  resolveSourcePath,
}: RegisterTtsIpcHandlersContext) {
  ipcMain.handle("tts-runtime-status", async () => (
    runDiagnostics("status", {}, () => controller.status())
  ));
  ipcMain.handle("tts-runtime-start", async () => (
    runDiagnostics("start", {}, () => controller.start())
  ));
  ipcMain.handle("tts-runtime-setup", async () => (
    runDiagnostics("setup", {}, () => controller.setup())
  ));
  ipcMain.handle("tts-runtime-stop", async () => (
    runDiagnostics("stop", {}, () => controller.stop())
  ));
  ipcMain.handle("tts-runtime-get-config", async () => controller.getConfig());
  ipcMain.handle("tts-runtime-set-config", async (
    _event,
    config: Parameters<TtsRuntimeController["setConfig"]>[0],
  ) => runDiagnostics("set-config", { config }, () => controller.setConfig(config)));
  ipcMain.handle("tts-runtime-set-model-cache-dir", async (_event, dirPath: string) => (
    runDiagnostics("set-model-cache-dir", { dirPath }, () => controller.setModelCacheDir(dirPath))
  ));
  ipcMain.handle("tts-runtime-request", async (
    _event,
    payload: { method: string; path: string; body?: unknown },
  ) => runDiagnostics("request", payload, () => controller.request(payload.method, payload.path, payload.body)));
  ipcMain.handle("tts-runtime-request-bytes", async (
    _event,
    payload: { method: string; path: string; body?: unknown },
  ) => runDiagnostics("request-bytes", payload, () => controller.requestBytes(payload.method, payload.path, payload.body)));
  ipcMain.handle("tts-runtime-request-formdata", async (
    _event,
    payload: { path: string; audioFilePath: string; referenceText?: string },
  ) => runDiagnostics("request-formdata", {
    path: payload.path,
    audioFilePath: payload.audioFilePath,
    referenceTextLength: payload.referenceText?.length ?? 0,
  }, () => controller.requestFormData(payload.path, payload.audioFilePath, payload.referenceText)));
  ipcMain.handle("tts-reference-audio-resolve", async (_event, audioPath: string) => {
    try {
      if (typeof audioPath !== "string" || !audioPath.trim()) return null;
      const resolvedPath = resolveSourcePath(audioPath.trim());
      if (!path.isAbsolute(resolvedPath)) return null;
      const stat = await fs.promises.stat(resolvedPath);
      if (!stat.isFile() || stat.size <= 0) return null;
      await fs.promises.access(resolvedPath, fs.constants.R_OK);
      return resolvedPath;
    } catch {
      return null;
    }
  });
}
