import {bindRuntimeControllerRoots, getStorageBasePath, getMediaRoot, getSkillsRoot, getAssetsRoot, scheduleAutoClean} from "./main-paths";
import {blessedDialogPaths, getDataDir, isStudioSourcePathAllowed, projectRootFor, readImageSource} from "./main-paths";
import {ensureStudioSkillsAvailableAtStartup, resolveReferenceAudioSourcePath, resolveStudioSourcePath} from "./main-paths";
import {bindChapterProjectionRuntime, enqueueChapterSceneSegments, evaluateVideoWorkflowChapterGate, readEditingProjectSnapshot, readRemotionCurrentShotSlots} from "./main-chapter-projection";
import {createDiagnosticsOperationId, diagnosticsFetchBytes, diagnosticsFetchJson, runTtsRuntimeDiagnostics, writeDiagnosticsLog} from "./main-diagnostics";
import {bindHostedStudioRuntime, disposeHostedStudio, hostedStudioIpc, persistStudioEditingRevision} from "./main-hosted-studio";
import {isBackgroundSmoke, MAIN_DIST, RENDERER_DIST} from "./main-env";
import {bindWindowRuntime, createWindow, getWin, setDisposeRemotionRuntime, stopLocalSidecars, typedPackageMetadata} from "./main-window";
import {bindNativeBridgeRuntime, buildManagedVideoUseChapterRun, nativeStudioQueueBridge} from "./main-native-bridge";
// IPC 注册群(存储/媒体/资产/更新/诊断/导出)整体外迁,副作用 import 即注册
import "./main-ipc-bootstrap";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import {app, protocol, utilityProcess} from 'electron'
import path from 'node:path'
import {configureSidecarLogCapture} from '../diagnostics/sidecar-log-capture'
import {createTtsRuntimeController} from '../tts/tts-runtime'
import {
  isNonEmptyString,
} from '../runtime/update-policy'
import {installUncaughtExceptionGuard} from '../runtime/uncaught-exception-guard'
import {registerTtsIpcHandlers} from '../ipc/tts/tts-ipc'
import {registerSelfMediaIpcHandlers} from '../ipc/self-media/self-media-ipc'
import {createCredentialVault} from '../aitoearn/credential-vault'
import {createAitoearnLocalPlatformBridge} from '../aitoearn/providers/aitoearn-local/platform-bridge'
import {createOfficialPlatformTransports} from '../aitoearn/providers/aitoearn-local/platforms/official/transports'
import {registerStorageMediaIpcHandlers} from '../ipc/media/storage-media-ipc'
import {
  resolveLocalMediaPath,
  resolveProjectScopedFilePath,
} from '../storage/storage-paths'
import {registerAssetLibraryIpcHandlers} from '../ipc/assets/asset-library-ipc'
import {probeStudioMediaEvidence, registerStudioRenderIpcHandlers} from '../ipc/studio/studio-render-ipc'
import {registerRemotionRuntimeIpcHandlers} from '../ipc/studio/remotion-runtime-ipc'
import {registerSubtitleFontsIpcHandlers} from '../ipc/studio/subtitle-fonts-ipc'
import {customFontAbsolutePath} from '@/lib/studio/remotion/custom-font-store'
import {registerVideoWorkflowIpcHandlers} from '../ipc/studio/video-workflow-ipc'
import {registerRemotionPreviewIpcHandlers} from '../ipc/studio/remotion-preview-ipc'
import {registerRemotionShotIpcHandlers} from '../ipc/studio/remotion-shot-ipc'
import {registerRemotionQueueIpcHandlers} from '../ipc/studio/remotion-queue-ipc'
import {registerRemotionChapterManifestIpcHandlers} from '../ipc/studio/remotion-chapter-manifest-ipc'
import {RemotionShotRenderer} from '@rendering/plugins/remotion/renderer/remotion-shot-renderer'
import type {CinematicCameraPreset} from '@rendering/plugins/remotion/composition/composition-props'
import {RemotionChapterRenderer} from '@rendering/plugins/remotion/renderer/remotion-chapter-renderer'
import {
  createRemotionQueueFilePersistence,
  migrateQueueEventsFileIfNeeded,
  RemotionRenderQueue,
  resolveHardwareQueueConcurrency,
} from '@rendering/plugins/remotion/queue/remotion-render-queue'
import {resolveRemotionRuntimeDir} from '@rendering/plugins/remotion/browser/remotion-runtime-manifest'
import {RemotionChapterManifestService} from '@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service'
import {createVideoWorkflowChapterService} from '@rendering/plugins/video-workflow/video-workflow-chapter-service'
import {acceptVideoUseArtifact} from '@rendering/plugins/video-workflow/video-workflow-artifact-store'
import {createVideoUseAdapter} from '@rendering/plugins/video-use/video-use-adapter'
import {createHyperFramesAdapter} from '@rendering/plugins/hyperframes/hyperframes-adapter'
import {createDepthAdapter} from '@rendering/plugins/depth/depth-adapter'
import {createDepthRuntimeController} from '@rendering/plugins/depth/depth-runtime-controller'
import {registerDepthIpcHandlers} from '../ipc/studio/depth-ipc'
import {createImageGenRuntimeController} from '@rendering/plugins/image_gen/image-gen-runtime-controller'
import {registerImageGenIpcHandlers} from '../ipc/studio/image-gen-ipc'
import {createUpscaleRuntimeController} from '@rendering/plugins/upscale/upscale-runtime-controller'
import {registerUpscaleIpcHandlers} from '../ipc/studio/upscale-ipc'
import {registerSeedVr2IpcHandlers} from '../ipc/studio/seedvr2-ipc'
import {registerMcpIpcHandlers} from '../ipc/studio/mcp-ipc'
import {registerVlmReviewIpc} from '../ipc/studio/vlm-review-ipc'
import {VlmReviewRuntimeController} from '../rendering/plugins/vlm_review/vlm-review-runtime-controller'
import {createVideoQcRuntimeController} from '@rendering/plugins/videoqc/dover-runtime-controller'
import {registerVideoQcIpcHandlers} from '../ipc/studio/video-qc-ipc'
import {runChapterQc, type ChapterQcOrchestratorDeps} from '@rendering/plugins/videoqc/chapter-qc-orchestrator'
import {registerChapterQcIpcHandlers} from '../ipc/studio/chapter-qc-ipc'
import {createAudioGenRuntimeController} from '@rendering/plugins/audio_gen/audio-gen-runtime-controller'
import {registerAudioGenIpcHandlers} from '../ipc/studio/audio-gen-ipc'
import {createSfxGenRuntimeController} from '@rendering/plugins/sfx_gen/sfx-gen-runtime-controller'
import {registerSfxGenIpcHandlers} from '../ipc/studio/sfx-gen-ipc'
import {createMusic3GenRuntimeController} from '@rendering/plugins/music3_gen/music3-gen-runtime-controller'
import {registerMusic3GenIpcHandlers} from '../ipc/studio/music3-gen-ipc'
import {audioModelCacheDir, music3ModelCacheDir, sfxModelCacheDir, ttsModelCacheDir} from '../storage/model-dirs'
import {createVideoWorkflowRuntimeManager} from '@rendering/plugins/video-workflow/video-workflow-runtime-manager'
import {selectSharedVideoToolchain} from '@rendering/plugins/video-workflow/video-workflow-runtime'
import {readStudioWorkflowStore} from '../storage/studio-workflow-store-io'
import {readRemotionCurrentShotSlotsFromWorkspace} from '../../lib/studio/remotion/remotion-current-slot'
import {
  registerPrivilegedSchemes,
  registerProtocolHandlers,
} from '../runtime/register-protocol-handlers'
import {ensureChromiumDataDir} from '../runtime/chromium-data-dir'

