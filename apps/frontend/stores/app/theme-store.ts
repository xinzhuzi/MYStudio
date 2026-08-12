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
  accentColor: string;
  gradient: string;
  tags: string[];
}

export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: "eyeCare",
    name: "豆绿制片纸",
    mode: "light",
    description: "低饱和豆绿纸面，适合长时间写作、审阅和素材整理。",
    color: "#5B8C5A",
    accentColor: "#3E6B3D",
    gradient: "linear-gradient(135deg, #CFE6CC 0%, #A8D5A3 50%, #5B8C5A 100%)",
    tags: ["护眼柔光", "长文写作", "舒缓防疲劳"],
  },
  {
    id: "warmPaper",
    name: "暖纸剧本台",
    mode: "light",
    description: "柔和暖纸底，适合剧本、设定和长文本编辑。",
    color: "#C48B47",
    accentColor: "#8C5A2B",
    gradient: "linear-gradient(135deg, #F5EFEB 0%, #E3DDCE 50%, #C48B47 100%)",
    tags: ["复古纸质", "剧本梗概", "典雅文学"],
  },
  {
    id: "sageInk",
    name: "鼠尾草档案",
    mode: "light",
    description: "灰绿档案台，适合素材归档和长时间资料管理。",
    color: "#4A7C59",
    accentColor: "#2C5237",
    gradient: "linear-gradient(135deg, #E2EBE0 0%, #CDD8C7 50%, #4A7C59 100%)",
    tags: ["鼠尾草绿", "素材归档", "沉静冷淡"],
  },
  {
    id: "neutral",
    name: "日间剪辑灰",
    mode: "light",
    description: "中性浅灰工作台，适合白天剪辑和资产管理。",
    color: "#1E88E5",
    accentColor: "#0D47A1",
    gradient: "linear-gradient(135deg, #F0F2F5 0%, #D7D8D1 50%, #1E88E5 100%)",
    tags: ["工业中性", "日间剪辑", "高对比度"],
  },
  {
    id: "blueprint",
    name: "青蓝蓝图台",
    mode: "light",
    description: "青蓝冷调工作台，适合配置、流程和密集参数界面。",
    color: "#00ACC1",
    accentColor: "#006064",
    gradient: "linear-gradient(135deg, #E0F7FA 0%, #D2E2E5 50%, #00ACC1 100%)",
    tags: ["工程蓝图", "节点工作流", "清晰高亮"],
  },
  {
    id: "mist",
    name: "雾蓝参数台",
    mode: "light",
    description: "低饱和蓝灰，适合表格、工作流和参数配置。",
    color: "#3949AB",
    accentColor: "#1A237E",
    gradient: "linear-gradient(135deg, #E8EAF6 0%, #D4DBE2 50%, #3949AB 100%)",
    tags: ["冷调雾蓝", "密集表格", "参数调试"],
  },
  {
    id: "porcelain",
    name: "瓷灰展映台",
    mode: "light",
    description: "比纯白更柔和的瓷灰底，适合展示、概览和项目首页。",
    color: "#D81B60",
    accentColor: "#880E4F",
    gradient: "linear-gradient(135deg, #FCE4EC 0%, #E5E1D8 50%, #D81B60 100%)",
    tags: ["高雅瓷灰", "作品展映", "项目大堂"],
  },
  {
    id: "lavender",
    name: "雾紫资产台",
    mode: "light",
    description: "低饱和紫灰调，适合创意资产、角色和风格管理。",
    color: "#8E24AA",
    accentColor: "#4A148C",
    gradient: "linear-gradient(135deg, #F3E5F5 0%, #DAD8E2 50%, #8E24AA 100%)",
    tags: ["梦幻雾紫", "角色资产", "创意概念"],
  },
  {
    id: "cinema",
    name: "Cine Black",
    mode: "dark",
    description: "电影暗房黑，适合首页、预览画面、分镜和夜间制作。",
    color: "#00B0FF",
    accentColor: "#FFB300",
    gradient: "linear-gradient(135deg, #050B14 0%, #00B0FF 50%, #FFB300 100%)",
    tags: ["电影监看", "变形宽银幕", "黄金琥珀点缀"],
  },
  {
    id: "graphite",
    name: "Graphite Cut",
    mode: "dark",
    description: "石墨深灰剪辑台，适合时间线和多面板操作。",
    color: "#00E5FF",
    accentColor: "#FF5252",
    gradient: "linear-gradient(135deg, #0B0E14 0%, #1C2533 50%, #00E5FF 100%)",
    tags: ["钛合金石墨", "多轨剪辑", "高精仪表"],
  },
  {
    id: "midnight",
    name: "Midnight Blue",
    mode: "dark",
    description: "午夜蓝黑低亮度，适合夜间创作和画面预览。",
    color: "#7C4DFF",
    accentColor: "#00E676",
    gradient: "linear-gradient(135deg, #070A14 0%, #151C33 50%, #7C4DFF 100%)",
    tags: ["星空夜幕", "极微光环境", "霓虹紫韵"],
  },
  {
    id: "ink",
    name: "Ink Noir",
    mode: "dark",
    description: "黑客矩阵黑场，带有代码雨网格脉冲与极佳的防疲劳视感。",
    color: "#00E676",
    accentColor: "#00B0FF",
    gradient: "linear-gradient(135deg, #040D0A 0%, #0A261D 50%, #00E676 100%)",
    tags: ["黑客帝国", "矩阵网格", "荧光绿光脉冲"],
  },
  {
    id: "ember",
    name: "Ember Grade",
    mode: "dark",
    description: "暖琥珀火山暗场，适合概念、角色和热烈氛围资产。",
    color: "#FF6D00",
    accentColor: "#FFD600",
    gradient: "linear-gradient(135deg, #140A05 0%, #33170A 50%, #FF6D00 100%)",
    tags: ["胶片火花", "熔岩暗场", "热烈氛围"],
  },
];

interface ThemeState {
  theme: Theme;
  colorPreset: ColorPresetId;
  enableCyberGrid: boolean;
  enableFilmVignette: boolean;
  enableScanlines: boolean;
  setTheme: (theme: Theme) => void;
  setColorPreset: (colorPreset: ColorPresetId) => void;
  toggleTheme: () => void;
  toggleCyberGrid: () => void;
  toggleFilmVignette: () => void;
  toggleScanlines: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      colorPreset: "cinema",
      enableCyberGrid: true,
      enableFilmVignette: true,
      enableScanlines: true,
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
      toggleCyberGrid: () => set((state) => ({ enableCyberGrid: !state.enableCyberGrid })),
      toggleFilmVignette: () => set((state) => ({ enableFilmVignette: !state.enableFilmVignette })),
      toggleScanlines: () => set((state) => ({ enableScanlines: !state.enableScanlines })),
    }),
    {
      name: "mystudio-theme",
    }
  )
);
