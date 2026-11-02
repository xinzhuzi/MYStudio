// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { McpSettingsTab } from "./McpSettingsTab";
import { useMcpServersStore } from "@/stores/mcp/mcp-servers-store";
import { useEnginePresetsStore } from "@/stores/settings/engine-presets-store";

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
// sonner mock(照 VideoQcSettingsSection.test 范式):⭐存为常用合法分支要断言 toast
vi.mock("sonner", () => ({ toast: toastMocks }));

// ui/select 测试替身(照 ApiSettingsContainer.test 范式):Radix Select 在 jsdom
// 需指针捕获,换常驻渲染的选项按钮+context 传 onValueChange,保住被测的真实
// 状态流(选值→一键切换→保存);importOriginal 透传其余导出兜底。
vi.mock("@/components/ui/select", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<typeof import("@/components/ui/select")>();
  const selectContext = React.createContext<{
    value: string;
    onValueChange?: (value: string) => void;
  }>({ value: "" });
  type SelectProps = { children?: React.ReactNode; value?: string; onValueChange?: (value: string) => void };
  return {
    ...actual,
    Select: ({ children, value, onValueChange }: SelectProps) => (
      <selectContext.Provider value={{ value: value ?? "", onValueChange }}>{children}</selectContext.Provider>
    ),
    SelectTrigger: ({ children }: SelectProps) => <div>{children}</div>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder ?? ""}</span>,
    SelectContent: ({ children }: SelectProps) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => {
      const context = React.useContext(selectContext);
      return (
        <button type="button" data-testid={`option-${value}`} onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

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
    // 11-02 起引擎地址行也有「测试连接」——按卡片作用域点,防同名撞车
    fireEvent.click(
      within(screen.getByTestId("mcp-server-card-本地文件")).getByRole("button", { name: /测试连接/ }),
    );

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

    fireEvent.click(
      within(screen.getByTestId("mcp-server-card-远程")).getByRole("button", { name: /测试连接/ }),
    );
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

  beforeEach(() => {
    // 11-02 起保存成功自动收藏条目——逐测复位防跨测泄漏(T17 会入列一条)
    useEnginePresetsStore.setState({ presets: [] });
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
      if (u.includes("/comfy/engine/probe")) {
        // ②引擎探活走 sidecar 服务端代理(11-02:渲染层 CSP 不放行 http+局域网 IP)
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            ok: true,
            url: "http://192.168.0.101:17000",
            comfyui_version: "0.45.1",
            device: "NVIDIA GeForce RTX 5090",
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
      // 1102 F4:成功详情入弹窗(实机 probe 数据);行内只留短确认
      expect(screen.getByTestId("remote-engine-ok").textContent).toContain("已保存并生效");
      expect(screen.getByTestId("remote-engine-ok-dialog").textContent).toContain(
        "已连通远端引擎(ComfyUI 0.45.1 · NVIDIA GeForce RTX 5090)",
      );
      expect(screen.getByTestId("remote-engine-ok-dialog").textContent).toContain("产物将自动取回");
    });
    expect(screen.getByTestId("remote-engine-ok-dialog").textContent).not.toContain("0.42.0");
    // 11-02 用户令:「当前生效」尾注撤展示——保存成功后也不再现
    expect(screen.queryByText(/当前生效/)).toBeNull();
    const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/comfy/engine/remote") && c[1]?.method === "POST");
    expect(post?.[1]?.body).toContain("192.168.0.101");
    const probe = fetchMock.mock.calls.find((c) => String(c[0]).includes("/comfy/engine/probe"));
    // 探活走 sidecar 代理(127.0.0.1:17595),不再直连引擎 IP
    expect(probe).toBeTruthy();
    // 11-02 自动收藏(Q2 双通道①):保存成功即入列——标签行见该地址
    expect(screen.getByTestId("remote-engine-presets-chips").textContent).toContain("192.168.0.101:17000");
  });

  it("测试连接(仅探活不保存):经 sidecar 代理探引擎报版本/GPU,不发 POST,文案点明未保存(11-02 用户令)", async () => {
    setComfySidecarLivenessProbeForTests(async () => true);
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/comfy/engine/probe")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            ok: true,
            url: "http://192.168.0.101:17000",
            comfyui_version: "0.42.0",
            device: "NVIDIA RTX PRO 4000",
          }),
        } as unknown as Response);
      }
      return Promise.reject(new Error("unexpected fetch " + url));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    fireEvent.change(screen.getByTestId("remote-engine-url"), { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("remote-engine-test"));
    await waitFor(() => {
      // 1102 F4:成功详情入弹窗;行内短确认
      expect(screen.getByTestId("remote-engine-ok").textContent).toContain("连接成功");
      expect(screen.getByTestId("remote-engine-ok-dialog").textContent).toContain(
        "连接成功(ComfyUI 0.42.0 · NVIDIA RTX PRO 4000)",
      );
    });
    expect(screen.getByTestId("remote-engine-ok-dialog").textContent).toContain("未保存");
    // 仅探活:绝不触发保存 POST
    const post = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/comfy/engine/remote") && c[1]?.method === "POST",
    );
    expect(post).toBeUndefined();
  });

  it("测试连接失败给直白文案(引擎未启动/地址不可达)", async () => {
    setComfySidecarLivenessProbeForTests(async () => true);
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/comfy/engine/probe")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: false, url: "http://192.168.0.101:17000", error: "Connection refused" }),
        } as unknown as Response);
      }
      return Promise.reject(new Error("unexpected fetch " + String(url)));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    fireEvent.change(screen.getByTestId("remote-engine-url"), { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("remote-engine-test"));
    await waitFor(() => {
      expect(screen.getByTestId("remote-engine-error").textContent).toContain("连接失败(http://192.168.0.101:17000)");
    });
  });

  it("全角冒号/斜杠自动归一(11-02 实弹:中文输入法输入肉眼不可辨,前缀校验恒炸格式错)", async () => {
    setComfySidecarLivenessProbeForTests(async () => true);
    let probedUrl = "";
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/comfy/engine/probe")) {
        probedUrl = u;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            ok: true,
            url: "http://192.168.0.101:17000",
            comfyui_version: "0.42.0",
            device: "NVIDIA RTX PRO 4000",
          }),
        } as unknown as Response);
      }
      return Promise.reject(new Error("unexpected fetch " + u));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    // 全角冒号+全角斜杠+尾全角斜杠混输(中文输入法典型产物)
    fireEvent.change(screen.getByTestId("remote-engine-url"), {
      target: { value: "http：／／192.168.0.101：17000／" },
    });
    fireEvent.click(screen.getByTestId("remote-engine-test"));
    await waitFor(() => {
      expect(screen.getByTestId("remote-engine-ok-dialog").textContent).toContain("连接成功(ComfyUI 0.42.0");
    });
    // F3 占位符逐字锁(用户令原文)
    expect(screen.getByTestId("remote-engine-url").getAttribute("placeholder")).toBe(
      "为空是本地引擎启动,填写URL为远端引擎启动",
    );
    // 探活请求带出的已是归一后的半角 URL
    expect(probedUrl).toContain("url=http%3A%2F%2F192.168.0.101%3A17000");
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
      if (u.includes("/comfy/engine/probe")) {
        // ②引擎未启动:sidecar 代理探活不通(ok:false)——保存本身已成功
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            ok: false,
            url: "http://192.168.0.101:17000",
            error: "<urlopen error [Errno 61] Connection refused>",
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

describe("McpSettingsTab·引擎地址常用条目(11-02 R1)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setComfySidecarLivenessProbeForTests(null);
    delete (window as unknown as { imageGenRuntime?: unknown }).imageGenRuntime;
    localStorage.clear();
  });

  beforeEach(() => {
    useEnginePresetsStore.setState({ presets: [] });
    toastMocks.success.mockClear();
    toastMocks.error.mockClear();
  });

  it("坑①回归:一键切换必传 urlOverride——手输框是 A,点下拉选 B,POST 存的是 B 非 A", async () => {
    setComfySidecarLivenessProbeForTests(async () => true);
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.102:17000", label: "192.168.0.102:17000", lastUsedAt: 1 }],
    });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = url as string;
      if (u.includes("/comfy/engine/remote") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ url: "http://192.168.0.102:17000", cleared: false }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/engine/remote")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            url: "http://192.168.0.102:17000",
            effective: "http://192.168.0.102:17000",
            source: "settings",
          }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/engine/probe")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            ok: true,
            url: "http://192.168.0.102:17000",
            comfyui_version: "0.42.0",
            device: "NVIDIA RTX PRO 4000",
          }),
        } as unknown as Response);
      }
      return Promise.reject(new Error("unexpected fetch " + u));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    // 手输框先填 A(制造旧 draft 闭包:若 handlePresetSwitch 直读 remoteDraft 就会存 A)
    fireEvent.change(screen.getByTestId("remote-engine-url"), { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("option-http://192.168.0.102:17000"));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/comfy/engine/remote") && c[1]?.method === "POST"),
      ).toBe(true);
    });
    const post = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/comfy/engine/remote") && c[1]?.method === "POST",
    ) as [string, RequestInit];
    const body = JSON.parse(String(post[1].body)) as { url: string };
    expect(body.url).toBe("http://192.168.0.102:17000");
    expect(String(post[1].body)).not.toContain("192.168.0.101");
    // 输入框同步填入所选条目(一键切换 R1.4)
    expect((screen.getByTestId("remote-engine-url") as HTMLInputElement).value).toBe("http://192.168.0.102:17000");
  });

  it("选「本机引擎」=清空保存:POST body.url 为空串(cleared),输入框清空", async () => {
    setComfySidecarLivenessProbeForTests(async () => true);
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = url as string;
      if (u.includes("/comfy/engine/remote") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ url: null, cleared: true }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/engine/remote")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            url: null,
            effective: "http://127.0.0.1:17598",
            source: "fallback",
          }),
        } as unknown as Response);
      }
      return Promise.reject(new Error("unexpected fetch " + u));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    fireEvent.change(screen.getByTestId("remote-engine-url"), { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("option-local"));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/comfy/engine/remote") && c[1]?.method === "POST"),
      ).toBe(true);
    });
    const post = fetchMock.mock.calls.find(
      (c) => String(c[0]).includes("/comfy/engine/remote") && c[1]?.method === "POST",
    ) as [string, RequestInit];
    const body = JSON.parse(String(post[1].body)) as { url: string };
    expect(body.url).toBe("");
    expect((screen.getByTestId("remote-engine-url") as HTMLInputElement).value).toBe("");
  });

  it("⭐存为常用:非法串(ftp://)给「存不了」不入列;合法串 toast+标签行即现(Q2 双通道②)", () => {
    render(<McpSettingsTab />);
    // 非法:非 http(s) 前缀,store 拒收入库,走现行 error 文案位
    fireEvent.change(screen.getByTestId("remote-engine-url"), { target: { value: "ftp://192.168.0.103:17000" } });
    fireEvent.click(screen.getByTestId("remote-engine-favorite"));
    expect(screen.getByTestId("remote-engine-error").textContent).toContain("存不了");
    expect(useEnginePresetsStore.getState().presets).toHaveLength(0);
    // 合法:未验证地址也可先存——toast+chips 即现
    cleanup();
    render(<McpSettingsTab />);
    fireEvent.change(screen.getByTestId("remote-engine-url"), { target: { value: "http://192.168.0.103:17000" } });
    fireEvent.click(screen.getByTestId("remote-engine-favorite"));
    expect(toastMocks.success).toHaveBeenCalledWith("已存入常用");
    const chips = screen.getByTestId("remote-engine-presets-chips");
    expect(chips.textContent).toContain("192.168.0.103:17000");
    expect(useEnginePresetsStore.getState().presets[0]?.url).toBe("http://192.168.0.103:17000");
  });

  it("标签行 ✕ 删除条目(G2):该条目从 chips 消失;删除当前生效条目只删条目不动引擎", () => {
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.104:17000", label: "192.168.0.104:17000", lastUsedAt: 1 }],
    });
    render(<McpSettingsTab />);
    expect(screen.getByTestId("remote-engine-presets-chips").textContent).toContain("192.168.0.104:17000");
    fireEvent.click(screen.getByRole("button", { name: "删除常用 192.168.0.104:17000" }));
    // 唯一条目删空后标签行整行消失
    expect(screen.queryByTestId("remote-engine-presets-chips")).toBeNull();
    expect(useEnginePresetsStore.getState().presets).toHaveLength(0);
  });
});
