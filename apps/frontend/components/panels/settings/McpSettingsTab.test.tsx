// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach } from "vitest";
import { McpSettingsTab } from "./McpSettingsTab";
import { useMcpServersStore } from "@/stores/mcp/mcp-servers-store";

describe("McpSettingsTab", () => {
  afterEach(() => {
    cleanup();
    delete (window as { mcpRuntime?: unknown }).mcpRuntime;
  });

  beforeEach(() => {
    useMcpServersStore.setState({ servers: [] });
  });

  it("shows the desktop-only hint when the runtime bridge is absent", () => {
    render(<McpSettingsTab />);
    expect(screen.getByText("桌面应用中可用。")).toBeTruthy();
  });

  it("owns its vertical scroll——设置页祖先链恒 overflow-hidden,tab 必须自带滚动容器", () => {
    // 回归锚:0924 范式重构后本 tab 漏挂 ScrollArea,内容超屏即整页滚不动
    const { container } = render(<McpSettingsTab />);
    const scroller = container.querySelector<HTMLElement>("div.overflow-y-auto");
    expect(scroller).toBeTruthy();
    expect(scroller?.textContent).toContain("MCP 服务");
    expect(scroller?.textContent).toContain("JSON 配置（通用格式）");
  });

  it("renders server cards and runs a successful connection test", async () => {
    useMcpServersStore.getState().addServer({
      name: "本地文件",
      transport: "stdio",
      command: "npx",
      args: ["-y", "fs-server"],
      enabled: true,
    });
    const testServer = vi.fn().mockResolvedValue({
      ok: true,
      serverName: "fs-server",
      tools: [{ name: "read_file" }, { name: "write_file" }],
    });
    (window as unknown as { mcpRuntime: unknown }).mcpRuntime = { testServer };
    render(<McpSettingsTab />);

    expect(screen.getByTestId("mcp-server-card-本地文件")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));

    await waitFor(() => {
      expect(screen.getByTestId("mcp-test-ok-本地文件").textContent).toContain("提供 2 个能力");
    });
    expect(testServer).toHaveBeenCalledWith(
      expect.objectContaining({ transport: "stdio", command: "npx", args: ["-y", "fs-server"] }),
    );
  });

  it("surfaces plain-language errors when the connection fails", async () => {
    useMcpServersStore.getState().addServer({
      name: "远程",
      transport: "http",
      url: "http://127.0.0.1:9/mcp",
      enabled: false,
    });
    const testServer = vi.fn().mockResolvedValue({ ok: false, error: "连不上这个地址，请检查服务是否在运行" });
    (window as unknown as { mcpRuntime: unknown }).mcpRuntime = { testServer };
    render(<McpSettingsTab />);

    fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));
    await waitFor(() => {
      expect(screen.getByTestId("mcp-test-err-远程").textContent).toContain("连不上这个地址");
    });
  });

  it("rejects manually adding a duplicate name (导出 JSON 名字做键,重名会静默合并)", async () => {
    useMcpServersStore.getState().addServer({
      name: "本地文件",
      transport: "stdio",
      command: "npx",
      args: ["-y", "fs-server"],
      enabled: true,
    });
    (window as unknown as { mcpRuntime: unknown }).mcpRuntime = { testServer: vi.fn() };
    render(<McpSettingsTab />);

    fireEvent.click(screen.getByTestId("mcp-add-server"));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "本地文件" } });
    fireEvent.change(screen.getByLabelText("启动命令"), { target: { value: "npx" } });
    fireEvent.click(screen.getByTestId("mcp-save-server"));

    await waitFor(() => {
      expect(screen.getByTestId("mcp-form-error").textContent).toContain("已存在同名服务器");
    });
    expect(useMcpServersStore.getState().servers).toHaveLength(1);
  });

  it("refreshes the JSON textarea after an edit that keeps the server count unchanged", async () => {
    const server = useMcpServersStore.getState().addServer({
      name: "本地文件",
      transport: "stdio",
      command: "npx",
      args: ["old-arg"],
      enabled: true,
    });
    render(<McpSettingsTab />);

    const textarea = screen.getByTestId("mcp-json-textarea") as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textarea.value).toContain("old-arg");
    });
    useMcpServersStore.getState().updateServer(server.id, { args: ["new-arg"] });
    await waitFor(() => {
      expect(textarea.value).toContain("new-arg");
    });
  });
});

