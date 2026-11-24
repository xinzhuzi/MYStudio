// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * PCB 连线插件兼容垫片·薄挂载(my.pcb-link.compat,11-24,任务 11-24-comfyui-pcb-link-routing)。
 *
 * 只做接线:把页面里的东西注入纯逻辑 my_pcb_link_compat_core.mjs(createPcbCompat),
 * 轮询它、暴露只读诊断句柄。为什么要有这个垫片、补的是哪两件事,见纯逻辑文件头。
 *
 * - 等 app.canvas 没有事件钩,沿用本目录的轮询写法(先例 daojie-subgraph-autofit.js):
 *   等插件挂钩期 400ms 一拍、满 150 拍放慢到 3000ms 一直等(不封顶);就绪后 2000ms 一拍
 *   (发现 app.canvas 换了新对象就补做处理);休眠即停表。
 * - 默认切到 PCB(Q1=A,一次性):仅当没激活过、且连线模式仍是出厂默认值、且设置服务可用;
 *   切换 = 写 Comfy.LinkRenderMode,再置隐藏标记 My.PcbLinkMode.Activated。用户之后在
 *   ComfyUI 设置里改回任何模式都不再覆盖。
 * - 设置服务的访问一律先判存在再用(app.extensionManager?.setting):前端升级后可能变,
 *   不支持时静默跳过。
 * - window.__myPcbLinkCompat 是只读诊断句柄,供验收探针与日后排障读
 *   (apps/build/scripts/comfyui_pcb_link_acceptance_probe.mjs;与上游 window.__pcb 同类做法)。
 */

import { app } from "/scripts/app.js";
import { createPcbCompat, resolveDefaultMode } from "./my_pcb_link_compat_core.mjs";

const MODE_SETTING = "Comfy.LinkRenderMode";
const ACTIVATED_SETTING = "My.PcbLinkMode.Activated";
/** 等插件挂钩:前 150 拍每拍 400ms(约一分钟),之后放慢到每拍 3000ms,一直等。 */
const WAIT_FAST_MS = 400;
const WAIT_FAST_TICKS = 150;
const WAIT_SLOW_MS = 3000;
/** 就绪后的巡检节拍。 */
const READY_POLL_MS = 2000;

app.registerExtension({
  name: "my.pcb-link.compat",
  settings: [
    { id: ACTIVATED_SETTING, name: "PCB 连线自动布线已启用(内部标记)", type: "hidden", defaultValue: false },
  ],
  setup() {
    const warned = new Set();
    const warnOnce = (msg, error) => {
      if (warned.has(msg)) return;
      warned.add(msg);
      console.warn("[my.pcb-link.compat] " + msg, error);
    };

    /** 默认切到 PCB;返回 { activated, mode, defaultMode, reason }。抛错交给纯逻辑侧告警一次。 */
    async function activateDefaultMode() {
      const setting = app.extensionManager?.setting;
      const settingsAvailable = Boolean(
        setting && typeof setting.get === "function" && typeof setting.set === "function",
      );
      const info = { activated: false, mode: null, defaultMode: null, reason: "settings-unavailable" };
      if (settingsAvailable) {
        info.mode = setting.get(MODE_SETTING) ?? null;
        // 取不到默认值时与 window.LiteGraph.SPLINE_LINK 比。
        info.defaultMode = (typeof setting.getDefaultValue === "function"
          ? setting.getDefaultValue(MODE_SETTING)
          : null) ?? window.LiteGraph?.SPLINE_LINK ?? null;
        info.activated = setting.get(ACTIVATED_SETTING) === true;
      }
      const decision = resolveDefaultMode({
        activated: info.activated,
        mode: info.mode,
        defaultMode: info.defaultMode,
        settingsAvailable,
      });
      info.reason = decision.reason;
      if (!decision.shouldActivate) return info;
      await setting.set(MODE_SETTING, window.__pcb.PCB());
      await setting.set(ACTIVATED_SETTING, true);
      info.activated = true;
      return info;
    }

    const compat = createPcbCompat({
      getPcb: () => window.__pcb ?? null,
      loadRegistry: () => import("/extensions/comfyui-pcb/pathing/registry.js"),
      warnOnce,
      getCanvas: () => app.canvas ?? null,
      getGraph: () => app.canvas?.graph ?? app.graph ?? null,
      activateDefaultMode,
    });

    window.__myPcbLinkCompat = {
      version: 1,
      phase: () => compat.state.phase,
      canvasInfo: compat.canvasInfo,
      aliasInfo: compat.aliasInfo,
      activation: compat.activation,
    };

    // 一拍做完才排下一拍(自排队链,同一时刻至多一个定时器);页面卸载即随之消失。
    const pump = async () => {
      let phase = compat.state.phase;
      try {
        phase = await compat.tick();
      } catch (error) {
        warnOnce("轮询出错(继续轮询)", error);
      }
      // 休眠 = 本页不再动:停表。
      if (phase === "dormant") return;
      const delay = phase === "ready"
        ? READY_POLL_MS
        : compat.state.waitTicks >= WAIT_FAST_TICKS ? WAIT_SLOW_MS : WAIT_FAST_MS;
      setTimeout(pump, delay);
    };
    setTimeout(pump, WAIT_FAST_MS);
  },
});
