/**
 * main.ts IPC 注册群(assembly 专批外迁,体逐字保留)——存储/媒体/资产/技能/
 * 项目夹/更新/shell/诊断/硬件/导出十二组注册。main.ts 以副作用 import 引入;
 * 依赖均为函数引用与已装配单例,无顺序敏感。
 */
import { app, shell } from 'electron'
import { registerSourceMemoryIpcHandlers } from '../ipc/studio/source-memory-ipc'
import { registerProjectFileIpcHandlers } from '../ipc/files/project-file-ipc'
import { registerImageProbeIpcHandlers } from '../ipc/media/image-probe-ipc'
import { configureArtifactManagementIpc } from '../ipc/files/artifact-management-ipc'
import { registerStudioContentIpcHandlers } from '../ipc/assets/studio-content-ipc'
import { registerProjectFolderIpcHandlers } from '../ipc/projects/project-folder-ipc'
import { registerAppUpdaterIpcHandlers } from '../ipc/app/app-updater-ipc'
import { registerAppShellIpcHandlers } from '../ipc/app/app-shell-ipc'
import { registerDiagnosticsIpcHandlers } from '../ipc/diagnostics/diagnostics-ipc'
import { registerRenderHwIpcHandlers } from '../ipc/rendering/render-hw-ipc'
import { registerApiRequestIpcHandlers } from '../ipc/ai/api-request-ipc'
import { registerFileExportIpcHandlers } from '../ipc/files/file-export-ipc'
import { createDefaultProjectMoveEngine } from '../storage/project-move-engine'
import { sanitizeExternalUrl } from '../runtime/update-policy'
import {
  getProtocolMimeType as getMimeType,
} from '../runtime/register-protocol-handlers'
import { getDataDir, getMediaRoot, getAssetsRoot, getSkillsRoot, getProjectDataRoot, projectLocationStore, storageManager, getStudioManualsSourceRoot, getStudioSkillSyncOptions, resolveStudioSourcePath } from './main-paths'
import { readImageSource } from './main-paths'
import { createDiagnosticsOperationId, diagnosticsLogService, writeDiagnosticsLog } from './main-diagnostics'
import { resolveAvailableUpdate } from './main-window'
import { makeStudioSkillFileUrl } from './main-utils'



registerSourceMemoryIpcHandlers({ getDataDir })
registerProjectFileIpcHandlers({
  getDataDir,
  readImageSource,
  getMimeType,
})

registerImageProbeIpcHandlers({
  getDataDir,
  getMediaRoot,
  getAssetsRoot,
})

configureArtifactManagementIpc({
  getDataDir,
  getMediaRoot,
})

registerStudioContentIpcHandlers({
  getSkillsRoot,
  getStudioSkillSyncOptions,
  makeStudioSkillFileUrl,
})
storageManager.registerIpcHandlers({ getStudioManualsSourceRoot })

registerProjectFolderIpcHandlers({
  locationStore: projectLocationStore,
  getProjectsDataRoot: () => getProjectDataRoot({ ensure: false }),
  createMoveEngine: () => createDefaultProjectMoveEngine(),
})

registerAppUpdaterIpcHandlers({
  getVersion: () => app.getVersion(),
  resolveAvailableUpdate,
  sanitizeExternalUrl,
  openExternal: (url) => shell.openExternal(url),
})

registerAppShellIpcHandlers({ resolveSourcePath: resolveStudioSourcePath })

registerDiagnosticsIpcHandlers({
  service: diagnosticsLogService,
  openPath: (targetPath) => shell.openPath(targetPath),
})

registerRenderHwIpcHandlers(() => app.getPath('userData'))

registerApiRequestIpcHandlers({
  createOperationId: createDiagnosticsOperationId,
  writeDiagnosticsLog,
})

registerFileExportIpcHandlers({ getDataDir, getMediaRoot })