describe("McpSettingsTab service connections (ComfyUI 桥移此)", () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as { imageGenRuntime?: unknown }).imageGenRuntime;
  });

  it("shows the ComfyUI bridge card with ready status when the service is up", async () => {
    (window as unknown as { imageGenRuntime: unknown }).imageGenRuntime = {
      status: vi.fn().mockResolvedValue({
        models: [{ modelName: "comfyui-bridge", downloaded: true, comfyuiVersion: "0.34.0" }],
      }),
    };
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("comfyui-bridge-ready").textContent).toContain("ComfyUI 0.34.0");
    });
  });

  it("bridge 就绪文案带上 GPU 名(10-29 T15/G3,inventory 透传 gpuName 时)", async () => {
    (window as unknown as { imageGenRuntime: unknown }).imageGenRuntime = {
      status: vi.fn().mockResolvedValue({
        models: [{ modelName: "comfyui-bridge", downloaded: true, comfyuiVersion: "0.34.0", gpuName: "Apple M3 Max" }],
      }),
    };
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("comfyui-bridge-ready").textContent).toContain("ComfyUI 0.34.0 · Apple M3 Max");
    });
  });

  it("shows the not-ready hint when ComfyUI is not running", async () => {
    (window as unknown as { imageGenRuntime: unknown }).imageGenRuntime = {
      status: vi.fn().mockResolvedValue({
        models: [{ modelName: "comfyui-bridge", downloaded: false, comfyuiVersion: null }],
      }),
    };
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("comfyui-bridge-not-ready").textContent).toContain("需 ComfyUI 正在运行");
    });
  });

  it("settles to not-ready when the inventory is unscanned (empty models) instead of probing forever", async () => {
    // 回归锚:models 空列表(未跑 python inventory)时旧行为=bridge 恒 null,永挂「探测中…」
    (window as unknown as { imageGenRuntime: unknown }).imageGenRuntime = {
      status: vi.fn().mockResolvedValue({ models: [] }),
    };
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("comfyui-bridge-not-ready").textContent).toContain("需 ComfyUI 正在运行");
    });
  });

  it("settles to not-ready when the preload bridge is absent (非桌面环境不永挂「探测中」)", async () => {
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("comfyui-bridge-not-ready").textContent).toContain("需 ComfyUI 正在运行");
    });
  });
});

import { setComfySidecarLivenessProbeForTests } from "@/lib/assist/image-studio/comfy-sidecar-bridge";

