// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { fileStorage } from "@/lib/indexed-db-storage";
import {
  DEFAULT_COMPATIBILITY_RETRY_ASPECT_RATIO,
  DEFAULT_COMPATIBILITY_RETRY_RESOLUTION,
  DEFAULT_IMAGE_ASPECT_RATIO,
  DEFAULT_IMAGE_RESOLUTION,
  type ImageAspectRatio,
  type ImageResolution,
} from "@/lib/ai/image-size-presets";

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

interface AppSettingsState {
  resourceSharing: ResourceSharingSettings;
  storagePaths: StoragePathSettings;
  cacheSettings: CacheSettings;
  updateSettings: UpdateSettings;
  developmentSettings: DevelopmentSettings;
  imageGenerationSettings: ImageGenerationSettings;
}

interface AppSettingsActions {
  setResourceSharing: (settings: Partial<ResourceSharingSettings>) => void;
  setStoragePaths: (paths: Partial<StoragePathSettings>) => void;
  setCacheSettings: (settings: Partial<CacheSettings>) => void;
  setUpdateSettings: (settings: Partial<UpdateSettings>) => void;
  setDevelopmentSettings: (settings: Partial<DevelopmentSettings>) => void;
  setImageGenerationSettings: (settings: Partial<ImageGenerationSettings>) => void;
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
    }),
    {
      name: "mystudio-app-settings",
      storage: createJSONStorage(() => fileStorage),
    }
  )
);
