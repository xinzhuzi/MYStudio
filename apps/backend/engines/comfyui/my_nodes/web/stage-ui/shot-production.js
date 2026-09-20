// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/** 单镜视频生产(remotionProduction 型):逐镜队列行(静态就绪徽章+活态位
 * .ms-live——B2 轮询按 data-shot-idx 原位重填,渲染中带进度条)。 */
import { emptyHTML, esc, badge, liveBadgesHTML } from "./common.js";
import { postAction } from "../bridge-action.js";
import { myTooltipsEnabled } from "../theme.js";

// 09-14 通用化:MyShot 实体退役后,H3 单镜直达并入载荷行(桥动作通道复用)
if (typeof window !== "undefined" && !window.__myH3RowDelegated) {
  window.__myH3RowDelegated = true;
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-h3-shot]") : null;
    if (target && !target.disabled) postAction("open-shot-video", String(target.dataset.h3Shot || ""), target, target.dataset.originProjectId, target.dataset.originEpisodeId);
  });
}

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
      const ready = Boolean(shot.imageReady);
      const h3 = shot.id
        ? '<button type="button" data-h3-shot="' + esc(String(shot.id)) + '" data-origin-project-id="' + esc(String(payload.originProjectId || "")) + '" data-origin-episode-id="' + esc(String(payload.originEpisodeId || "")) + '" title="'
          + (myTooltipsEnabled ? (ready ? "打开该镜的漫影 H3 视频制作工作流" : "先生成画面") : "") + '"'
          + (ready ? "" : " disabled")
          + ' style="margin-left:6px;cursor:' + (ready ? "pointer" : "not-allowed")
          + ";opacity:" + (ready ? "1" : ".48")
          + ';border:1px solid #6ea8fe66;background:#6ea8fe22;color:#9ec5fe;border-radius:6px;font-size:var(--my-fs-11);padding:1px 8px;">H3</button>'
        : "";
      return `<div class="ms-row" data-shot-idx="${Number(shot.index) || 0}"><span class="idx">#${String(shot.index).padStart(2, "0")}</span>
        <span class="main">${esc(shot.label)}</span><span class="ms-live">${liveBadgesHTML(shot.status, shot.progress)}</span><span class="ms-badges">${bits}</span>${h3}</div>`;
    }).join("");
    return rows ? `<div class="ms-rows" data-live="queue">${rows}</div>` : emptyHTML("等待分镜面板提供分镜");
  },
};
