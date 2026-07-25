// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ==================== Types ====================

export type StudioMode = 'image' | 'video' | 'cinema' | 'tts';

export interface HistoryEntry {
  id: string;
  prompt: string;
  model: string;
  resultUrl: string;
  thumbnailUrl?: string;
  params: Record<string, any>;
  createdAt: number;
  mediaId?: string;
  type: 'image' | 'video';
}

interface FreedomState {
  // Studio mode
  activeStudio: StudioMode;
  
  // Image studio
  imagePrompt: string;
  selectedImageModel: string;
  imageAspectRatio: string;
  imageResolution: string;
  imageExtraParams: Record<string, any>;
  imageResult: string | null;
  imageGenerating: boolean;
  
  // Video studio
  videoPrompt: string;
  selectedVideoModel: string;
  videoAspectRatio: string;
  videoDuration: number;
  videoResolution: string;
  videoResult: string | null;
  videoGenerating: boolean;
  
  // Cinema studio
  cinemaPrompt: string;
  selectedCamera: string;
  selectedLens: string;
  selectedFocalLength: number;
  selectedAperture: string;
  cinemaResult: string | null;
  cinemaGenerating: boolean;
  
  // History
  imageHistory: HistoryEntry[];
  videoHistory: HistoryEntry[];
  cinemaHistory: HistoryEntry[];
}

interface FreedomActions {
  setActiveStudio: (studio: StudioMode) => void;
  
  // Image studio actions
  setImagePrompt: (prompt: string) => void;
  setSelectedImageModel: (model: string) => void;
  setImageAspectRatio: (ratio: string) => void;
  setImageResolution: (resolution: string) => void;
  setImageExtraParams: (params: Record<string, any>) => void;
  setImageResult: (url: string | null) => void;
  setImageGenerating: (generating: boolean) => void;
  
  // Video studio actions
  setVideoPrompt: (prompt: string) => void;
  setSelectedVideoModel: (model: string) => void;
  setVideoAspectRatio: (ratio: string) => void;
  setVideoDuration: (duration: number) => void;
  setVideoResolution: (resolution: string) => void;
  setVideoResult: (url: string | null) => void;
  setVideoGenerating: (generating: boolean) => void;
  
  // Cinema studio actions
  setCinemaPrompt: (prompt: string) => void;
  setSelectedCamera: (camera: string) => void;
  setSelectedLens: (lens: string) => void;
  setSelectedFocalLength: (fl: number) => void;
  setSelectedAperture: (aperture: string) => void;
  setCinemaResult: (url: string | null) => void;
  setCinemaGenerating: (generating: boolean) => void;
  
  // History actions
  addHistoryEntry: (entry: HistoryEntry) => void;
  removeHistoryEntry: (id: string) => void;
  clearHistory: (type: 'image' | 'video' | 'cinema') => void;
}

type FreedomStore = FreedomState & FreedomActions;

/** 复位瞬时生成标志（image/video/cinema）。供 persist rehydrate 调用，避免上次生成被进程中断后卡在"生成中"。 */
export function resetTransientGenerating(state?: Partial<FreedomState>): void {
  if (!state) return;
  state.imageGenerating = false;
  state.videoGenerating = false;
  state.cinemaGenerating = false;
}

// ==================== Constants ====================

const MAX_HISTORY = 50;

const initialState: FreedomState = {
  activeStudio: 'image',
  
  imagePrompt: '',
  selectedImageModel: '',
  imageAspectRatio: '16:9',
  imageResolution: '',
  imageExtraParams: {},
  imageResult: null,
  imageGenerating: false,
  
  videoPrompt: '',
  selectedVideoModel: '',
  videoAspectRatio: '16:9',
  videoDuration: 5,
  videoResolution: '720p',
  videoResult: null,
  videoGenerating: false,
  
  cinemaPrompt: '',
  selectedCamera: 'Modular 8K Digital',
  selectedLens: 'Fast Prime Cine',
  selectedFocalLength: 35,
  selectedAperture: 'f/2.8',
  cinemaResult: null,
  cinemaGenerating: false,
  
  imageHistory: [],
  videoHistory: [],
  cinemaHistory: [],
};

// ==================== Store ====================

export const useFreedomStore = create<FreedomStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      setActiveStudio: (studio) => set({ activeStudio: studio }),

      // Image studio
      setImagePrompt: (prompt) => set({ imagePrompt: prompt }),
      setSelectedImageModel: (model) => set({ selectedImageModel: model }),
      setImageAspectRatio: (ratio) => set({ imageAspectRatio: ratio }),
      setImageResolution: (resolution) => set({ imageResolution: resolution }),
      setImageExtraParams: (params) => set({ imageExtraParams: params }),
      setImageResult: (url) => set({ imageResult: url }),
      setImageGenerating: (generating) => set({ imageGenerating: generating }),

      // Video studio
      setVideoPrompt: (prompt) => set({ videoPrompt: prompt }),
      setSelectedVideoModel: (model) => set({ selectedVideoModel: model }),
      setVideoAspectRatio: (ratio) => set({ videoAspectRatio: ratio }),
      setVideoDuration: (duration) => set({ videoDuration: duration }),
      setVideoResolution: (resolution) => set({ videoResolution: resolution }),
      setVideoResult: (url) => set({ videoResult: url }),
      setVideoGenerating: (generating) => set({ videoGenerating: generating }),

      // Cinema studio
      setCinemaPrompt: (prompt) => set({ cinemaPrompt: prompt }),
      setSelectedCamera: (camera) => set({ selectedCamera: camera }),
      setSelectedLens: (lens) => set({ selectedLens: lens }),
      setSelectedFocalLength: (fl) => set({ selectedFocalLength: fl }),
      setSelectedAperture: (aperture) => set({ selectedAperture: aperture }),
      setCinemaResult: (url) => set({ cinemaResult: url }),
      setCinemaGenerating: (generating) => set({ cinemaGenerating: generating }),

      // History
      addHistoryEntry: (entry) => {
        const historyKey = entry.type === 'image'
          ? 'imageHistory'
          : entry.type === 'video'
          ? 'videoHistory'
          : 'cinemaHistory';
        set((state) => {
          const current = state[historyKey as keyof FreedomState] as HistoryEntry[];
          const updated = [entry, ...current].slice(0, MAX_HISTORY);
          return { [historyKey]: updated };
        });
      },

      removeHistoryEntry: (id) => {
        set((state) => ({
          imageHistory: state.imageHistory.filter(h => h.id !== id),
          videoHistory: state.videoHistory.filter(h => h.id !== id),
          cinemaHistory: state.cinemaHistory.filter(h => h.id !== id),
        }));
      },

      clearHistory: (type) => {
        const key = type === 'image'
          ? 'imageHistory'
          : type === 'video'
          ? 'videoHistory'
          : 'cinemaHistory';
        set({ [key]: [] });
      },
    }),
    {
      name: 'mystudio-freedom',
      version: 1,
      // 瞬时生成标志不应跨会话恢复：重启时若上次生成被进程中断会卡在"生成中"，rehydrate 时强制复位。
      onRehydrateStorage: () => (state) => resetTransientGenerating(state),
    }
  )
);
