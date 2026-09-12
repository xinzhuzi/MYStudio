// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/** 视频工作台(workbench 型):轨道行(名称/镜数/素材/时长+状态徽章)。 */
import { esc, badge } from "./common.js";

export default {
  key: "workbench",
  render(payload) {
    const rows = (payload.tracks || []).map((track) => `
      <div class="ms-row"><span class="main">${esc(track.name)}</span>
        <span class="meta">${track.count > 0 ? esc(track.count) + " 镜 · " : ""}${track.mediaCount > 0 ? esc(track.mediaCount) + " 素材 · " : ""}${track.duration > 0 ? Math.floor(track.duration / 60) + ":" + String(track.duration % 60).padStart(2, "0") : ""}</span>
        ${track.state ? `<span class="ms-badges">${badge(track.state === "ready" ? "ok" : "wait", esc(track.state))}</span>` : ""}
      </div>`).join("");
    return `<div class="ms-rows">${rows}</div>`;
  },
};
