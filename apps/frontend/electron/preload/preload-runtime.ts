import { ipcRenderer, contextBridge, type IpcRendererEvent } from 'electron'
import { SELF_MEDIA_IPC, decodeSelfMediaIpcReply, decodeSelfMediaProgressEvent } from '../../lib/self-media/ipc-contract'
import type { TimelineRenderPlan } from '../../types/editing'
import type { BackendModelStatus, TtsRuntimeCommandResult, TtsRuntimeConfig, TtsRuntimeStatus } from '../../types/tts'
import type { ExecuteResult, RecoveryQueryResult, MetadataUpdateResult } from '../../types/artifacts'
import {
  REMOTION_RUNTIME_DOWNLOAD_CHANNEL,
  REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT,
  REMOTION_RUNTIME_STATUS_CHANNEL,
  validateRemotionRuntimeDownloadProgressEvent,
  validateRemotionRuntimeStatusReply,
} from '@rendering/contracts/remotion-runtime-ipc'
import type { RemotionBrowserDownloadProgress, RemotionBrowserStatus } from '@rendering/contracts/remotion-browser-status'
import {
  VIDEO_WORKFLOW_PREPARE_CHANNEL,
  VIDEO_WORKFLOW_UPDATE_CHANNEL,
  VIDEO_WORKFLOW_REPAIR_CHANNEL,
  VIDEO_WORKFLOW_ROLLBACK_CHANNEL,
  VIDEO_WORKFLOW_REVIEW_CHANNEL,
  VIDEO_WORKFLOW_RUN_CHAPTER_CHANNEL,
  VIDEO_WORKFLOW_APPLY_CHAPTER_CHANNEL,
  VIDEO_WORKFLOW_STATUS_CHANNEL,
  VIDEO_WORKFLOW_READ_CHAPTER_CHANNEL,
  validateVideoWorkflowActionReply,
  validateVideoWorkflowReviewReply,
  validateVideoWorkflowChapterRunReply,
  validateVideoWorkflowChapterApplyReply,
  validateVideoWorkflowStatusReply,
  validateVideoWorkflowChapterReadReply,
} from '@rendering/contracts/video-workflow-ipc'
import type {
  VideoWorkflowActionReplyV1,
  VideoWorkflowPluginActionRequestV1,
  VideoWorkflowReviewReplyV1,
  VideoWorkflowReviewRequestV1,
  VideoWorkflowStatusReplyV1,
  VideoWorkflowChapterRunReplyV1,
  VideoWorkflowChapterRunRequestV1,
  VideoWorkflowChapterApplyReplyV1,
  VideoWorkflowChapterApplyRequestV1,
  VideoWorkflowChapterReadReplyV1,
  VideoWorkflowChapterReadRequestV1,
} from '@rendering/contracts/video-workflow-ipc'
import {
  REMOTION_WORKSPACE_RUNTIME_CHANNEL,
  validateRemotionWorkspaceRuntimeReply,
  type RemotionWorkspaceRuntimeReply,
} from '@rendering/contracts/remotion-workspace-runtime'
import {
  REMOTION_PREVIEW_CREATE_CHANNEL,
  REMOTION_PREVIEW_RELEASE_CHANNEL,
  REMOTION_SHOT_PREVIEW_CREATE_CHANNEL,
  validateRemotionPreviewCreateReply,
  validateRemotionPreviewReleaseReply,
  validateRemotionShotPreviewCreateReply,
  type RemotionPreviewCreateReply,
  type RemotionPreviewReleaseReply,
  type RemotionShotPreviewCreateReply,
} from '@rendering/plugins/remotion/preview/remotion-preview-ipc'
import type { RemotionShotPlanV1 } from '@/lib/studio/remotion/shot-plan'
import {
  REMOTION_SHOT_RENDER_CANCEL_CHANNEL,
  REMOTION_SHOT_RENDER_CHANNEL,
  type RemotionShotRenderRequest,
} from '@rendering/plugins/remotion/renderer/remotion-shot-ipc'
import type { RemotionShotRenderResult } from '@rendering/plugins/remotion/renderer/remotion-shot-renderer'
import {
  DEPTH_PREPARE_CHANNEL,
  DEPTH_PROBE_CHANNEL,
  DEPTH_ROLLBACK_CHANNEL,
  DEPTH_SCHEMA_VERSION,
  validateDepthRuntimeActionReply,
  validateDepthRuntimeStatus,
} from '@rendering/contracts/depth-workflow'
import type {
  DepthRuntimeActionReplyV1,
  DepthRuntimeLifecycleRequestV1,
  DepthRuntimeStatusV1,
} from '@rendering/contracts/depth-workflow'
import {
  UPSCALE_PREPARE_CHANNEL,
  UPSCALE_PROBE_CHANNEL,
  UPSCALE_ROLLBACK_CHANNEL,
  UPSCALE_SCHEMA_VERSION,
  validateUpscaleRuntimeActionReply,
  validateUpscaleRuntimeStatus,
} from '@rendering/contracts/upscale-workflow'
import type {
  UpscaleRuntimeActionReplyV1,
  UpscaleRuntimeLifecycleRequestV1,
  UpscaleRuntimeStatusV1,
} from '@rendering/contracts/upscale-workflow'
import {
  IMAGE_GEN_PREPARE_CHANNEL,
  IMAGE_GEN_PROBE_CHANNEL,
  IMAGE_GEN_ROLLBACK_CHANNEL,
  IMAGE_GEN_SCHEMA_VERSION,
  validateImageGenRuntimeActionReply,
  validateImageGenRuntimeStatus,
} from '@rendering/contracts/image-gen-workflow'
import type {
  ImageGenRuntimeActionReplyV1,
  ImageGenRuntimeLifecycleRequestV1,
  ImageGenRuntimeStatusV1,
} from '@rendering/contracts/image-gen-workflow'
import {
  REMOTION_QUEUE_CANCEL_CHANNEL,
  REMOTION_QUEUE_CHECK_SWITCH_CHANNEL,
  REMOTION_QUEUE_ENQUEUE_CHAPTER_SCENES_CHANNEL,
  REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL,
  REMOTION_QUEUE_GET_CHANNEL,
  REMOTION_QUEUE_JOB_EVENT,
  REMOTION_QUEUE_RETRY_CHANNEL,
  REMOTION_QUEUE_SWITCH_CHANNEL,
  decodeRemotionQueueNotification,
  decodeRemotionQueueScopeReply,
  type RemotionQueueCancelReply,
  type RemotionQueueEnqueueChapterScenesReply,
  type RemotionQueueEnqueueChapterScenesRequest,
  type RemotionQueueEnqueueShotRequest,
  type RemotionQueueRetryReply,
  type RemotionQueueScopeReply,
  type RemotionQueueSwitchReply,
} from '@rendering/plugins/remotion/queue/remotion-queue-ipc'
import type { RemotionQueueNotification } from '@rendering/plugins/remotion/queue/remotion-render-queue'
import {
  REMOTION_CHAPTER_AUDIO_IMPORT_CHANNEL,
  REMOTION_CHAPTER_AUDIO_PROBE_CHANNEL,
  REMOTION_CHAPTER_MANIFEST_READ_CHANNEL,
  REMOTION_CHAPTER_MANIFEST_WRITE_CHANNEL,
  REMOTION_SHOT_AUDIO_WRITE_GENERATED_CHANNEL,
  type RemotionChapterManifestBridge,
} from '@rendering/plugins/remotion/manifest/remotion-chapter-manifest-ipc'
import {
  REMOTION_STUDIO_CLOSE_SESSION_CHANNEL,
  REMOTION_STUDIO_EDITING_UPDATED_EVENT,
  REMOTION_STUDIO_ENSURE_SESSION_CHANNEL,
  validateRemotionStudioEnsureSessionReply,
  validateRemotionStudioEditingUpdatedEvent,
  type RemotionStudioEnsureSessionReply,
  type RemotionStudioEnsureSessionRequest,
  type RemotionStudioEditingUpdatedEvent,
} from '../ipc/studio/remotion-studio-ipc'


