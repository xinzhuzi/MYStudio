// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 分镜缩略图命名契约(09-15 分镜域零实体裁定后的存留件):
 * 09-14 通用化(e2bbb78)退役了 MyShot 总览图生成器与逐镜/逐章工作流实体
 * ——分镜域零文件,环节载荷由画布侧对仓库通用模板(repo:0_分镜/)现注入。
 * 本文件只留引擎 input 缩略图命名契约:主帧/帧2 的文件名与上传源路径
 * (保鲜同步上传与 tiles 载荷共用,引擎镜节点按名渲染)。
 */

import type { StoryboardItem } from "@/types/studio";

/** 该镜成图在引擎 input 目录的缩略图名(保鲜同步上传,扩展按名渲染;无图=空) */
export function shotPreviewName(storyboard: StoryboardItem): string {
  if (storyboard.mediaRef?.kind !== "image" || !storyboard.mediaRef.path) return "";
  const safeId = storyboard.id.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `my-shot-${safeId}.jpg`;
}

/** 第二关键帧缩略图名(09-14 用户裁定:每镜多张图都上屏——回接后每镜常 2 帧,
 * 引擎镜节点双图并排);帧2 缺图=空串(节点回落单图) */
export function shotPreview2Name(storyboard: StoryboardItem): string {
  const frames = (storyboard.keyframes ?? []).filter((frame) => frame.mediaRef?.path);
  const second = frames[1];
  if (!second?.mediaRef?.path) return "";
  const safeId = storyboard.id.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `my-shot-${safeId}-k2.jpg`;
}

/** 帧2 的原始媒体路径(上传源;无=空) */
export function shotPreview2Source(storyboard: StoryboardItem): string {
  const frames = (storyboard.keyframes ?? []).filter((frame) => frame.mediaRef?.path);
  return frames[1]?.mediaRef?.path ?? "";
}
