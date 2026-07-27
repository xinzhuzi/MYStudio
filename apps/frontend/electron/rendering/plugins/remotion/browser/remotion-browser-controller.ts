import fs from "node:fs";
import type {
  RemotionBrowserStatus,
} from "../../../contracts/remotion-browser-status";

// Sentinel thrown by the status probe's onDownload hook so a status check can
// never fall through into an actual browser download. Identity comparison only.
export const BROWSER_DOWNLOAD_ABORT: unique symbol = Symbol(
  "remotion-browser-download-abort",
);

// Probe adapter mirrors Remotion 官方 ensureBrowser({ onBrowserDownload }).
// The controller passes an onDownload that throws BROWSER_DOWNLOAD_ABORT, so a
// missing browser aborts before any bytes are fetched.
export interface RemotionBrowserProbeAdapter {
  ensureBrowser(options: { onDownload: () => never }): Promise<{
    executablePath?: string;
  }>;
}

// Download adapter is the only path allowed to actually fetch a browser. Real
// implementation wraps Remotion 官方 version:null 下载；tests inject a fake.
export interface RemotionBrowserDownloadAdapter {
  download(options: { onProgress: (ratio: number) => void }): Promise<{
    executablePath?: string;
  }>;
}

export interface RemotionBrowserProbeResult {
  status: RemotionBrowserStatus;
  executablePath?: string;
}

// Persists which Remotion version the cached browser was prepared for. A
// mismatch marks update-required; the store is never cleared by the controller.
export interface PreparedVersionStore {
  read(): string | undefined;
  write(version: string): void;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasExecutablePath(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isExecutableFile(executablePath: string): boolean {
  try {
    if (!fs.statSync(executablePath).isFile()) return false;
    fs.accessSync(executablePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export class RemotionBrowserController {
  private setupInFlight = false;

  constructor(
    private readonly remotionVersion: string,
    private readonly probe: RemotionBrowserProbeAdapter,
    private readonly downloader: RemotionBrowserDownloadAdapter,
    private readonly store: PreparedVersionStore,
  ) {
    if (typeof remotionVersion !== "string" || remotionVersion.trim().length === 0) {
      throw new Error("浏览器控制器需要非空 Remotion 版本");
    }
  }

  async probeStatus(): Promise<RemotionBrowserProbeResult> {
    const preparedForRemotionVersion = this.store.read();
    let needsDownload = false;
    let executablePath: string | undefined;
    try {
      const result = await this.probe.ensureBrowser({
        onDownload: () => {
          throw BROWSER_DOWNLOAD_ABORT;
        },
      });
      executablePath = result.executablePath;
    } catch (error) {
      if (error === BROWSER_DOWNLOAD_ABORT) {
        needsDownload = true;
      } else {
        return {
          status: {
            state: "error",
            remotionVersion: this.remotionVersion,
            preparedForRemotionVersion,
            message: toMessage(error),
          },
        };
      }
    }

    // A Remotion version change is an explicit manual-update state even when
    // the public no-download probe reports that no matching browser exists.
    if (
      preparedForRemotionVersion !== undefined
      && preparedForRemotionVersion !== this.remotionVersion
    ) {
      return {
        status: {
          state: "update-required",
          remotionVersion: this.remotionVersion,
          preparedForRemotionVersion,
        },
        executablePath,
      };
    }

    if (needsDownload) {
      return {
        status: {
          state: "not-installed",
          remotionVersion: this.remotionVersion,
          preparedForRemotionVersion,
        },
      };
    }

    if (!hasExecutablePath(executablePath)) {
      return {
        status: {
          state: "error",
          remotionVersion: this.remotionVersion,
          preparedForRemotionVersion,
          message: "Remotion 浏览器探测未返回 executable path",
        },
      };
    }

    if (!isExecutableFile(executablePath)) {
      return {
        status: {
          state: "error",
          remotionVersion: this.remotionVersion,
          preparedForRemotionVersion,
          message: "Remotion 浏览器 executable path 不是可执行文件",
        },
      };
    }

    return {
      status: {
        state: "ready",
        remotionVersion: this.remotionVersion,
        preparedForRemotionVersion,
      },
      executablePath,
    };
  }

  async status(): Promise<RemotionBrowserStatus> {
    return (await this.probeStatus()).status;
  }

  async downloadWithExecutable(
    onProgress: (ratio: number) => void,
  ): Promise<RemotionBrowserProbeResult> {
    if (this.setupInFlight) {
      throw new Error("同一时间只允许一个浏览器设置操作");
    }
    this.setupInFlight = true;
    try {
      const result = await this.downloader.download({ onProgress });
      if (!hasExecutablePath(result.executablePath)) {
        throw new Error("Remotion 浏览器下载完成但未返回 executable path");
      }
      if (!isExecutableFile(result.executablePath)) {
        throw new Error("Remotion 浏览器下载完成但 executable path 不是可执行文件");
      }
      this.store.write(this.remotionVersion);
      return {
        status: {
          state: "ready",
          remotionVersion: this.remotionVersion,
          preparedForRemotionVersion: this.remotionVersion,
        },
        executablePath: result.executablePath,
      };
    } finally {
      this.setupInFlight = false;
    }
  }

  async download(
    onProgress: (ratio: number) => void,
  ): Promise<RemotionBrowserStatus> {
    return (await this.downloadWithExecutable(onProgress)).status;
  }

  get isSetupInFlight(): boolean {
    return this.setupInFlight;
  }
}