/**
 * preload 运行时域——本地运行时控制器暴露(VLM/视频QC/章节QC/音频/音效/
 * 音乐3/Remotion 渲染器/工件库存与删除/TTS/深度/超分/图像生成/视频工作流)。
 * P3 收官:AST 块边界整体迁移,体逐字保留。
 */

function parseRemotionRuntimeStatus(value: unknown): RemotionBrowserStatus {
  const result = validateRemotionRuntimeStatusReply(value)
  if (!result.success) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  }
  return result.value
}

contextBridge.exposeInMainWorld('remotionRuntime', {
  status: async (): Promise<RemotionBrowserStatus> =>
    parseRemotionRuntimeStatus(await ipcRenderer.invoke(REMOTION_RUNTIME_STATUS_CHANNEL)),
  download: async (): Promise<RemotionBrowserStatus> =>
    parseRemotionRuntimeStatus(await ipcRenderer.invoke(REMOTION_RUNTIME_DOWNLOAD_CHANNEL, {})),
  onDownloadProgress(listener: (progress: RemotionBrowserDownloadProgress) => void) {
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => {
      const result = validateRemotionRuntimeDownloadProgressEvent(payload)
      if (result.success) listener(result.value)
    }
    ipcRenderer.on(REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT, wrapped)
    return () => ipcRenderer.removeListener(REMOTION_RUNTIME_DOWNLOAD_PROGRESS_EVENT, wrapped)
  },
  workspaceRuntime: async (): Promise<RemotionWorkspaceRuntimeReply> => {
    const result = validateRemotionWorkspaceRuntimeReply(
      await ipcRenderer.invoke(REMOTION_WORKSPACE_RUNTIME_CHANNEL, {}),
    )
    if (!result.success) {
      throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
    }
    return result.value
  },
})

function parseVideoWorkflowStatus(value: unknown): VideoWorkflowStatusReplyV1 {
  const result = validateVideoWorkflowStatusReply(value)
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  return result.value
}

function parseVideoWorkflowAction(value: unknown): VideoWorkflowActionReplyV1 {
  const result = validateVideoWorkflowActionReply(value)
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  return result.value
}

function parseVideoWorkflowReview(value: unknown): VideoWorkflowReviewReplyV1 {
  const result = validateVideoWorkflowReviewReply(value)
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  return result.value
}

function parseVideoWorkflowChapterRun(value: unknown): VideoWorkflowChapterRunReplyV1 {
  const result = validateVideoWorkflowChapterRunReply(value)
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  return result.value
}

function parseVideoWorkflowChapterApply(value: unknown): VideoWorkflowChapterApplyReplyV1 {
  const result = validateVideoWorkflowChapterApplyReply(value)
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  return result.value
}
function parseVideoWorkflowChapterRead(value: unknown): VideoWorkflowChapterReadReplyV1 {
  const result = validateVideoWorkflowChapterReadReply(value)
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  return result.value
}

contextBridge.exposeInMainWorld('subtitleFonts', {
  list: async () => ipcRenderer.invoke('subtitleFonts:list'),
  import: async () => ipcRenderer.invoke('subtitleFonts:import'),
  delete: async (fontId: string) => ipcRenderer.invoke('subtitleFonts:delete', fontId),
  read: async (fontId: string) => ipcRenderer.invoke('subtitleFonts:read', fontId),
})

