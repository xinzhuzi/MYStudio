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
import { registerSecureStorageIpcHandlers } from '../ipc/app/secure-storage-ipc'
import { cancelScheduledC1Relaunch, registerC1PurgeIpcHandlers } from './c1-purge-controller'
import { registerDiagnosticsIpcHandlers } from '../ipc/diagnostics/diagnostics-ipc'
import { registerRenderHwIpcHandlers } from '../ipc/rendering/render-hw-ipc'
import { registerApiRequestIpcHandlers } from '../ipc/ai/api-request-ipc'
import { registerFileExportIpcHandlers } from '../ipc/files/file-export-ipc'
import { createDefaultProjectMoveEngine } from '../storage/project-move-engine'
import { sanitizeExternalUrl } from '../runtime/update-policy'
import {
  getProtocolMimeType as getMimeType,
} from '../runtime/register-protocol-handlers'
import { getDataDir, getMediaRoot, getAssetsRoot, getSkillsRoot, getProjectDataRoot, projectLocationStore, storageManager, getStudioManualsSourceRoot, getStudioSkillSyncOptions, resolveStudioSourcePath, blessedDialogPaths } from './main-paths'
import { readImageSource } from './main-paths'
import { createDiagnosticsOperationId, diagnosticsLogService, writeDiagnosticsLog } from './main-diagnostics'
import { resolveAvailableUpdate } from './main-window'
import { makeStudioSkillFileUrl } from './main-utils'



registerSourceMemoryIpcHandlers({ getDataDir })
registerProjectFileIpcHandlers({
  getAssetsRoot,
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
storageManager.registerIpcHandlers({
  getStudioManualsSourceRoot,
  // 目录选择器的结果同步祝福到共享注册表,供项目导入守卫消费。
  onDialogDirSelected: (dirPath) => blessedDialogPaths.bless([dirPath]),
})

registerProjectFolderIpcHandlers({
  locationStore: projectLocationStore,
  getProjectsDataRoot: () => getProjectDataRoot({ ensure: false }),
  createMoveEngine: () => createDefaultProjectMoveEngine(),
  isImportPathBlessed: blessedDialogPaths.has,
})

registerAppUpdaterIpcHandlers({
  getVersion: () => app.getVersion(),
  resolveAvailableUpdate,
  sanitizeExternalUrl,
  openExternal: (url) => shell.openExternal(url),
})

registerAppShellIpcHandlers({ resolveSourcePath: resolveStudioSourcePath })

// 0924 C1 专项:safeStorage 三通道(API 密钥落盘加密),无上下文依赖,随处可注册
registerSecureStorageIpcHandlers()

// 0924 C1③ leveldb 明文物理清除五通道(getMode/getStaged sendSync 同步应答 +
// stage/confirm/relaunch)。boot 模式由 main.ts 的 runC1PurgeBoot 先行判定注入
// 模块状态;relaunch 注入真实现(app.relaunch + exit)避免测试触发真进程退出。
registerC1PurgeIpcHandlers({
  userDataPath: () => app.getPath('userData'),
  sessionDataPath: () => app.getPath('sessionData'),
  relaunch: () => {
    app.relaunch()
    app.exit(0)
    // 兜底强杀:真机验收实证 app.exit 后 will-quit/早期退出路径偶发冻结
    // (SIGTERM 无效,SIGKILL 后 relauncher 才拉起),会把两拍协议卡死在中间态。
    // 1.5s 后 process.exit(0) 强制收尾;unref 保证正常退出路径不被 timer 拖住。
    setTimeout(() => process.exit(0), 1500).unref()
  },
})

// 拍0 延迟成熟退出(5s)期间用户手动退出(Cmd+Q/关窗退出):取消 relaunch 调度。
// staged 原样保留、数据未动,下次启动状态机见「扫描命中+staged 在」自然走拍1
// 回写,协议支持中断续走。app.exit(0) 路径不触发 before-quit,不会自己取消自己
// (与 main-window 的 before-quit 清理链是并列 listener,互不干扰)。
app.on('before-quit', () => {
  cancelScheduledC1Relaunch()
})

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
