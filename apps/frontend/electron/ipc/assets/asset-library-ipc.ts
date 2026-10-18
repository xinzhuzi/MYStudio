import { dialog, ipcMain } from "electron";
import nodeFs from "node:fs";
import nodePath from "node:path";
import * as assetsStorage from "../../storage/studio-assets-storage";
import { getAssetImagePickerDefaultPath } from "../../media/asset-image-picker";
import { listStudioRuntimeAssets } from "../../storage/studio-runtime-assets";
import { resolveAssetFilePath, resolveProjectOrAssetFileUrl } from "../../storage/storage-paths";
import type { DiagnosticsLogEntryInput } from "../../../types/diagnostics";

type RegisterAssetLibraryIpcHandlersContext = {
  getStorageBasePath: () => string;
  /** 1015 资产归域:资产根(=项目位置表解析的 <projectRoot>/assets);provider 抛 ASSET_HOME_ORPHANED 等异常态走根健康闸。 */
  getAssetsRoot: () => string;
  getMediaRoot: () => string;
  createOperationId: (prefix: string) => string;
  writeDiagnosticsLog: (entry: DiagnosticsLogEntryInput) => void;
  /** 素材源文件守卫:绝对路径必须位于受管根内,或刚由原生对话框选出(祝福路径)。 */
  isSourcePathAllowed: (sourceFilePath: string) => boolean;
  /** 原生对话框选出的路径在此登记,短期作为合法素材源。 */
  blessDialogPaths: (paths: readonly string[]) => void;
};

/** 断链告警会话级去重(1015 补刀):同 URL 只 warn 一次,新 URL 不吞信号。 */
const brokenAssetUrlWarned = new Set<string>();

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
  getAssetsRoot,
  getMediaRoot,
  createOperationId,
  writeDiagnosticsLog,
  isSourcePathAllowed,
  blessDialogPaths,
}: RegisterAssetLibraryIpcHandlersContext) {
  let assetDiagnosticsQueue: Promise<void> = Promise.resolve();
  let readyAssetsRoot: string | null = null;
  // 【M9+M15 根健康闸】getAssetsRoot 异常态(ASSET_HOME_ORPHANED 等)→
  // 先 writeDiagnosticsLog(error)自带留痕,再原样 throw(handler rejects,
  // assets:list 等直接透传结果的 handler 把 rejection 面板可见);
  // 绝不调 initAssetsStorage(M1:静默 fallback=空库重建+受管根丢失双杀)。
  const ensureAssetsStorageReady = (operationId: string) => {
    let assetsRoot: string;
    try {
      assetsRoot = getAssetsRoot();
    } catch (error) {
      writeDiagnosticsLog({
        level: "error",
        category: "asset",
        operationId,
        message: `资产库根解析失败(状态机异常态):${error instanceof Error ? error.message : String(error)}`,
      });
      throw error;
    }
    if (readyAssetsRoot === assetsRoot) return;
    assetsStorage.initAssetsStorage(assetsRoot);
    readyAssetsRoot = assetsRoot;
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
      ensureAssetsStorageReady(operationId);
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
  ipcMain.handle("assets:read-image-data-url", async (_event, id: string) => (
    runAssetDiagnostics("read-image-data-url", { id }, () => assetsStorage.readAssetImageDataUrl(id))
  ));
  // 1010:asset-file:// → data: URL(参考图缩略等 canvas 链用;file:// 源下
  // fetch/直载都会污染画布,唯一干净路=主进程读字节回 data:)
  // 1013 扩 project-file://:装机实弹 Tainted canvas——project-file 进本桥被
  // parseAssetFileUrl(仅认 asset-file)返 null→回落直载染画布,衍生行参考图
  // 缩略全灭;换 09-09 双协议解析器 resolveProjectOrAssetFileUrl 同构收编。
  ipcMain.handle("assets:read-url-data-url", (_event, url: string) => {
    try {
      const absolute = resolveProjectOrAssetFileUrl(
        getStorageBasePath(),
        getAssetsRoot(),
        String(url ?? ""),
      );
      if (!nodeFs.existsSync(absolute)) return null;
      const data = nodeFs.readFileSync(absolute);
      const ext = nodePath.extname(absolute).toLowerCase();
      const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
        : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/png";
      return `data:${mime};base64,${data.toString("base64")}`;
    } catch {
      return null;
    }
  });
  // asset-file:// 虚拟引用 → 受管绝对路径(瞬态解析,供 TTS Python 后端等
  // 只吃真实路径的消费边界;store 持久化形态恒为虚拟——08-24 路径裁定)。
  // 1015 补刀【断链可诊断】:解析成功但文件缺席 → writeDiagnosticsLog(warn)
  // 留痕(此前静默 null,断链只表现成下游「文件不可读」,主进程无据可查);
  // 同 URL 会话级去重防刷屏(TTS 轮询链会重复解析同一引用)。
  ipcMain.handle("assets:resolve-file-url", (_event, url: string) => {
    try {
      const raw = String(url ?? "");
      const absolute = resolveAssetFilePath(
        getAssetsRoot(),
        raw,
      );
      if (nodeFs.existsSync(absolute)) return absolute;
      if (raw.startsWith("asset-file://") && !brokenAssetUrlWarned.has(raw)) {
        brokenAssetUrlWarned.add(raw);
        writeDiagnosticsLog({
          level: "warn",
          category: "asset",
          operationId: createOperationId("asset-resolve-file-url"),
          message: `资产引用断链:虚拟 URL 解析成功但文件缺席(${raw} → ${absolute})`,
        });
      }
      return null;
    } catch {
      return null;
    }
  });
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
  // R4 族聚显(10-19-script-asset-corridor-blank):剧本资产行详情按
  // batchMatch 同源候选全集取族(updatedAt 倒序),只读聚合,不改写任何行。
  ipcMain.handle("assets:list-family", async (_event, payload: { type: string; name: string }) => (
    runAssetDiagnostics("list-family", payload, () => (
      assetsStorage.listAssetFamilyAssets(payload.type as AssetKind, payload.name)
    ))
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