contextBridge.exposeInMainWorld('videoWorkflowPlugins', {
  status: async (): Promise<VideoWorkflowStatusReplyV1> =>
    parseVideoWorkflowStatus(await ipcRenderer.invoke(VIDEO_WORKFLOW_STATUS_CHANNEL)),
  prepare: async (request: VideoWorkflowPluginActionRequestV1): Promise<VideoWorkflowActionReplyV1> =>
    parseVideoWorkflowAction(await ipcRenderer.invoke(VIDEO_WORKFLOW_PREPARE_CHANNEL, request)),
  update: async (request: VideoWorkflowPluginActionRequestV1): Promise<VideoWorkflowActionReplyV1> =>
    parseVideoWorkflowAction(await ipcRenderer.invoke(VIDEO_WORKFLOW_UPDATE_CHANNEL, request)),
  repair: async (request: VideoWorkflowPluginActionRequestV1): Promise<VideoWorkflowActionReplyV1> =>
    parseVideoWorkflowAction(await ipcRenderer.invoke(VIDEO_WORKFLOW_REPAIR_CHANNEL, request)),
  rollback: async (request: VideoWorkflowPluginActionRequestV1): Promise<VideoWorkflowActionReplyV1> =>
    parseVideoWorkflowAction(await ipcRenderer.invoke(VIDEO_WORKFLOW_ROLLBACK_CHANNEL, request)),
  review: async (request: VideoWorkflowReviewRequestV1): Promise<VideoWorkflowReviewReplyV1> =>
    parseVideoWorkflowReview(await ipcRenderer.invoke(VIDEO_WORKFLOW_REVIEW_CHANNEL, request)),
  runChapter: async (request: VideoWorkflowChapterRunRequestV1): Promise<VideoWorkflowChapterRunReplyV1> =>
    parseVideoWorkflowChapterRun(await ipcRenderer.invoke(VIDEO_WORKFLOW_RUN_CHAPTER_CHANNEL, request)),
  applyChapter: async (request: VideoWorkflowChapterApplyRequestV1): Promise<VideoWorkflowChapterApplyReplyV1> =>
    parseVideoWorkflowChapterApply(await ipcRenderer.invoke(VIDEO_WORKFLOW_APPLY_CHAPTER_CHANNEL, request)),
  readChapter: async (request: VideoWorkflowChapterReadRequestV1): Promise<VideoWorkflowChapterReadReplyV1> =>
    parseVideoWorkflowChapterRead(await ipcRenderer.invoke(VIDEO_WORKFLOW_READ_CHAPTER_CHANNEL, request)),
})

contextBridge.exposeInMainWorld('remotionPreview', {
  create: async (plan: TimelineRenderPlan): Promise<RemotionPreviewCreateReply> => {
    const result = validateRemotionPreviewCreateReply(
      await ipcRenderer.invoke(REMOTION_PREVIEW_CREATE_CHANNEL, { plan }),
    )
    if (!result.success) {
      throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
    }
    return result.value
  },
  createShot: async (shotPlan: RemotionShotPlanV1): Promise<RemotionShotPreviewCreateReply> => {
    const result = validateRemotionShotPreviewCreateReply(
      await ipcRenderer.invoke(REMOTION_SHOT_PREVIEW_CREATE_CHANNEL, { shotPlan }),
    )
    if (!result.success) {
      throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
    }
    return result.value
  },
  release: async (sessionId: string): Promise<RemotionPreviewReleaseReply> => {
    const result = validateRemotionPreviewReleaseReply(
      await ipcRenderer.invoke(REMOTION_PREVIEW_RELEASE_CHANNEL, { sessionId }),
    )
    if (!result.success) {
      throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
    }
    return result.value
  },
})

contextBridge.exposeInMainWorld('remotionShotRenderer', {
  render: (request: RemotionShotRenderRequest): Promise<RemotionShotRenderResult> =>
    ipcRenderer.invoke(REMOTION_SHOT_RENDER_CHANNEL, request),
  cancel: (jobId: string): Promise<{ success: boolean; jobId: string; canceled: boolean; error?: string }> =>
    ipcRenderer.invoke(REMOTION_SHOT_RENDER_CANCEL_CHANNEL, { jobId }),
})

contextBridge.exposeInMainWorld('remotionChapterManifest', {
  read: (scope) => ipcRenderer.invoke(REMOTION_CHAPTER_MANIFEST_READ_CHANNEL, scope),
  write: (request) => ipcRenderer.invoke(REMOTION_CHAPTER_MANIFEST_WRITE_CHANNEL, request),
  importAudio: (request) => ipcRenderer.invoke(REMOTION_CHAPTER_AUDIO_IMPORT_CHANNEL, request),
  writeGeneratedShotAudio: (request) => ipcRenderer.invoke(REMOTION_SHOT_AUDIO_WRITE_GENERATED_CHANNEL, request),
  probeAudio: (request) => ipcRenderer.invoke(REMOTION_CHAPTER_AUDIO_PROBE_CHANNEL, request),
} satisfies RemotionChapterManifestBridge)

