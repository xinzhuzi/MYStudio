import { ipcMain } from "electron";
import type {
  AvailableUpdateInfo,
  OpenExternalResult,
  UpdateCheckOptions,
  UpdateCheckResult,
} from "../../types/update";

type RegisterAppUpdaterIpcHandlersContext = {
  getVersion: () => string;
  resolveAvailableUpdate: (currentVersion: string) => Promise<AvailableUpdateInfo | null>;
  sanitizeExternalUrl: (url: string) => string | null | undefined;
  openExternal: (url: string) => Promise<void>;
};

export function registerAppUpdaterIpcHandlers({
  getVersion,
  resolveAvailableUpdate,
  sanitizeExternalUrl,
  openExternal,
}: RegisterAppUpdaterIpcHandlersContext) {
  ipcMain.handle("app-updater-get-current-version", async () => getVersion());

  ipcMain.handle("app-updater-check", async (
    _event,
    options?: UpdateCheckOptions,
  ): Promise<UpdateCheckResult> => {
    const currentVersion = getVersion();
    try {
      const update = await resolveAvailableUpdate(currentVersion);
      return {
        success: true,
        currentVersion,
        hasUpdate: !!update,
        update,
      };
    } catch (error) {
      if (!options?.silent) {
        console.error("Failed to check updates:", error);
      }
      return {
        success: false,
        currentVersion,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("app-updater-open-link", async (
    _event,
    url: string,
  ): Promise<OpenExternalResult> => {
    const safeUrl = sanitizeExternalUrl(url);
    if (!safeUrl) {
      return { success: false, error: "无效下载链接" };
    }

    try {
      await openExternal(safeUrl);
      return { success: true };
    } catch (error) {
      console.error("Failed to open external link:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
