// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * main.ts 菜单簇(09-12 ComfyUI 键盘直通)——webview guest 获焦时清空应用
 * 菜单,失焦/销毁时恢复。
 *
 * 根因:应用从未定制菜单,macOS 上跑的是 Electron 默认菜单,其 Edit/File/View
 * 角色(Cmd+Z/C/X/V/A、Cmd+O、Cmd+R、Cmd+=/-…)是窗口级 accelerator,会在
 * guest 页面收到 keydown 之前截胡——ComfyUI 画布的撤销/复制/粘贴/全选/打开
 * 等快捷键集体失效(不冲突的键如 Cmd+Enter/Delete 正常,所以感觉「有些」失效)。
 *
 * 修法(09-12 用户裁定:ComfyUI 界面在场,键盘/手势全部用 ComfyUI 自己的):
 * guest 获焦 → setApplicationMenu(null)(零 accelerator,键盘整把透传);
 * guest 失焦/销毁(点回宿主 chrome/悬浮球/离开画布视图)→ 恢复此前菜单。
 * 悬浮球层序契约不变(z-40 恒高于 webview):点球=焦点回宿主,菜单随之恢复,
 * 跳转入口始终最顶一级。
 */
import { Menu, type WebContents } from "electron";

/** 菜单门接口(默认 Menu 实现;测试注入假体)。 */
export interface MenuGateApi {
  getApplicationMenu: () => Electron.Menu | null;
  setApplicationMenu: (menu: Electron.Menu | null) => void;
}

/**
 * 焦点门:首次清空前抓存当前菜单;恢复后清记,下次获焦重抓(菜单若在
 * 间隙被换过也跟得上)。重复 focus 幂等(再次置 null 无副作用);未清空过
 * 就恢复=无操作(不凭空设菜单)。
 */
export function createWebviewMenuGate(api: MenuGateApi) {
  let saved: Electron.Menu | null | undefined;
  return {
    guestFocused() {
      if (saved === undefined) saved = api.getApplicationMenu();
      api.setApplicationMenu(null);
    },
    guestUnfocused() {
      if (saved === undefined) return;
      api.setApplicationMenu(saved);
      saved = undefined;
    },
  };
}

/** 挂到主窗口 webContents:每个 attach 进来的 webview guest 都接焦点门。 */
export function installWebviewKeyboardPassthrough(
  webContents: WebContents,
  api: MenuGateApi = Menu,
) {
  const gate = createWebviewMenuGate(api);
  webContents.on("did-attach-webview", (_event, guest) => {
    guest.on("focus", () => gate.guestFocused());
    const restore = () => gate.guestUnfocused();
    guest.on("blur", restore);
    // 视图切走时 guest 直接销毁可能不派发 blur:销毁兜底恢复,防菜单悬空为 null
    guest.once("destroyed", restore);
  });
}
