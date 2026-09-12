// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/** 衍生资产(assets 型):资产卡三列网格(封面/名称/类型·视图·状态)。 */
import { esc, inputImg } from "./common.js";

export default {
  key: "assets",
  render(payload) {
    const cards = (payload.assets || []).map((asset) => {
      const cover = asset.cover
        ? inputImg(asset.cover)
        : `<span class="cv">🖼</span>`;
      return `<div class="ms-card" title="${esc(asset.name)}">${cover}
        <span class="nm">${esc(asset.name)}<small>${esc(asset.typeLabel)}${asset.views ? " · " + esc(asset.views) + " 视图" : ""}${asset.state ? " · " + esc(asset.state) : ""}</small></span>
      </div>`;
    }).join("");
    return `<div class="ms-cards">${cards}</div>`;
  },
};
