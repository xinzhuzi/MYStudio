// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 工作流脏标守护(my-workflow-clean-guard,1007夜立):
 * 新前端里"结果挂件写入"(预览文本 serialize=true / 图片缩略图等)发生在执行回调,
 * 每跑一发就把 activeWorkflow.isModified 置真→标签挂 •,用户以为有未存改动(实际只是
 * 执行结果)。本守护:execution_start 快照"本来干净吗";execution_success/error 后
 * 若本来干净则 changeTracker.reset() 把旗放回。**用户执行前已有真未存改动(lastWasClean
 * =false)时永远不动旗**——只撤执行自身弄脏的那部分。不处理载入态(载入脏实测自愈,
 * 且载入沉降清脏会误杀草稿恢复的真改动)。
 * tracker 句柄:workflow store 的 activeWorkflow(Pinia;经 __vue_app__ 全局属性取,
 * 1007 活体实证);comfyAPI.changeTracker 只导出类不导出实例。
 */
import { app } from "/scripts/app.js";

let lastWasClean = true;
let storeCache = null;

function workflowStore() {
  if (storeCache) return storeCache;
  try {
    const root = [...document.querySelectorAll("*")].find((e) => e.__vue_app__);
    const pinia = root?.__vue_app__?._context?.config?.globalProperties?.$pinia;
    const store = pinia ? [...(pinia._s?.values?.() || [])].find((s) => s.$id === "workflow") : null;
    storeCache = store || null;
  } catch (e) { storeCache = null; }
  return storeCache;
}

function activeWorkflow() {
  try { return workflowStore()?.$state?.activeWorkflow ?? null; } catch (e) { return null; }
}

function isClean(aw) {
  try { return !aw || !aw.isModified; } catch (e) { return true; }
}

function restoreCleanIfWasClean() {
  try {
    const aw = activeWorkflow();
    if (!aw) return;
    if (!lastWasClean) return;           // 用户本来就有未存改动:不碰旗
    if (!aw.isModified) return;
    // 1007 实测定谳:isModified=普通字段(getter/setter 直通 _isModified),
    // changeTracker.reset() 只清 tracker 内部 diff 不清旗——须显式置 false(save() 同款动作)
    try { aw.changeTracker?.reset?.(); } catch (e) {}
    aw.isModified = false;
  } catch (e) { /* 守护失败=维持前端默认脏标,无副作用 */ }
}

app.registerExtension({
  name: "my.workflow.cleanGuard",
  setup() {
    const api = app.api ?? window.comfyAPI?.api?.api;
    if (!api?.addEventListener) return;
    api.addEventListener("execution_start", () => {
      lastWasClean = isClean(activeWorkflow());
    });
    // 稍等一拍:让执行尾段的结果挂件写入全部落完再放旗
    const onDone = () => setTimeout(restoreCleanIfWasClean, 1200);
    api.addEventListener("execution_success", onDone);
    api.addEventListener("execution_error", onDone);
    api.addEventListener("execution_interrupted", onDone);
  },
});
