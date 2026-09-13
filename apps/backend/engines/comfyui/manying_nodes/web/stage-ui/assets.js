// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/** 衍生资产(assets 型):基础三组(角色/场景/道具,assetGroups)+衍生链资产卡
 * (assets:封面/名称/类型·状态)——老剧本资产界面两组信息都进节点(09-13
 * 用户裁定:功能/界面迁移节点图);assetGroups 缺席=只渲染卡,两者都缺=占位。 */
import { esc, inputImg } from "./common.js";

export default {
  key: "assets",
  render(payload) {
    const parts = [];
    const groups = payload.assetGroups;
    if (groups && (groups.characters?.length || groups.scenes?.length || groups.props?.length)) {
      const sections = [
        ["characters", "角色"], ["scenes", "场景"], ["props", "道具"],
      ].map(([field, label]) => {
        const names = groups[field] || [];
        if (!names.length) return "";
        const chips = names.map((name) => `<span class="ms-asset-name">${esc(name)}</span>`).join("");
        return `<div class="ms-asset-group"><b>${label} ${names.length}</b><div class="ms-asset-names">${chips}</div></div>`;
      }).filter(Boolean).join("");
      if (sections) parts.push(`<div class="ms-asset-sections">${sections}</div>`);
    }
    // 衍生链资产卡分类展示(09-13 用户裁定:按 角色/场景/道具 分组,不混排)
    const renderCards = (list) => list.map((asset) => {
      const cover = asset.cover
        ? inputImg(asset.cover)
        : `<span class="cv">🖼</span>`;
      return `<div class="ms-card" title="${esc(asset.name)}">${cover}
        <span class="nm">${esc(asset.name)}<small>${esc(asset.typeLabel)}${asset.views ? " · " + esc(asset.views) + " 视图" : ""}${asset.state ? " · " + esc(asset.state) : ""}</small></span>
      </div>`;
    }).join("");
    const allCards = payload.assets || [];
    const CARD_CATEGORIES = ["角色", "场景", "道具"];
    const cardSections = [...CARD_CATEGORIES, null].map((cat) => {
      const list = cat ? allCards.filter((a) => a.typeLabel === cat) : allCards.filter((a) => !CARD_CATEGORIES.includes(a.typeLabel));
      if (!list.length) return "";
      return `<div class="ms-asset-group"><b>${cat ? cat : "其他"}衍生 ${list.length}</b><div class="ms-cards">${renderCards(list)}</div></div>`;
    }).filter(Boolean).join("");
    if (cardSections) parts.push(`<div class="ms-asset-sections">${cardSections}</div>`);
    if (!parts.length) return `<div class="ms-lines"><div>暂无资产 · 点「抽取资产」从剧本提取</div></div>`;
    return parts.join("");
  },
};
