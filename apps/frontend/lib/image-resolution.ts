// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

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
