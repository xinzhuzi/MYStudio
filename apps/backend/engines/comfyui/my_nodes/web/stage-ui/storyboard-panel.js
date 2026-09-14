// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/** 分镜面板(storyboard 型):磁贴网格(六列 aspect-ratio;缩略图三色态点;
 * 台词次行 tile 高度契约)。 */
import { emptyHTML, esc, inputImg } from "./common.js";

export default {
  key: "storyboard",
  render(payload) {
    const tiles = (payload.tiles || []).map((tile) => {
      const state = tile.hasVideo ? "#6ea8fe" : tile.hasImage ? "#4ec9a8" : "#7d8ba1";
      const media = tile.preview ? inputImg(tile.preview) : "";
      return `<div class="ms-tile" title="${esc(tile.title)}${tile.lines ? "\n" + esc(tile.lines) : ""}">
        ${media}<span class="ph">${esc(tile.title)}</span>
        <i class="sd" style="background:${state}"></i>
        <span class="tt">${esc(tile.title)}</span>
      </div>`;
    }).join("");
    return tiles ? `<div class="ms-tiles">${tiles}</div>` : emptyHTML("待生成分镜 · 底部「一键生图」");
  },
};
