// 三段链路日志打包导出 IPC(09-10 自 depth-ipc.ts 回迁独立成家:depth 域退役,
// 本通道是视频管线诊断功能与 depth 无关,原寄居在 depth-ipc 文件内)。
import { ipcMain } from "electron";
import path from "node:path";
import {
  createVideoPipelineLogBundle,
  writeLogBundle,
} from "@rendering/plugins/video-workflow/video-pipeline-log-bundle";

export interface RegisterVideoPipelineLogIpcOptions {
  getDataRoot: () => string;
  getDiagnosticsDir: () => string;
  getLogBundleDir: () => string;
}

// 三段链路日志打包导出: Remotion evidence + video-use + HyperFrames + 诊断日志.
export function registerVideoPipelineLogIpcHandlers(options: RegisterVideoPipelineLogIpcOptions) {
  ipcMain.handle("video-pipeline-export-log-bundle", async (_event, payload: { projectId?: unknown; chapterId?: unknown; revision?: unknown }): Promise<{ success: boolean; path?: string; error?: string }> => {
      const { projectId, chapterId, revision } = payload ?? {};
      if (typeof projectId !== "string" || typeof chapterId !== "string"
        || !/^[A-Za-z0-9._-]+$/.test(projectId) || !/^[A-Za-z0-9._-]+$/.test(chapterId)) {
        return { success: false, error: "projectId 和 chapterId 必须是安全路径段" };
      }
      try {
        const bundle = createVideoPipelineLogBundle({
          dataRoot: options.getDataRoot(),
          projectId,
          chapterId,
          ...(typeof revision === "number" && revision > 0 ? { revision } : {}),
          diagnosticsDir: options.getDiagnosticsDir(),
        });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outputPath = writeLogBundle(
          bundle,
          path.join(options.getLogBundleDir(), `video-pipeline-bundle-${projectId}-${chapterId}-${stamp}.json`),
        );
        return { success: true, path: outputPath };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });

  return {
    dispose: () => {
      ipcMain.removeHandler("video-pipeline-export-log-bundle");
    },
  };
}
