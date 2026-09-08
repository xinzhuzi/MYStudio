// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
// 高级节点开关 hook 测试:默认关、localStorage 持久化、跨组件订阅、
// 跨窗口 storage 事件失效缓存、非组件侧读取(B 节分层开关验收面)。
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMFY_ADVANCED_NODES_STORAGE_KEY,
  isComfyAdvancedNodesEnabled,
  setComfyAdvancedNodes,
  useComfyAdvancedNodes,
} from "./use-comfy-advanced-nodes";

const STORAGE_KEY = COMFY_ADVANCED_NODES_STORAGE_KEY;

function refreshViaStorageEvent() {
  // 模拟跨窗口:直写 localStorage 后派发 storage 事件(模块级监听失效缓存)
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
}

beforeEach(() => {
  act(() => setComfyAdvancedNodes(false));
  window.localStorage.removeItem(STORAGE_KEY);
  refreshViaStorageEvent();
});

afterEach(() => {
  // vitest 未开 globals,@testing-library 不自动卸载——手动清理挂载的 hook
  cleanup();
  window.localStorage.removeItem(STORAGE_KEY);
  act(() => setComfyAdvancedNodes(false));
});

describe("useComfyAdvancedNodes(默认层/高级层开关)", () => {
  it("缺省 false(普通用户不见专家节点);读取已持久化的开启态", () => {
    const { result } = renderHook(() => useComfyAdvancedNodes());
    expect(result.current.showAdvancedNodes).toBe(false);
    // 预置已开启的存储(别的会话写下的)→ 首读即 true
    window.localStorage.setItem(STORAGE_KEY, "1");
    refreshViaStorageEvent();
    const second = renderHook(() => useComfyAdvancedNodes());
    expect(second.result.current.showAdvancedNodes).toBe(true);
  });

  it("toggle 翻转并持久化 localStorage(1/0)", () => {
    const { result } = renderHook(() => useComfyAdvancedNodes());
    act(() => result.current.toggleAdvancedNodes());
    expect(result.current.showAdvancedNodes).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
    act(() => result.current.setAdvancedNodes(false));
    expect(result.current.showAdvancedNodes).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("0");
  });

  it("跨组件订阅:两处 hook 实例同值联动(设置页与画布入口一致性)", () => {
    const a = renderHook(() => useComfyAdvancedNodes());
    const b = renderHook(() => useComfyAdvancedNodes());
    act(() => a.result.current.setAdvancedNodes(true));
    expect(b.result.current.showAdvancedNodes).toBe(true);
    act(() => b.result.current.toggleAdvancedNodes());
    expect(a.result.current.showAdvancedNodes).toBe(false);
  });

  it("卸载取消订阅不残留;非组件侧 isComfyAdvancedNodesEnabled 直读", () => {
    const { unmount } = renderHook(() => useComfyAdvancedNodes());
    unmount();
    act(() => setComfyAdvancedNodes(true));
    expect(isComfyAdvancedNodesEnabled()).toBe(true);
  });

  it("storage 事件带其它 key 不误刷;key=null(clear)也失效缓存", () => {
    act(() => setComfyAdvancedNodes(true));
    window.localStorage.setItem(STORAGE_KEY, "0");
    window.dispatchEvent(new StorageEvent("storage", { key: "other-key" }));
    expect(isComfyAdvancedNodesEnabled()).toBe(true); // 无关键不刷,缓存仍真
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(isComfyAdvancedNodesEnabled()).toBe(false); // clear 场景失效重读
  });
});