describe("McpSettingsTab·远程引擎地址行(10-29 D1)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setComfySidecarLivenessProbeForTests(null);
    delete (window as unknown as { imageGenRuntime?: unknown }).imageGenRuntime;
    localStorage.clear();
  });

  it("服务连接组渲染引擎地址行,sidecar 未运行时空态不炸", async () => {
    // getRemoteEngine 探活失败被组件静默吞——行仍在,无「当前生效」尾注
    render(<McpSettingsTab />);
    expect(screen.getByText("ComfyUI 引擎地址（远程）")).toBeTruthy();
    expect(screen.getByTestId("remote-engine-url")).toBeTruthy();
    expect(screen.queryByText(/当前生效/)).toBeNull();
  });

  it("保存即测:写 URL 走 POST /comfy/engine/remote,回读生效+system_stats 直探显示版本/GPU(10-29 T17/问题#2)", async () => {
    setComfySidecarLivenessProbeForTests(async () => true);
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = url as string;
      if (u.includes("/comfy/engine/remote") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ url: "http://192.168.0.101:17000", cleared: false }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/engine/remote")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            url: "http://192.168.0.101:17000",
            effective: "http://192.168.0.101:17000",
            source: "settings",
          }),
        } as unknown as Response);
      }
      if (u.includes("/system_stats")) {
        // ②引擎原生 API 直探(不走 controller IPC)
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            comfyui_version: "0.45.1",
            devices: [{ name: "NVIDIA GeForce RTX 5090" }],
          }),
        } as unknown as Response);
      }
      return Promise.reject(new Error("unexpected fetch " + u));
    });
    vi.stubGlobal("fetch", fetchMock);
    // controller IPC 桥行仍报旧版本——T17 探活不依赖它(system_stats 为准,防旧误报)
    (window as unknown as { imageGenRuntime: unknown }).imageGenRuntime = {
      status: () =>
        Promise.resolve({
          models: [
            { modelName: "comfyui-bridge", downloaded: true, comfyuiVersion: "0.42.0" },
          ],
        }),
    };
    render(<McpSettingsTab />);
    const input = screen.getByTestId("remote-engine-url");
    fireEvent.change(input, { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("remote-engine-save"));
    await waitFor(() => {
      expect(screen.getByTestId("remote-engine-ok").textContent).toContain(
        "已连通远端引擎(ComfyUI 0.45.1 · NVIDIA GeForce RTX 5090)——产物将自动取回",
      );
    });
    expect(screen.getByTestId("remote-engine-ok").textContent).not.toContain("0.42.0");
    expect(screen.getByText(/当前生效:http:\/\/192\.168\.0\.101:17000/)).toBeTruthy();
    const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/comfy/engine/remote") && c[1]?.method === "POST");
    expect(post?.[1]?.body).toContain("192.168.0.101");
    const probe = fetchMock.mock.calls.find((c) => String(c[0]).includes("/system_stats"));
    expect(String(probe?.[0])).toBe("http://192.168.0.101:17000/system_stats");
  });

  it("非法 URL 保存失败给大白话", async () => {
    setComfySidecarLivenessProbeForTests(async () => true);
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("/comfy/engine/remote") && init?.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: { message: "引擎地址须为 http(s)://主机[:端口] 形态(如 http://192.168.0.101:17000)" } }),
        } as unknown as Response);
      }
      if (String(url).includes("/status")) {
        return Promise.resolve({ ok: true, status: 200 } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    fireEvent.change(screen.getByTestId("remote-engine-url"), { target: { value: "192.168.0.101" } });
    fireEvent.click(screen.getByTestId("remote-engine-save"));
    await waitFor(() => {
      expect(screen.getByTestId("remote-engine-error").textContent).toContain("http(s)");
    });
  });

  it("sidecar 探活 false 时保存给出指路文案(10-29 T9/G8:与桥 sidecarLikelyUp 同源)", async () => {
    // 探活 false → 桥不发 fetch 直接抛指路;设置页 catch 原样给同源文案
    setComfySidecarLivenessProbeForTests(async () => false);
    render(<McpSettingsTab />);
    fireEvent.change(screen.getByTestId("remote-engine-url"), { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("remote-engine-save"));
    await waitFor(() => {
      expect(screen.getByTestId("remote-engine-error").textContent).toContain("本地生图服务未运行");
    });
    expect(screen.getByTestId("remote-engine-error").textContent).toContain("设置→本地配置");
    // 10-29 问题#4:指路文案与本地配置页真实按钮(PluginSettingsTab)逐字对齐
    expect(screen.getByTestId("remote-engine-error").textContent).toContain("『按优先级准备基础运行时』");
  });

  it("①通②不通:回读已生效但引擎直探失败——诚实降级文案,不再误报「暂未探活成功」(10-29 T17/问题#2)", async () => {
    setComfySidecarLivenessProbeForTests(async () => true);
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = url as string;
      if (u.includes("/comfy/engine/remote") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ url: "http://192.168.0.101:17000", cleared: false }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/engine/remote")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            url: "http://192.168.0.101:17000",
            effective: "http://192.168.0.101:17000",
            source: "settings",
          }),
        } as unknown as Response);
      }
      if (u.includes("/system_stats")) {
        // ②引擎未启动:连接拒绝(fetch reject)——保存本身已成功
        return Promise.reject(new TypeError("fetch failed"));
      }
      return Promise.reject(new Error("unexpected fetch " + u));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    fireEvent.change(screen.getByTestId("remote-engine-url"), { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("remote-engine-save"));
    await waitFor(() => {
      expect(screen.getByTestId("remote-engine-ok").textContent).toContain(
        "已保存并生效(http://192.168.0.101:17000),引擎探活暂不可达(引擎可能未启动)",
      );
    });
    expect(screen.getByTestId("remote-engine-ok").textContent).not.toContain("暂未探活成功");
  });

  it("保存生效但回读 source 非 settings:走 error 文案(T17 ①校验失败兜底)", async () => {
    setComfySidecarLivenessProbeForTests(async () => true);
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = url as string;
      if (u.includes("/comfy/engine/remote") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ url: "http://192.168.0.101:17000", cleared: false }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/engine/remote")) {
        // ①回读:来源仍是 env(保存未生效形态)
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            url: "http://192.168.0.101:17000",
            effective: "http://127.0.0.1:17598",
            source: "env",
          }),
        } as unknown as Response);
      }
      return Promise.reject(new Error("unexpected fetch " + u));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    fireEvent.change(screen.getByTestId("remote-engine-url"), { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("remote-engine-save"));
    await waitFor(() => {
      expect(screen.getByTestId("remote-engine-error").textContent).toContain("保存后回读校验失败");
    });
  });
});
