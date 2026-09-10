// @vitest-environment jsdom

// 回归测试(09-10 自刷新循环根修):装机真实路径没有 preload 注入,client 走
// getComfyEngineClient() 的 HTTP 回落——该工厂每次调用都返回新实例。若 hook 每
// render 都取新 client,所有 [client] 回调与挂载效应会退化成每 render 重跑,形成
// 状态/插件/模型清单无限自刷新(本地配置模型页 195 件清单来回切页狂刷不止)。
// 铁律:client 每挂载只取一次,跨渲染身份稳定(照 ComfyCanvasStudio 同款修法)。

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockComfyEngineClient } from "./mock-comfy-engine-client";
import { useComfyEngineSettings } from "./useComfyEngineSettings";

const getComfyEngineClient = vi.hoisted(() => vi.fn());
vi.mock("./comfy-engine-contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./comfy-engine-contract")>();
  return { ...actual, getComfyEngineClient };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useComfyEngineSettings client 稳定性", () => {
  it("HTTP 回落每次返回新 client:挂载探测只做一次,重渲染不再自刷新", async () => {
    const statusSpies: Array<{ mock: { calls: unknown[] } }> = [];
    getComfyEngineClient.mockImplementation(() => {
      const base = createMockComfyEngineClient();
      const original = base.getEngineStatus.bind(base);
      const spy = vi.fn(original);
      base.getEngineStatus = spy;
      statusSpies.push(spy);
      return base;
    });

    const { result, rerender } = renderHook(() => useComfyEngineSettings({ pollIntervalMs: 5 }));

    await waitFor(() => expect(result.current.status?.state).toBe("not-installed"));
    // 连续重渲染:旧代码在此每 render 都新建 client → 挂载效应重跑 → 反复探测
    rerender();
    rerender();
    rerender();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(getComfyEngineClient).toHaveBeenCalledTimes(1);
    const totalProbes = statusSpies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    expect(totalProbes).toBe(1);
  });
});
