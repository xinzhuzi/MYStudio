import { BrowserWindow, ipcMain, utilityProcess } from "electron";
import type {
  RemotionBrowserDownloadProgress,
} from "@rendering/contracts/remotion-browser-status";
import {
  REMOTION_RUNTIME_DOWNLOAD_CHANNEL,
  REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT,
  REMOTION_RUNTIME_STATUS_CHANNEL,
  validateRemotionRuntimeDownloadRequest,
  validateRemotionRuntimeStatusRequest,
} from "@rendering/contracts/remotion-runtime-ipc";
import {
  createRemotionBrowserController,
  prepareRemotionRuntimeDirectory,
  RemotionBrowserUtilitySupervisor,
} from "@rendering/plugins/remotion/browser/remotion-browser-utility";
import type { RemotionBrowserController } from "@rendering/plugins/remotion/browser/remotion-browser-controller";

export interface RegisterRemotionRuntimeIpcOptions {
  userDataDir: string;
  remotionVersion: string;
  workerPath: string;
}

export interface RemotionRuntimeIpcHandle {
  controller: RemotionBrowserController;
  dispose: () => void;
}

export function registerRemotionRuntimeIpcHandlers({
  userDataDir,
  remotionVersion,
  workerPath,
}: RegisterRemotionRuntimeIpcOptions): RemotionRuntimeIpcHandle {
  const runtimeDir = prepareRemotionRuntimeDirectory(userDataDir, remotionVersion);
  const supervisor = new RemotionBrowserUtilitySupervisor({
    userDataDir,
    remotionVersion,
    workerPath,
    fork: (modulePath, args, options) => utilityProcess.fork(modulePath, [...args], options),
  });
  const controller = createRemotionBrowserController(supervisor, remotionVersion, runtimeDir);

  ipcMain.handle(REMOTION_RUNTIME_STATUS_CHANNEL, async (_event, payload: unknown) => {
    assertEmptyRequest(validateRemotionRuntimeStatusRequest(payload));
    return controller.status();
  });
  ipcMain.handle(REMOTION_RUNTIME_DOWNLOAD_CHANNEL, async (_event, payload: unknown) => {
    assertEmptyRequest(validateRemotionRuntimeDownloadRequest(payload));
    let workerReportedFailure = false;
    try {
      return await supervisor.download((progress) => {
        workerReportedFailure ||= progress.phase === "failed";
        broadcastDownloadProgress(progress);
      });
    } catch (error) {
      if (!workerReportedFailure) {
        broadcastDownloadProgress({
          phase: "failed",
          ratio: 0,
          remotionVersion,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  });

  return {
    controller,
    dispose() {
      ipcMain.removeHandler(REMOTION_RUNTIME_STATUS_CHANNEL);
      ipcMain.removeHandler(REMOTION_RUNTIME_DOWNLOAD_CHANNEL);
      supervisor.dispose();
    },
  };
}

function broadcastDownloadProgress(progress: RemotionBrowserDownloadProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT, progress);
    }
  }
}

function assertEmptyRequest(
  result: { success: true } | { success: false; issues: Array<{ path: string; message: string }> },
): void {
  if (!result.success) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
}
