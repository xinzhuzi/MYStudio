// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import type { OpenExternalResult, UpdateCheckOptions, UpdateCheckResult } from "./update";
import type { ModelTestRequest, ModelTestResult } from "../lib/ai/model-test";
import type { TextCompletionRequest, TextCompletionResult } from "../lib/ai/text-completion";
import type { ImageRequestPayload, ImageRequestResult } from "./api-image-request";
import type {
  DiagnosticsLogClearResult,
  DiagnosticsLogEntry,
  DiagnosticsLogEntryInput,
  DiagnosticsLogExportResult,
  DiagnosticsLogInfo,
  DiagnosticsLogOpenFolderResult,
  DiagnosticsLogQuery,
  DiagnosticsLogQueryResult,
} from "./diagnostics";
import type { TimelineRenderPlan } from "./editing";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { StudioAssetListRequest, StudioAssetListResponse, StudioAssetSummary } from "./studio-assets";
import type {
  StudioVisualManualCreatePayload,
  StudioVisualManualDetail,
  StudioVisualManualImagesWritePayload,
  StudioVisualManualSummary,
  StudioVisualManualWritePayload,
} from "./studio-visual-manual";
import type { TtsRuntimeCommandResult, TtsRuntimeConfig, TtsRuntimeStatus } from "./tts";
import type { RemotionBrowserDownloadProgress, RemotionBrowserStatus } from "@rendering/contracts/remotion-browser-status";
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
} from "@rendering/contracts/video-workflow-ipc";
import type { RemotionWorkspaceRuntimeReply } from "@rendering/contracts/remotion-workspace-runtime";
import type {
  RemotionPreviewCreateReply,
  RemotionPreviewReleaseReply,
  RemotionShotPreviewCreateReply,
} from "@rendering/plugins/remotion/preview/remotion-preview-ipc";
import type { RemotionShotPlanV1 } from "@/lib/studio/remotion/shot-plan";
import type { RemotionShotRenderRequest } from "@rendering/plugins/remotion/renderer/remotion-shot-ipc";
import type { RemotionShotRenderResult } from "@rendering/plugins/remotion/renderer/remotion-shot-renderer";
import type { RemotionStudioEditingUpdatedEvent } from "@/electron/ipc/studio/remotion-studio-ipc";
import type {
  RemotionQueueCancelReply,
  RemotionQueueEnqueueShotRequest,
  RemotionQueueRetryReply,
  RemotionQueueScopeReply,
  RemotionQueueSwitchReply,
} from "@rendering/plugins/remotion/queue/remotion-queue-ipc";
import type { RemotionQueueNotification } from "@rendering/plugins/remotion/queue/remotion-render-queue";
import type { RemotionChapterManifestBridge } from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-ipc";
import type { ProjectFolderBridge } from "@/electron/ipc/projects/project-folder-ipc";
import type {
  RemotionStudioEnsureSessionReply,
  RemotionStudioEnsureSessionRequest,
} from "@/electron/ipc/studio/remotion-studio-ipc";
import type {
  SelfMediaAccountListReply,
  SelfMediaConfigureProviderReply,
  SelfMediaConfigureProviderRequest,
  SelfMediaCreateTaskRequest,
  SelfMediaCreateTaskReply,
  SelfMediaListAccountsRequest,
  SelfMediaListTasksRequest,
  SelfMediaLoginReply,
  SelfMediaProviderListReply,
  SelfMediaStartLoginRequest,
  SelfMediaTaskListReply,
  SelfMediaTaskProgressEvent,
  SelfMediaTaskReply,
  SelfMediaTaskRequest,
} from "../lib/self-media/ipc-contract";
import type {
  ExecuteResult,
  InventoryResult,
  RecoveryQueryResult,
  DeletionConfirmation,
  MetadataUpdateResult,
} from "@/types/artifacts";

// ---- Project folder phase-2 contract (move / import) ----
// Frozen renderer-side contract from task 08-15-project-location-phase2 design
// §2. Self-typed here (not re-imported from the main-process module) so the
// renderer surface does not depend on the parallel main-process implementation.
export type ProjectFolderMovePhase = "copying" | "verifying" | "finalizing";

export interface ProjectFolderMoveProgressEvent {
  projectId: string;
  phase: ProjectFolderMovePhase;
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
}

