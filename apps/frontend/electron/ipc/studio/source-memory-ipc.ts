import { ipcMain } from "electron";
import { createSourceMemoryService } from "../../storage/source-memory-service";
import { resolveProjectRootPath } from "../../storage/storage-paths";

type RegisterSourceMemoryIpcContext = { getDataDir: () => string };

export function registerSourceMemoryIpcHandlers({ getDataDir }: RegisterSourceMemoryIpcContext) {
  const service = createSourceMemoryService({
    getProjectRoot: (projectId) => resolveProjectRootPath(getDataDir(), projectId),
  });

  ipcMain.handle("source-memory-build", (_event, projectId: string) => service.build(projectId));
  ipcMain.handle("source-memory-search", (_event, projectId: string, query: string, limit?: number) =>
    service.search(projectId, query, limit),
  );
  ipcMain.handle("source-memory-status", (_event, projectId: string) => service.status(projectId));
}
