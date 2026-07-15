import { ipcMain } from "electron";
import {
  createStoredStudioSkillFile,
  deleteStoredStudioSkillFile,
  ensureStudioSkillsSynced,
  listStoredStudioSkillFiles,
  readStoredStudioSkillText,
  resetStudioSkillsSyncState,
  restoreStoredStudioSkillFile,
  resolveStoredStudioSkillPath,
  writeStoredStudioSkillText,
} from "../studio-skills-storage";
import {
  createStoredVisualManual,
  duplicateStoredVisualManual,
  listStoredVisualManuals,
  readStoredVisualManual,
  writeStoredVisualManualImages,
  writeStoredVisualManual,
} from "../studio-visual-manuals-storage";
import type {
  StudioVisualManualCreatePayload,
  StudioVisualManualImagesWritePayload,
  StudioVisualManualWritePayload,
} from "../../types/studio-visual-manual";

type StudioSkillSyncOptions = Parameters<typeof ensureStudioSkillsSynced>[0];

type RegisterStudioContentIpcHandlersContext = {
  getSkillsRoot: () => string;
  getStudioSkillSyncOptions: () => StudioSkillSyncOptions;
  makeStudioSkillFileUrl: (relativePath: string) => string;
};

export function registerStudioContentIpcHandlers({
  getSkillsRoot,
  getStudioSkillSyncOptions,
  makeStudioSkillFileUrl,
}: RegisterStudioContentIpcHandlersContext) {
  ipcMain.handle("studio-skill-list", async () => {
    try {
      return await listStoredStudioSkillFiles(getStudioSkillSyncOptions());
    } catch (error) {
      console.warn("Failed to list studio skills:", error);
      return [];
    }
  });

  ipcMain.handle("studio-skill-read-text", async (_event, relativePath: string) => {
    try {
      const skillsRoot = getSkillsRoot();
      await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
      const { targetPath } = resolveStoredStudioSkillPath(skillsRoot, relativePath);
      const content = await readStoredStudioSkillText(skillsRoot, relativePath);
      return { success: true, content, filePath: targetPath, storagePath: targetPath };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("studio-skill-write-text", async (_event, relativePath: string, value: string) => {
    try {
      const skillsRoot = getSkillsRoot();
      await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
      const { targetPath } = resolveStoredStudioSkillPath(skillsRoot, relativePath);
      const stat = await writeStoredStudioSkillText(skillsRoot, relativePath, value);
      return { success: true, filePath: targetPath, storagePath: targetPath, updatedAt: stat.mtimeMs };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("studio-skill-create-text", async (_event, relativePath: string, value: string) => {
    try {
      const skillsRoot = getSkillsRoot();
      await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
      const created = await createStoredStudioSkillFile(skillsRoot, relativePath, value);
      return { success: true, ...created };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("studio-skill-delete-text", async (_event, relativePath: string) => {
    try {
      const deleted = await deleteStoredStudioSkillFile(getSkillsRoot(), relativePath);
      return { success: true, deleted };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("studio-skill-restore-text", async (_event, relativePath: string) => {
    try {
      const restored = await restoreStoredStudioSkillFile(getStudioSkillSyncOptions(), relativePath);
      return { success: true, ...restored };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  type VisualManualList = Awaited<ReturnType<typeof listStoredVisualManuals>>;
  let visualManualListCache: VisualManualList | null = null;
  let visualManualListLoading: Promise<VisualManualList> | null = null;
  const getManualOptions = () => ({
    ...getStudioSkillSyncOptions(),
    makeFileUrl: makeStudioSkillFileUrl,
  });

  ipcMain.handle("studio-visual-manual-list", async (_event, options?: { refresh?: boolean }) => {
    if (options?.refresh) {
      visualManualListCache = null;
      resetStudioSkillsSyncState();
    }
    if (visualManualListCache) return visualManualListCache;
    if (visualManualListLoading) return visualManualListLoading;
    visualManualListLoading = (async () => {
      try {
        const result = await listStoredVisualManuals(getManualOptions());
        visualManualListCache = result;
        return result;
      } catch (error) {
        console.warn("Failed to list studio visual manuals:", error);
        return [];
      } finally {
        visualManualListLoading = null;
      }
    })();
    return visualManualListLoading;
  });

  ipcMain.handle("studio-visual-manual-read", async (_event, stylePath: string) => {
    try {
      const manual = await readStoredVisualManual(getManualOptions(), stylePath);
      return { success: true, manual };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("studio-visual-manual-write", async (
    _event,
    stylePath: string,
    payload: StudioVisualManualWritePayload,
  ) => {
    try {
      await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
      await writeStoredVisualManual(getSkillsRoot(), stylePath, payload);
      const manual = await readStoredVisualManual(getManualOptions(), stylePath);
      return { success: true, manual };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("studio-visual-manual-write-images", async (
    _event,
    stylePath: string,
    payload: StudioVisualManualImagesWritePayload,
  ) => {
    try {
      await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
      await writeStoredVisualManualImages(getSkillsRoot(), stylePath, payload);
      const manual = await readStoredVisualManual(getManualOptions(), stylePath);
      return { success: true, manual };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("studio-visual-manual-create", async (_event, payload: StudioVisualManualCreatePayload) => {
    try {
      await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
      const stylePath = await createStoredVisualManual(getSkillsRoot(), payload);
      const manual = await readStoredVisualManual(getManualOptions(), stylePath);
      visualManualListCache = null;
      return { success: true, manual };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("studio-visual-manual-duplicate", async (
    _event,
    payload: { sourceStylePath: string; name: string; stylePath: string; projectId?: string },
  ) => {
    try {
      await ensureStudioSkillsSynced(getStudioSkillSyncOptions());
      const stylePath = await duplicateStoredVisualManual(
        getSkillsRoot(),
        payload.sourceStylePath,
        payload,
      );
      const manual = await readStoredVisualManual(getManualOptions(), stylePath);
      visualManualListCache = null;
      return { success: true, manual };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
