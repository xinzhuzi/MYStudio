// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import type { OpenExternalResult, UpdateCheckResult } from "./update";
import type { ModelTestRequest, ModelTestResult } from "../lib/api-manager/model-test";
import type { TextCompletionRequest, TextCompletionResult } from "../lib/api-manager/text-completion";
import type { EpisodeMergePlan, TrackRenderPlan } from "./studio";
import type { StudioAssetListRequest, StudioAssetListResponse, StudioAssetSummary } from "./studio-assets";
import type {
  StudioVisualManualCreatePayload,
  StudioVisualManualDetail,
  StudioVisualManualImagesWritePayload,
  StudioVisualManualSummary,
  StudioVisualManualWritePayload,
} from "./studio-visual-manual";
import type { TtsRuntimeCommandResult, TtsRuntimeStatus } from "./tts";

export {};

declare global {
  interface Window {
    appEvents?: {
      onMainProcessMessage: (listener: (message: string) => void) => () => void;
    };
    imageStorage?: {
      saveImage: (url: string, category: string, filename: string) => Promise<{ success: boolean; localPath?: string; error?: string }>;
      getImagePath: (localPath: string) => Promise<string | null>;
      deleteImage: (localPath: string) => Promise<boolean>;
      readAsBase64: (localPath: string) => Promise<string | null>;
      getAbsolutePath: (localPath: string) => Promise<string | null>;
    };
    fileStorage?: {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<boolean>;
      removeItem: (key: string) => Promise<boolean>;
      exists: (key: string) => Promise<boolean>;
      listKeys: (prefix: string) => Promise<string[]>;
      listDirs: (prefix: string) => Promise<string[]>;
      removeDir: (prefix: string) => Promise<boolean>;
    };
    projectFiles?: {
      writeText: (key: string, value: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
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
      getPaths: () => Promise<{ basePath: string; projectPath: string; mediaPath: string; skillsPath: string; cachePath: string }>;
      selectDirectory: () => Promise<string | null>;
      // Unified storage operations (single base path for projects + media)
      validateDataDir: (dirPath: string) => Promise<{ valid: boolean; projectCount?: number; mediaCount?: number; skillCount?: number; error?: string }>;
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
      openDevTools: () => Promise<{ success: boolean; error?: string }>;
      testModel: (payload: ModelTestRequest) => Promise<ModelTestResult>;
      textCompletion: (payload: TextCompletionRequest) => Promise<TextCompletionResult>;
      textCompletionStream: (payload: TextCompletionRequest, onChunk: (delta: string) => void) => Promise<TextCompletionResult>;
    };
    appUpdater?: {
      getCurrentVersion: () => Promise<string>;
      checkForUpdates: () => Promise<UpdateCheckResult>;
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
      renderTrackCandidate: (plan: TrackRenderPlan) => Promise<{
        success: boolean;
        filePath?: string;
        previewUrl?: string;
        error?: string;
      }>;
      mergeEpisode: (plan: EpisodeMergePlan) => Promise<{
        success: boolean;
        filePath?: string;
        previewUrl?: string;
        error?: string;
      }>;
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
      importFromToonflow: (payload: { type: string }) => Promise<{ success: boolean; imported: number }>;
    };
    ttsRuntime?: {
      status: () => Promise<TtsRuntimeStatus>;
      start: () => Promise<TtsRuntimeCommandResult>;
      stop: () => Promise<TtsRuntimeCommandResult>;
      setModelCacheDir: (dirPath: string) => Promise<TtsRuntimeCommandResult>;
      request: (payload: { method: string; path: string; body?: unknown }) => Promise<unknown>;
      requestBytes: (payload: { method: string; path: string; body?: unknown }) => Promise<{ data: ArrayBuffer; mimeType?: string }>;
    };
  }
}
