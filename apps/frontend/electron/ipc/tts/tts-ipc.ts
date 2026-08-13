import fs from "node:fs";
import path from "node:path";
import { ipcMain } from "electron";
import {
  TtsRuntimeError,
  type TtsRuntimeController,
} from "../../tts/tts-runtime";
import type { TtsRuntimeConfig } from "@/types/tts";

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

export interface TtsRuntimeRequestPayload {
  method: string;
  path: string;
  body?: unknown;
}

export interface TtsRuntimeFormDataPayload {
  path: string;
  audioFilePath: string;
  referenceText?: string;
}

export type TtsRuntimeConfigPayload = Pick<Partial<TtsRuntimeConfig>, "pythonRuntimeUrl" | "pythonRuntimeDir">;

export function decodeTtsRuntimeRequestPayload(value: unknown): TtsRuntimeRequestPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ["method", "path", "body"])) {
    throw invalidTtsRequest("TTS 请求 payload 字段无效");
  }
  if (typeof value.method !== "string" || !value.method.trim()) {
    throw invalidTtsRequest("TTS 请求 method 无效");
  }
  if (typeof value.path !== "string" || !value.path.trim()) {
    throw invalidTtsRequest("TTS 请求 path 无效");
  }
  return {
    method: value.method,
    path: value.path,
    body: value.body,
  };
}

export function decodeTtsRuntimeFormDataPayload(value: unknown): TtsRuntimeFormDataPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ["path", "audioFilePath", "audio_file_path", "referenceText", "reference_text"])) {
    throw invalidTtsRequest("TTS 音频上传 payload 字段无效");
  }
  const audioFilePath = readCompatibleString(value, "audioFilePath", "audio_file_path");
  if (typeof value.path !== "string" || !value.path.trim() || !audioFilePath?.trim()) {
    throw invalidTtsRequest("TTS 音频上传路径无效");
  }
  const referenceText = readCompatibleString(value, "referenceText", "reference_text");
  return {
    path: value.path,
    audioFilePath,
    referenceText,
  };
}

export function decodeTtsRuntimeConfigPayload(value: unknown): TtsRuntimeConfigPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ["pythonRuntimeUrl", "pythonRuntimeDir"])) {
    throw invalidTtsRequest("TTS 运行环境配置字段无效");
  }
  if (value.pythonRuntimeUrl !== undefined && typeof value.pythonRuntimeUrl !== "string") {
    throw invalidTtsRequest("TTS 运行环境地址无效");
  }
  if (value.pythonRuntimeDir !== undefined && typeof value.pythonRuntimeDir !== "string") {
    throw invalidTtsRequest("TTS 运行环境路径无效");
  }
  return {
    pythonRuntimeUrl: value.pythonRuntimeUrl,
    pythonRuntimeDir: value.pythonRuntimeDir,
  };
}

export function decodeTtsRuntimeModelCacheDirPayload(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw invalidTtsRequest("TTS 模型缓存路径无效");
  }
  return value;
}

function readCompatibleString(
  value: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): string | undefined {
  const camelValue = value[camelKey];
  const snakeValue = value[snakeKey];
  if (camelValue !== undefined && typeof camelValue !== "string") throw invalidTtsRequest(`TTS 字段 ${camelKey} 无效`);
  if (snakeValue !== undefined && typeof snakeValue !== "string") throw invalidTtsRequest(`TTS 字段 ${snakeKey} 无效`);
  if (camelValue !== undefined && snakeValue !== undefined && camelValue !== snakeValue) {
    throw invalidTtsRequest(`TTS 字段 ${camelKey}/${snakeKey} 冲突`);
  }
  return (camelValue ?? snakeValue) as string | undefined;
}

function invalidTtsRequest(message: string): TtsRuntimeError {
  return new TtsRuntimeError({
    code: "invalid-request",
    message,
    retryable: false,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

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
  ipcMain.handle("tts-runtime-migrate-storage", async () => (
    runDiagnostics("migrate-storage", {}, () => controller.migrateStorage())
  ));
  ipcMain.handle("tts-runtime-read-requirements", async () => controller.readRequirements());
  ipcMain.handle("tts-runtime-scan-model-inventory", async () => controller.scanModelInventory());
  ipcMain.handle("tts-runtime-delete", async () => (
    runDiagnostics("delete", {}, () => controller.deleteRuntime())
  ));
  ipcMain.handle("tts-runtime-get-config", async () => controller.getConfig());
  ipcMain.handle("tts-runtime-set-config", async (
    _event,
    payload: unknown,
  ) => {
    const config = decodeTtsRuntimeConfigPayload(payload);
    return runDiagnostics("set-config", { config }, () => controller.setConfig(config));
  });
  ipcMain.handle("tts-runtime-set-model-cache-dir", async (_event, payload: unknown) => {
    const dirPath = decodeTtsRuntimeModelCacheDirPayload(payload);
    return runDiagnostics("set-model-cache-dir", { dirPath }, () => controller.setModelCacheDir(dirPath));
  });
  // The existing preload facade carries method/path/body only; it has no cancel
  // channel or transferable AbortSignal. Deadlines stay host-owned, while
  // renderer cancellation remains in the existing worker protocol.
  ipcMain.handle("tts-runtime-request", async (
    _event,
    payload: unknown,
  ) => {
    const request = decodeTtsRuntimeRequestPayload(payload);
    return runDiagnostics("request", { ...request }, () => controller.request(request.method, request.path, request.body));
  });
  ipcMain.handle("tts-runtime-request-bytes", async (
    _event,
    payload: unknown,
  ) => {
    const request = decodeTtsRuntimeRequestPayload(payload);
    return runDiagnostics("request-bytes", { ...request }, () => controller.requestBytes(request.method, request.path, request.body));
  });
  ipcMain.handle("tts-runtime-request-formdata", async (
    _event,
    payload: unknown,
  ) => {
    const request = decodeTtsRuntimeFormDataPayload(payload);
    return runDiagnostics("request-formdata", {
      path: request.path,
      audioFilePath: request.audioFilePath,
      referenceTextLength: request.referenceText?.length ?? 0,
    }, () => controller.requestFormData(request.path, request.audioFilePath, request.referenceText));
  });
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
