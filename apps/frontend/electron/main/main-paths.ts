import { app } from "electron";
import { createStorageManager } from "../storage/storage-manager";
import { createProjectLocationStore } from "../storage/project-locations";
import { setProjectLocationResolver, resolveProjectRootPath } from "../storage/storage-paths";
import { createImageSourceReader } from "../media/image-source";
import fs from "node:fs";
import { createBlessedPathRegistry, isPathInsideAnyRoot } from "../security/managed-paths";



/**
 * main.ts 存储装配与路径工具族——storageManager 构造/数据根/项目根/blessed 路径注册/受管源根/图像源读取器。assembly 专批,体逐字保留;派生名全部导出回 main.ts。
 */
export const storageManager = createStorageManager({ userDataPath: app.getPath('userData'), sessionDataPath: app.getPath('sessionData') })
export const {
  getStorageBasePath,
  getProjectDataRoot,
  getMediaRoot,
  getAssetsRoot,
  getSkillsRoot,
  scheduleAutoClean,
} = storageManager

// 每项目外部位置表(主进程解析权威):<userData>/project-locations.json。
// resolver 必须先于任何 IPC handler 首次调用就位——所有 `_p/<pid>` 前缀的
// 路径解析(file-storage / artifact / project-file / image-source)据此重定向;
// 未注册位置的项目行为与 legacy 完全一致。
export const projectLocationStore = createProjectLocationStore({
  userDataPath: app.getPath('userData'),
  getProjectsDataRoot: () => getProjectDataRoot({ ensure: false }),
})
setProjectLocationResolver(projectLocationStore.get)

// ==================== File Storage for App Data ====================
export const getDataDir = () => {
  const dataDir = getProjectDataRoot()
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  return dataDir
}
// resolver-aware 项目根:外部位置项目 → <location>;legacy → <dataRoot>/_p/<pid>。
export const projectRootFor = (projectId: string) => resolveProjectRootPath(getDataDir(), projectId)

// ===== IPC 路径原语的受管根守卫(安全加固 H-2/H-3)=====
// 渲染进程提供的绝对路径只有两类可信:位于应用受管目录内,或刚由主进程
// 原生对话框选出(短期「祝福」)。其余绝对路径一律拒绝,防止被攻破的
// renderer 把 fs/shell/ffprobe 当任意读写原语。协议分支(project-file:///
// local-image://)自带 realpath 级根约束,不经此守卫。
export const blessedDialogPaths = createBlessedPathRegistry()
// tts/depth/upscale 控制器在 main.ts 装配后注入(装配顺序:控制器晚于路径族)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _controllerRoots: (() => string[]) | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bindRuntimeControllerRoots(provider: () => string[]): void {
  _controllerRoots = provider
}
export const getManagedSourceRoots = (): string[] => {
  const roots = [
    getDataDir(),
    getMediaRoot(),
    app.getPath('userData'),
    // 存储基地址可被用户 link 到外部目录:python 运行时/assets 库/projects/media/
    // skills 及深度/超分模型的默认缓存都在它之下,必须整体受管。
    getStorageBasePath(),
    ...Object.values(projectLocationStore.all()),
    ...(_controllerRoots?.() ?? []),
  ]
  return Array.from(new Set(roots.filter((root) => typeof root === 'string' && root.trim() !== '')))
}
export const isStudioSourcePathAllowed = (targetPath: string): boolean => (
  isPathInsideAnyRoot(getManagedSourceRoots(), targetPath) || blessedDialogPaths.has(targetPath)
)

export const readImageSource = createImageSourceReader({ getDataDir, getMediaRoot, getAssetsRoot, isAbsoluteImageSourceAllowed: isStudioSourcePathAllowed })

