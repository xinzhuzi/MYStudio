// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import {
  ClapperboardIcon,
  UsersIcon,
  VideoIcon,
  SettingsIcon,
  MapPinIcon,
  FileTextIcon,
  FilmIcon,
  SparklesIcon,
  PaletteIcon,
  LayoutDashboardIcon,
  FolderOpenIcon,
  WorkflowIcon,
  Mic2Icon,
  BookOpenTextIcon,
  LucideIcon,
} from "lucide-react";
import { create } from "zustand";
import type {
  CharacterConsistencyElements,
  CharacterIdentityAnchors,
  CharacterNegativePrompt,
  CharacterStageInfo,
  PromptLanguage,
} from "@/types/script";

// Tab-based navigation (simpler flat structure)
export type Tab = "dashboard" | "overview" | "studio" | "script" | "characters" | "scenes" | "freedom" | "director" | "sclass" | "assets" | "media" | "skills" | "tts" | "export" | "settings";

export interface NavItem {
  id: Tab;
  label: string;
  icon: LucideIcon;
}

// Main navigation items (top section)
export const mainNavItems: NavItem[] = [
  { id: "overview", label: "概览", icon: LayoutDashboardIcon },
  { id: "studio", label: "工作流", icon: WorkflowIcon },
  { id: "skills", label: "技能", icon: BookOpenTextIcon },
  { id: "assets", label: "资产", icon: FolderOpenIcon },
  { id: "freedom", label: "辅助", icon: PaletteIcon },
  { id: "tts", label: "TTS", icon: Mic2Icon },
  { id: "export", label: "导出", icon: FilmIcon },
  { id: "media", label: "产物", icon: VideoIcon },
];

// Bottom navigation items
export const bottomNavItems: NavItem[] = [
  { id: "settings", label: "设置", icon: SettingsIcon },
];

// Legacy exports for compatibility
export type Stage = "script" | "assets" | "director" | "export";
export interface StageConfig {
  id: Stage;
  label: string;
  icon: LucideIcon;
  tabs: Tab[];
}
export const stages: StageConfig[] = [
  { id: "script", label: "剧本", icon: FileTextIcon, tabs: ["script"] },
  { id: "assets", label: "角色与场景", icon: UsersIcon, tabs: ["characters", "scenes"] },
  { id: "director", label: "导演工作台", icon: ClapperboardIcon, tabs: ["director"] },
  { id: "export", label: "成片与导出", icon: FilmIcon, tabs: ["export"] },
];

export const tabs: { [key in Tab]: { icon: LucideIcon; label: string; stage?: Stage } } = {
  dashboard: { icon: FileTextIcon, label: "项目" },
  overview: { icon: LayoutDashboardIcon, label: "概览" },
  studio: { icon: WorkflowIcon, label: "工作流" },
  script: { icon: FileTextIcon, label: "剧本", stage: "script" },
  characters: { icon: UsersIcon, label: "角色", stage: "assets" },
  scenes: { icon: MapPinIcon, label: "场景", stage: "assets" },
  freedom: { icon: PaletteIcon, label: "辅助" },
  director: { icon: ClapperboardIcon, label: "导演", stage: "director" },
  sclass: { icon: SparklesIcon, label: "S级", stage: "director" },
  assets: { icon: FolderOpenIcon, label: "资产" },
  media: { icon: VideoIcon, label: "产物" },
  skills: { icon: BookOpenTextIcon, label: "技能" },
  tts: { icon: Mic2Icon, label: "TTS" },
  export: { icon: FilmIcon, label: "导出", stage: "export" },
  settings: { icon: SettingsIcon, label: "设置" },
};

interface NavigationSnapshot {
  activeTab: Tab;
  activeStage: Stage;
  inProject: boolean;
  activeEpisodeIndex: number | null;
  activeEpisodeScopeKey: string | null;
}

