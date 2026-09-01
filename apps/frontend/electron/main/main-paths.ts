import { app } from "electron";
import { createStorageManager } from "../storage/storage-manager";
import { createProjectLocationStore } from "../storage/project-locations";
import {
  setProjectLocationResolver,
  resolveProjectRootPath,
  resolveProjectFileUrl,
  resolveLocalMediaPath,
} from "../storage/storage-paths";
import { ensureStudioSkillsSynced } from "../storage/studio-skills-storage";
import { createImageSourceReader } from "../media/image-source";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
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

// ==================== Studio 手册种子与技能同步 ====================
export function getStudioManualsSourceRoot() {
  // APP_ROOT is apps/ in electron-vite out layout (out/main -> ../..).
  // Seed lives at apps/frontend/assets/studio-manuals (not legacy src/assets).
  // Packaged builds ship the same tree via extraResources -> resources/studio-manuals.
  const appRoot = process.env.APP_ROOT ?? path.join(__dirname, '../..')
  const candidates = [
    path.join(appRoot, 'frontend', 'assets', 'studio-manuals'),
    path.join(app.getAppPath(), 'frontend', 'assets', 'studio-manuals'),
    path.join(process.resourcesPath, 'studio-manuals'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

export function getToonflowRuntimeStudioManualsSourceRoot() {
  return path.join(os.homedir(), 'Library', 'Application Support', 'toonflow', 'data', 'skills')
}

export function getStudioManualsFallbackSourceRoots() {
  const primaryRoot = path.resolve(getStudioManualsSourceRoot())
  return [getToonflowRuntimeStudioManualsSourceRoot()]
    .map((candidate) => path.resolve(candidate))
    .filter((candidate) => candidate !== primaryRoot && fs.existsSync(candidate))
}

export function getStudioSkillSyncOptions() {
  return {
    sourceRoot: getStudioManualsSourceRoot(),
    fallbackSourceRoots: getStudioManualsFallbackSourceRoots(),
    storageRoot: getSkillsRoot(),
  }
}

export async function ensureStudioSkillsAvailableAtStartup() {
  try {
    await ensureStudioSkillsSynced(getStudioSkillSyncOptions())
  } catch (error) {
    console.warn('Failed to sync studio skills at startup:', error)
  }
}

// ==================== Studio source URL→绝对路径解析 ====================
export function resolveStudioSourcePath(sourcePath: string) {
  if (sourcePath.startsWith('project-file://')) {
    return resolveProjectFileUrl(getDataDir(), sourcePath)
  }
  if (sourcePath.startsWith('local-image://')) {
    return resolveLocalMediaPath(getMediaRoot(), sourcePath)
  }
  if (sourcePath.startsWith('file://')) {
    const filePath = sourcePath.replace('file://', '')
    assertStudioSourcePathAllowed(filePath)
    return filePath
  }
  if (path.isAbsolute(sourcePath)) {
    assertStudioSourcePathAllowed(sourcePath)
    return sourcePath
  }
  return sourcePath
}

function assertStudioSourcePathAllowed(filePath: string) {
  if (!isStudioSourcePathAllowed(filePath)) {
    throw new Error(`路径不在应用管理的目录范围内，已拒绝访问: ${filePath}`)
  }
}

// macOS may expose the same inode as /var and /private/var; prefer realpath
// identity while retaining lexical resolution for paths that do not exist yet.
export function pathsEquivalent(left: string, right: string): boolean {
  const resolveReal = (value: string) => {
    const macAlias = value.replace(/^\/private\/var(?:\/|$)/, '/var/')
    try {
      return fs.realpathSync.native(macAlias)
    } catch {
      return path.resolve(macAlias)
    }
  }
  return resolveReal(left) === resolveReal(right)
}

// TTS 固定音色参考音频的路径解析:保留收紧前的原语义(绝对路径存在即读)。
// 依据 08-18 渲染层调用面审计:设置页「参考音频路径」是自由文本框,用户可
// 手输/持久化任意外部绝对路径;该链路只把音频字节发给 127.0.0.1 的本地
// sidecar,不外发网络,风险远低于 openPath/图床上传,收紧会打断音色克隆
// 核心流程。其余 IPC 仍走 resolveStudioSourcePath 的受管根守卫。
export function resolveReferenceAudioSourcePath(sourcePath: string) {
  if (sourcePath.startsWith('project-file://')) {
    return resolveProjectFileUrl(getDataDir(), sourcePath)
  }
  if (sourcePath.startsWith('local-image://')) {
    return resolveLocalMediaPath(getMediaRoot(), sourcePath)
  }
  if (sourcePath.startsWith('file://')) return sourcePath.replace('file://', '')
  return sourcePath
}
