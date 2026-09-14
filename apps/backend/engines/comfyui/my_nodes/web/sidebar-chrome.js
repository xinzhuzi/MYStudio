// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";

/**
 * 漫影侧栏外壳(sidebar-chrome 模块,09-13 模块拆分):官方 sidebar 扩展
 * 注册+dock「模型」入口隐藏+品牌龙徽置顶;页签内容渲染在 sidebar.js。
 */

import { renderSidebar } from "./sidebar.js";
import { cleanupLegacyUnsavedTabs } from "./open-workflow.js";

app.registerExtension({
  name: "my.sidebar",
  async setup() {
    // 新版前端侧栏 API(官方 sidebar 扩展,自定义 DOM 渲染);旧版无此面=静默跳过
    if (app.extensionManager?.registerSidebarTab) {
      app.extensionManager.registerSidebarTab({
        id: "my.shots",
        icon: "icon-[lucide--list]",
        title: "漫影",
        tooltip: "漫影:分镜/工作流——按所在模块定默认页签",
        render: renderSidebar,
      });
      installSidebarTabDecorations();
      installDockModelEntryRemoval();
      // 旧 Unsaved 签清场(Q3a 09-12):等图就绪(草稿恢复完)扫一轮;幂等,
      // 协议通道每次打开也会再扫。只关含漫影环节节点的(可再生),用户手搭不动。
      const sweepUnsaved = (attempt) => {
        if (app.isGraphReady === true) { void cleanupLegacyUnsavedTabs(); return; }
        if (attempt < 40) setTimeout(() => sweepUnsaved(attempt + 1), 300);
      };
      sweepUnsaved(0);
    }
  },
});

// ── dock「模型」入口移除(09-11 用户裁定:模型只在画布节点上呈现,侧栏
// 模型库入口不需要;用户点名的原生项豁免,仍走外挂 DOM 形式不改本体)──
// dock 按钮为前端渲染的侧栏项,按标签文本识别「模型」后隐藏;观察器常驻
// (侧栏随模块/窗口重渲染,一次性隐藏会被冲掉)。
function installDockModelEntryRemoval() {
  const hideModelEntry = () => {
    const buttons = document.querySelectorAll(".side-tool-bar-container button, [class*=\"side-tool-bar\"] button");
    for (const button of buttons) {
      const label = ((button.title || "") + " " + (button.getAttribute("aria-label") || "") + " " + (button.textContent || "")).trim();
      if (label.indexOf("模型") >= 0 && button.style.display !== "none") {
        button.style.display = "none";
      }
    }
  };
  hideModelEntry();
  const observer = new MutationObserver(hideModelEntry);
  observer.observe(document.body, { childList: true, subtree: true });
}

// ── 侧栏漫影标签:品牌龙徽标 + 置顶(09-10 用户裁定×3:弃代码线稿改用真标) ──
// ComfyUI 侧栏图标走 iconify 名册只认 lucide 名——自定义图标用注册后
// DOM 置换;标签排序按注册序(扩展殿后),置顶用 DOM 前插。观察器兜底
// Vue 重渲染回滚。图标=品牌 logo(apps/frontend/assets/brand/logo-32x32.png,
// 原图 1254²/1.3MB,缩至 64²/6.5KB 后 base64 内嵌=data URL,零 URL 假设;
// 形=红金龙徽,alpha 透明底,深浅主题通吃)。
// 品牌 logo 数据(assets/brand/logo-32x32.png 缩 64²/6.5KB;base64 内嵌=零 URL 假设)
const LOGO_PNG_DATA_URL =
  'data:image/png;base64,'
  + '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';

// 图标=品牌龙徽的单色化:CSS mask 用 logo alpha 通道,currentColor 上色——
// 暗主题白/亮主题黑,与侧栏 lucide 图标(stroke=currentColor)同一主题机制,
// 细节(须/鳞/爪)经 alpha 全保留。
const MY_LOGO_ICON =
  '<span aria-hidden="true" '
  + 'style="display:inline-block;width:2.6em;height:2.6em;background-color:currentColor;'
  + '-webkit-mask-image:url(\'' + LOGO_PNG_DATA_URL + '\');'
  + 'mask-image:url(\'' + LOGO_PNG_DATA_URL + '\');'
  + '-webkit-mask-size:contain;mask-size:contain;'
  + '-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;'
  + '-webkit-mask-position:center;mask-position:center"/>';

function decorateSidebarTab() {
  // 金锚点:SideToolbar 每个标签按钮带 data-testid="<tabId>-tab-button"(bundle 实证)
  const root = document.querySelector('[data-testid="my.shots-tab-button"]');
  if (!root) return;
  // 09-15 用户裁定:龙徽 tab=icon-only——隐藏原生标签位(side-bar-button-label,
  // bundle 实证类名)放大龙徽;title/tooltip 保留(hover 仍有「漫影」提示,
  // aria 不损),CSS 域内按 testid 圈定,Vue 重渲染天然免疫(类名恒在)。
  if (!document.getElementById("my-tab-icon-only")) {
    const style = document.createElement("style");
    style.id = "my-tab-icon-only";
    style.textContent = [
      '[data-testid="my.shots-tab-button"] .side-bar-button-label{display:none;}',
      '[data-testid="my.shots-tab-button"] .side-bar-button-content{gap:0;justify-content:center;}',
    ].join("\n");
    document.head.append(style);
  }
  // 置顶:插到本容器第一个标签钮之前(顶部品牌徽标之后)=在队列/资产等所有标签之上
  const container = root.parentElement;
  if (container) {
    const firstTab = container.querySelector('[data-testid$="-tab-button"]');
    if (firstTab && firstTab !== root) container.insertBefore(root, firstTab);
  }
  // 图标置换:图标槽=组件内部 i.side-bar-button-icon(iconify 类渲染位)→ 品牌龙徽单色 mask
  // 沿用槽位类名吃原生尺寸,外加 object-fit;标记防重渲染后重复嵌套
  const iconHost = root.querySelector("i.side-bar-button-icon");
  if (iconHost && !root.querySelector("[data-my-dragon]")) {
    const holder = document.createElement("span");
    holder.innerHTML = MY_LOGO_ICON;
    const dragon = holder.firstElementChild;
    if (dragon) {
      dragon.setAttribute("data-my-dragon", "1");
      dragon.classList.add("side-bar-button-icon");
      iconHost.replaceWith(dragon);
    }
  }
}

function installSidebarTabDecorations() {
  if (window.__mySidebarDecorated) return;
  window.__mySidebarDecorated = true;
  let scheduled = false;
  const sweep = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorateSidebarTab();
    });
  };
  const start = () => {
    sweep();
    new MutationObserver(sweep).observe(document.body, { subtree: true, childList: true });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
}
