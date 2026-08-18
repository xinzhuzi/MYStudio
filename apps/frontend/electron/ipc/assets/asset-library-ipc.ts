import { dialog, ipcMain } from "electron";
import * as assetsStorage from "../../storage/studio-assets-storage";
import { getAssetImagePickerDefaultPath } from "../../media/asset-image-picker";
import { listStudioRuntimeAssets } from "../../storage/studio-runtime-assets";
import type { DiagnosticsLogEntryInput } from "../../../types/diagnostics";

type RegisterAssetLibraryIpcHandlersContext = {
  getStorageBasePath: () => string;
  getMediaRoot: () => string;
  createOperationId: (prefix: string) => string;
  writeDiagnosticsLog: (entry: DiagnosticsLogEntryInput) => void;
  /** 素材源文件守卫:绝对路径必须位于受管根内,或刚由原生对话框选出(祝福路径)。 */
  isSourcePathAllowed: (sourceFilePath: string) => boolean;
  /** 原生对话框选出的路径在此登记,短期作为合法素材源。 */
  blessDialogPaths: (paths: readonly string[]) => void;
};

function summarizeDiagnosticsResult(result: unknown): unknown {
  if (Array.isArray(result)) return { count: result.length };
  if (!result || typeof result !== "object") return result;
  const record = result as Record<string, unknown>;
  if (Array.isArray(record.items)) return { total: record.total, itemCount: record.items.length };
  return {
    success: record.success,
    id: record.id,
    name: record.name,
    type: record.type,
    imported: record.imported,
    hasResult: true,
  };
}