// electron-vite 构建后的目录结构
//
// ├─┬ out
// │ ├─┬ main
// │ │ └── index.cjs
// │ ├─┬ preload
// │ │ └── index.cjs
// │ └─┬ renderer
// │   └── index.html
//
process.env.APP_ROOT = path.join(__dirname, '../..')


process.env.VITE_PUBLIC = RENDERER_DIST

// Chromium 会话数据（Cache / Local Storage / IndexedDB / Cookies / OPFS 等）
// 收敛到 <userData>/Chromium，避免散落在 userData 根目录污染应用数据。
// Electron 要求在 app.ready 之前覆盖 sessionData；这里也先于单例锁，
// 让 Singleton 标记直接落在新根目录。一次性迁移失败时回退旧布局，绝不阻塞启动。
const chromiumDataDir = ensureChromiumDataDir({ userDataPath: app.getPath('userData') })
if (chromiumDataDir) app.setPath('sessionData', chromiumDataDir)

const hasSingleInstanceLock = app.requestSingleInstanceLock()

// 开发调试:MYSTUDIO_REMOTE_DEBUG=1 时开放 9222 远程调试端口,
// 供 chrome-devtools-mcp(--browser-url http://127.0.0.1:9222)接入做自动布局/盒模型诊断。
// 必须在 app.whenReady 之前 appendSwitch。默认不开,打包/smoke/正常运行无影响。
if (process.env.MYSTUDIO_REMOTE_DEBUG === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}
if (!hasSingleInstanceLock) {
  app.exit(0)
}

