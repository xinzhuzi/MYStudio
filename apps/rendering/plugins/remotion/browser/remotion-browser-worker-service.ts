import fs from "node:fs";
import path from "node:path";
import type {
  RemotionBrowserDownloadProgress,
  RemotionBrowserStatus,
} from "../../../contracts/remotion-browser-status";
import {
  RemotionBrowserController,
  type PreparedVersionStore,
  type RemotionBrowserDownloadAdapter,
  type RemotionBrowserProbeAdapter,
} from "./remotion-browser-controller";
import {
  type RemotionBrowserWorkerCommand,
  type RemotionBrowserWorkerEvent,
  validateRemotionBrowserWorkerCommand,
  validateRemotionBrowserWorkerEvent,
} from "./remotion-browser-worker-protocol";

export type RemotionEnsureBrowserResult =
  | { type: "user-defined-path"; path: string }
  | { type: "local-puppeteer-browser"; path: string }
  | { type: "no-browser" }
  | { type: "version-mismatch"; actualVersion: string | null };

export interface RemotionBrowserDownloadDetails {
  alreadyAvailable: boolean;
  percent: number;
  downloadedBytes: number;
  totalSizeInBytes: number;
}

export interface RemotionEnsureBrowserOptions {
  chromeMode: "headless-shell";
  logLevel: "warn";
  onBrowserDownload(options: { chromeMode: "headless-shell" }): {
    onProgress(progress: RemotionBrowserDownloadDetails): void;
    version: null;
  };
}

export type RemotionEnsureBrowser = (
  options: RemotionEnsureBrowserOptions,
) => Promise<RemotionEnsureBrowserResult>;

export interface RemotionBrowserWorkerServiceDependencies {
  ensureBrowser: RemotionEnsureBrowser;
  store: PreparedVersionStore;
  downloadTimeoutMs?: number;
}

export interface RemotionBrowserWorkerService {
  handle(
    value: unknown,
    emit: (event: RemotionBrowserWorkerEvent) => void,
  ): Promise<RemotionBrowserWorkerEvent>;
}

const PREPARED_VERSION_STATE_FILE = "browser-state.json";
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120_000;

export function createPreparedVersionFileStore(runtimeDir: string): PreparedVersionStore {
  if (!path.isAbsolute(runtimeDir)) {
    throw new Error("Remotion runtime 目录必须是绝对路径");
  }
  const statePath = path.join(runtimeDir, PREPARED_VERSION_STATE_FILE);
  return {
    read() {
      let raw: string;
      try {
        raw = fs.readFileSync(statePath, "utf8");
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return undefined;
        throw error;
      }
      const value: unknown = JSON.parse(raw);
      if (!isRecord(value) || value.schemaVersion !== 1 || !isNonEmptyString(value.preparedForRemotionVersion)) {
        throw new Error("Remotion 浏览器状态文件无效");
      }
      return value.preparedForRemotionVersion;
    },
    write(version) {
      if (!isNonEmptyString(version)) throw new Error("Remotion prepared version 必须是非空字符串");
      fs.mkdirSync(runtimeDir, { recursive: true });
      const temporaryPath = `${statePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify({
        schemaVersion: 1,
        preparedForRemotionVersion: version,
      }, null, 2)}\n`, "utf8");
      fs.renameSync(temporaryPath, statePath);
    },
  };
}

export function createRemotionEnsureBrowserAdapters(
  ensureBrowser: RemotionEnsureBrowser,
): {
  probe: RemotionBrowserProbeAdapter;
  downloader: RemotionBrowserDownloadAdapter;
} {
  const probe: RemotionBrowserProbeAdapter = {
    async ensureBrowser({ onDownload }) {
      const result = await ensureBrowser({
        chromeMode: "headless-shell",
        logLevel: "warn",
        onBrowserDownload: () => onDownload(),
      });
      return { executablePath: requireExecutablePath(result) };
    },
  };

  const downloader: RemotionBrowserDownloadAdapter = {
    async download({ onProgress }) {
      const result = await ensureBrowser({
        chromeMode: "headless-shell",
        logLevel: "warn",
        onBrowserDownload: ({ chromeMode }) => {
          if (chromeMode !== "headless-shell") {
            throw new Error(`拒绝下载非 Headless Shell 浏览器: ${chromeMode}`);
          }
          return {
            version: null,
            onProgress: ({ percent }) => {
              if (!Number.isFinite(percent) || percent < 0 || percent > 1) {
                throw new Error(`Remotion 浏览器下载进度无效: ${percent}`);
              }
              onProgress(percent);
            },
          };
        },
      });
      return { executablePath: requireExecutablePath(result) };
    },
  };

  return { probe, downloader };
}

