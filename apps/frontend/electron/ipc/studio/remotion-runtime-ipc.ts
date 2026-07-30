import { BrowserWindow, ipcMain, utilityProcess } from "electron";
import fs from "node:fs";
import path from "node:path";
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
  REMOTION_WORKSPACE_RUNTIME_CHANNEL,
  validateRemotionWorkspaceRuntimeReply,
  type RemotionWorkspaceRuntimeReply,
} from "@rendering/contracts/remotion-workspace-runtime";
import { assertBundleMatchesRuntime } from "@rendering/plugins/remotion/render/bundle-manifest";
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
  bundlePath?: string;
}

export interface RemotionRuntimeIpcHandle {
  controller: RemotionBrowserController;
  dispose: () => void;
}

export function registerRemotionRuntimeIpcHandlers({
  userDataDir,
  remotionVersion,
  workerPath,
  bundlePath,
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
  if (bundlePath) {
    ipcMain.handle(REMOTION_WORKSPACE_RUNTIME_CHANNEL, async (_event, payload: unknown) => {
      assertEmptyRequest(validateRemotionRuntimeStatusRequest(payload));
      const manifestPath = path.join(bundlePath, "manifest.json");
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as Record<string, unknown>;
      const validated = assertBundleMatchesRuntime(manifest, remotionVersion);
      const reply: RemotionWorkspaceRuntimeReply = {
        schemaVersion: 1,
        templateId: validated.templateId,
        templateVersion: validated.templateVersion,
        remotionVersion: validated.remotionVersion,
        bundleContentHash: validated.contentHash,
        compositionIds: validated.compositionIds,
      };
      const result = validateRemotionWorkspaceRuntimeReply(reply);
      if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
      return result.value;
    });
  }

  return {
    controller,
    dispose() {
      ipcMain.removeHandler(REMOTION_RUNTIME_STATUS_CHANNEL);
      ipcMain.removeHandler(REMOTION_RUNTIME_DOWNLOAD_CHANNEL);
      supervisor.dispose();
      if (bundlePath) ipcMain.removeHandler(REMOTION_WORKSPACE_RUNTIME_CHANNEL);
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