const remotionVersion = typedPackageMetadata.dependencies?.remotion
if (!isNonEmptyString(remotionVersion)) {
  throw new Error('package.json 必须声明精确 Remotion 版本')
}

// 子进程(Python sidecar/Electron worker)输出统一捕获到 <userData>/logs/sidecars/。
// 未配置时捕获 no-op;各 spawn 现场只认 module 名。
configureSidecarLogCapture({
  getSidecarsDir: () => path.join(app.getPath('userData'), 'logs', 'sidecars'),
  writeDiagnostics: writeDiagnosticsLog,
})


// undici setTypeOfService EINVAL(上游 undici#5544)会以未捕获异常弹出 Electron
// 崩溃框,对请求本身无害;进程级过滤吞掉,其余异常保持默认崩溃语义。
installUncaughtExceptionGuard({
  writeLog: (entry) => writeDiagnosticsLog({ ...entry, operationId: createDiagnosticsOperationId('uncaught-exception') }),
})


const ttsRuntimeController = createTtsRuntimeController({
  appRoot: process.env.APP_ROOT ?? path.join(__dirname, '../..'),
  userDataPath: app.getPath('userData'),
  storageBasePath: () => getStorageBasePath(),
  fetchJson: diagnosticsFetchJson,
  fetchBytes: diagnosticsFetchBytes,
})
const selfMediaCredentialVault = createCredentialVault(app.getPath('userData'))
const officialPlatformTransports = createOfficialPlatformTransports({
  userDataPath: app.getPath('userData'),
  allowedAssetRoots: () => [getDataDir(), getMediaRoot()],
})
const selfMediaIpc = registerSelfMediaIpcHandlers({
  credentialVault: selfMediaCredentialVault,
  localBridge: createAitoearnLocalPlatformBridge({
    userDataPath: app.getPath('userData'),
    allowedAssetRoots: () => [getDataDir(), getMediaRoot()],
    platformTransports: officialPlatformTransports.transports,
  }),
  taskStorePath: path.join(app.getPath('userData'), 'self-media', 'tasks.json'),
  resolveAsset: async (_projectId, asset) => {
    const source = asset.approvedUrl ?? asset.assetId;
    const resolved = resolveStudioSourcePath(source);
    if (!resolved || (!resolved.startsWith('http://') && !resolved.startsWith('https://') && !path.isAbsolute(resolved))) {
      throw new Error('自媒体资产无法解析为安全的本地路径或 URL');
    }
    return { assetId: asset.assetId, url: resolved, kind: asset.kind };
  },
})
bindWindowRuntime({ ttsRuntimeController, selfMediaIpc })

const remotionUserDataDir = app.getPath('userData')
const remotionBundlePath = app.isPackaged
  ? path.join(process.resourcesPath, 'remotion-bundle')
  : path.join(process.env.APP_ROOT ?? path.join(__dirname, '../..'), '.cache/remotion-bundle')
const remotionBinariesDirectory = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules/@remotion/compositor-darwin-arm64')
  : path.join(process.env.APP_ROOT ?? path.join(__dirname, '../..'), 'node_modules/@remotion/compositor-darwin-arm64')