export function registerAssetLibraryIpcHandlers({
  getStorageBasePath,
  getMediaRoot,
  createOperationId,
  writeDiagnosticsLog,
  isSourcePathAllowed,
  blessDialogPaths,
}: RegisterAssetLibraryIpcHandlersContext) {
  let assetDiagnosticsQueue: Promise<void> = Promise.resolve();
  let readyStorageBasePath: string | null = null;
  const ensureAssetsStorageReady = () => {
    const storageBasePath = getStorageBasePath();
    if (readyStorageBasePath === storageBasePath) return;
    assetsStorage.initAssetsStorage(storageBasePath);
    readyStorageBasePath = storageBasePath;
  };
  const runAssetDiagnostics = async <T>(
    action: string,
    context: Record<string, unknown>,
    run: () => Promise<T> | T,
  ): Promise<T> => {
    const operationId = createOperationId(`asset-${action}`);
    const queuedAt = performance.now();
    const previous = assetDiagnosticsQueue.catch(() => undefined);
    const queuedRun = previous.then(async () => {
      const startedAt = performance.now();
      const queuedMs = Math.round(startedAt - queuedAt);
      ensureAssetsStorageReady();
      writeDiagnosticsLog({
        level: "debug",
        category: "asset",
        operationId,
        message: `Asset ${action} started`,
        context: { ...context, queuedMs },
      });
      try {
        const result = await run();
        const durationMs = Math.round(performance.now() - startedAt);
        writeDiagnosticsLog({
          level: "info",
          category: "asset",
          operationId,
          message: `Asset ${action} completed`,
          durationMs,
          context: { ...context, queuedMs, durationMs, result: summarizeDiagnosticsResult(result) },
        });
        return result;
      } catch (error) {
        const durationMs = Math.round(performance.now() - startedAt);
        writeDiagnosticsLog({
          level: "error",
          category: "asset",
          operationId,
          message: `Asset ${action} failed`,
          durationMs,
          context: { ...context, queuedMs, durationMs },
          error,
        });
        throw error;
      }
    });
    assetDiagnosticsQueue = queuedRun.then(() => undefined, () => undefined);
    return queuedRun;
  };

  type AssetKind = Parameters<typeof assetsStorage.listAssets>[0];
  type AssetUpdates = Parameters<typeof assetsStorage.updateAsset>[1];

  const rejectIllegalSourcePath = (sourceFilePath?: string) => {
    if (sourceFilePath && !isSourcePathAllowed(sourceFilePath)) {
      throw new Error("素材源文件路径不在应用允许的目录范围内");
    }
  };

  ipcMain.handle("assets:list", async (_event, payload: {
    type: string; search?: string; offset?: number; limit?: number; category?: string;
  }) => runAssetDiagnostics("list", payload, () => assetsStorage.listAssets(
    payload.type as AssetKind,
    payload.search,
    payload.offset,
    payload.limit,
    payload.category,
  )));
  ipcMain.handle("assets:get", async (_event, id: string) => (
    runAssetDiagnostics("get", { id }, () => assetsStorage.getAsset(id))
  ));
  ipcMain.handle("assets:get-by-name", async (_event, payload: { type: string; name: string }) => (
    runAssetDiagnostics("get-by-name", payload, () => (
      assetsStorage.getAssetByName(payload.type as AssetKind, payload.name)
    ))
  ));
  ipcMain.handle("assets:batch-match", async (_event, payload: { type: string; names: string[] }) => (
    runAssetDiagnostics("batch-match", {
      type: payload.type,
      namesCount: payload.names.length,
      namesPreview: payload.names.slice(0, 20),
    }, async () => {
      const map = await assetsStorage.batchMatchAssets(payload.type as AssetKind, payload.names);
      return Array.from(map.entries()).map(([name, asset]) => ({ name, asset }));
    })
  ));
  ipcMain.handle("assets:update", async (_event, payload: { id: string; updates: Record<string, unknown> }) => (
    runAssetDiagnostics("update", { id: payload.id, updates: payload.updates }, () => (
      assetsStorage.updateAsset(payload.id, payload.updates as AssetUpdates)
    ))
  ));
  ipcMain.handle("assets:delete", async (_event, id: string) => (
    runAssetDiagnostics("delete", { id }, () => assetsStorage.deleteAsset(id))
  ));
  ipcMain.handle("assets:add", async (_event, payload: {
    type: string; name: string; sourceFilePath?: string; description?: string; prompt?: string; setting?: string;
  }) => runAssetDiagnostics("add", payload, () => {
    rejectIllegalSourcePath(payload.sourceFilePath);
    return assetsStorage.addAsset({
      type: payload.type as AssetKind,
      name: payload.name,
      sourceFilePath: payload.sourceFilePath,
      description: payload.description,
      prompt: payload.prompt,
      setting: payload.setting,
    });
  }));
  ipcMain.handle("assets:add-image", async (_event, payload: {
    assetId: string; imageName: string; sourceFilePath: string;
  }) => runAssetDiagnostics("add-image", payload, () => {
    rejectIllegalSourcePath(payload.sourceFilePath);
    return assetsStorage.addAssetImage(payload.assetId, payload.imageName, payload.sourceFilePath);
  }));
  ipcMain.handle("assets:replace-image", async (_event, payload: { assetId: string; sourceFilePath: string }) => (
    runAssetDiagnostics("replace-image", payload, () => {
      rejectIllegalSourcePath(payload.sourceFilePath);
      return assetsStorage.replaceAssetMainImage(payload.assetId, payload.sourceFilePath);
    })
  ));
  ipcMain.handle("assets:remove-image", async (_event, payload: { assetId: string; imageFilePath: string }) => (
    runAssetDiagnostics("remove-image", payload, () => (
      assetsStorage.removeAssetImage(payload.assetId, payload.imageFilePath)
    ))
  ));
  ipcMain.handle("assets:rename-image", async (_event, payload: {
    assetId: string; imageFilePath: string; newName: string;
  }) => runAssetDiagnostics("rename-image", payload, () => (
    assetsStorage.renameAssetImage(payload.assetId, payload.imageFilePath, payload.newName)
  )));
  ipcMain.handle("assets:select-image-file", async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: getAssetImagePickerDefaultPath(getMediaRoot()),
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    blessDialogPaths(result.filePaths);
    return result.filePaths[0];
  });
  ipcMain.handle("assets:select-image-files", async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: getAssetImagePickerDefaultPath(getMediaRoot()),
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (result.canceled) return [];
    blessDialogPaths(result.filePaths);
    return result.filePaths;
  });
  ipcMain.handle("assets:select-audio-file", async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: getMediaRoot(),
      properties: ["openFile"],
      filters: [{ name: "音频", extensions: ["aac", "flac", "m4a", "mp3", "ogg", "wav"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    blessDialogPaths(result.filePaths);
    return result.filePaths[0];
  });
  ipcMain.handle("assets:import-from-toonflow", async (_event, payload: { type: string }) => (
    runAssetDiagnostics("import-from-toonflow", payload, async () => {
      const toonflowResult = await listStudioRuntimeAssets({
        type: payload.type as AssetKind,
        offset: 0,
        limit: 9999,
      });
      if (!toonflowResult.success || !toonflowResult.items.length) {
        return { success: true, imported: 0 };
      }
      return { success: true, imported: assetsStorage.importFromToonflow(toonflowResult.items) };
    })
  ));
}