export function createRemotionBrowserWorkerService(
  dependencies: RemotionBrowserWorkerServiceDependencies,
): RemotionBrowserWorkerService {
  const downloadTimeoutMs = normalizeDownloadTimeout(dependencies.downloadTimeoutMs);
  return {
    async handle(value, emit) {
      const validated = validateRemotionBrowserWorkerCommand(value);
      if (!validated.success) {
        const event: RemotionBrowserWorkerEvent = {
          kind: "error",
          requestId: extractRequestId(value),
          message: validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
        };
        emitValidated(emit, event);
        return event;
      }

      const command = validated.value;
      const { probe, downloader } = createRemotionEnsureBrowserAdapters(dependencies.ensureBrowser);
      const controller = new RemotionBrowserController(
        command.remotionVersion,
        probe,
        downloader,
        dependencies.store,
      );
      let lastRatio = 0;

      try {
        if (command.action === "download") {
          emitProgress(emit, command, "starting", 0);
          const result = await withTimeout(
            controller.downloadWithExecutable((ratio) => {
              lastRatio = ratio;
              emitProgress(emit, command, "downloading", ratio);
            }),
            downloadTimeoutMs,
            `Remotion Headless Shell 下载超过 ${downloadTimeoutMs}ms 未完成`,
          );
          emitProgress(emit, command, "completed", 1);
          return emitResult(emit, command, result.status, result.executablePath);
        }

        const result = await controller.probeStatus();
        return emitResult(emit, command, result.status, result.executablePath);
      } catch (error) {
        const message = toMessage(error);
        if (command.action === "download") {
          emitProgress(emit, command, "failed", lastRatio, message);
        }
        const event: RemotionBrowserWorkerEvent = {
          kind: "error",
          requestId: command.requestId,
          message,
        };
        emitValidated(emit, event);
        return event;
      }
    },
  };
}

function normalizeDownloadTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DOWNLOAD_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Remotion 浏览器下载超时必须是正数");
  }
  return value;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function emitProgress(
  emit: (event: RemotionBrowserWorkerEvent) => void,
  command: RemotionBrowserWorkerCommand,
  phase: RemotionBrowserDownloadProgress["phase"],
  ratio: number,
  message?: string,
): void {
  emitValidated(emit, {
    kind: "progress",
    requestId: command.requestId,
    progress: {
      phase,
      ratio,
      remotionVersion: command.remotionVersion,
      ...(message ? { message } : {}),
    },
  });
}

function emitResult(
  emit: (event: RemotionBrowserWorkerEvent) => void,
  command: RemotionBrowserWorkerCommand,
  status: RemotionBrowserStatus,
  executablePath?: string,
): RemotionBrowserWorkerEvent {
  const event: RemotionBrowserWorkerEvent = {
    kind: "result",
    requestId: command.requestId,
    status,
    ...(executablePath ? { executablePath } : {}),
  };
  emitValidated(emit, event);
  return event;
}

function emitValidated(
  emit: (event: RemotionBrowserWorkerEvent) => void,
  event: RemotionBrowserWorkerEvent,
): void {
  const validated = validateRemotionBrowserWorkerEvent(event);
  if (!validated.success) {
    throw new Error(validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  emit(validated.value);
}

function requireExecutablePath(result: RemotionEnsureBrowserResult): string {
  if ((result.type === "user-defined-path" || result.type === "local-puppeteer-browser")
    && path.isAbsolute(result.path)) {
    return result.path;
  }
  throw new Error(`Remotion ensureBrowser 未返回可用 executable path: ${result.type}`);
}

function extractRequestId(value: unknown): string {
  return isRecord(value) && isNonEmptyString(value.requestId)
    ? value.requestId
    : "invalid-request";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error;
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