// All adapters consume one process-wide FFmpeg/ffprobe pair. Prefer an explicit
// operator pair, then reuse an existing Apple Silicon Homebrew installation.
// The runtime probe blocks unsupported bundled binaries; it never downloads a
// private toolchain or silently swaps a partial explicit override.
const sharedVideoToolchain = selectSharedVideoToolchain({
  configuredFfmpeg: process.env.MYSTUDIO_FFMPEG_PATH,
  configuredFfprobe: process.env.MYSTUDIO_FFPROBE_PATH,
  bundledFfmpeg: path.join(remotionBinariesDirectory, 'ffmpeg'),
  bundledFfprobe: path.join(remotionBinariesDirectory, 'ffprobe'),
})
process.env.MYSTUDIO_FFMPEG_PATH = sharedVideoToolchain.ffmpegExecutable
process.env.MYSTUDIO_FFPROBE_PATH = sharedVideoToolchain.ffprobeExecutable
registerSubtitleFontsIpcHandlers({ getUserDataPath: () => app.getPath('userData') })
const remotionRuntime = registerRemotionRuntimeIpcHandlers({
  userDataDir: remotionUserDataDir,
  remotionVersion,
  workerPath: path.join(MAIN_DIST, 'remotion-browser-worker.cjs'),
  bundlePath: remotionBundlePath,
})
const remotionPreview = registerRemotionPreviewIpcHandlers({
  resolveSourcePath: resolveStudioSourcePath,
})
const remotionChapterManifestService = new RemotionChapterManifestService({
  projectRootForProject: projectRootFor,
  probeMedia: async (filePath) => {
    const evidence = await probeStudioMediaEvidence(filePath)
    return {
      durationUs: Math.round(evidence.duration * 1_000_000),
      streams: evidence.streams,
    }
  },
})
const remotionChapterManifestIpc = registerRemotionChapterManifestIpcHandlers(remotionChapterManifestService)
const videoWorkflowWorkspaceRootForProject = (projectId: string) => path.join(projectRootFor(projectId), 'video-use')
// electron-builder ships Python sources through extraResources, outside the
// asar archive. A packaged app must use Resources/backend as the subprocess
// cwd; app.asar/backend is a virtual path and causes spawn ENOTDIR.
const videoWorkflowBackendRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'backend')
  : path.join(process.env.APP_ROOT ?? path.join(__dirname, '../..'), 'backend')
const videoUseAdapter = createVideoUseAdapter({
  storageBasePath: getStorageBasePath,
  // video-use 权重住 TTS 家族缓存,但须经 model-dirs 单一拼装源(启动契约:生成类
  // 运行时不得挂 ttsRuntimeController 实例;08-28 补完 audio/sfx/music3 同款收口)
  modelCacheDir: () => ttsModelCacheDir(getStorageBasePath()),
  backendRoot: videoWorkflowBackendRoot,
  workspaceRootForProject: videoWorkflowWorkspaceRootForProject,
})
// 子进程(python adapter 等)继承此 env,据 <deps>/.ready 判断是否可推 hy: 模板
process.env.MYSTUDIO_REGISTRY_DEPS_DIR = path.join(app.getPath('userData'), 'hyperframes-registry-deps')
const hyperFramesAdapter = createHyperFramesAdapter({
  storageBasePath: getStorageBasePath,
  workspaceRootForProject: (projectId: string) => path.join(projectRootFor(projectId), 'hyperframes'),
  workerPath: path.join(MAIN_DIST, 'hyperframes-worker.cjs'),
  // hy:* registry 模板依赖(GSAP/Three/字体)下载落位;worker 内联渲染时经 env 读取
  registryDepsDir: path.join(app.getPath('userData'), 'hyperframes-registry-deps'),
  // 浏览器 utility 一次只服务一个请求:与设置页状态刷新并发时会被拒,重试一次避免瞬态"未找到可复用的 Headless Shell"误报
  resolveBrowserPath: async () => {
    const attempt = async () => (await remotionRuntime.controller.probeStatus()).executablePath
    try {
      const first = await attempt()
      if (first) return first
    } catch { /* 并发拒绝/进程冷启动,立即重试 */ }
    await new Promise((resolve) => setTimeout(resolve, 300))
    try {
      return await attempt()
    } catch {
      return undefined
    }
  },
})
const videoWorkflowRuntimeManager = createVideoWorkflowRuntimeManager(getStorageBasePath())
const videoWorkflowChapterService = createVideoWorkflowChapterService({
  workspaceRootForProject: videoWorkflowWorkspaceRootForProject,
  runVideoUse: videoUseAdapter.runChapter,
  renderHyperFrames: hyperFramesAdapter.renderOverlay,
  getCurrentEditingProject: readEditingProjectSnapshot,
  persistEditingProject: persistStudioEditingRevision,
  readChapterManifest: remotionChapterManifestService.read.bind(remotionChapterManifestService),
  writeChapterManifest: remotionChapterManifestService.writeCas.bind(remotionChapterManifestService),
  readCurrentShotSlots: (identity) => readRemotionCurrentShotSlotsFromWorkspace(path.join(projectRootFor(identity.projectId), 'remotion'), identity.projectId, identity.chapterId),
})
const videoWorkflowIpc = registerVideoWorkflowIpcHandlers({
  getStorageBasePath,
  appVersion: app.getVersion(),
  remotionVersion,
  probeRemotion: () => remotionRuntime.controller.status(),
  prepareRemotion: () => remotionRuntime.controller.download(() => undefined),
  probeVideoUse: videoUseAdapter.probe,
  probeHyperFrames: hyperFramesAdapter.probe,
  prepareVideoUseModel: async () => {
    const result = await ttsRuntimeController.prepareAlignmentModel()
    return { success: result.success, ...(result.error ? { error: result.error } : {}) }
  },
  runtimeManager: videoWorkflowRuntimeManager,
  reviewVideoUse: async (request) => {
    const result = await acceptVideoUseArtifact(videoWorkflowWorkspaceRootForProject, request)
    if (!result.success) {
      return {
        schemaVersion: 1,
        success: false,
        projectId: request.projectId,
        chapterId: request.chapterId,
        revision: request.revision,
        status: 'blocked',
        artifactPath: result.artifactPath,
        message: result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('；'),
      }
    }
    return {
      schemaVersion: 1,
      success: true,
      projectId: request.projectId,
      chapterId: request.chapterId,
      revision: request.revision,
      status: 'accepted',
      artifactPath: result.artifactPath,
    }
  },
  runVideoUseChapter: videoUseAdapter.runChapter,
  applyVideoWorkflowChapter: videoWorkflowChapterService.applyAcceptedArtifact,
  buildVideoUseChapterRun: buildManagedVideoUseChapterRun,
})
const remotionRuntimeDir = resolveRemotionRuntimeDir(remotionUserDataDir)

