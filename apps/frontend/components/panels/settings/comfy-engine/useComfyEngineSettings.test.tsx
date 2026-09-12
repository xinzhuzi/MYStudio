// @vitest-environment jsdom

// useComfyEngineSettings hook 测试:注入 mock client,验证挂载一次性探测、
// 安装任务轮询到终结(不常驻轮询)、任务收尾刷新状态、无桥降级。

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockComfyEngineClient } from "./mock-comfy-engine-client";
import { useComfyEngineSettings } from "./useComfyEngineSettings";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderEngine(client: ReturnType<typeof createMockComfyEngineClient>) {
  return renderHook(() => useComfyEngineSettings({ client, pollIntervalMs: 5 }));
}

describe("useComfyEngineSettings", () => {
  it("挂载一次性探测状态与插件清单", async () => {
    const client = createMockComfyEngineClient();
    const { result } = renderEngine(client);

    await waitFor(() => expect(result.current.status?.state).toBe("not-installed"));
    expect(result.current.plugins.length).toBeGreaterThan(0);
  });

  it("挂载探测失败后 refreshStatus 补探可恢复(引擎卡胶囊重探数据面)", async () => {
    // 09-08 加固④配套:sidecar 未起时挂载探测静默失败,胶囊停在「检查中」;
    // 上层在 sidecar 就绪后调一次 refreshStatus 必须能拿到状态(不缓存失败)。
    const base = createMockComfyEngineClient();
    let failNextStatus = true;
    const client = {
      ...base,
      getEngineStatus: async () => {
        if (failNextStatus) {
          failNextStatus = false;
          throw new Error("sidecar 未起");
        }
        return base.getEngineStatus();
      },
    };
    const { result } = renderHook(() => useComfyEngineSettings({ client, pollIntervalMs: 5 }));

    await waitFor(() => expect(failNextStatus).toBe(false));
    expect(result.current.status).toBeNull(); // 探测失败保持 null(连旧快照都没有)

    await act(async () => {
      await result.current.refreshStatus();
    });
    expect(result.current.status?.state).toBe("not-installed"); // 补探成功就就位
  });

  it("挂载探测失败后有界重试自动恢复(不再永转「正在确认引擎状态」)", async () => {
    // 09-10 下午实弹根修:初次探测赶在 prepare 拉起 sidecar 前失败时,
    // 原实现无重试,引擎卡永转;现在 status 为空期间按间隔自动补探,拿到即停。
    const base = createMockComfyEngineClient();
    let failures = 2; // 前 2 次探测失败,第 3 次成功(模拟 sidecar 冷启动就绪)
    const client = {
      ...base,
      getEngineStatus: async () => {
        if (failures > 0) {
          failures -= 1;
          throw new Error("sidecar 未起");
        }
        return base.getEngineStatus();
      },
    };
    const { result } = renderHook(() =>
      useComfyEngineSettings({ client, pollIntervalMs: 5, statusRetryIntervalMs: 5 }),
    );

    // 不调任何手动刷新:挂载探测失败 → 有界重试 → 状态自动就位
    await waitFor(() => expect(result.current.status?.state).toBe("not-installed"), { timeout: 3000 });
    expect(failures).toBe(0); // 确实经过了失败后的自动补探
  });

  it("插件清单挂载失败后随有界重试自动补拉(不再恒「已装 0 个」)", async () => {
    // 09-10 晚实弹:装机版新启首进设置页,listPlugins 赶在 sidecar 就绪前失败,
    // 原实现清单零重试,整场会话恒「已装 0 个」;现在与状态共用重试通道。
    const base = createMockComfyEngineClient();
    let failures = 2; // 清单前 2 次失败,第 3 次成功(状态首探即成功,不牵扯)
    const client = {
      ...base,
      listPlugins: async () => {
        if (failures > 0) {
          failures -= 1;
          throw new Error("sidecar 未起");
        }
        return base.listPlugins();
      },
    };
    const { result } = renderHook(() =>
      useComfyEngineSettings({ client, pollIntervalMs: 5, statusRetryIntervalMs: 5 }),
    );

    // 不调任何手动刷新:挂载探测失败 → 有界重试只为清单继续跑 → 自动就位
    await waitFor(() => expect(result.current.plugins.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(failures).toBe(0);
  });

  it("启动撞上「sidecar 恰好死着」:prepare 自愈后补试一次成功(09-11 P3)", async () => {
    const base = createMockComfyEngineClient({
      initialStatus: { installed: true, state: "ready", version: "0.34.0", port: 17599 },
    });
    let down = true;
    const client = {
      ...base,
      startEngine: async () => {
        if (down) {
          down = false;
          throw new Error("本地生图服务未运行,请先在 设置→本地配置 完成「准备运行时」");
        }
        return base.startEngine();
      },
    };
    const prepare = vi.fn();
    (window as { imageGenRuntime?: unknown }).imageGenRuntime = { prepare };
    const { result } = renderHook(() =>
      useComfyEngineSettings({ client, pollIntervalMs: 5, sidecarHealWaitMs: 1 }),
    );

    await act(async () => {
      await result.current.startService();
    });
    expect(prepare).toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith("ComfyUI 引擎服务已启动");
    await waitFor(() => expect(result.current.status?.serviceRunning).toBe(true));
    delete (window as { imageGenRuntime?: unknown }).imageGenRuntime;
  });

  it("启动失败非「服务不在」类:不补试,如实报原错误", async () => {
    const base = createMockComfyEngineClient({
      initialStatus: { installed: true, state: "ready", version: "0.34.0", port: 17599 },
    });
    let calls = 0;
    const client = {
      ...base,
      startEngine: async () => {
        calls += 1;
        throw new Error("引擎正被另一个漫影进程管理");
      },
    };
    const prepare = vi.fn();
    (window as { imageGenRuntime?: unknown }).imageGenRuntime = { prepare };
    const { result } = renderHook(() =>
      useComfyEngineSettings({ client, pollIntervalMs: 5, sidecarHealWaitMs: 1 }),
    );

    await act(async () => {
      await result.current.startService();
    });
    expect(calls).toBe(1); // 没有第二次尝试(挂载效应的 prepare 与补试无关,不作为判据)
    expect(toasts.error).toHaveBeenCalledWith("引擎正被另一个漫影进程管理");
    delete (window as { imageGenRuntime?: unknown }).imageGenRuntime;
  });

  it("任务轮询在途时并发第二个任务被明拒(轮询槽不再被顶掉;09-11 P3)", async () => {
    const client = createMockComfyEngineClient({
      initialStatus: { installed: true, state: "ready", version: "0.34.0", port: 17599, updateAvailable: true },
    });
    // 轮询间隔放大:保证第二个任务发起时第一个仍在轮询(确定性)
    const { result } = renderHook(() => useComfyEngineSettings({ client, pollIntervalMs: 300 }));

    await act(async () => {
      await result.current.updateEngine();
    });
    expect(result.current.activeJob?.state).toBe("running");

    await act(async () => {
      await result.current.updateEngine(); // 轮询在途的并发任务
    });
    expect(toasts.error).toHaveBeenCalledWith("已有任务在进行中,请等它完成再操作");

    // 原任务的轮询没有被顶掉,照常推进到终结
    await waitFor(() => expect(result.current.activeJob?.state).toBe("succeeded"), { timeout: 4000 });
  });

  it("无桥时 hasBridge=false,动作点按给大白话错误不抛异常", async () => {
    const { result } = renderHook(() => useComfyEngineSettings({ client: undefined }));
    expect(result.current.hasBridge).toBe(false);

    await act(async () => {
      await result.current.installEngine();
    });
    expect(toasts.error).toHaveBeenCalledWith("ComfyUI 引擎配置仅在桌面应用中可用");
  });

  it("安装任务:轮询推进到成功,状态翻为就绪且停止轮询", async () => {
    const client = createMockComfyEngineClient();
    const { result } = renderEngine(client);

    await act(async () => {
      await result.current.installEngine();
    });
    // job 启动后 activeJob 为 running,阶段文案来自任务
    expect(result.current.activeJob?.state).toBe("running");

    await waitFor(() => expect(result.current.status?.state).toBe("ready"), { timeout: 3000 });
    expect(result.current.status?.installed).toBe(true);
    expect(result.current.activeJob?.state).toBe("succeeded");
    expect(toasts.success).toHaveBeenCalledWith("ComfyUI 引擎安装完成");
  });

  it("检查更新发现新版 → 状态标记可更新(行胶囊数据源)", async () => {
    const client = createMockComfyEngineClient({
      initialStatus: { installed: true, state: "ready", version: "0.34.0", port: 17599 },
    });
    const { result } = renderEngine(client);

    await act(async () => {
      await result.current.checkUpdate();
    });
    expect(result.current.updateCheck?.updateAvailable).toBe(true);
    expect(result.current.status?.updateAvailable).toBe(true);
  });

  it("更新链成功:收尾出更新报告(不兼容点名)且版本刷新", async () => {
    const client = createMockComfyEngineClient({
      initialStatus: { installed: true, state: "ready", version: "0.34.0", port: 17599 },
    });
    const { result } = renderEngine(client);

    await act(async () => {
      await result.current.updateEngine();
    });
    await waitFor(() => expect(result.current.updateReport).not.toBeNull(), { timeout: 3000 });
    expect(result.current.updateReport?.incompatiblePlugins).toEqual(["图层样式"]);
    expect(result.current.status?.version).toBe("0.34.5");
    expect(toasts.success).toHaveBeenCalledWith("引擎已更新到 0.34.5");
  });

  it("更新失败:错误大白话 + 状态刷新,回滚恢复", async () => {
    const client = createMockComfyEngineClient({
      failUpdate: true,
      initialStatus: { installed: true, state: "ready", version: "0.34.0", port: 17599 },
    });
    const { result } = renderEngine(client);

    await act(async () => {
      await result.current.updateEngine();
    });
    await waitFor(() => expect(result.current.activeJob?.state).toBe("failed"), { timeout: 3000 });
    expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining("校验没通过"));

    await act(async () => {
      await result.current.rollbackUpdate();
    });
    expect(toasts.success).toHaveBeenCalledWith("已回滚到更新前快照");
  });

  it("插件安装任务收尾刷新插件清单并出新增节点报告", async () => {
    const client = createMockComfyEngineClient();
    const { result } = renderEngine(client);

    await act(async () => {
      await result.current.installPlugin("curated", "rgthree");
    });
    await waitFor(() => expect(result.current.pluginInstallReport).not.toBeNull(), { timeout: 3000 });
    expect(result.current.pluginInstallReport?.addedNodeCount).toBeGreaterThan(0);
    expect(
      result.current.plugins.find((plugin) => plugin.id === "rgthree")?.state,
    ).toBe("installed");
  });

  it("卸载插件走引用扫描后清理清单", async () => {
    const client = createMockComfyEngineClient();
    const { result } = renderEngine(client);

    await act(async () => {
      await result.current.installPlugin("curated", "rgthree");
    });
    await waitFor(
      () => expect(result.current.plugins.find((plugin) => plugin.id === "rgthree")?.state).toBe("installed"),
      { timeout: 3000 },
    );

    const usage = await result.current.getPluginUsage("rgthree");
    expect(usage?.workflows.length).toBeGreaterThan(0);

    await act(async () => {
      await result.current.uninstallPlugin("rgthree");
    });
    expect(
      result.current.plugins.find((plugin) => plugin.id === "rgthree")?.state,
    ).toBe("installable");
  });
});
