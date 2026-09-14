// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/** 单镜视频生产(remotionProduction 型):逐镜队列行(静态就绪徽章+活态位
 * .ms-live——B2 轮询按 data-shot-idx 原位重填,渲染中带进度条)。 */
import { emptyHTML, esc, badge, liveBadgesHTML } from "./common.js";

export default {
  key: "remotionProduction",
  render(payload) {
    const rows = (payload.shots || []).map((shot) => {
      const bits = [
        shot.videoReady ? badge("ok", "视频✓") : badge("wait", "待出"),
        shot.ttsReady ? badge("ok", "配音✓") : "",
        shot.sfxReady ? badge("ok", "音效✓") : "",
        shot.revision > 1 ? badge("rev", "v" + shot.revision) : "",
      ].filter(Boolean).join("");
      return `<div class="ms-row" data-shot-idx="${Number(shot.index) || 0}"><span class="idx">#${String(shot.index).padStart(2, "0")}</span>
        <span class="main">${esc(shot.label)}</span><span class="ms-live">${liveBadgesHTML(shot.status, shot.progress)}</span><span class="ms-badges">${bits}</span></div>`;
    }).join("");
    return rows ? `<div class="ms-rows" data-live="queue">${rows}</div>` : emptyHTML("等待分镜面板提供分镜");
  },
};