contextBridge.exposeInMainWorld('remotionQueue', {
  get: async (scope: { projectId: string; chapterId: string }): Promise<RemotionQueueScopeReply> => {
    const result = decodeRemotionQueueScopeReply(await ipcRenderer.invoke(REMOTION_QUEUE_GET_CHANNEL, scope))
    if (!result) throw new Error('Remotion queue scope 响应无效')
    return result
  },
  enqueueShot: (request: RemotionQueueEnqueueShotRequest): Promise<RemotionQueueRetryReply> =>
    ipcRenderer.invoke(REMOTION_QUEUE_ENQUEUE_SHOT_CHANNEL, request),
  enqueueChapterScenes: (request: RemotionQueueEnqueueChapterScenesRequest): Promise<RemotionQueueEnqueueChapterScenesReply> =>
    ipcRenderer.invoke(REMOTION_QUEUE_ENQUEUE_CHAPTER_SCENES_CHANNEL, request),
  retry: (jobId: string): Promise<RemotionQueueRetryReply> =>
    ipcRenderer.invoke(REMOTION_QUEUE_RETRY_CHANNEL, { jobId }),
  cancel: (jobId: string): Promise<RemotionQueueCancelReply> =>
    ipcRenderer.invoke(REMOTION_QUEUE_CANCEL_CHANNEL, { jobId }),
  switchProject: (toProjectId: string): Promise<RemotionQueueSwitchReply> =>
    ipcRenderer.invoke(REMOTION_QUEUE_SWITCH_CHANNEL, { toProjectId }),
  canSwitchProject: (toProjectId: string): Promise<RemotionQueueSwitchReply> =>
    ipcRenderer.invoke(REMOTION_QUEUE_CHECK_SWITCH_CHANNEL, { toProjectId }),
  onJob(listener: (notification: RemotionQueueNotification) => void) {
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => {
      const notification = decodeRemotionQueueNotification(payload)
      if (notification) listener(notification)
    }
    ipcRenderer.on(REMOTION_QUEUE_JOB_EVENT, wrapped)
    return () => ipcRenderer.removeListener(REMOTION_QUEUE_JOB_EVENT, wrapped)
  },
})

contextBridge.exposeInMainWorld('remotionStudio', {
  ensureSession: async (request: RemotionStudioEnsureSessionRequest): Promise<RemotionStudioEnsureSessionReply> => {
    const result = validateRemotionStudioEnsureSessionReply(
      await ipcRenderer.invoke(REMOTION_STUDIO_ENSURE_SESSION_CHANNEL, request),
    )
    if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
    return result.value
  },
  closeSession: async (projectId: string): Promise<{ status: "closed"; projectId: string }> => {
    const result = await ipcRenderer.invoke(REMOTION_STUDIO_CLOSE_SESSION_CHANNEL, { projectId }) as unknown
    if (!result || typeof result !== "object" || (result as { status?: unknown }).status !== "closed" || (result as { projectId?: unknown }).projectId !== projectId) {
      throw new Error("Remotion Studio close 响应无效")
    }
    return result as { status: "closed"; projectId: string }
  },
  onEditingUpdated(listener: (event: RemotionStudioEditingUpdatedEvent) => void) {
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => {
      const result = validateRemotionStudioEditingUpdatedEvent(payload)
      if (result.success) listener(result.value)
    }
    ipcRenderer.on(REMOTION_STUDIO_EDITING_UPDATED_EVENT, wrapped)
    return () => ipcRenderer.removeListener(REMOTION_STUDIO_EDITING_UPDATED_EVENT, wrapped)
  },
})

contextBridge.exposeInMainWorld('studioAssets', {
  saveMaterial: (payload: { name: string; bytes: ArrayBuffer }) => ipcRenderer.invoke('studio-save-material', payload),
  list: (payload: unknown) => ipcRenderer.invoke('assets:list', payload),
  get: (id: string) => ipcRenderer.invoke('assets:get', id),
  update: (payload: { id: string; updates: Record<string, unknown> }) => ipcRenderer.invoke('assets:update', payload),
  delete: (id: string) => ipcRenderer.invoke('assets:delete', id),
  add: (payload: { type: string; name: string; sourceFilePath?: string; description?: string; prompt?: string; setting?: string }) => ipcRenderer.invoke('assets:add', payload),
  addImage: (payload: { assetId: string; imageName: string; sourceFilePath: string }) => ipcRenderer.invoke('assets:add-image', payload),
  replaceImage: (payload: { assetId: string; sourceFilePath: string }) => ipcRenderer.invoke('assets:replace-image', payload),
  removeImage: (payload: { assetId: string; imageFilePath: string }) => ipcRenderer.invoke('assets:remove-image', payload),
  renameImage: (payload: { assetId: string; imageFilePath: string; newName: string }) => ipcRenderer.invoke('assets:rename-image', payload),
  selectImageFile: () => ipcRenderer.invoke('assets:select-image-file'),
  selectImageFiles: () => ipcRenderer.invoke('assets:select-image-files'),
  selectAudioFile: () => ipcRenderer.invoke('assets:select-audio-file'),
  importFromToonflow: (payload: { type: string }) => ipcRenderer.invoke('assets:import-from-toonflow', payload),
  getByName: (payload: { type: string; name: string }) => ipcRenderer.invoke('assets:get-by-name', payload),
  batchMatch: (payload: { type: string; names: string[] }) => ipcRenderer.invoke('assets:batch-match', payload),
  readImageDataUrl: (id: string) => ipcRenderer.invoke('assets:read-image-data-url', id),
  resolveFileUrl: (url: string) => ipcRenderer.invoke('assets:resolve-file-url', url),
})

