// 注入 ComfyUI 画布网页视图的脚本与样式(选区样式、登录态遮罩、画布适配、渲染队列快照读取)。2026-11-24 超线文件拆分:从 ComfyCanvasStudio.tsx 拆出;原文件仍是入口,导出名不变。
"use client";

import { useProjectStore } from "@/stores/project/project-store";
import MY_LOGIN_CLOAK_SOURCE from "../../../../../backend/comfyui/my_nodes/web/my_login_cloak.js?raw";

/** 画布内文本选中样式:ComfyUI 前端唯一选中规则是 xterm vendor css 泄漏的
 * 全局 ::selection{color:transparent} 且无背景定义 → Chromium 默认黄底裸奔
 * (09-10 实弹:工作流树选中=黄条+隐形字,与两边主题都不符)。宿主注入
 * 主题一致选中色(照应用 ::selection 配方 --primary/28%,文字恢复可见)。 */
export const WEBVIEW_SELECTION_CSS =
  "::selection{background:hsl(212 100% 48% / 0.28)!important;color:inherit!important}";

export function buildSignInCloakScript(): string {
  if (!MY_LOGIN_CLOAK_SOURCE.includes("myLoginCloak")) {
    throw new Error("my_login_cloak.js 缺少 myLoginCloak 段(登录遮蔽真源被改坏)");
  }
  return MY_LOGIN_CLOAK_SOURCE;
}

/**
 * 画布满幅矫正器(09-11 用户报障:分镜工作流画布未占满全屏,右侧露纯黑竖带)。
 * 实弹定位:宿主 webview 恒满幅(1920×981 实测),黑带在 ComfyUI 前端内部——
 * 会话恢复/工作流自动载入的竞态窗口里,canvas 位图(resizeCanvas 设定的
 * width/height)停在中间尺寸后未随最终布局矫正,位图右侧即未绘制黑区。
 * 兜底:位图与 CSS 尺寸×dpr 错配时,照上游 resizeCanvas 语义重设
 * (设位图→ctx.scale→app.canvas.draw 主动重绘),错配才动、幂等。
 */
export function buildCanvasFitScript(): string {
  return `(function () {
  if (window.__myCanvasFit) return;
  window.__myCanvasFit = true;
  function fit() {
    var c = document.querySelector("#graph-canvas");
    if (!c) return;
    var rect = c.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    var scale = Math.max(window.devicePixelRatio || 1, 1);
    var wantW = Math.round(rect.width * scale);
    var wantH = Math.round(rect.height * scale);
    if (c.width === wantW && c.height === wantH) return;
    c.width = wantW;
    c.height = wantH;
    var ctx = c.getContext("2d");
    if (ctx) ctx.scale(scale, scale);
    try {
      var app = window.app;
      if (app && app.canvas && typeof app.canvas.draw === "function") app.canvas.draw(true, true);
    } catch (e) { /* draw 不可用:下一轮兜底再试 */ }
  }
  window.addEventListener("load", fit);
  document.addEventListener("DOMContentLoaded", fit);
  var n = 0;
  var iv = setInterval(function () {
    fit();
    if (++n >= 45) clearInterval(iv);
  }, 2000);
})();`;
}

/** 渲染队列实时快照投影(09-12 B2):window.remotionQueue(渲染层真源,lib
 * 同步链够不着)→ [{index,status,progress}]。shotId→镜号经当前分镜表映射;
 * 队列缺席/非 Electron/读失败=空数组(推送面静默,下一 tick 重试)。 */
export async function readRenderQueueSnapshot(
  chapterId: string,
  storyboards: Array<{ id: string; index: number }>,
): Promise<Array<{ index: number; status: string; progress: number }>> {
  const bridge = window.remotionQueue;
  if (typeof bridge?.get !== "function") return [];
  try {
    const projectId = useProjectStore.getState().activeProjectId;
    if (!projectId) return [];
    const scope = await bridge.get({ projectId, chapterId });
    const indexByShotId = new Map(storyboards.map((item) => [item.id, item.index]));
    const queue: Array<{ index: number; status: string; progress: number }> = [];
    for (const job of scope.jobs || []) {
      const target = job?.target;
      if (!target || target.kind !== "shot") continue;
      const index = indexByShotId.get(target.shotId);
      if (index === undefined) continue;
      queue.push({ index, status: String(job.status || ""), progress: Number(job.progress) || 0 });
    }
    return queue;
  } catch {
    return [];
  }
}
