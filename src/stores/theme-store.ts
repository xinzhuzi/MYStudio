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
    name: "豆绿制片纸",
    mode: "light",
    description: "低饱和豆绿纸面，适合长时间写作、审阅和素材整理。",
    color: "#CFE6CC",
  },
  {
    id: "warmPaper",
    name: "暖纸剧本台",
    mode: "light",
    description: "柔和暖纸底，适合剧本、设定和长文本编辑。",
    color: "#E3DDCE",
  },
  {
    id: "sageInk",
    name: "鼠尾草档案",
    mode: "light",
    description: "灰绿档案台，适合素材归档和长时间资料管理。",
    color: "#CDD8C7",
  },
  {
    id: "neutral",
    name: "日间剪辑灰",
    mode: "light",
    description: "中性浅灰工作台，适合白天剪辑和资产管理。",
    color: "#D7D8D1",
  },
  {
    id: "blueprint",
    name: "青蓝蓝图台",
    mode: "light",
    description: "青蓝冷调工作台，适合配置、流程和密集参数界面。",
    color: "#D2E2E5",
  },
  {
    id: "mist",
    name: "雾蓝参数台",
    mode: "light",
    description: "低饱和蓝灰，适合表格、工作流和参数配置。",
    color: "#D4DBE2",
  },
  {
    id: "porcelain",
    name: "瓷灰展映台",
    mode: "light",
    description: "比纯白更柔和的瓷灰底，适合展示、概览和项目首页。",
    color: "#E5E1D8",
  },
  {
    id: "lavender",
    name: "雾紫资产台",
    mode: "light",
    description: "低饱和紫灰调，适合创意资产、角色和风格管理。",
    color: "#DAD8E2",
  },
  {
    id: "cinema",
    name: "Cine Black",
    mode: "dark",
    description: "电影暗房黑，适合首页、预览画面、分镜和夜间制作。",
    color: "#0B0F14",
  },
  {
    id: "graphite",
    name: "Graphite Cut",
    mode: "dark",
    description: "石墨深灰剪辑台，适合时间线和多面板操作。",
    color: "#1B1F24",
  },
  {
    id: "midnight",
    name: "Midnight Blue",
    mode: "dark",
    description: "午夜蓝黑低亮度，适合夜间创作和画面预览。",
    color: "#101722",
  },
  {
    id: "ink",
    name: "Ink Noir",
    mode: "dark",
    description: "黑蓝墨色暗场，适合沉浸式分镜和影视质感。",
    color: "#0B111A",
  },
  {
    id: "ember",
    name: "Ember Grade",
    mode: "dark",
    description: "暖琥珀暗场，适合概念、角色和氛围资产。",
    color: "#231A14",
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