contextBridge.exposeInMainWorld('ttsRuntime', {
  status: (): Promise<TtsRuntimeStatus> => ipcRenderer.invoke('tts-runtime-status'),
  start: (): Promise<TtsRuntimeCommandResult> => ipcRenderer.invoke('tts-runtime-start'),
  setup: (): Promise<TtsRuntimeCommandResult> => ipcRenderer.invoke('tts-runtime-setup'),
  stop: (): Promise<TtsRuntimeCommandResult> => ipcRenderer.invoke('tts-runtime-stop'),
  migrateStorage: (): Promise<TtsRuntimeCommandResult> => ipcRenderer.invoke('tts-runtime-migrate-storage'),
  getConfig: (): Promise<TtsRuntimeConfig> => ipcRenderer.invoke('tts-runtime-get-config'),
  setConfig: (config: Partial<TtsRuntimeConfig>): Promise<TtsRuntimeCommandResult> =>
    ipcRenderer.invoke('tts-runtime-set-config', config),
  setModelCacheDir: (dirPath: string): Promise<TtsRuntimeCommandResult> =>
    ipcRenderer.invoke('tts-runtime-set-model-cache-dir', dirPath),
  request: (payload: { method: string; path: string; body?: unknown }): Promise<unknown> =>
    ipcRenderer.invoke('tts-runtime-request', payload),
  requestBytes: (payload: { method: string; path: string; body?: unknown }): Promise<{ data: ArrayBuffer; mimeType?: string }> =>
    ipcRenderer.invoke('tts-runtime-request-bytes', payload),
  requestFormData: (payload: { path: string; audioFilePath: string; referenceText?: string }): Promise<unknown> =>
    ipcRenderer.invoke('tts-runtime-request-formdata', payload),
  readRequirements: (): Promise<{ content: string; path: string } | null> =>
    ipcRenderer.invoke('tts-runtime-read-requirements'),
  scanModelInventory: (): Promise<BackendModelStatus[]> =>
    ipcRenderer.invoke('tts-runtime-scan-model-inventory'),
  delete: (): Promise<TtsRuntimeCommandResult> =>
    ipcRenderer.invoke('tts-runtime-delete'),
  resolveReferenceAudioPath: (audioPath: string): Promise<string | null> =>
    ipcRenderer.invoke('tts-reference-audio-resolve', audioPath),
})

function parseDepthRuntimeStatus(value: unknown): DepthRuntimeStatusV1 {
  const result = validateDepthRuntimeStatus(value)
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  return result.value
}

function parseDepthRuntimeAction(value: unknown): DepthRuntimeActionReplyV1 {
  const result = validateDepthRuntimeActionReply(value)
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  return result.value
}

function parseUpscaleRuntimeStatus(value: unknown): UpscaleRuntimeStatusV1 {
  const result = validateUpscaleRuntimeStatus(value)
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  return result.value
}

function parseImageGenRuntimeStatus(value: unknown): ImageGenRuntimeStatusV1 {
  const result = validateImageGenRuntimeStatus(value)
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  return result.value
}

function parseImageGenRuntimeAction(value: unknown): ImageGenRuntimeActionReplyV1 {
  const result = validateImageGenRuntimeActionReply(value)
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  return result.value
}

function parseUpscaleRuntimeAction(value: unknown): UpscaleRuntimeActionReplyV1 {
  const result = validateUpscaleRuntimeActionReply(value)
  if (!result.success) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
  return result.value
}