export type ProjectFolderMoveResult =
  | { ok: true; location: string; mode: "renamed" | "copied" }
  | {
      ok: false;
      code:
        | "MISSING_DIR"
        | "CONFLICT"
        | "PARENT_INVALID"
        | "NOT_WRITABLE"
        | "NESTED"
        | "CANCELLED"
        | "MOVE_FAILED";
      message?: string;
    };

export interface ProjectFolderCancelMoveResult {
  ok: true;
  cancelled: boolean;
}

export type ProjectFolderImportResult =
  | { ok: true; project: { id: string; name: string; location: string } }
  | {
      ok: false;
      // IMPORT_FAILED mirrors the main-process handler's in-band failure code
      // for id-rewrite/location-table errors — keep in sync with
      // electron/ipc/projects/project-folder-ipc.ts.
      code: "INVALID_PATH" | "NOT_A_PROJECT" | "ALREADY_REGISTERED" | "NESTED" | "IMPORT_FAILED";
      message?: string;
      existingProjectId?: string;
    };

export interface ProjectFolderMoveImportBridge {
  move: (
    projectId: string,
    projectName: string,
    targetParentDir: string,
  ) => Promise<ProjectFolderMoveResult>;
  cancelMove: (projectId: string) => Promise<ProjectFolderCancelMoveResult>;
  importFolder: (folderPath: string) => Promise<ProjectFolderImportResult>;
  onMoveProgress: (
    listener: (progress: ProjectFolderMoveProgressEvent) => void,
  ) => () => void;
}