// Depth runtime controller — settings-facing lifecycle (设置 → 本地配置 → 深度估计模型).
// Model downloads are explicit and user-triggered; inference never downloads.
// The model cache dir is self-managed at <storageBase>/model/depth (config.json),
// mirroring the TTS model-dir feature set — no TTS cache fallback.
const depthRuntimeController = createDepthRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
})

// Depth estimation adapter — enables cinematic 3D mode in shot rendering.
// Reuse the controller's persisted model cache resolver so settings probes and
// render workers always inspect the same explicitly downloaded model bytes.
const depthAdapter = createDepthAdapter({
  storageBasePath: getStorageBasePath,
  modelCacheDir: depthRuntimeController.getModelCacheDir,
  backendRoot: videoWorkflowBackendRoot,
})
const depthIpc = registerDepthIpcHandlers({
  controller: depthRuntimeController,
  getDataRoot: getDataDir,
  getDiagnosticsDir: () => path.join(app.getPath('userData'), 'logs', 'diagnostics'),
  getLogBundleDir: () => path.join(app.getPath('userData'), 'logs', 'pipeline-bundles'),
})

// Local image generation sidecar — OpenAI-compatible HTTP server (127.0.0.1:17595)
// registered as the `manying-local-image` provider so cloud APIs can be replaced
// for character/scene/prop generation at zero cost. Models download explicitly.
const imageGenRuntimeController = createImageGenRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
})
const imageGenIpc = registerImageGenIpcHandlers({ controller: imageGenRuntimeController })

// Local image super-resolution sidecar — pure-torch Real-ESRGAN CLI worker for
// 1K→4K upscaling of cloud/local generated images. Same explicit-download
// policy; the model cache dir is self-managed at <storageBase>/UpscaleModel.
const upscaleRuntimeController = createUpscaleRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
  resolveProjectFilePath: (projectId, relativePath) => {
    try {
      return resolveProjectScopedFilePath(getDataDir(), projectId, relativePath)
    } catch {
      return null
    }
  },
  resolveLocalMediaPath: (url) => {
    try {
      return resolveLocalMediaPath(getMediaRoot(), url)
    } catch {
      return null
    }
  },
})
registerStorageMediaIpcHandlers({
  getDataDir,
  getMediaRoot,
  createOperationId: createDiagnosticsOperationId,
  writeDiagnosticsLog,
  readImageSource,
})

