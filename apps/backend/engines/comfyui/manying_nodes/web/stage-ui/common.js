// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 环节节点 UI 模块公共件(stage-ui/common,09-13 用户裁定:每型节点 UI 分模块)。
 * 各型模块只管自己的排版;转义/徽章/活态/图片标签等共享语言在此单源。
 */

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

export function badge(kind, text) {
  return `<span class="ms-badge ms-badge--${kind}">${esc(text)}</span>`;
}

/** 队列活态徽章/进度条(静态渲染与 B2 轮询共用一源):running=徽章+进度条,
 * failed/blocked=红,canceled/ready/pending=灰;succeeded=空(就绪徽章接管)。 */
export function liveBadgesHTML(status, progress) {
  if (status === "running") {
    const pct = Math.round(Math.min(1, Math.max(0, Number(progress) || 0)) * 100);
    return badge("run", "渲染中") + `<span class="ms-prog"><i style="width:${pct}%"></i></span>`;
  }
  if (status === "failed") return badge("fail", "失败");
  if (status === "blocked") return badge("fail", "阻塞");
  if (status === "canceled") return badge("wait", "已取消");
  if (status === "pending" || status === "ready" || status === "queued") return badge("wait", "排队");
  return "";
}

/** 引擎 input 缩略图 <img>(晚到限次重试契约=window.__manyingImgRetry,宿主注入) */
export function inputImg(filename) {
  return `<img src="/view?filename=${encodeURIComponent(filename)}&subfolder=&type=input" alt=""
     onerror="window.__manyingImgRetry && window.__manyingImgRetry(this)">`;
}

/** markdown 渲染器(markdown-it 14.2.0,MIT,vendor 内嵌):剧本/导演规划
 * 正文是 markdown 源——用户裁定文字展示必须用插件渲染(md 标题/分隔线/
 * 引用成型),禁裸排原文。UMD 惰性 import(相对路径,引擎本地零外网);
 * 加载失败=回落纯文本行(优雅退化)。breaks=false:生成器 50 字软换行
 * 渲染后自动回流成段。 */
let mdRenderer = null;
let mdLoading = null;
const mdWaiters = new Set();

/** 渲染器就位回调(首帧纯文本回落,就位后调用方重渲染成型) */
export function onMarkdownReady(fn) {
  if (mdRenderer) { fn(); return; }
  mdWaiters.add(fn);
}

function ensureMarkdown() {
  if (mdRenderer || !mdLoading) {
    if (!mdLoading) {
      mdLoading = import("./vendor/markdown-it.min.js")
        .then((mod) => {
          const factory = mod.default || window.markdownit;
          mdRenderer = factory({ html: false, linkify: false, typographer: false });
          const waiters = [...mdWaiters]; mdWaiters.clear();
          for (const fn of waiters) { try { fn(); } catch (error) { /* 各自兜底 */ } }
          return mdRenderer;
        })
        .catch(() => {
          console.warn("[manying] markdown-it 装载失败,正文回落纯文本");
          return null;
        });
    }
    return;
  }
}

/** 剥源文档的 XML 式分节标记行(如 <scriptPlan>/<storyboardTable>)——
 * md 对它们只会转义成可见杂文;previewLines 载荷原样携带,渲染前统一剥。 */
const WRAPPER_TAG = /^<\/?[a-zA-Z][\w-]*>$/;
function stripWrapperTags(source) {
  return source
    .split("\n")
    .filter((line) => !WRAPPER_TAG.test(line.trim()))
    .join("\n");
}

/** markdown → HTML(markdown-it 14.2.0 MIT vendor 内嵌):用户裁定文字展示
 * 必须用插件渲染(md 标题/分隔线/引用成型),禁裸排原文;UMD 惰性 import
 * (引擎本地零外网);未就位=转义纯文本回落,就绪回调触发重渲染;
 * breaks=false:生成器 50 字软换行渲染后自动回流成段。 */
export function renderMarkdown(text) {
  const source = String(text || "");
  if (!source) return "";
  ensureMarkdown();
  if (mdRenderer) return mdRenderer.render(stripWrapperTags(source));
  return `<div class="ms-lines">${source.split("\n").map((line) => `<div>${esc(line)}</div>`).join("")}</div>`;
}

/** 空态占位(09-14 UI 收尾:七型统一,数据缺席也给可读反馈) */
export function emptyHTML(text) {
  return `<div class="ms-empty">${esc(text)}</div>`;
}
