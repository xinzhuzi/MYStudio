import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const electronMock = vi.hoisted(() => ({
  Menu: {
    getApplicationMenu: vi.fn(),
    setApplicationMenu: vi.fn(),
  },
}));

vi.mock("electron", () => electronMock);

import {
  createWebviewMenuGate,
  installWebviewKeyboardPassthrough,
  type MenuGateApi,
} from "./main-menu";

function fakeApi(): MenuGateApi {
  let current: Electron.Menu | null = { id: "default-menu" } as unknown as Electron.Menu;
  const getApplicationMenu = vi.fn((): Electron.Menu | null => current);
  const setApplicationMenu = vi.fn((menu: Electron.Menu | null) => {
    current = menu;
  });
  return { getApplicationMenu, setApplicationMenu };
}

describe("createWebviewMenuGate(ComfyUI 键盘直通焦点门)", () => {
  it("guest 获焦清空菜单,失焦恢复原菜单", () => {
    const api = fakeApi();
    const gate = createWebviewMenuGate(api);
    gate.guestFocused();
    expect(api.setApplicationMenu).toHaveBeenLastCalledWith(null);
    gate.guestUnfocused();
    expect(api.setApplicationMenu).toHaveBeenLastCalledWith({ id: "default-menu" });
  });

  it("恢复后清记:下次获焦重抓(间隙换过菜单也跟得上)", () => {
    const api = fakeApi();
    const gate = createWebviewMenuGate(api);
    gate.guestFocused();
    gate.guestUnfocused();
    api.setApplicationMenu({ id: "replaced-menu" } as unknown as Electron.Menu);
    gate.guestFocused();
    gate.guestUnfocused();
    expect(api.setApplicationMenu).toHaveBeenLastCalledWith({ id: "replaced-menu" });
  });

  it("未清空就恢复=无操作(不凭空设菜单)", () => {
    const api = fakeApi();
    const gate = createWebviewMenuGate(api);
    gate.guestUnfocused();
    expect(api.setApplicationMenu).not.toHaveBeenCalled();
  });

  it("重复获焦幂等(持续 null)", () => {
    const api = fakeApi();
    const gate = createWebviewMenuGate(api);
    gate.guestFocused();
    gate.guestFocused();
    gate.guestUnfocused();
    expect(api.setApplicationMenu).toHaveBeenCalledTimes(3);
    expect(api.setApplicationMenu).toHaveBeenLastCalledWith({ id: "default-menu" });
  });
});

describe("installWebviewKeyboardPassthrough(guest 事件接线)", () => {
  it("guest focus→null,blur/destroyed→恢复", () => {
    const api = fakeApi();
    const embedder = new EventEmitter();
    // did-attach-webview 回调签名:(event, guestWebContents)
    const guest = new EventEmitter() as unknown as Electron.WebContents;
    installWebviewKeyboardPassthrough(
      embedder as unknown as Electron.WebContents,
      api,
    );
    embedder.emit("did-attach-webview", undefined, guest);
    guest.emit("focus");
    expect(api.setApplicationMenu).toHaveBeenLastCalledWith(null);
    guest.emit("blur");
    expect(api.setApplicationMenu).toHaveBeenLastCalledWith({ id: "default-menu" });
    guest.emit("focus");
    guest.emit("destroyed");
    expect(api.setApplicationMenu).toHaveBeenLastCalledWith({ id: "default-menu" });
  });
});