const projectLevelTabs = new Set<Tab>([
  "overview",
  "studio",
  "freedom",
  "assets",
  "media",
  "skills",
  "tts",
]);

function toNavigationSnapshot(state: Pick<MediaPanelStore, keyof NavigationSnapshot>): NavigationSnapshot {
  return {
    activeTab: state.activeTab,
    activeStage: state.activeStage,
    inProject: state.inProject,
    activeEpisodeIndex: state.activeEpisodeIndex,
    activeEpisodeScopeKey: state.activeEpisodeScopeKey,
  };
}

function sameNavigationSnapshot(a: NavigationSnapshot, b: NavigationSnapshot): boolean {
  return (
    a.activeTab === b.activeTab &&
    a.activeStage === b.activeStage &&
    a.inProject === b.inProject &&
    a.activeEpisodeIndex === b.activeEpisodeIndex &&
    a.activeEpisodeScopeKey === b.activeEpisodeScopeKey
  );
}

function pushNavigation(
  state: MediaPanelStore,
  next: NavigationSnapshot,
): Partial<MediaPanelStore> {
  const current = toNavigationSnapshot(state);
  if (sameNavigationSnapshot(current, next)) {
    return next;
  }

  return {
    ...next,
    navigationBackStack: [...state.navigationBackStack, current],
    navigationForwardStack: [],
  };
}

function resolveTabNavigation(state: MediaPanelStore, tab: Tab): NavigationSnapshot {
  const tabConfig = tabs[tab];
  if (tabConfig?.stage) {
    return {
      ...toNavigationSnapshot(state),
      activeTab: tab,
      activeStage: tabConfig.stage,
      inProject: true,
    };
  }

  if (tab === "dashboard") {
    return {
      activeTab: tab,
      activeStage: state.activeStage,
      inProject: false,
      activeEpisodeIndex: null,
      activeEpisodeScopeKey: null,
    };
  }

  if (projectLevelTabs.has(tab)) {
    return {
      ...toNavigationSnapshot(state),
      activeTab: tab,
      inProject: true,
    };
  }

  return {
    ...toNavigationSnapshot(state),
    activeTab: tab,
  };
}

// Data passed from script panel to director
export interface PendingDirectorData {
  storyPrompt: string; // Combined action + dialogue
  characterNames?: string[];
  sceneLocation?: string;
  sceneTime?: string;
  shotId?: string; // Source shot ID for reference
  // Auto-fill parameters
  sceneCount?: number; // 1 for single shot, N for scene with N shots
  styleId?: string; // Visual style from script
  sourceType?: 'shot' | 'scene' | 'episode'; // What triggered this jump
  // 集作用域透传
  sourceEpisodeIndex?: number;
  sourceEpisodeId?: string;
}

// Data passed from script panel to character library
export interface PendingCharacterData {
  name: string;
  gender?: string;
  age?: string;
  personality?: string;
  role?: string;
  traits?: string;
  skills?: string;
  keyActions?: string;
  appearance?: string;
  relationships?: string;
  tags?: string[];    // 角色标签
  notes?: string;     // 角色备注
  styleId?: string;
  // 集作用域透传
  sourceEpisodeIndex?: number;
  sourceEpisodeId?: string;
  // === 年代信息（从剧本元数据传递）===
  storyYear?: number;  // 故事年份，如 2002
  era?: string;        // 时代背景描述
  // === 提示词语言偏好（从剧本面板透传）===
  promptLanguage?: PromptLanguage;  // 'zh' | 'en' | 'zh+en'
  // === 专业角色设计字段（世界级大师生成） ===
  visualPromptEn?: string;  // 英文视觉提示词
  visualPromptZh?: string;  // 中文视觉提示词
  // === 6层身份锚点（角色一致性） ===
  identityAnchors?: CharacterIdentityAnchors;  // 身份锚点 - 6层特征锁定
  negativePrompt?: CharacterNegativePrompt;    // 负面提示词
  // === 多阶段角色支持 ===
  stageInfo?: CharacterStageInfo;
  consistencyElements?: CharacterConsistencyElements;
}

