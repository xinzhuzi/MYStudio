// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { fileStorage } from "@/lib/storage/indexed-db-storage";
import {
  DEFAULT_COMPATIBILITY_RETRY_ASPECT_RATIO,
  DEFAULT_COMPATIBILITY_RETRY_RESOLUTION,
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_RESOLUTION,
  type ImageAspectRatio,
  type ImageResolution,
} from "@/lib/ai/image-size-presets";
import {
  isTimelineRendererId,
  type TimelineRendererId,
} from "@rendering/contracts/timeline-renderer";

export interface ResourceSharingSettings {
  shareCharacters: boolean;
  shareScenes: boolean;
  shareMedia: boolean;
}

export interface StoragePathSettings {
  basePath: string;
}

export interface CacheSettings {
  autoCleanEnabled: boolean;
  autoCleanDays: number;
}
export interface UpdateSettings {
  autoCheckEnabled: boolean;
  ignoredVersion: string;
}
export interface DevelopmentSettings {
  showDevToolsControls: boolean;
}
export interface ImageGenerationSettings {
  defaultAspectRatio: ImageAspectRatio;
  defaultResolution: ImageResolution;
  compatibilityRetryEnabled: boolean;
  compatibilityRetryAspectRatio: ImageAspectRatio;
  compatibilityRetryResolution: ImageResolution;
}
export interface RenderingSettings {
  renderer: TimelineRendererId;
}
export interface ProjectLocationDefaults {
  /** 上次新建项目使用的父目录;目录选择器默认打开位置。 */
  lastParentDir: string;
}

interface AppSettingsState {
  resourceSharing: ResourceSharingSettings;
  storagePaths: StoragePathSettings;
  cacheSettings: CacheSettings;
  updateSettings: UpdateSettings;
  developmentSettings: DevelopmentSettings;
  imageGenerationSettings: ImageGenerationSettings;
  renderingSettings: RenderingSettings;
  projectLocationDefaults: ProjectLocationDefaults;
}

interface AppSettingsActions {
  setResourceSharing: (settings: Partial<ResourceSharingSettings>) => void;
  setStoragePaths: (paths: Partial<StoragePathSettings>) => void;
  setCacheSettings: (settings: Partial<CacheSettings>) => void;
  setUpdateSettings: (settings: Partial<UpdateSettings>) => void;
  setDevelopmentSettings: (settings: Partial<DevelopmentSettings>) => void;
  setImageGenerationSettings: (settings: Partial<ImageGenerationSettings>) => void;
  setRenderingSettings: (settings: Partial<RenderingSettings>) => void;
  setProjectLocationDefaults: (defaults: Partial<ProjectLocationDefaults>) => void;
}

const defaultState: AppSettingsState = {
  resourceSharing: {
    shareCharacters: true,
    shareScenes: true,
    shareMedia: true,
  },
  storagePaths: {
    basePath: "",
  },
  cacheSettings: {
    autoCleanEnabled: false,
    autoCleanDays: 30,
  },
  updateSettings: {
    autoCheckEnabled: true,
    ignoredVersion: "",
  },
  developmentSettings: {
    showDevToolsControls: false,
  },
  imageGenerationSettings: {
    defaultAspectRatio: DEFAULT_IMAGE_ASPECT_RATIO,
    defaultResolution: DEFAULT_IMAGE_RESOLUTION,
    compatibilityRetryEnabled: true,
    compatibilityRetryAspectRatio: DEFAULT_COMPATIBILITY_RETRY_ASPECT_RATIO,
    compatibilityRetryResolution: DEFAULT_COMPATIBILITY_RETRY_RESOLUTION,
  },
  renderingSettings: {
    renderer: "remotion",
  },
  projectLocationDefaults: {
    lastParentDir: "",
  },
};

export const useAppSettingsStore = create<AppSettingsState & AppSettingsActions>()(
  persist(
    (set) => ({
      ...defaultState,
      setResourceSharing: (settings) =>
        set((state) => ({
          resourceSharing: { ...state.resourceSharing, ...settings },
        })),
      setStoragePaths: (paths) =>
        set((state) => ({
          storagePaths: { ...state.storagePaths, ...paths },
        })),
      setCacheSettings: (settings) =>
        set((state) => ({
          cacheSettings: { ...state.cacheSettings, ...settings },
        })),
      setUpdateSettings: (settings) =>
        set((state) => ({
          updateSettings: { ...state.updateSettings, ...settings },
        })),
      setDevelopmentSettings: (settings) =>
        set((state) => ({
          developmentSettings: {
            ...defaultState.developmentSettings,
            ...state.developmentSettings,
            ...settings,
          },
        })),
      setImageGenerationSettings: (settings) =>
        set((state) => ({
          imageGenerationSettings: {
            ...defaultState.imageGenerationSettings,
            ...state.imageGenerationSettings,
            ...settings,
          },
        })),
      setRenderingSettings: (settings) =>
        set((state) => ({
          renderingSettings: {
            ...defaultState.renderingSettings,
            ...state.renderingSettings,
            ...settings,
          },
        })),
      setProjectLocationDefaults: (defaults) =>
        set((state) => ({
          projectLocationDefaults: {
            ...state.projectLocationDefaults,
            ...defaults,
          },
        })),
    }),
    {
      name: "mystudio-app-settings",
      storage: createJSONStorage(() => fileStorage),
      merge: mergeAppSettingsState,
    }
  )
);

export function mergeAppSettingsState(
  persisted: unknown,
  current: AppSettingsState & AppSettingsActions,
): AppSettingsState & AppSettingsActions {
  const persistedState = persisted && typeof persisted === "object"
    ? persisted as Partial<AppSettingsState>
    : {};
  const persistedRenderer = persistedState.renderingSettings?.renderer;
  // FFmpeg was the pre-Remotion default. Migrate persisted legacy settings to
  // the single normal production renderer instead of silently reopening the old chain.
  const normalizedRenderer = persistedRenderer === "ffmpeg" ? "remotion" : persistedRenderer;
  const persistedLastParentDir = persistedState.projectLocationDefaults?.lastParentDir;
  return {
    ...current,
    ...persistedState,
    renderingSettings: {
      renderer: isTimelineRendererId(normalizedRenderer)
        ? normalizedRenderer
        : current.renderingSettings.renderer,
    },
    projectLocationDefaults: {
      lastParentDir: typeof persistedLastParentDir === "string"
        ? persistedLastParentDir
        : current.projectLocationDefaults.lastParentDir,
    },
  };
}
