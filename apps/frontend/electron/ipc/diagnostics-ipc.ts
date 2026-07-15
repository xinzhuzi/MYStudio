import { ipcMain } from "electron";
import type { DiagnosticsLogService } from "../diagnostics-log";
import type { DiagnosticsLogEntryInput, DiagnosticsLogQuery } from "../../types/diagnostics";

type RegisterDiagnosticsIpcHandlersContext = {
  service: DiagnosticsLogService;
  openPath: (targetPath: string) => Promise<string>;
};

export function registerDiagnosticsIpcHandlers({
  service,
  openPath,
}: RegisterDiagnosticsIpcHandlersContext) {
  ipcMain.handle("diagnostics-log-write", async (_event, entry: DiagnosticsLogEntryInput) => service.write(entry));
  ipcMain.handle("diagnostics-log-query", async (_event, query?: DiagnosticsLogQuery) => service.query(query));
  ipcMain.handle("diagnostics-log-get-info", async () => service.getInfo());
  ipcMain.handle("diagnostics-log-open-folder", async () => {
    const directory = service.getDirectory();
    const error = await openPath(directory);
    return error ? { success: false, directory, error } : { success: true, directory };
  });
  ipcMain.handle("diagnostics-log-export-bundle", async () => service.exportBundle());
  ipcMain.handle("diagnostics-log-clear", async () => service.clear());
}
