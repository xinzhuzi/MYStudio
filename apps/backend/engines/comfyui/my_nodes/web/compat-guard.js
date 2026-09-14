// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { app } from "/scripts/app.js";

/**
 * 渲染与数据兼容守卫(compat-guard 模块,09-13 模块拆分):
 * ①VueNodes 旗帜关回;②模板清单按模块过滤+userdata 工作流树剔分镜
 * (策略单源 my_module_policy.js)+预取竞态重取。
 */

import { myScope } from "./theme.js";
import { filterUserDataWorkflowEntriesDropMy, isUserDataWorkflowListUrl } from "./my_module_policy.js";

// 渲染兼容守卫(09-12 真跑根修):ComfyUI 前端的 Vue 节点渲染模式
// (Comfy.VueNodes.Enabled,测试期特性)会让 litegraph 的 drawNode 提前返回,
// onDrawBackground 自定义绘制整体失效——漫影环节节点的富内容/镜子缩略图全灭
// (所有依赖画布自绘的社区扩展同样中招)。漫影托管引擎须恒走经典画布渲染:
// 发现被开启即关回 ComfyUI 出厂默认 false,一次重载生效;sessionStorage 防循环。
app.registerExtension({
  name: "my.render.compat",
  async setup() {
    try {
      const settings = app.ui?.settings;
      if (typeof settings?.getSettingValue !== "function") return;
      const key = "Comfy.VueNodes.Enabled";
      if ((await settings.getSettingValue(key)) !== true) return;
      if (sessionStorage.getItem("__myVueNodesGuarded") === "1") return;
      sessionStorage.setItem("__myVueNodesGuarded", "1");
      if (typeof settings.setSettingValueAsync === "function") {
        await settings.setSettingValueAsync(key, false);
      } else {
        settings.setSettingValue(key, false);
      }
      location.reload();
    } catch {
      // 设置面不可用(旧版前端)=经典渲染本就是默认,无动作
    }
  },
});

// ── 工作流模块模板数据过滤(09-11 用户裁定:分类按当前模块展示)──────────────
// 工作流模块(myScope=workflow)的工作流浏览/搜索只出现漫影库:官方核心
// 模板清单(/templates/index*.json,fileURL 无前缀)与自定义模板清单
// (/api/workflow_templates,apiURL 带 /api)响应置空;本地模型模块与外部
// 直访不装过滤(全量)。纯外挂数据层过滤:不改 ComfyUI 原生 UI/DOM;桥请求
// (BRIDGE_URL 绝对地址)与缩略图(/api/workflow_templates/<路径>)不匹配,
// 天然不受影响。幂等:每页面加载只装一次。
(function installTemplateScopeFilter() {
  if (window.__myTplScope) return;
  window.__myTplScope = true;
  const scope = myScope();
  const originalFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (scope === "workflow") {
      // 工作流模块=漫影库单源:官方核心/自定义模板清单置空(原行为)
      if (/^\/templates\/index(\.[A-Za-z-]+)?\.json(\?|$)/.test(url)) {
        return Promise.resolve(new Response("[]", { headers: { "Content-Type": "application/json" } }));
      }
      if (/^\/api\/workflow_templates(\?|$)/.test(url)) {
        return Promise.resolve(new Response("{}", { headers: { "Content-Type": "application/json" } }));
      }
    }
    if (isUserDataWorkflowListUrl(url)) {
      // 09-14 用户裁定(终版):ComfyUI 工作流与漫影模块是两套逻辑——原生
      // 工作流浏览器属于 ComfyUI 本身的功能,其文件夹树永不包含漫影(漫影
      // 工作流单独属于漫影侧栏,侧栏走桥接口天然不受影响)。过滤无条件生效:
      // 任何模块/直访入口进来都剔「漫影/」根(策略单源 my_module_policy.js;
      // v1 数组/v2 items 两形态;剔漫影=旧剔分镜超集)
      return originalFetch(input, init).then(async (response) => {
        try {
          const body = await response.clone().json();
          const pass = (entries) => filterUserDataWorkflowEntriesDropMy(entries);
          let patched = null;
          if (Array.isArray(body)) {
            patched = pass(body);
          } else if (body && Array.isArray(body.items)) {
            patched = { ...body, items: pass(body.items) };
          }
          if (patched === null) return response;
          return new Response(JSON.stringify(patched), {
            status: response.status,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          return response; // 解析失败=原样直通(过滤面永不制造故障)
        }
      });
    }
    return originalFetch(input, init);
  };
  if (scope === "models") void reindexWorkflowsOnce(0);
})();

// 启动竞态补刀(09-13 实弹根修):工作流树的**首次预取**发生在扩展装载之前
// (fetch 补丁未及就位),预取缓存带着分镜条目——原生浏览器首开仍见分镜
// (persistedWorkflows=143,实弹复现)。补丁就位后经官方 workflow store 的
// syncWorkflows() 重取一次(实弹验证:143→62、分镜归零),首开即过滤后的
// 世界。纯数据面刷新零 DOM 干预;window.app 异步赋值→轮询等服,拿不到=
// 静默放弃(与主线路同款)。loadWorkflows() 不触网(只重排本地索引),勿换。
async function reindexWorkflowsOnce(attempt) {
  const svc = window.app?.extensionManager?.workflow;
  if (!svc || typeof svc.syncWorkflows !== "function") {
    if (attempt < 40) setTimeout(() => void reindexWorkflowsOnce(attempt + 1), 500);
    return;
  }
  try { await svc.syncWorkflows(); } catch (error) { /* 重取失败:保持预取态,刷新钮兜底 */ }
}
