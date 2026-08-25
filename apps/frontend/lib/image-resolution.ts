// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { ImageResolution } from "@/lib/ai/image-size-presets";

/**
 * 图片分辨率档位分类(展示时探测真实像素,不依赖数据层字段)。
 *
 * 阈值依据 GPT_IMAGE_SIZE_MAP 各档长边阶梯:
 *   1K 档长边 544~1280 / 2K 档长边 2016~2048 / 4K 档长边 2880~3840,
 * 档间空隙干净,取 1600/2400 双侧留余量;长边 < 700 视为缩略图/图标,不标。
 * 本地超分 ×4 结果(≥2880)天然落入 4K。
 */
export function classifyImageResolution(width: number, height: number): ImageResolution | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  const longEdge = Math.max(width, height);
  if (longEdge >= 2400) return "4K";
  if (longEdge >= 1600) return "2K";
  if (longEdge >= 700) return "1K";
  return null;
}

/**
 * 探测用 URL:剥离 ?thumb=1 变体。
 * 资产缩略图是 sips 200×200 独立文件(storage-paths.ts 解析到 thumbs 树),
 * 探测缩略图必然误判,必须打原图 URL。
 */
export function toResolutionProbeSrc(src: string): string {
  if (!src.includes("thumb=1")) return src;
  return src
    .replace(/([?&])thumb=1&/g, "$1")
    .replace(/[?&]thumb=1(?=$|#)/, "");
}