bindRuntimeControllerRoots(() => [ttsRuntimeController.getModelCacheDir(), depthRuntimeController.getModelCacheDir(), upscaleRuntimeController.getModelCacheDir()])
const upscaleIpc = registerUpscaleIpcHandlers({ controller: upscaleRuntimeController })
const seedvr2Ipc = registerSeedVr2IpcHandlers()
const mcpIpc = registerMcpIpcHandlers()
// 非阻塞启动期刷新:冷启动后 status() 即反映真实运行时/模型状态,超分动作的
// precheck(节点按钮/分镜 tile)无需用户先访问设置页。
void upscaleRuntimeController.refresh()

// VLM Review sidecar — Qwen3-VL visual consistency checking(生图后自动审核)。
// 复用 managed Python;权重显式下载,<storageBase>/model/vlm。
const vlmReviewController = new VlmReviewRuntimeController({
  pythonExecutable: path.join(getStorageBasePath(), "python", "bin", "python3"),
  // 复用打包感知的 backend 根:app.asar/backend 是虚拟路径,spawn 会 ENOTDIR(08-28 修)。
  backendRoot: videoWorkflowBackendRoot,
  storageBasePath: getStorageBasePath(),
  resolveProjectFilePath: async (url) => {
    try {
      // project-file://<projectId>/<percent-encoded 相对路径>——projectId 与每段
      // 路径都必须 decodeURIComponent(08-28 R14 实证:成图文件名含中文,原样传
      // 会让 VLM worker 拿到字面 %E5… 路径找不到文件,审核环产线整体失效)
      const match = /^project-file:\/\/([^/]+)\/(.*)$/.exec(url)
      if (!match) return null
      const projectId = decodeURIComponent(match[1])
      const relativePath = match[2]
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/')
      return resolveProjectScopedFilePath(getDataDir(), projectId, relativePath)
    } catch {
      return null
    }
  },
})
registerVlmReviewIpc(vlmReviewController)

// Chapter video QC sidecar — DOVER-Mobile 观感层(出片后 QC 链 L3)。
// 复用 managed Python(probe 路径零重依赖);权重显式下载,<storageBase>/model/videoqc。
const videoQcRuntimeController = createVideoQcRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
})
const videoQcIpc = registerVideoQcIpcHandlers({ controller: videoQcRuntimeController })
// 非阻塞启动期刷新:QC 报告与设置页冷启动即反映模型就绪态。
void videoQcRuntimeController.refresh()

// 出片后 QC 链编排器(L1 结构/L2 逐帧/L3 观感;L4 语义由渲染端跑完回写)。
const chapterQcOrchestratorDeps: ChapterQcOrchestratorDeps = {
  remotionWorkspaceRootForProject: (projectId) => path.join(projectRootFor(projectId), 'remotion'),
  videoUseWorkspaceRootForProject: (projectId) => path.join(projectRootFor(projectId), 'video-use'),
  dataRoot: getDataDir(),
  videoQc: videoQcRuntimeController,
}
const chapterQcIpc = registerChapterQcIpcHandlers({
  deps: chapterQcOrchestratorDeps,
  runQc: runChapterQc,
  getWindow: getWin,
})

// Local music generation sidecar — MusicGen BGM generation via CLI worker.
// Same explicit-download policy; generated WAVs feed the chapter BGM track.
const audioGenRuntimeController = createAudioGenRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
  modelCacheDir: () => audioModelCacheDir(getStorageBasePath()),
})
const audioGenIpc = registerAudioGenIpcHandlers({
  controller: audioGenRuntimeController,
  getExportDir: () => path.join(app.getPath('userData'), 'exports'),
})

// Local sfx generation sidecar (08-19-local-sfx-generation P1) — seed-deterministic
// short one-shots for the sfx binding role; explicit-download policy, exports dir first.
const sfxGenRuntimeController = createSfxGenRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
  modelCacheDir: () => sfxModelCacheDir(getStorageBasePath()),
})
const sfxGenIpc = registerSfxGenIpcHandlers({
  controller: sfxGenRuntimeController,
  getExportDir: () => path.join(app.getPath('userData'), 'exports'),
})

