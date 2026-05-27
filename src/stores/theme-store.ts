// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark";
export type ColorPresetId =
  | "eyeCare"
  | "warmPaper"
  | "sageInk"
  | "neutral"
  | "blueprint"
  | "mist"
  | "porcelain"
  | "lavender"
  | "cinema"
  | "graphite"
  | "midnight"
  | "ink"
  | "ember";

export interface ColorPreset {
  id: ColorPresetId;
  name: string;
  mode: Theme;
  description: string;
  color: string;
}

export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: "eyeCare",
    name: "护眼豆绿",
    mode: "light",
    description: "低饱和浅绿纸面，适合长时间写作、审阅、整理素材。",
    color: "#CFE8CC",
  },
  {
    id: "warmPaper",
    name: "暖纸米白",
    mode: "light",
    description: "柔和暖纸色，适合剧本、设定、长文本编辑。",
    color: "#E5E0D1",
  },
  {
    id: "sageInk",
    name: "鼠尾草绿",
    mode: "light",
    description: "偏灰绿色，适合素材归档和长时间资料管理。",
    color: "#CFD9C9",
  },
  {
    id: "neutral",
    name: "剪辑中性灰",
    mode: "light",
    description: "接近专业工具的中性浅灰，适合白天做剪辑和资产管理。",
    color: "#D8D9D2",
  },
  {
    id: "blueprint",
    name: "青蓝专业",
    mode: "light",
    description: "青蓝冷调工作台，适合 API、配置、流程类密集界面。",
    color: "#D3E3E6",
  },
  {
    id: "mist",
    name: "雾蓝浅灰",
    mode: "light",
    description: "低饱和蓝灰，适合表格、工作流和参数配置。",
    color: "#D5DBE2",
  },
  {
    id: "porcelain",
    name: "瓷白暖灰",
    mode: "light",
    description: "比纯白更柔和，适合展示、概览和项目首页。",
    color: "#E7E2DA",
  },
  {
    id: "lavender",
    name: "雾紫灰",
    mode: "light",
    description: "轻微紫灰调，适合创意资产、角色与风格管理。",
    color: "#DBD9E3",
  },
  {
    id: "cinema",
    name: "影视暗场",
    mode: "dark",
    description: "暗色剪辑棚质感，适合预览画面、分镜和夜间制作。",
    color: "#121212",
  },
  {
    id: "graphite",
    name: "石墨深灰",
    mode: "dark",
    description: "中性深灰工作台，适合剪辑、时间线和多面板操作。",
    color: "#1E2024",
  },
  {
    id: "midnight",
    name: "午夜蓝黑",
    mode: "dark",
    description: "蓝黑低亮度，适合夜间创作和画面预览。",
    color: "#131820",
  },
  {
    id: "ink",
    name: "墨色黑蓝",
    mode: "dark",
    description: "更沉稳的黑蓝底，适合沉浸式分镜和影视质感。",
    color: "#0F121A",
  },
  {
    id: "ember",
    name: "暖棕暗场",
    mode: "dark",
    description: "带暖色的暗场模板，适合概念、角色和氛围资产。",
    color: "#211B18",
  },
];

interface ThemeState {
  theme: Theme;
  colorPreset: ColorPresetId;
  setTheme: (theme: Theme) => void;
  setColorPreset: (colorPreset: ColorPresetId) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      colorPreset: "cinema",
      setTheme: (theme) => set({ theme }),
      setColorPreset: (colorPreset) => {
        const preset = COLOR_PRESETS.find((item) => item.id === colorPreset);
        set({ colorPreset, theme: preset?.mode ?? get().theme });
      },
      toggleTheme: () => {
        const nextTheme = get().theme === "dark" ? "light" : "dark";
        set({
          theme: nextTheme,
          colorPreset: nextTheme === "dark" ? "cinema" : "eyeCare",
        });
      },
    }),
    {
      name: "moyin-theme",
    }
  )
);