export {};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
      startIn?: string;
    }) => Promise<FileSystemDirectoryHandle>;

    // Artifact management (new for artifact deletion task)
    electron?: {
      artifactInventory?: {
        scan: (projectId: string, chapterId?: string) => Promise<InventoryResult>;
        list: (projectId: string) => Promise<InventoryResult>;
      };
      artifactPlanDeletion?: {
        plan: (request: {
          projectId: string;
          chapterId: string;
          scope: "chapter" | "artifacts";
          artifactIds?: string[];
        }) => Promise<import("@/types/artifacts").PlanResult>;
      };
      artifactDeletion?: {
        execute: (request: {
          planId: string;
          fingerprint: string;
          confirmation: DeletionConfirmation;
        }) => Promise<ExecuteResult>;
        recovery: (projectId: string) => Promise<RecoveryQueryResult>;
      };
      artifactMetadata?: {
        update: (request: {
          projectId: string;
          artifactId: string;
          updates: { name?: string; notes?: string };
        }) => Promise<MetadataUpdateResult>;
      };
    };

    appEvents?: {
      onMainProcessMessage: (listener: (message: string) => void) => () => void;
    };
    selfMedia?: {
      listProviders: () => Promise<SelfMediaProviderListReply>;
      listAccounts: (request: SelfMediaListAccountsRequest) => Promise<SelfMediaAccountListReply>;
      listTasks: (request: SelfMediaListTasksRequest) => Promise<SelfMediaTaskListReply>;
      configureProvider: (request: SelfMediaConfigureProviderRequest) => Promise<SelfMediaConfigureProviderReply>;
      startLogin: (request: SelfMediaStartLoginRequest) => Promise<SelfMediaLoginReply>;
      createTask: (request: SelfMediaCreateTaskRequest) => Promise<SelfMediaCreateTaskReply>;
      pollTask: (request: SelfMediaTaskRequest) => Promise<SelfMediaTaskReply>;
      cancelTask: (request: SelfMediaTaskRequest) => Promise<SelfMediaTaskReply>;
      onProgress: (listener: (progress: SelfMediaTaskProgressEvent) => void) => () => void;
    };
    mystudioSmoke?: {
      enabled: boolean;
      userDataDir?: string;
    };
    diagnosticsLog?: {
      write: (entry: DiagnosticsLogEntryInput) => Promise<DiagnosticsLogEntry>;
      query: (query?: DiagnosticsLogQuery) => Promise<DiagnosticsLogQueryResult>;
      getInfo: () => Promise<DiagnosticsLogInfo>;
      openFolder: () => Promise<DiagnosticsLogOpenFolderResult>;
      exportBundle: () => Promise<DiagnosticsLogExportResult>;
      clear: () => Promise<DiagnosticsLogClearResult>;
    };
    imageStorage?: {
      saveImage: (url: string, category: string, filename: string) => Promise<{ success: boolean; localPath?: string; error?: string }>;
      getImagePath: (localPath: string) => Promise<string | null>;
      moveImage: (localPath: string, category: string) => Promise<{ success: boolean; localPath?: string; error?: string }>;
      readAsBase64: (localPath: string) => Promise<string | null>;
      getAbsolutePath: (localPath: string) => Promise<string | null>;
    };
    fileStorage?: {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<boolean>;
      removeItem: (key: string) => Promise<boolean>;
      renameItem?: (fromKey: string, toKey: string) => Promise<boolean>;
      exists: (key: string) => Promise<boolean>;
      listKeys: (prefix: string) => Promise<string[]>;
      listDirs: (prefix: string) => Promise<string[]>;
      removeDir: (prefix: string) => Promise<boolean>;
    };
    projectFolder?: ProjectFolderBridge & ProjectFolderMoveImportBridge;
    projectFiles?: {
      writeText: (key: string, value: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
      writeBinary: (payload: { projectId: string; relativePath: string; bytes: ArrayBuffer }) => Promise<{
        success: boolean;
        url?: string;
        filePath?: string;
        size?: number;
        error?: string;
      }>;
      saveImage: (payload: { projectId: string; relativePath: string; source: string }) => Promise<{
        success: boolean;
        url?: string;
        filePath?: string;
        size?: number;
        error?: string;
      }>;
      readAsBase64: (url: string) => Promise<{
        success: boolean;
        base64?: string;
        mimeType?: string;
        size?: number;
        error?: string;
      }>;
      readText: (payload: { projectId: string; relativePath: string }) => Promise<{
        success: boolean;
        text?: string;
        size?: number;
        mimeType?: string;
        truncated?: boolean;
        error?: string;
      }>;
      getAbsolutePath: (url: string) => Promise<string | null>;
      removeText: (key: string) => Promise<{ success: boolean; error?: string }>;
    };
    studioSkills?: {
      list: () => Promise<Array<{
        relativePath: string;
        filePath: string;
        storagePath: string;
        sourcePath?: string;
        size: number;
        updatedAt: number;
        isCustomized: boolean;
        isDeleted?: boolean;
        deletedAt?: number;
        sourceExists: boolean;
      }>>;
      readText: (relativePath: string) => Promise<{ success: boolean; content?: string; filePath?: string; storagePath?: string; error?: string }>;
      writeText: (relativePath: string, value: string) => Promise<{ success: boolean; filePath?: string; storagePath?: string; updatedAt?: number; error?: string }>;
      createText: (relativePath: string, value: string) => Promise<{
        success: boolean;
        relativePath?: string;
        filePath?: string;
        storagePath?: string;
        size?: number;
        updatedAt?: number;
        isCustomized?: boolean;
        sourceExists?: boolean;
        error?: string;
      }>;
      deleteText: (relativePath: string) => Promise<{ success: boolean; deleted?: boolean; error?: string }>;
      restoreText: (relativePath: string) => Promise<{
        success: boolean;
        relativePath?: string;
        filePath?: string;
        storagePath?: string;
        sourcePath?: string;
        size?: number;
        updatedAt?: number;
        isCustomized?: boolean;
        isDeleted?: boolean;
        sourceExists?: boolean;
        error?: string;
      }>;
    };
    studioVisualManuals?: {
      list: (options?: { refresh?: boolean }) => Promise<StudioVisualManualSummary[]>;
      read: (stylePath: string) => Promise<{ success: boolean; manual?: StudioVisualManualDetail; error?: string }>;
      write: (stylePath: string, payload: StudioVisualManualWritePayload) => Promise<{
        success: boolean;
        manual?: StudioVisualManualDetail;
        error?: string;
      }>;
      writeImages: (stylePath: string, payload: StudioVisualManualImagesWritePayload) => Promise<{
        success: boolean;
        manual?: StudioVisualManualDetail;
        error?: string;
      }>;
      create: (payload: StudioVisualManualCreatePayload) => Promise<{
        success: boolean;
        manual?: StudioVisualManualDetail;
        error?: string;
      }>;
      duplicate: (payload: { sourceStylePath: string; name: string; stylePath: string; projectId?: string }) => Promise<{
        success: boolean;
        manual?: StudioVisualManualDetail;
        error?: string;
      }>;
    };
    storageManager?: {
      getPaths: () => Promise<{
        basePath: string;
        projectPath: string;
        mediaPath: string;
        assetsPath: string;
        skillsPath: string;
        pythonRuntimeDir: string;
        modelCacheDir: string;
        cachePath: string;
      }>;
      selectDirectory: (defaultPath?: string) => Promise<string | null>;
      // Unified storage operations (single base path for projects, media, assets, and skills)
      validateDataDir: (dirPath: string) => Promise<{
        valid: boolean;
        projectCount?: number;
        mediaCount?: number;
        assetCount?: number;
        skillCount?: number;
        error?: string;
      }>;
      moveData: (newPath: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      linkData: (dirPath: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      exportData: (targetPath: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      importData: (sourcePath: string) => Promise<{ success: boolean; error?: string }>;
      // Cache
      getCacheSize: () => Promise<{ total: number; details: Array<{ path: string; size: number }> }>;
      clearCache: (options?: { olderThanDays?: number }) => Promise<{ success: boolean; clearedBytes?: number; error?: string }>;
      updateConfig: (config: { autoCleanEnabled?: boolean; autoCleanDays?: number }) => Promise<boolean>;
    };
    electronAPI?: {
      saveFileDialog: (options: {
        localPath: string;
        defaultPath: string;
        filters: { name: string; extensions: string[] }[];
      }) => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
      openPath: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
      showItemInFolder: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
      openDevTools: () => Promise<{ success: boolean; error?: string }>;
      testModel: (payload: ModelTestRequest) => Promise<ModelTestResult>;
      textCompletion: (payload: TextCompletionRequest) => Promise<TextCompletionResult>;
      imageRequest: (payload: ImageRequestPayload) => Promise<ImageRequestResult>;
      textCompletionStream: (payload: TextCompletionRequest, onChunk: (delta: string) => void) => Promise<TextCompletionResult>;
    };
    appUpdater?: {
      getCurrentVersion: () => Promise<string>;
      checkForUpdates: (options?: UpdateCheckOptions) => Promise<UpdateCheckResult>;
      openExternalLink: (url: string) => Promise<OpenExternalResult>;
    };
    imageHostUploader?: {
      upload: (payload: {
        provider: {
          name: string;
          platform: string;
          baseUrl?: string;
          uploadPath?: string;
          apiKeyParam?: string;
          apiKeyHeader?: string;
          apiKeyFormField?: string;
          expirationParam?: string;
          imageField?: string;
          imagePayloadType?: 'base64' | 'file';
          nameField?: string;
          staticFormFields?: Record<string, string>;
          responseUrlField?: string;
          responseDeleteUrlField?: string;
        };
        apiKey: string;
        imageData: string;
        options?: {
          name?: string;
          expiration?: number;
        };
      }) => Promise<{
        success: boolean;
        url?: string;
        deleteUrl?: string;
        error?: string;
      }>;
    };
    studioRenderer?: {
      probeMedia: (filePath: string) => Promise<{
        path: string;
        sizeBytes: number;
        mtimeMs: number;
        sha256: string;
        duration: number;
        streams: string[];
      }>;
    };
    remotionRuntime?: {
      status: () => Promise<RemotionBrowserStatus>;
      download: () => Promise<RemotionBrowserStatus>;
      onDownloadProgress: (
        listener: (progress: RemotionBrowserDownloadProgress) => void,
      ) => () => void;
      workspaceRuntime?: () => Promise<RemotionWorkspaceRuntimeReply>;
    };
    videoWorkflowPlugins?: {
      status: () => Promise<VideoWorkflowStatusReplyV1>;
      prepare: (request: VideoWorkflowPluginActionRequestV1) => Promise<VideoWorkflowActionReplyV1>;
      update: (request: VideoWorkflowPluginActionRequestV1) => Promise<VideoWorkflowActionReplyV1>;
      repair: (request: VideoWorkflowPluginActionRequestV1) => Promise<VideoWorkflowActionReplyV1>;
      rollback: (request: VideoWorkflowPluginActionRequestV1) => Promise<VideoWorkflowActionReplyV1>;
      review: (request: VideoWorkflowReviewRequestV1) => Promise<VideoWorkflowReviewReplyV1>;
      runChapter: (request: VideoWorkflowChapterRunRequestV1) => Promise<VideoWorkflowChapterRunReplyV1>;
      applyChapter: (request: VideoWorkflowChapterApplyRequestV1) => Promise<VideoWorkflowChapterApplyReplyV1>;
      readChapter: (request: VideoWorkflowChapterReadRequestV1) => Promise<VideoWorkflowChapterReadReplyV1>;
    };
    remotionPreview?: {
      create: (plan: TimelineRenderPlan) => Promise<RemotionPreviewCreateReply>;
      createShot?: (shotPlan: RemotionShotPlanV1) => Promise<RemotionShotPreviewCreateReply>;
      release: (sessionId: string) => Promise<RemotionPreviewReleaseReply>;
    };
    remotionShotRenderer?: {
      render: (request: RemotionShotRenderRequest) => Promise<RemotionShotRenderResult>;
      cancel: (jobId: string) => Promise<{ success: boolean; jobId: string; canceled: boolean; error?: string }>;
    };
    remotionChapterManifest?: RemotionChapterManifestBridge;
    remotionQueue?: {
      get: (scope: { projectId: string; chapterId: string }) => Promise<RemotionQueueScopeReply>;
      enqueueShot: (request: RemotionQueueEnqueueShotRequest) => Promise<RemotionQueueRetryReply>;
      retry: (jobId: string) => Promise<RemotionQueueRetryReply>;
      cancel: (jobId: string) => Promise<RemotionQueueCancelReply>;
      switchProject: (toProjectId: string) => Promise<RemotionQueueSwitchReply>;
      canSwitchProject?: (toProjectId: string) => Promise<RemotionQueueSwitchReply>;
      onJob: (listener: (notification: RemotionQueueNotification) => void) => () => void;
    };
    remotionStudio?: {
      ensureSession: (request: RemotionStudioEnsureSessionRequest) => Promise<RemotionStudioEnsureSessionReply>;
      closeSession: (projectId: string) => Promise<{ status: "closed"; projectId: string }>;
      onEditingUpdated: (listener: (event: RemotionStudioEditingUpdatedEvent) => void) => () => void;
    };
    studioAssets?: {
      saveMaterial: (payload: { name: string; bytes: ArrayBuffer }) => Promise<{
        success: boolean;
        localPath?: string;
        filePath?: string;
        size?: number;
        error?: string;
      }>;
      list: (payload: StudioAssetListRequest) => Promise<{ items: StudioAssetSummary[]; total: number }>;
      get: (id: string) => Promise<StudioAssetSummary | null>;
      update: (payload: { id: string; updates: Record<string, unknown> }) => Promise<StudioAssetSummary | null>;
      delete: (id: string) => Promise<boolean>;
      add: (payload: { type: string; name: string; sourceFilePath?: string; description?: string; prompt?: string; setting?: string }) => Promise<StudioAssetSummary | null>;
      addImage: (payload: { assetId: string; imageName: string; sourceFilePath: string }) => Promise<StudioAssetSummary | null>;
      replaceImage: (payload: { assetId: string; sourceFilePath: string }) => Promise<StudioAssetSummary | null>;
      removeImage: (payload: { assetId: string; imageFilePath: string }) => Promise<StudioAssetSummary | null>;
      renameImage: (payload: { assetId: string; imageFilePath: string; newName: string }) => Promise<StudioAssetSummary | null>;
      selectImageFile: () => Promise<string | null>;
      selectImageFiles: () => Promise<string[]>;
      selectAudioFile: () => Promise<string | null>;
      importFromToonflow: (payload: { type: string }) => Promise<{ success: boolean; imported: number }>;
      getByName: (payload: { type: string; name: string }) => Promise<StudioAssetSummary | null>;
      batchMatch: (payload: { type: string; names: string[] }) => Promise<Array<{ name: string; asset: StudioAssetSummary | null }>>;
    };
    ttsRuntime?: {
      status: () => Promise<TtsRuntimeStatus>;
      start: () => Promise<TtsRuntimeCommandResult>;
      setup: () => Promise<TtsRuntimeCommandResult>;
      stop: () => Promise<TtsRuntimeCommandResult>;
      migrateStorage: () => Promise<TtsRuntimeCommandResult>;
      getConfig: () => Promise<TtsRuntimeConfig>;
      setConfig: (config: Partial<TtsRuntimeConfig>) => Promise<TtsRuntimeCommandResult>;
      setModelCacheDir: (dirPath: string) => Promise<TtsRuntimeCommandResult>;
      request: (payload: { method: string; path: string; body?: unknown }) => Promise<unknown>;
      requestBytes: (payload: { method: string; path: string; body?: unknown }) => Promise<{ data: ArrayBuffer; mimeType?: string }>;
      requestFormData: (payload: { path: string; audioFilePath: string; referenceText?: string }) => Promise<unknown>;
      readRequirements: () => Promise<{ content: string; path: string } | null>;
      scanModelInventory: () => Promise<import("@/types/tts").BackendModelStatus[]>;
      delete: () => Promise<TtsRuntimeCommandResult>;
      resolveReferenceAudioPath: (audioPath: string) => Promise<string | null>;
    };
    depthRuntime?: {
      status: () => Promise<import("@/types/depth").DepthRuntimeStatus>;
      setup: () => Promise<import("@/types/depth").DepthRuntimeStatus>;
      refresh: () => Promise<import("@/types/depth").DepthRuntimeStatus>;
      scanModel: () => Promise<{ models: import("@/types/depth").DepthModelStatusRow[] }>;
      downloadModel: () => Promise<{ accepted: boolean; message: string }>;
      downloadProgress: () => Promise<import("@/types/depth").DepthDownloadProgress>;
      setCinematicPreset: (preset: string) => Promise<{ accepted: boolean; message: string }>;
      setCinematicMode: (mode: "auto" | "manual") => Promise<{ accepted: boolean; message: string }>;
      setPresetMap: (map: Record<string, string>) => Promise<{ accepted: boolean; count: number; message: string }>;
      getConfig: () => Promise<{ modelCacheDir: string }>;
      setModelCacheDir: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
      deleteModel: () => Promise<{ success: boolean; error?: string }>;
    };
    videoPipelineLogBundle?: {
      export: (payload: { projectId: string; chapterId: string; revision?: number }) => Promise<{
        success: boolean;
        path?: string;
        error?: string;
      }>;
    };
    imageGenRuntime?: {
      status: () => Promise<import("@/types/image-gen").ImageGenRuntimeStatus>;
      setup: () => Promise<import("@/types/image-gen").ImageGenRuntimeStatus>;
      stop: () => Promise<import("@/types/image-gen").ImageGenRuntimeStatus>;
      scanModel: () => Promise<{ models: import("@/types/image-gen").ImageGenModelRow[] }>;
      downloadModel: (model: string) => Promise<{ accepted: boolean; message: string }>;
      setActiveModel: (model: string) => Promise<{ accepted: boolean; message: string }>;
    };
    audioGenRuntime?: {
      status: () => Promise<import("@/types/audio-gen").AudioGenRuntimeStatus>;
      setup: () => Promise<import("@/types/audio-gen").AudioGenRuntimeStatus>;
      scanModel: () => Promise<{ models: import("@/types/audio-gen").AudioGenModelRow[] }>;
      downloadModel: () => Promise<{ accepted: boolean; message: string }>;
      generate: (payload: { prompt: string; seconds?: number; outputDir: string }) => Promise<import("@/types/audio-gen").AudioGenGenerateResult>;
    };
    artifactInventory?: {
      scan: (projectId: string, chapterId?: string) => Promise<InventoryResult>;
      list: (projectId: string) => Promise<InventoryResult>;
    };
    artifactPlanDeletion?: {
      plan: (request: {
        projectId: string;
        chapterId: string;
        scope: "chapter" | "artifacts";
        artifactIds?: string[];
      }) => Promise<import("@/types/artifacts").PlanResult>;
    };
    artifactDeletion?: {
      execute: (request: {
        planId: string;
        fingerprint: string;
        confirmation: DeletionConfirmation;
      }) => Promise<ExecuteResult>;
      recovery: (projectId: string) => Promise<RecoveryQueryResult>;
    };
    artifactMetadata?: {
      update: (request: {
        projectId: string;
        artifactId: string;
        updates: { name?: string; notes?: string };
      }) => Promise<MetadataUpdateResult>;
    };
  }
}
