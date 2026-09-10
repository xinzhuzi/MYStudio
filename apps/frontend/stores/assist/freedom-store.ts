// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ==================== Types ====================

// 09-10 辅助面板全屏 ComfyUI 合一(用户裁定):图片/视频/电影工作室退役,
// freedom 视图=整屏 ComfyUI;TTS 配音室=悬浮球面板可达的子态。
export type StudioMode = 'comfy' | 'tts';

interface FreedomState {
  activeStudio: StudioMode;
}

interface FreedomActions {
  setActiveStudio: (studio: StudioMode) => void;
}

type FreedomStore = FreedomState & FreedomActions;

const initialState: FreedomState = {
  activeStudio: 'comfy',
};

// ==================== Store ================================================

export const useFreedomStore = create<FreedomStore>()(
  persist(
    (set) => ({
      ...initialState,

      setActiveStudio: (studio) => set({ activeStudio: studio }),
    }),
    {
      name: 'mystudio-freedom',
      version: 2,
      // v1→v2:三个退役工作室(image/video/cinema)的持久字段全清,
      // activeStudio 一律归一('tts' 保留;退役值/缺省/null → 'comfy')。
      // 旧生成中标志(imageGenerating 等)随字段一并消失,无需再复位。
      migrate: (persisted) => {
        const legacy = persisted as { activeStudio?: unknown };
        const activeStudio: StudioMode =
          legacy.activeStudio === 'tts' ? 'tts' : 'comfy';
        return { activeStudio };
      },
    }
  )
);
