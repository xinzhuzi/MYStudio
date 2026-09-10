// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// 悬浮球基础设施(09-10 用户裁定:所有进出口都将用球,独立成模块长期维护)。
// 边界铁律:本模块零业务依赖——禁止 import panels/features/stores 业务代码;
// 业务球(工作流球/本地模型球/未来新球)在各自功能模块目录组装,只消费这里的原语。

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
