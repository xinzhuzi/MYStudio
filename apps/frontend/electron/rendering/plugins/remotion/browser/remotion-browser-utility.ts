import fs from "node:fs";
import path from "node:path";
import type {
  RemotionBrowserDownloadProgress,
  RemotionBrowserStatus,
} from "../../../contracts/remotion-browser-status";
import {
  RemotionBrowserController,
  type RemotionBrowserDownloadAdapter,
  type RemotionBrowserProbeAdapter,
} from "./remotion-browser-controller";
import {
  buildRemotionRuntimeManifest,
  resolveRemotionRuntimeDir,
  resolveRemotionRuntimeManifestPath,
} from "./remotion-runtime-manifest";
import { createPreparedVersionFileStore } from "./remotion-browser-worker-service";
import {
  type RemotionBrowserWorkerAction,
 
  validateRemotionBrowserWorkerEvent,
} from "./remotion-browser-worker-protocol";

interface UtilityProcessLike {
  on(event: "message", listener: (message: unknown) => void): UtilityProcessLike;
  on(event: "exit", listener: (code: number) => void): UtilityProcessLike;
  off(event: "message", listener: (message: unknown) => void): UtilityProcessLike;
  off(event: "exit", listener: (code: number) => void): UtilityProcessLike;
  postMessage(message: unknown): void;
  kill(): boolean;
}

export interface RemotionBrowserUtilityOptions {
  userDataDir: string;
  remotionVersion: string;
  workerPath: string;
  fork: (
    modulePath: string,
    args: string[],
    options: { cwd: string; serviceName: string },
  ) => UtilityProcessLike;
}

export interface RemotionBrowserWorkerResult {
  status: RemotionBrowserStatus;
  executablePath?: string;
}

interface PendingRequest {
  resolve: (value: RemotionBrowserWorkerResult) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: RemotionBrowserDownloadProgress) => void;
}

export function prepareRemotionRuntimeDirectory(
  userDataDir: string,
  remotionVersion: string,
): string {
  const runtimeDir = resolveRemotionRuntimeDir(userDataDir);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(
    resolveRemotionRuntimeManifestPath(userDataDir),
    `${JSON.stringify(buildRemotionRuntimeManifest(remotionVersion), null, 2)}\n`,
    "utf8",
  );
  return runtimeDir;
}

export function createRemotionBrowserController(
  supervisor: RemotionBrowserUtilitySupervisor,
  remotionVersion: string,
  runtimeDir: string,
): RemotionBrowserController {
  const probe: RemotionBrowserProbeAdapter = {
    async ensureBrowser({ onDownload }) {
      const result = await supervisor.probeStatus();
      if (result.status.state === "not-installed") onDownload();
      if (result.status.state === "error") {
        throw new Error(result.status.message ?? "Remotion 浏览器状态检查失败");
      }
      return { executablePath: result.executablePath };
    },
  };
  const downloader: RemotionBrowserDownloadAdapter = {
    async download({ onProgress }) {
      const result = await supervisor.downloadWithExecutable((progress) => onProgress(progress.ratio));
      return { executablePath: result.executablePath };
    },
  };
  return new RemotionBrowserController(
    remotionVersion,
    probe,
    downloader,
    createPreparedVersionFileStore(runtimeDir),
  );
}

export class RemotionBrowserUtilitySupervisor {
  private process: UtilityProcessLike | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private sequence = 0;
  private activeRequestId: string | null = null;
  private readonly onMessage = (message: unknown) => this.handleMessage(message);
  private readonly onExit = (code: number) => this.handleExit(code);

  constructor(private readonly options: RemotionBrowserUtilityOptions) {}

  async status(): Promise<RemotionBrowserStatus> {
    return (await this.probeStatus()).status;
  }

  probeStatus(): Promise<RemotionBrowserWorkerResult> {
    return this.request("status");
  }

  async download(
    onProgress: (progress: RemotionBrowserDownloadProgress) => void,
  ): Promise<RemotionBrowserStatus> {
    return (await this.downloadWithExecutable(onProgress)).status;
  }

  downloadWithExecutable(
    onProgress: (progress: RemotionBrowserDownloadProgress) => void,
  ): Promise<RemotionBrowserWorkerResult> {
    return this.request("download", onProgress);
  }

  dispose(): void {
    this.releaseProcess();
    this.rejectPending(new Error("Remotion 浏览器 utility process 已关闭"));
  }

  get isRunning(): boolean {
    return this.process !== null;
  }

  private request(
    action: RemotionBrowserWorkerAction,
    onProgress?: (progress: RemotionBrowserDownloadProgress) => void,
  ): Promise<RemotionBrowserWorkerResult> {
    if (this.activeRequestId) {
      return Promise.reject(new Error("同一时间只允许一个浏览器 utility 操作"));
    }
    const requestId = `browser-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      try {
        const child = this.ensureProcess();
        this.activeRequestId = requestId;
        this.pending.set(requestId, { resolve, reject, onProgress });
        child.postMessage({
          schemaVersion: 1,
          requestId,
          action,
          remotionVersion: this.options.remotionVersion,
        });
      } catch (error) {
        this.activeRequestId = null;
        reject(toError(error));
      }
    });
  }

  private ensureProcess(): UtilityProcessLike {
    if (this.process) return this.process;
    if (!path.isAbsolute(this.options.workerPath)) {
      throw new Error("Remotion 浏览器 worker 路径必须是绝对路径");
    }
    const runtimeDir = prepareRemotionRuntimeDirectory(
      this.options.userDataDir,
      this.options.remotionVersion,
    );
    const child = this.options.fork(this.options.workerPath, [], {
      cwd: runtimeDir,
      serviceName: "MYStudio Remotion Browser",
    });
    child.on("message", this.onMessage);
    child.on("exit", this.onExit);
    this.process = child;
    return child;
  }

  private handleMessage(message: unknown): void {
    const validated = validateRemotionBrowserWorkerEvent(message);
    if (!validated.success) {
      this.rejectActive(new Error(validated.issues.map(
        (issue) => `${issue.path}: ${issue.message}`,
      ).join("; ")));
      this.releaseProcess();
      return;
    }
    const event = validated.value;
    if (event.requestId !== this.activeRequestId) {
      this.rejectActive(new Error(
        "Remotion 浏览器 worker requestId 与当前请求不匹配",
      ));
      this.releaseProcess();
      return;
    }
    const pending = this.pending.get(event.requestId);
    if (!pending) {
      this.rejectActive(new Error("Remotion 浏览器 utility 请求状态不一致"));
      this.releaseProcess();
      return;
    }
    if (event.kind === "progress") {
      pending.onProgress?.(event.progress);
      return;
    }
    this.pending.delete(event.requestId);
    this.activeRequestId = null;
    this.releaseProcess();
    if (event.kind === "error") {
      pending.reject(new Error(event.message));
      return;
    }
    pending.resolve({
      status: event.status,
      ...(event.executablePath ? { executablePath: event.executablePath } : {}),
    });
  }

  private handleExit(code: number): void {
    this.process = null;
    this.activeRequestId = null;
    this.rejectPending(new Error(`Remotion 浏览器 utility process 退出(code=${code})`));
  }

  private releaseProcess(): void {
    const child = this.process;
    this.process = null;
    child?.off("message", this.onMessage);
    child?.off("exit", this.onExit);
    child?.kill();
  }

  private rejectActive(error: Error): void {
    if (!this.activeRequestId) return;
    const pending = this.pending.get(this.activeRequestId);
    this.pending.delete(this.activeRequestId);
    this.activeRequestId = null;
    pending?.reject(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.activeRequestId = null;
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