// MiniMax-Music3 (MLX) whole-song BGM engine (08-19-minimax-music3-engine) —
// self-contained bf16 weight pack, native --seed; explicit download (~28.5 GB).
const music3GenRuntimeController = createMusic3GenRuntimeController({
  storageBasePath: getStorageBasePath,
  backendRoot: videoWorkflowBackendRoot,
  modelCacheDir: () => music3ModelCacheDir(getStorageBasePath()),
})
const music3GenIpc = registerMusic3GenIpcHandlers({
  controller: music3GenRuntimeController,
  getExportDir: () => path.join(app.getPath('userData'), 'exports'),
  // 项目音乐目录 = <项目根>/music/;项目根经位置注册表动态解析(08-19 工作台音乐生成)
  getProjectMusicDir: (projectId: string) => path.join(projectRootFor(projectId), 'music'),
  // AI 参照曲解析读音频:受管根/对话框祝福路径守卫(managed-paths H-2/H-3)
  isSourcePathAllowed: isStudioSourcePathAllowed,
})

const remotionShotRenderer = new RemotionShotRenderer({
  workspaceRoot: getDataDir(),
  workspaceRootForProject: (projectId) => path.join(projectRootFor(projectId), "remotion"),
  projectRootForProject: projectRootFor,
  bundlePath: remotionBundlePath,
  workerPath: path.join(MAIN_DIST, 'remotion-render-worker.cjs'),
  cwd: remotionRuntimeDir,
  binariesDirectory: remotionBinariesDirectory,
  resolveSourcePath: resolveStudioSourcePath,
  probeBrowser: () => remotionRuntime.controller.probeStatus(),
  fork: (modulePath, args, options) => utilityProcess.fork(modulePath, [...args], options),
  remotionVersion,
  emitProgress: () => undefined,
  depthAdapter,
  cinematicPreset: (shotId: string) => depthRuntimeController.getCinematicPresetForShot(shotId) as CinematicCameraPreset,
})
const remotionChapterRenderer = new RemotionChapterRenderer({
  workspaceRoot: getDataDir(),
  workspaceRootForProject: (projectId) => path.join(projectRootFor(projectId), "remotion"),
  bundlePath: remotionBundlePath,
  workerPath: path.join(MAIN_DIST, 'remotion-render-worker.cjs'),
  cwd: remotionRuntimeDir,
  binariesDirectory: remotionBinariesDirectory,
  resolveSourcePath: resolveStudioSourcePath,
  projectRootForProject: projectRootFor,
  chapterManifestService: remotionChapterManifestService,
  probeBrowser: () => remotionRuntime.controller.probeStatus(),
  fork: (modulePath, args, options) => utilityProcess.fork(modulePath, [...args], options),
  remotionVersion,
  resolveCustomFontPath: (fontId) => customFontAbsolutePath(app.getPath('userData'), fontId),
  emitProgress: () => undefined,
  videoWorkflowGate: evaluateVideoWorkflowChapterGate,
  // 章节级资产（LUT/sfx，08-19）：dev=源码树 frontend/assets；打包=resources 下
  // extraResources 镜像（electron-builder.yml from frontend/assets/{luts,sfx}）。
  assetsDir: app.isPackaged
    ? process.resourcesPath
    : path.join(process.env.APP_ROOT ?? path.join(__dirname, '../..'), 'frontend/assets'),
  // 字幕音效类别表：分镜记录 shotFx.sfx（装饰层，同 store 单源；读取失败=空表零派生）。
  readSfxCategories: (projectId, chapterId) => {
    try {
      const store = readStudioWorkflowStore(getDataDir(), projectId)
      const storyboards = (store?.state?.storyboards ?? []) as Array<{ id: string; episodeId: string; shotFx?: { sfx?: unknown } }>
      const categories: Record<string, string> = {}
      for (const storyboard of storyboards) {
        if (storyboard.episodeId === chapterId && typeof storyboard.shotFx?.sfx === 'string') {
          categories[storyboard.id] = storyboard.shotFx.sfx
        }
      }
      return categories
    } catch {
      return {}
    }
  },
})
const remotionShotIpc = registerRemotionShotIpcHandlers(remotionShotRenderer)
// 日志统一归位:队列事件日志进 <userData>/logs/remotion-queue/,运行态快照留在数据根。
// 一次性迁移旧布局(与快照同目录)的事件文件,必须在构造队列前同步完成。
const remotionQueueStateRoot = path.join(getDataDir(), '_remotion', 'queue')
const remotionQueueEventsRoot = path.join(app.getPath('userData'), 'logs', 'remotion-queue')
migrateQueueEventsFileIfNeeded(
  path.join(remotionQueueStateRoot, 'queue-events.jsonl'),
  path.join(remotionQueueEventsRoot, 'queue-events.jsonl'),
)
const remotionQueue = new RemotionRenderQueue({
  // 硬件感知并发:每路渲染≈4核+8GB 预算,取约束最小值(M4 128G→3);缺省回落 1
  concurrency: resolveHardwareQueueConcurrency(),
  persistence: createRemotionQueueFilePersistence({ stateRoot: remotionQueueStateRoot, eventsRoot: remotionQueueEventsRoot }),
  executor: {
    render: remotionShotRenderer.render.bind(remotionShotRenderer),
    renderChapter: remotionChapterRenderer.render.bind(remotionChapterRenderer),
    renderChapterScene: remotionChapterRenderer.renderScene.bind(remotionChapterRenderer),
    cancel: (jobId) => {
      const shot = remotionShotRenderer.cancel(jobId)
      if (shot.success) return shot
      return remotionChapterRenderer.cancel(jobId)
    },
  },
  // 出片后 QC 链挂点:fire-and-forget,失败只进报告不影响队列(08-19-chapter-video-qc)
  onChapterJobSucceeded: (identity) => {
    void runChapterQc(chapterQcOrchestratorDeps, identity).catch(() => undefined)
  },
})
const remotionQueueIpc = registerRemotionQueueIpcHandlers(remotionQueue, {
  getCurrentShotSlots: readRemotionCurrentShotSlots,
  enqueueChapterScenes: enqueueChapterSceneSegments,
})
// chapter-projection 读簇的装配单例注入(全部消费点均在 whenReady 后的 IPC 调用)
bindChapterProjectionRuntime({
  remotionVersion,
  remotionBundlePath,
  remotionRuntime,
  remotionChapterManifestService,
  remotionQueue,
  videoWorkflowChapterService,
})
bindNativeBridgeRuntime({
  remotionVersion,
  remotionBundlePath,
  remotionRuntime,
  remotionChapterManifestService,
  remotionQueue,
  videoUseAdapter,
})
bindHostedStudioRuntime(nativeStudioQueueBridge)

