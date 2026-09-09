// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// @vitest-environment jsdom
// 09-09 用户裁定:开关退役,全量生态节点常开——hook 恒真兼容层回归锁。
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMFY_ADVANCED_NODES_STORAGE_KEY,
  isComfyAdvancedNodesEnabled,
  useComfyAdvancedNodes,
} from "./use-comfy-advanced-nodes";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(COMFY_ADVANCED_NODES_STORAGE_KEY);
});

describe("useComfyAdvancedNodes(恒开兼容层,09-09 开关退役)", () => {
  it("hook 与非组件侧读取恒 true;localStorage 旧值(0/脏值)不再参与", () => {
    window.localStorage.setItem(COMFY_ADVANCED_NODES_STORAGE_KEY, "0");
    const { result } = renderHook(() => useComfyAdvancedNodes());
    expect(result.current.showAdvancedNodes).toBe(true);
    expect(isComfyAdvancedNodesEnabled()).toBe(true);
  });

  it("set/toggle 兼容保留为 no-op:不写存储、值不变", () => {
    window.localStorage.setItem(COMFY_ADVANCED_NODES_STORAGE_KEY, "0");
    const { result } = renderHook(() => useComfyAdvancedNodes());
    result.current.setAdvancedNodes(false);
    result.current.toggleAdvancedNodes();
    expect(result.current.showAdvancedNodes).toBe(true);
    expect(window.localStorage.getItem(COMFY_ADVANCED_NODES_STORAGE_KEY)).toBe("0"); // 未被改写
    expect(isComfyAdvancedNodesEnabled()).toBe(true);
  });
});
