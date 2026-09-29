// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * h3DurationUs 真实时长守卫(B1,2026-09-29):
 * 分镜 H3 落片时长(`StoryboardItem.h3DurationUs`,微秒)的唯一写入判定。
 * 任何把视频落到分镜的通路,时长一律先过本守卫——仅正整数微秒放行,
 * 0/负数/小数/NaN/Infinity/非数值全部拒绝为 undefined(静默降级名义时长,
 * 口径=docs/comfyui-kb/分镜H3视频产线.md §四)。
 * 消费侧同判(shot-plan 只认正整数);禁止各落账点再各写一份内联判定。
 */
export function normalizeH3DurationUs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