// Data passed from script panel to scene library
export interface PendingSceneData {
  // === 基础信息 ===
  name: string;
  location: string;
  time?: string;
  atmosphere?: string;
  styleId?: string;
  tags?: string[];        // 场景标签
  notes?: string;         // 场景备注
  // 集作用域透传
  sourceEpisodeIndex?: number;
  sourceEpisodeId?: string;
  // 提示词语言偏好
  promptLanguage?: import('@/types/script').PromptLanguage;
  
  // === 专业场景设计（完整传递）===
  visualPrompt?: string;       // 中文视觉描述
  visualPromptEn?: string;     // 英文视觉描述
  architectureStyle?: string;  // 建筑风格
  lightingDesign?: string;     // 光影设计
  colorPalette?: string;       // 色彩基调
  eraDetails?: string;         // 时代特征
  keyProps?: string[];         // 关键道具
  spatialLayout?: string;      // 空间布局
  
  // === 多视角联合图数据 ===
  viewpoints?: PendingViewpointData[];           // 视角列表
  contactSheetPrompts?: ContactSheetPromptSet[]; // 联合图提示词（可能多张）
}

// 待生成的视角数据
export interface PendingViewpointData {
  id: string;           // 视角ID
  name: string;         // 中文名：餐桌区、沙发区
  nameEn: string;       // 英文名
  shotIds: string[];    // 关联的分镜ID
  shotIndexes: number[]; // 关联的分镜序号（用于展示）
  keyProps: string[];   // 道具（中文）
  keyPropsEn: string[]; // 道具（英文）
  gridIndex: number;    // 在联合图中的位置
  pageIndex: number;    // 属于第几张联合图（从0开始）
}

// 联合图提示词集合（支持多张）
export interface ContactSheetPromptSet {
  pageIndex: number;          // 第几张联合图（从0开始）
  prompt: string;             // 英文提示词
  promptZh: string;           // 中文提示词
  viewpointIds: string[];     // 包含哪些视角ID
  gridLayout: { rows: number; cols: number };
}

interface MediaPanelStore {
  activeTab: Tab;
  activeStage: Stage;
  inProject: boolean; // Whether viewing a project or dashboard
  navigationBackStack: NavigationSnapshot[];
  navigationForwardStack: NavigationSnapshot[];
  setActiveTab: (tab: Tab) => void;
  setActiveStage: (stage: Stage) => void;
  setInProject: (inProject: boolean) => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  // Episode scope (子项目作用域)
  activeEpisodeIndex: number | null;
  activeEpisodeScopeKey: string | null; // `${projectId}::ep-${episodeIndex}`
  enterEpisode: (index: number, projectId?: string) => void;
  backToSeries: () => void;
  highlightMediaId: string | null;
  requestRevealMedia: (mediaId: string) => void;
  clearHighlight: () => void;
  // Cross-panel data passing
  pendingDirectorData: PendingDirectorData | null;
  setPendingDirectorData: (data: PendingDirectorData | null) => void;
  goToDirectorWithData: (data: PendingDirectorData) => void;
  // Character library data passing
  pendingCharacterData: PendingCharacterData | null;
  setPendingCharacterData: (data: PendingCharacterData | null) => void;
  goToCharacterWithData: (data: PendingCharacterData) => void;
  // Scene library data passing
  pendingSceneData: PendingSceneData | null;
  setPendingSceneData: (data: PendingSceneData | null) => void;
  goToSceneWithData: (data: PendingSceneData) => void;
}