setDisposeRemotionRuntime(async () => {
  await hostedStudioIpc.dispose()
  await disposeHostedStudio()
  remotionQueueIpc.dispose()
  remotionChapterManifestIpc.dispose()
  await remotionPreview.dispose()
  await remotionShotIpc.dispose()
  await remotionChapterRenderer.dispose()
  videoWorkflowIpc.dispose()
  depthIpc.dispose()
  imageGenIpc.dispose()
  upscaleIpc.dispose()
  seedvr2Ipc.dispose()
  mcpIpc.dispose()
  videoQcIpc.dispose()
  chapterQcIpc.dispose()
  audioGenIpc.dispose()
  sfxGenIpc.dispose()
  music3GenIpc.dispose()
  remotionRuntime.dispose()
})

registerStudioRenderIpcHandlers({
  getMediaRoot,
  resolveSourcePath: resolveStudioSourcePath,
  createOperationId: createDiagnosticsOperationId,
  writeDiagnosticsLog,
})

registerAssetLibraryIpcHandlers({
  getStorageBasePath,
  getMediaRoot,
  createOperationId: createDiagnosticsOperationId,
  writeDiagnosticsLog,
  isSourcePathAllowed: isStudioSourcePathAllowed,
  blessDialogPaths: blessedDialogPaths.bless,
})


registerTtsIpcHandlers({
  controller: ttsRuntimeController,
  runDiagnostics: runTtsRuntimeDiagnostics,
  resolveReferenceAudioPath: resolveReferenceAudioSourcePath,
})

registerPrivilegedSchemes(protocol)

app.whenReady().then(async () => {
  if (isBackgroundSmoke && process.platform === 'darwin') {
    app.setActivationPolicy('accessory')
    app.dock?.hide()
  }
  scheduleAutoClean()
  await stopLocalSidecars()
  await ensureStudioSkillsAvailableAtStartup()
  registerProtocolHandlers({
    protocol,
    getMediaRoot,
    getDataDir,
    getSkillsRoot,
    getAssetsRoot,
    getImageThumbDir: () => path.join(app.getPath('userData'), 'image-thumbs'),
  })
  
  createWindow()
})


export { blessedDialogPaths, getDataDir, getManagedSourceRoots, isStudioSourcePathAllowed, projectLocationStore, projectRootFor, readImageSource, storageManager } from "./main-paths";
export { VITE_DEV_SERVER_URL, MAIN_DIST, RENDERER_DIST } from "./main-env";