// Depth estimation runtime API — settings lifecycle for the cinematic 3D model.
// Downloads are explicit and user-triggered; inference never auto-downloads.
contextBridge.exposeInMainWorld('depthRuntime', {
  probe: (request: DepthRuntimeLifecycleRequestV1 = { schemaVersion: DEPTH_SCHEMA_VERSION }): Promise<DepthRuntimeStatusV1> =>
    ipcRenderer.invoke(DEPTH_PROBE_CHANNEL, request).then(parseDepthRuntimeStatus),
  prepare: (request: DepthRuntimeLifecycleRequestV1 = { schemaVersion: DEPTH_SCHEMA_VERSION }): Promise<DepthRuntimeActionReplyV1> =>
    ipcRenderer.invoke(DEPTH_PREPARE_CHANNEL, request).then(parseDepthRuntimeAction),
  rollback: (request: DepthRuntimeLifecycleRequestV1 = { schemaVersion: DEPTH_SCHEMA_VERSION }): Promise<DepthRuntimeActionReplyV1> =>
    ipcRenderer.invoke(DEPTH_ROLLBACK_CHANNEL, request).then(parseDepthRuntimeAction),
  status: (): Promise<unknown> => ipcRenderer.invoke('depth-runtime-status'),
  setup: (): Promise<unknown> => ipcRenderer.invoke('depth-runtime-setup'),
  refresh: (): Promise<unknown> => ipcRenderer.invoke('depth-runtime-refresh'),
  scanModel: (): Promise<{ models: unknown[] }> => ipcRenderer.invoke('depth-runtime-scan-model'),
  downloadModel: (): Promise<{ accepted: boolean; message: string }> =>
    ipcRenderer.invoke('depth-runtime-download-model'),
  downloadProgress: (): Promise<unknown> => ipcRenderer.invoke('depth-runtime-download-progress'),
  setCinematicPreset: (preset: string): Promise<{ accepted: boolean; message: string }> =>
    ipcRenderer.invoke('depth-runtime-set-cinematic-preset', preset),
  setCinematicMode: (mode: 'auto' | 'manual'): Promise<{ accepted: boolean; message: string }> =>
    ipcRenderer.invoke('depth-runtime-set-cinematic-mode', mode),
  setPresetMap: (map: Record<string, string>): Promise<{ accepted: boolean; count: number; message: string }> =>
    ipcRenderer.invoke('depth-runtime-set-preset-map', map),
  getConfig: (): Promise<{ modelCacheDir: string }> => ipcRenderer.invoke('depth-runtime-get-config'),
  setModelCacheDir: (dirPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('depth-runtime-set-model-cache-dir', dirPath),
  deleteModel: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('depth-runtime-delete-model'),
})

// Video pipeline log bundle export — 三段链路日志统一打包导出.
contextBridge.exposeInMainWorld('videoPipelineLogBundle', {
  export: (payload: { projectId: string; chapterId: string; revision?: number }): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('video-pipeline-export-log-bundle', payload),
})

// Local image generation runtime API — sidecar lifecycle + explicit model downloads.
contextBridge.exposeInMainWorld('imageGenRuntime', {
  probe: (request: ImageGenRuntimeLifecycleRequestV1 = { schemaVersion: IMAGE_GEN_SCHEMA_VERSION }): Promise<ImageGenRuntimeStatusV1> =>
    ipcRenderer.invoke(IMAGE_GEN_PROBE_CHANNEL, request).then(parseImageGenRuntimeStatus),
  prepare: (request: ImageGenRuntimeLifecycleRequestV1 = { schemaVersion: IMAGE_GEN_SCHEMA_VERSION }): Promise<ImageGenRuntimeActionReplyV1> =>
    ipcRenderer.invoke(IMAGE_GEN_PREPARE_CHANNEL, request).then(parseImageGenRuntimeAction),
  rollback: (request: ImageGenRuntimeLifecycleRequestV1 = { schemaVersion: IMAGE_GEN_SCHEMA_VERSION }): Promise<ImageGenRuntimeActionReplyV1> =>
    ipcRenderer.invoke(IMAGE_GEN_ROLLBACK_CHANNEL, request).then(parseImageGenRuntimeAction),
  status: (): Promise<unknown> => ipcRenderer.invoke('image-gen-runtime-status'),
  setup: (): Promise<unknown> => ipcRenderer.invoke('image-gen-runtime-setup'),
  stop: (): Promise<unknown> => ipcRenderer.invoke('image-gen-runtime-stop'),
  scanModel: (): Promise<{ models: unknown[] }> => ipcRenderer.invoke('image-gen-runtime-scan-model'),
  downloadModel: (model: string): Promise<{ accepted: boolean; message: string }> =>
    ipcRenderer.invoke('image-gen-runtime-download-model', model),
  setActiveModel: (model: string): Promise<{ accepted: boolean; message: string }> =>
    ipcRenderer.invoke('image-gen-runtime-set-active-model', model),
})

// MCP servers config API (09-01-mcp-settings-section) — short-lived probe only;
// tool consumption lands in a follow-up task.
contextBridge.exposeInMainWorld('mcpRuntime', {
  testServer: (config: { transport: 'stdio' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string }): Promise<
    | { ok: true; serverName?: string; tools: { name: string; description?: string }[] }
    | { ok: false; error: string }
  > => ipcRenderer.invoke('mcp-server-test', config),
  disconnect: (serverId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('mcp-server-disconnect', serverId),
})

// Local image super-resolution runtime API — pure-torch Real-ESRGAN lifecycle
// + one-shot run channel. Downloads are explicit and user-triggered; inference
// never auto-downloads.
contextBridge.exposeInMainWorld('upscaleRuntime', {
  probe: (request: UpscaleRuntimeLifecycleRequestV1 = { schemaVersion: UPSCALE_SCHEMA_VERSION }): Promise<UpscaleRuntimeStatusV1> =>
    ipcRenderer.invoke(UPSCALE_PROBE_CHANNEL, request).then(parseUpscaleRuntimeStatus),
  prepare: (request: UpscaleRuntimeLifecycleRequestV1 = { schemaVersion: UPSCALE_SCHEMA_VERSION }): Promise<UpscaleRuntimeActionReplyV1> =>
    ipcRenderer.invoke(UPSCALE_PREPARE_CHANNEL, request).then(parseUpscaleRuntimeAction),
  rollback: (request: UpscaleRuntimeLifecycleRequestV1 = { schemaVersion: UPSCALE_SCHEMA_VERSION }): Promise<UpscaleRuntimeActionReplyV1> =>
    ipcRenderer.invoke(UPSCALE_ROLLBACK_CHANNEL, request).then(parseUpscaleRuntimeAction),
  status: (): Promise<unknown> => ipcRenderer.invoke('upscale-runtime-status'),
  setup: (): Promise<unknown> => ipcRenderer.invoke('upscale-runtime-setup'),
  refresh: (): Promise<unknown> => ipcRenderer.invoke('upscale-runtime-refresh'),
  scanModel: (): Promise<{ models: unknown[] }> => ipcRenderer.invoke('upscale-runtime-scan-model'),
  downloadModel: (model: string): Promise<{ accepted: boolean; message: string }> =>
    ipcRenderer.invoke('upscale-runtime-download-model', model),
  downloadProgress: (): Promise<unknown> => ipcRenderer.invoke('upscale-runtime-download-progress'),
  setActiveModel: (model: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('upscale-runtime-set-active-model', model),
  run: (payload: {
    schemaVersion: number
    projectId: string
    shotId?: string
    model: string
    inputImagePath: string
    outputImagePath: string
  }): Promise<unknown> => ipcRenderer.invoke('upscale-run', payload),
  getConfig: (): Promise<{ modelCacheDir: string }> => ipcRenderer.invoke('upscale-runtime-get-config'),
  setModelCacheDir: (dirPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('upscale-runtime-set-model-cache-dir', dirPath),
  deleteModel: (model: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('upscale-runtime-delete-model', model),
})

// VLM Review runtime API — local visual consistency checking via Qwen3-VL.
// Downloads are explicit and user-triggered; inference never auto-downloads.
// Missing model = skip review (fail-open), does not block generation.
contextBridge.exposeInMainWorld('vlmReview', {
  probe: (): Promise<unknown> => ipcRenderer.invoke('vlm-review-runtime-probe'),
  setup: (): Promise<unknown> => ipcRenderer.invoke('vlm-review-runtime-setup'),
  downloadModel: (): Promise<unknown> => ipcRenderer.invoke('vlm-review-model-download'),
  getDownloadProgress: (): Promise<unknown> => ipcRenderer.invoke('vlm-review-model-progress'),
  deleteModel: (): Promise<unknown> => ipcRenderer.invoke('vlm-review-model-delete'),
  run: (payload: {
    schemaVersion: number
    projectId: string
    shotId: string
    frameId?: string
    generatedImagePath: string
    referenceImages: Array<{ path: string; role: string; assetName: string; promptHint?: string }>
    expectedContent: string
    expectedCharacters: string[]
  }): Promise<unknown> => ipcRenderer.invoke('vlm-review-run', payload),
})

// Chapter video QC (DOVER 观感层) runtime API — explicit downloads only,
// mirrors the upscale runtime bridge. QC 层缺模型=跳过+标注,不阻塞出片。
contextBridge.exposeInMainWorld('videoQcRuntime', {
  probe: (): Promise<unknown> => ipcRenderer.invoke('video-qc-runtime-probe'),
  status: (): Promise<unknown> => ipcRenderer.invoke('video-qc-runtime-status'),
  setup: (): Promise<unknown> => ipcRenderer.invoke('video-qc-runtime-setup'),
  rollback: (): Promise<unknown> => ipcRenderer.invoke('video-qc-runtime-rollback'),
  refresh: (): Promise<unknown> => ipcRenderer.invoke('video-qc-runtime-refresh'),
  scanModel: (): Promise<{ models: unknown[]; cacheDir: string }> => ipcRenderer.invoke('video-qc-runtime-scan-model'),
  downloadModel: (model: string): Promise<{ accepted: boolean; message: string }> =>
    ipcRenderer.invoke('video-qc-runtime-download-model', model),
  downloadProgress: (): Promise<unknown> => ipcRenderer.invoke('video-qc-runtime-download-progress'),
  getConfig: (): Promise<{ modelCacheDir: string }> => ipcRenderer.invoke('video-qc-runtime-get-config'),
  setModelCacheDir: (dirPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('video-qc-runtime-set-model-cache-dir', dirPath),
  deleteModel: (model: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('video-qc-runtime-delete-model', model),
})

// Chapter QC(成片体检单)API — 报告读取/手动重跑/L4 语义与 AC4 视觉预审回写。
contextBridge.exposeInMainWorld('chapterQc', {
  getReport: (payload: { projectId: string; chapterId: string }): Promise<unknown> =>
    ipcRenderer.invoke('chapter-qc-get-report', payload),
  run: (payload: { projectId: string; chapterId: string; outputPath?: string }): Promise<unknown> =>
    ipcRenderer.invoke('chapter-qc-run', payload),
  submitSemantic: (payload: {
    projectId: string
    chapterId: string
    model?: string
    stats: { checked: number; passed: number; failed: number; skipped: number }
    findings: unknown[]
  }): Promise<{ success: boolean; message?: string }> =>
    ipcRenderer.invoke('chapter-qc-submit-semantic', payload),
  submitVisionPreflight: (payload: {
    projectId: string
    chapterId: string
    expectedCreatedAt: number
    model?: string
    stats: { checked: number; passed: number; failed: number; skipped: number }
    findings: unknown[]
  }): Promise<{ success: boolean; message?: string }> =>
    ipcRenderer.invoke('chapter-qc-submit-vision-preflight', payload),
  onReportUpdated: (listener: (payload: { projectId: string; chapterId: string }) => void): (() => void) => {
    const handler = (_event: unknown, payload: { projectId: string; chapterId: string }) => listener(payload)
    ipcRenderer.on('chapter-qc-report-updated', handler)
    return () => ipcRenderer.removeListener('chapter-qc-report-updated', handler)
  },
})

// Local music generation runtime API — MusicGen BGM, explicit downloads only.
contextBridge.exposeInMainWorld('audioGenRuntime', {
  status: (): Promise<unknown> => ipcRenderer.invoke('audio-gen-runtime-status'),
  setup: (): Promise<unknown> => ipcRenderer.invoke('audio-gen-runtime-setup'),
  scanModel: (): Promise<{ models: unknown[] }> => ipcRenderer.invoke('audio-gen-runtime-scan-model'),
  downloadModel: (): Promise<{ accepted: boolean; message: string }> =>
    ipcRenderer.invoke('audio-gen-runtime-download-model'),
  generate: (payload: { prompt: string; seconds?: number; outputDir: string }): Promise<unknown> =>
    ipcRenderer.invoke('audio-gen-runtime-generate', payload),
})

// Local sfx generation runtime API (08-19-local-sfx-generation) — seed-deterministic
// short one-shots, explicit downloads only.
contextBridge.exposeInMainWorld('sfxGenRuntime', {
  status: (): Promise<unknown> => ipcRenderer.invoke('sfx-gen-runtime-status'),
  setup: (): Promise<unknown> => ipcRenderer.invoke('sfx-gen-runtime-setup'),
  scanModel: (): Promise<{ models: unknown[] }> => ipcRenderer.invoke('sfx-gen-runtime-scan-model'),
  downloadModel: (model: string): Promise<{ accepted: boolean; message: string }> =>
    ipcRenderer.invoke('sfx-gen-runtime-download-model', { model }),
  generate: (payload: { prompt: string; seed?: number; seconds?: number; model?: string; outputDir: string }): Promise<unknown> =>
    ipcRenderer.invoke('sfx-gen-runtime-generate', payload),
})

// MiniMax-Music3 runtime API (08-19-minimax-music3-engine) — whole-song BGM,
// native seed determinism, explicit ~28.5 GB bf16 download only; HTTP port 11273.
contextBridge.exposeInMainWorld('music3GenRuntime', {
  status: (): Promise<unknown> => ipcRenderer.invoke('music3-gen-runtime-status'),
  setup: (): Promise<unknown> => ipcRenderer.invoke('music3-gen-runtime-setup'),
  scanModel: (): Promise<{ models: unknown[] }> => ipcRenderer.invoke('music3-gen-runtime-scan-model'),
  downloadModel: (model: string): Promise<{ accepted: boolean; message: string }> =>
    ipcRenderer.invoke('music3-gen-runtime-download-model', { model }),
  configure: (payload: { weightsDir?: string; binaryPath?: string; port?: number; preferredEngine?: 'pocket' | 'mlxserv' }): Promise<unknown> =>
    ipcRenderer.invoke('music3-gen-runtime-configure', payload),
  installMlxServeBinary: (): Promise<{ installed: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('music3-gen-install-mlxserve'),
  installWeights: (): Promise<{ accepted: boolean; message: string }> =>
    ipcRenderer.invoke('music3-gen-install-weights'),
  musicDir: (projectId: string, songName?: string): Promise<{ dir?: string; error?: string }> =>
    ipcRenderer.invoke('music3-gen-music-dir', { projectId, ...(typeof songName === "string" && songName.trim() ? { songName } : {}) }),
  generate: (payload: { prompt: string; lyrics?: string; seed?: number; seconds?: number; steps?: number; engine?: 'pocket' | 'mlxserv'; outputDir: string; projectId?: string; songName?: string }): Promise<unknown> =>
    ipcRenderer.invoke('music3-gen-runtime-generate', payload),
  readAudioFile: (filePath: string): Promise<{ bytes?: Uint8Array; size?: number; error?: string }> =>
    ipcRenderer.invoke('music3-gen-read-audio-file', { path: filePath }),
})

// Artifact Inventory API - read-only project/chapter scan
contextBridge.exposeInMainWorld('artifactInventory', {
  scan: (projectId: string, chapterId?: string) =>
    ipcRenderer.invoke('artifact-inventory-scan', { projectId, chapterId }),
  list: (projectId: string) =>
    ipcRenderer.invoke('artifact-get-project-artifacts', { projectId }),
})

// Artifact Deletion Planning API (read-only plan generation)
contextBridge.exposeInMainWorld('artifactPlanDeletion', {
  plan: (request: {
    projectId: string;
    chapterId: string;
    scope: 'chapter' | 'artifacts';
    artifactIds?: string[];
  }) => ipcRenderer.invoke('artifact-plan-deletion', request),
})

contextBridge.exposeInMainWorld('artifactDeletion', {
  execute: (request: {
    planId: string;
    fingerprint: string;
    confirmation: {
      type: 'chapter' | 'artifacts';
      chapterTitle?: string;
      chapterId?: string;
      artifactCount?: number;
    };
  }): Promise<ExecuteResult> => ipcRenderer.invoke('artifact-execute-deletion', request),
  recovery: (projectId: string): Promise<RecoveryQueryResult> =>
    ipcRenderer.invoke('artifact-deletion-recovery-query', { projectId }),
})

contextBridge.exposeInMainWorld('artifactMetadata', {
  update: (request: {
    projectId: string;
    artifactId: string;
    updates: { name?: string; notes?: string };
  }): Promise<MetadataUpdateResult> => ipcRenderer.invoke('artifact-update-metadata', request),
})


contextBridge.exposeInMainWorld('appEvents', {
  onMainProcessMessage(listener: (message: string) => void) {
    const wrapped = (_event: IpcRendererEvent, message: string) => listener(message)
    ipcRenderer.on('main-process-message', wrapped)
    return () => ipcRenderer.removeListener('main-process-message', wrapped)
  },
})


contextBridge.exposeInMainWorld('selfMedia', {
  listProviders: async (): Promise<SelfMediaProviderListReply> =>
    decodeSelfMediaIpcReply(await ipcRenderer.invoke(SELF_MEDIA_IPC.listProviders)),
  listAccounts: async (request: SelfMediaListAccountsRequest): Promise<SelfMediaAccountListReply> =>
    decodeSelfMediaIpcReply(await ipcRenderer.invoke(SELF_MEDIA_IPC.listAccounts, request)),
  listTasks: async (request: SelfMediaListTasksRequest): Promise<SelfMediaTaskListReply> =>
    decodeSelfMediaIpcReply(await ipcRenderer.invoke(SELF_MEDIA_IPC.listTasks, request)),
  configureProvider: async (request: SelfMediaConfigureProviderRequest): Promise<SelfMediaConfigureProviderReply> =>
    decodeSelfMediaIpcReply(await ipcRenderer.invoke(SELF_MEDIA_IPC.configureProvider, request)),
  startLogin: async (request: SelfMediaStartLoginRequest): Promise<SelfMediaLoginReply> =>
    decodeSelfMediaIpcReply(await ipcRenderer.invoke(SELF_MEDIA_IPC.startLogin, request)),
  createTask: async (request: SelfMediaCreateTaskRequest): Promise<SelfMediaCreateTaskReply> =>
    decodeSelfMediaIpcReply(await ipcRenderer.invoke(SELF_MEDIA_IPC.createTask, request)),
  pollTask: async (request: SelfMediaTaskRequest): Promise<SelfMediaTaskReply> =>
    decodeSelfMediaIpcReply(await ipcRenderer.invoke(SELF_MEDIA_IPC.pollTask, request)),
  cancelTask: async (request: SelfMediaTaskRequest): Promise<SelfMediaTaskReply> =>
    decodeSelfMediaIpcReply(await ipcRenderer.invoke(SELF_MEDIA_IPC.cancelTask, request)),
  onProgress(listener: (progress: SelfMediaTaskProgressEvent) => void) {
    const wrapped = (_event: IpcRendererEvent, payload: unknown) => {
      try {
        listener(decodeSelfMediaProgressEvent(payload))
      } catch {
        // Ignore malformed provider events at the renderer boundary.
      }
    }
    ipcRenderer.on(SELF_MEDIA_IPC.progress, wrapped)
    return () => ipcRenderer.removeListener(SELF_MEDIA_IPC.progress, wrapped)
  },
})


contextBridge.exposeInMainWorld('renderHw', {
  get: () => ipcRenderer.invoke('render-hw-get'),
  set: (settings: { hardwareAcceleration?: boolean }) => ipcRenderer.invoke('render-hw-set', settings),
});



contextBridge.exposeInMainWorld('mystudioSmoke', {
  enabled: process.env.MYSTUDIO_SMOKE === '1',
  userDataDir: process.argv.find((arg) => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length) ?? '',
})
