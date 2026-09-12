// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/** 分镜表(storyboardTable 型):两行制表行(首行镜号/场景/描述/景别·运镜/时长,
 * 次行台词/动作/音效/资产)——解析自 md 表格(lib 层 parseStoryboardTable)。 */
import { esc } from "./common.js";

export default {
  key: "storyboardTable",
  render(payload) {
    const rows = (payload.tableRows || []).map((row) => `
      <div class="ms-row">
        <span class="idx">#${String(row.index).padStart(2, "0")}</span>
        <span class="main"><span class="scene">${esc(row.scene)}</span>${esc(row.title)}
          <span class="sub">「${esc(row.lines || "—")}」${row.action ? " · " + esc(row.action) : ""}${row.sound ? " · ♪" + esc(row.sound) : ""}${row.assets ? " · 【" + esc(row.assets) + "】" : ""}</span>
        </span>
        <span class="meta">${esc(row.shotSize)}${row.cameraMove ? "·" + esc(row.cameraMove) : ""} ${row.duration}s</span>
      </div>`).join("");
    return `<div class="ms-rows">${rows}</div>`;
  },
};
