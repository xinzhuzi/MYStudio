// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 导航展示配置(1123 架构整理 D6 上移):图标与文案的展示真源在
// components;标签页与阶段的类型(Tab/Stage)与纯映射(TAB_STAGE/
// STAGE_TABS)仍在 @/stores/navigation/media-panel-store,本件零运行时
// 反向依赖——store 不 import 本件,stores→components 越层边不回潮。
import {
  BoxesIcon,
  ClapperboardIcon,
  UsersIcon,
  SettingsIcon,
  MapPinIcon,
  FileTextIcon,
  FilmIcon,
  SparklesIcon,
  LayoutDashboardIcon,
  FolderOpenIcon,
  WorkflowIcon,
  BookOpenTextIcon,
  Share2Icon,
  LucideIcon,
} from "lucide-react";
import { LocalModelsIcon } from "@/components/ui/local-models-icon";
import type { Tab, Stage } from "@/stores/navigation/media-panel-store";
import { TAB_STAGE, STAGE_TABS } from "@/stores/navigation/media-panel-store";

export interface NavItem {
  id: Tab;
  label: string;
  icon: LucideIcon;
}

// Main navigation items (top section)
export const mainNavItems: NavItem[] = [
  { id: "overview", label: "概览", icon: LayoutDashboardIcon },
  { id: "studio", label: "MY 工作流", icon: WorkflowIcon }, // 09-11 项目适应命名
  { id: "skills", label: "技能", icon: BookOpenTextIcon },
  { id: "assets", label: "资产", icon: FolderOpenIcon },
  // 09-14 图标换血:大模型弃辅助时代 Palette,改用 ComfyUI 模型库同款 ai-model 图标
  { id: "freedom", label: "大模型", icon: LocalModelsIcon },
  { id: "export", label: "导出", icon: FilmIcon },
  { id: "media", label: "产物", icon: BoxesIcon },
  { id: "self-media", label: "自媒体", icon: Share2Icon },
];

// Bottom navigation items
export const bottomNavItems: NavItem[] = [
  { id: "settings", label: "设置", icon: SettingsIcon },
];

export interface StageConfig {
  id: Stage;
  label: string;
  icon: LucideIcon;
  tabs: Tab[];
}
export const stages: StageConfig[] = [
  { id: "script", label: "剧本", icon: FileTextIcon, tabs: STAGE_TABS.script },
  { id: "assets", label: "角色与场景", icon: UsersIcon, tabs: STAGE_TABS.assets },
  { id: "director", label: "导演工作台", icon: ClapperboardIcon, tabs: STAGE_TABS.director },
  { id: "export", label: "成片与导出", icon: FilmIcon, tabs: STAGE_TABS.export },
];

export const tabs: { [key in Tab]: { icon: LucideIcon; label: string; stage?: Stage } } = {
  dashboard: { icon: FileTextIcon, label: "项目" },
  overview: { icon: LayoutDashboardIcon, label: "概览" },
  studio: { icon: WorkflowIcon, label: "MY 工作流" },
  script: { icon: FileTextIcon, label: "剧本", stage: TAB_STAGE.script },
  characters: { icon: UsersIcon, label: "角色", stage: TAB_STAGE.characters },
  scenes: { icon: MapPinIcon, label: "场景", stage: TAB_STAGE.scenes },
  freedom: { icon: LocalModelsIcon, label: "大模型" },
  director: { icon: ClapperboardIcon, label: "导演", stage: TAB_STAGE.director },
  sclass: { icon: SparklesIcon, label: "S级", stage: TAB_STAGE.sclass },
  assets: { icon: FolderOpenIcon, label: "资产" },
  media: { icon: BoxesIcon, label: "产物" },
  "self-media": { icon: Share2Icon, label: "自媒体" },
  skills: { icon: BookOpenTextIcon, label: "技能" },
  export: { icon: FilmIcon, label: "导出", stage: TAB_STAGE.export },
  settings: { icon: SettingsIcon, label: "设置" },
};
