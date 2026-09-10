// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 悬浮球独立模块(09-11 终局结构裁定:从单一模块归一为全局模块)。
// 本目录=球功能全部家当:壳与分区原语(OrbShell/OrbSection/use-orb-position,
// 零业务依赖)、共享分区(OrbGotoSection/OrbStagesSection)、全局面孔 AppOrb。
// 对外唯一门面=AppOrb(Layout 应用层消费);其余导出仅供模块内与测试使用。
// 阶段内容(进度环/切换阶段/待推进)仅工作流视图渲染(09-11 裁定)。

export { AppOrb } from "./AppOrb";
export { OrbShell } from "./OrbShell";
export type { OrbShellProps } from "./OrbShell";
export { OrbSection } from "./OrbSection";
export type { OrbSectionProps } from "./OrbSection";
export {
  useOrbPosition,
  clampOrbPosition,
  snapToNearestEdge,
  ORB_SIZE,
  ORB_MARGIN,
  WORKFLOW_ORB_POSITION_KEY,
  LOCAL_MODEL_ORB_POSITION_KEY,
} from "./use-orb-position";
export type { OrbPosition, OrbAnchor } from "./use-orb-position";