export const useMediaPanelStore = create<MediaPanelStore>((set) => ({
  activeTab: "dashboard",
  activeStage: "script",
  inProject: false,
  navigationBackStack: [],
  navigationForwardStack: [],
  setActiveTab: (tab) => {
    set((state) => pushNavigation(state, resolveTabNavigation(state, tab)));
  },
  setActiveStage: (stage) => {
    // Switch to first tab of the stage
    const stageConfig = stages.find(s => s.id === stage);
    if (stageConfig && stageConfig.tabs.length > 0) {
      set((state) =>
        pushNavigation(state, {
          ...toNavigationSnapshot(state),
          activeStage: stage,
          activeTab: stageConfig.tabs[0],
          inProject: true,
        }),
      );
    }
  },
  setInProject: (inProject) => {
    set((state) =>
      pushNavigation(state, {
        ...toNavigationSnapshot(state),
        inProject,
        activeTab: inProject ? state.activeTab : "dashboard",
        activeEpisodeIndex: inProject ? state.activeEpisodeIndex : null,
        activeEpisodeScopeKey: inProject ? state.activeEpisodeScopeKey : null,
      }),
    );
  },
  canGoBack: () => useMediaPanelStore.getState().navigationBackStack.length > 0,
  canGoForward: () => useMediaPanelStore.getState().navigationForwardStack.length > 0,
  goBack: () => {
    set((state) => {
      const previous = state.navigationBackStack.at(-1);
      if (!previous) return {};
      return {
        ...previous,
        navigationBackStack: state.navigationBackStack.slice(0, -1),
        navigationForwardStack: [toNavigationSnapshot(state), ...state.navigationForwardStack],
      };
    });
  },
  goForward: () => {
    set((state) => {
      const next = state.navigationForwardStack[0];
      if (!next) return {};
      return {
        ...next,
        navigationBackStack: [...state.navigationBackStack, toNavigationSnapshot(state)],
        navigationForwardStack: state.navigationForwardStack.slice(1),
      };
    });
  },
  // Episode scope
  activeEpisodeIndex: null,
  activeEpisodeScopeKey: null,
  enterEpisode: (index, projectId) =>
    set((state) =>
      pushNavigation(state, {
        activeEpisodeIndex: index,
        activeEpisodeScopeKey: projectId ? `${projectId}::ep-${index}` : `default::ep-${index}`,
        activeTab: "script",
        activeStage: "script",
        inProject: true,
      }),
    ),
  backToSeries: () =>
    set((state) =>
      pushNavigation(state, {
        ...toNavigationSnapshot(state),
        activeEpisodeIndex: null,
        activeEpisodeScopeKey: null,
        activeTab: "overview",
      }),
    ),
  highlightMediaId: null,
  requestRevealMedia: (mediaId) =>
    set((state) => ({
      ...pushNavigation(state, {
        ...toNavigationSnapshot(state),
        activeTab: "media",
        inProject: true,
      }),
      highlightMediaId: mediaId,
    })),
  clearHighlight: () => set({ highlightMediaId: null }),
  // Cross-panel data passing
  pendingDirectorData: null,
  setPendingDirectorData: (data) => set({ pendingDirectorData: data }),
  goToDirectorWithData: (data) =>
    set((state) => ({
      ...pushNavigation(state, {
        ...toNavigationSnapshot(state),
        activeTab: "director",
        activeStage: "director",
        inProject: true,
      }),
      pendingDirectorData: data,
    })),
  // Character library data passing
  pendingCharacterData: null,
  setPendingCharacterData: (data) => set({ pendingCharacterData: data }),
  goToCharacterWithData: (data) =>
    set((state) => ({
      ...pushNavigation(state, {
        ...toNavigationSnapshot(state),
        activeTab: "characters",
        activeStage: "assets",
        inProject: true,
      }),
      pendingCharacterData: data,
    })),
  // Scene library data passing
  pendingSceneData: null,
  setPendingSceneData: (data) => set({ pendingSceneData: data }),
  goToSceneWithData: (data) =>
    set((state) => ({
      ...pushNavigation(state, {
        ...toNavigationSnapshot(state),
        activeTab: "scenes",
        activeStage: "assets",
        inProject: true,
      }),
      pendingSceneData: data,
    })),
}));
