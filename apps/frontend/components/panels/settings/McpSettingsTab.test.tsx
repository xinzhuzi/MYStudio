// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { McpSettingsTab } from "./McpSettingsTab";
import { useMcpServersStore } from "@/stores/mcp/mcp-servers-store";
import { useEnginePresetsStore } from "@/stores/settings/engine-presets-store";
import { setComfySidecarLivenessProbeForTests } from "@/lib/assist/image-studio/comfy-sidecar-bridge";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { useWorkflowBindingsStore, resolveBoundTemplateForGeneration, isBindableWorkflow } from "@/stores/settings/workflow-bindings-store";

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

// (1102 控制中心役)原桥接状态灯五测随灯收编退役:桥行撤状态段,能力随当前
// 生效引擎(双卡统一探活);专业流/道劫型设置仍在该行,由设置类测试覆盖。

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
    expect(screen.getByTestId("engine-device-local")).toBeTruthy();
    expect(screen.getByTestId("engine-device-add")).toBeTruthy();
    // 1102 控制中心:双卡徽标「当前生效」恒恰一张卡(旧尾注已撤,此断言改口径)
    expect(screen.getAllByText(/当前生效/)).toHaveLength(1);
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
    fireEvent.click(screen.getByTestId("engine-device-add"));
    fireEvent.change(screen.getByTestId("engine-device-add-url"), { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("engine-device-add-save"));
    await waitFor(() => {
      // 1102 F4 终态:成功=弹窗即全部,行内不再有提示(用户令)
      expect(screen.getByTestId("remote-engine-ok-dialog").textContent).toContain(
        "已连通远端引擎(ComfyUI 0.45.1 · NVIDIA GeForce RTX 5090)",
      );
      expect(screen.getByTestId("remote-engine-ok-dialog").textContent).toContain("产物将自动取回");
    });
    expect(screen.queryByTestId("remote-engine-ok")).toBeNull();
    expect(screen.getByTestId("remote-engine-ok-dialog").textContent).not.toContain("0.42.0");
    // 11-02 用户令:「当前生效」尾注撤展示——保存成功后也不再现
    // 1102 控制中心:双卡徽标「当前生效」恒恰一张卡(旧尾注已撤,此断言改口径)
    expect(screen.getAllByText(/当前生效/)).toHaveLength(1);
    const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/comfy/engine/remote") && c[1]?.method === "POST");
    expect(post?.[1]?.body).toContain("192.168.0.101");
    const probe = fetchMock.mock.calls.find((c) => String(c[0]).includes("/comfy/engine/probe"));
    // 探活走 sidecar 代理(127.0.0.1:17595),不再直连引擎 IP
    expect(probe).toBeTruthy();
    // 11-02 自动收藏(Q2 双通道①):保存成功即入列——标签行见该地址
    expect(screen.getByTestId("engine-devices-list").textContent).toContain("192.168.0.101:17000");
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
        fireEvent.click(screen.getByTestId("engine-device-add"));
    fireEvent.change(screen.getByTestId("engine-device-add-url"), { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("engine-device-add-test"));
    await waitFor(() => {
      // 1102 F4 终态:成功=弹窗即全部,行内不再有提示(用户令)
      expect(screen.getByTestId("remote-engine-ok-dialog").textContent).toContain(
        "连接成功(ComfyUI 0.42.0 · NVIDIA RTX PRO 4000)",
      );
    });
    expect(screen.getByTestId("remote-engine-ok-dialog").textContent).toContain("未保存");
    expect(screen.queryByTestId("remote-engine-ok")).toBeNull();
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
        fireEvent.click(screen.getByTestId("engine-device-add"));
    fireEvent.change(screen.getByTestId("engine-device-add-url"), { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("engine-device-add-test"));
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
        fireEvent.click(screen.getByTestId("engine-device-add"));
    fireEvent.change(screen.getByTestId("engine-device-add-url"), { target: { value: "http：／／192.168.0.101：17000／" } });
    fireEvent.click(screen.getByTestId("engine-device-add-test"));
    await waitFor(() => {
      expect(screen.getByTestId("remote-engine-ok-dialog").textContent).toContain("连接成功(ComfyUI 0.42.0");
    });
    // F3 占位符逐字锁(用户令原文)
    expect(screen.getByTestId("engine-device-add-url").getAttribute("placeholder")).toBe(
      "http://192.168.x.x:17000(全角：／自动归一)",
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
        fireEvent.click(screen.getByTestId("engine-device-add"));
    fireEvent.change(screen.getByTestId("engine-device-add-url"), { target: { value: "192.168.0.101" } });
    fireEvent.click(screen.getByTestId("engine-device-add-save"));
    await waitFor(() => {
      expect(screen.getByTestId("remote-engine-error").textContent).toContain("http(s)");
    });
  });

  it("sidecar 探活 false 时保存给出指路文案(10-29 T9/G8:与桥 sidecarLikelyUp 同源)", async () => {
    // 探活 false → 桥不发 fetch 直接抛指路;设置页 catch 原样给同源文案
    setComfySidecarLivenessProbeForTests(async () => false);
    render(<McpSettingsTab />);
        fireEvent.click(screen.getByTestId("engine-device-add"));
    fireEvent.change(screen.getByTestId("engine-device-add-url"), { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("engine-device-add-save"));
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
        fireEvent.click(screen.getByTestId("engine-device-add"));
    fireEvent.change(screen.getByTestId("engine-device-add-url"), { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("engine-device-add-save"));
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
        fireEvent.click(screen.getByTestId("engine-device-add"));
    fireEvent.change(screen.getByTestId("engine-device-add-url"), { target: { value: "http://192.168.0.101:17000" } });
    fireEvent.click(screen.getByTestId("engine-device-add-save"));
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
    // 点 .102 设备行激活(activateDevice 直传该行 url,闭包陷阱面已随 draft 输入框退役)
    fireEvent.click(
      screen.getAllByTestId("engine-device-remote-select").find((b) => b.dataset.url === "http://192.168.0.102:17000")!,
    );
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
    // 设备行选中态翻转(一键切换 R1.4 新口径)
    expect(
      screen.getAllByTestId("engine-device-remote-select").find((b) => b.dataset.url === "http://192.168.0.102:17000")!.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("点本机设备行=清空保存:POST body.url 为空串(cleared),本机行转选中", async () => {
    setComfySidecarLivenessProbeForTests(async () => true);
    let current: string | null = "http://192.168.0.101:17000"; // 先远端生效,点本机才有切换可发
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = url as string;
      if (u.includes("/comfy/engine/remote")) {
        if (init?.method === "POST") {
          current = (JSON.parse(String(init.body)) as { url?: string }).url || null;
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(
            current
              ? { url: current, effective: current, source: "settings" }
              : { url: null, effective: "http://127.0.0.1:17598", source: "fallback" },
          ),
        } as unknown as Response);
      }
      return Promise.reject(new Error("unexpected fetch " + u));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-local-select").getAttribute("aria-checked")).toBe("false");
    });
    fireEvent.click(screen.getByTestId("engine-device-local-select"));
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
    expect(screen.getByTestId("engine-device-local-select").getAttribute("aria-checked")).toBe("true");
  });

  it("添加设备:非法串(ftp://)客户端拦「地址格式不对」不入列;合法串保存生效即入列(Q2 意图在设备列表语义下的延续)", async () => {
    render(<McpSettingsTab />);
    fireEvent.click(screen.getByTestId("engine-device-add"));
    fireEvent.change(screen.getByTestId("engine-device-add-url"), { target: { value: "ftp://192.168.0.103:17000" } });
    fireEvent.click(screen.getByTestId("engine-device-add-save"));
    expect(screen.getByTestId("remote-engine-error").textContent).toContain("地址格式不对");
    expect(useEnginePresetsStore.getState().presets).toHaveLength(0);
    // 合法:保存生效即自动入列(引擎探不到也照样入列=未验证地址可先存意图)
    cleanup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/comfy/engine/remote")) {
        if (init?.method === "POST") {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ url: "http://192.168.0.103:17000", cleared: false }) } as unknown as Response);
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ url: "http://192.168.0.103:17000", effective: "http://192.168.0.103:17000", source: "settings" }) } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    setComfySidecarLivenessProbeForTests(async () => true);
    render(<McpSettingsTab />);
    fireEvent.click(screen.getByTestId("engine-device-add"));
    fireEvent.change(screen.getByTestId("engine-device-add-url"), { target: { value: "http://192.168.0.103:17000" } });
    fireEvent.click(screen.getByTestId("engine-device-add-save"));
    await waitFor(() => {
      expect(useEnginePresetsStore.getState().presets[0]?.url).toBe("http://192.168.0.103:17000");
    });
    expect(screen.getByTestId("engine-devices-list").textContent).toContain("192.168.0.103:17000");
  });

  it("设备行删除:条目从列表消失;删除设备不动引擎(本机恒生效,徽标恒恰一)", () => {
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.104:17000", label: "192.168.0.104:17000", lastUsedAt: 1 }],
    });
    render(<McpSettingsTab />);
    expect(screen.getByTestId("engine-devices-list").textContent).toContain("192.168.0.104:17000");
    fireEvent.click(screen.getByTestId("engine-device-delete"));
    expect(useEnginePresetsStore.getState().presets).toHaveLength(0);
    expect(screen.queryByText("192.168.0.104:17000")).toBeNull();
    expect(screen.getAllByText(/当前生效/)).toHaveLength(1);
    expect(screen.getByTestId("engine-device-local-select").getAttribute("aria-checked")).toBe("true");
  });
});

describe("McpSettingsTab·引擎与产线控制中心(11-02 hub)", () => {
  beforeEach(() => {
    useAppSettingsStore.setState({ imageGenerationSettings: { ...useAppSettingsStore.getState().imageGenerationSettings, defaultImageModel: "" } });
    useWorkflowBindingsStore.setState({ t2iWorkflowId: null, i2iWorkflowId: null });
    setComfySidecarLivenessProbeForTests(async () => true);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setComfySidecarLivenessProbeForTests(null);
    useWorkflowBindingsStore.setState({ t2iWorkflowId: null, i2iWorkflowId: null });
    useAppSettingsStore.setState({ imageGenerationSettings: { ...useAppSettingsStore.getState().imageGenerationSettings, defaultImageModel: "" } });
    localStorage.clear();
  });

  it("设备列表:恒恰一行带「当前生效」徽标(远端生效时该远端行选中)", async () => {
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.101:17000", label: "Windows 主力", lastUsedAt: 1 }],
    });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/comfy/engine/remote")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ url: "http://192.168.0.101:17000", effective: "http://192.168.0.101:17000", source: "settings" }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/workflows")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ engineOnline: true, workflows: [] }) } as unknown as Response);
      }
      return Promise.reject(new Error("unexpected " + u));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-remote").className).toContain("border-primary");
      expect(screen.getByTestId("engine-device-remote-select").getAttribute("aria-checked")).toBe("true");
      expect(screen.getByTestId("engine-device-local").className).not.toContain("border-primary");
      expect(screen.getByTestId("engine-device-local-select").getAttribute("aria-checked")).toBe("false");
    });
    expect(screen.getAllByText(/当前生效/)).toHaveLength(1);
    expect(screen.getByTestId("engine-devices-list").textContent).toContain("Windows 主力");
  });

  it("1103 选中交互:远端生效中点本机设备行→清地址保存切回本机", async () => {
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.101:17000", label: "Windows 主力", lastUsedAt: 1 }],
    });
    let current: string | null = "http://192.168.0.101:17000";
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/comfy/engine/remote")) {
        if (init?.method === "POST") {
          current = (JSON.parse(String(init.body)) as { url?: string }).url || null;
        }
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve(
            current
              ? { url: current, effective: current, source: "settings" }
              : { url: null, effective: "http://127.0.0.1:17598", source: "manifest" },
          ),
        } as unknown as Response);
      }
      if (u.includes("/comfy/workflows")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ engineOnline: true, workflows: [] }) } as unknown as Response);
      }
      return Promise.reject(new Error("unexpected " + u));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-remote-select").getAttribute("aria-checked")).toBe("true");
    });
    fireEvent.click(screen.getByTestId("engine-device-local-select"));
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-local-select").getAttribute("aria-checked")).toBe("true");
      expect(screen.getByTestId("engine-device-remote-select").getAttribute("aria-checked")).toBe("false");
    });
    // POST 断言在状态翻转后(saveRemoteEngine 的 fetch 在异步微任务,同步查恒空)
    const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/comfy/engine/remote") && c[1]?.method === "POST");
    expect(post).toBeTruthy();
    expect((JSON.parse(String(post?.[1]?.body)) as { url?: string }).url).toBe("");
    expect(toastMocks.success).toHaveBeenCalledWith("已恢复本机引擎");
  });

  it("1103 选中交互:本机生效中点远端设备行→保存该机地址生效", async () => {
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.101:17000", label: "Windows 主力", lastUsedAt: 1 }],
    });
    let current: string | null = null;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/comfy/engine/remote")) {
        if (init?.method === "POST") {
          current = (JSON.parse(String(init.body)) as { url?: string }).url || null;
        }
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve(
            current
              ? { url: current, effective: current, source: "settings" }
              : { url: null, effective: "http://127.0.0.1:17598", source: "manifest" },
          ),
        } as unknown as Response);
      }
      if (u.includes("/comfy/workflows")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ engineOnline: true, workflows: [] }) } as unknown as Response);
      }
      return Promise.reject(new Error("unexpected " + u));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-local-select").getAttribute("aria-checked")).toBe("true");
    });
    fireEvent.click(screen.getByTestId("engine-device-remote-select"));
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-remote-select").getAttribute("aria-checked")).toBe("true");
    });
    const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/comfy/engine/remote") && c[1]?.method === "POST");
    expect(post).toBeTruthy();
    expect((JSON.parse(String(post?.[1]?.body)) as { url?: string }).url).toBe("http://192.168.0.101:17000");
  });

  // ── 1103 device-level-ssh:多机 SSH 凭据随设备走 ──
  const deviceSshMock = (current0: string | null) => {
    const state = { current: current0, sshPosted: null as Record<string, unknown> | null };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/comfy/engine/remote")) {
        if (init?.method === "POST") state.current = (JSON.parse(String(init.body)) as { url?: string }).url || null;
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve(
            state.current
              ? { url: state.current, effective: state.current, source: "settings" }
              : { url: null, effective: "http://127.0.0.1:17598", source: "fallback" },
          ),
        } as unknown as Response);
      }
      if (u.includes("/comfy/ssh/config") && init?.method === "POST") {
        state.sshPosted = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...state.sshPosted }) } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as unknown as Response);
    });
    return { fetchMock, state };
  };

  it("device-ssh ①:设备带 SSH 档→激活即双写(引擎+SSH 凭据落章)", async () => {
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.101:17000", label: "A机", lastUsedAt: 1, ssh: { host: "192.168.0.101", port: 22, user: "zbj", keyPath: "" } }],
    });
    const { fetchMock, state } = deviceSshMock(null);
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-local-select").getAttribute("aria-checked")).toBe("true");
    });
    fireEvent.click(screen.getByTestId("engine-device-remote-select"));
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-remote-select").getAttribute("aria-checked")).toBe("true");
    });
    await waitFor(() => {
      expect(state.sshPosted).not.toBeNull();
    });
    expect((state.sshPosted as Record<string, unknown>).host).toBe("192.168.0.101");
    expect((state.sshPosted as Record<string, unknown>).user).toBe("zbj");
  });

  it("device-ssh ②:设备未配 SSH→激活只写引擎,不动全局 SSH 配置", async () => {
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.102:17000", label: "B机", lastUsedAt: 1 }],
    });
    const { fetchMock } = deviceSshMock(null);
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-local-select").getAttribute("aria-checked")).toBe("true");
    });
    fireEvent.click(screen.getByTestId("engine-device-remote-select"));
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-remote-select").getAttribute("aria-checked")).toBe("true");
    });
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/comfy/ssh/config"))).toBe(false);
  });

  it("device-ssh ③:SSH 区保存→凭据回写进当前生效设备(切走再切回随行)", async () => {
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.101:17000", label: "A机", lastUsedAt: 1 }],
    });
    const { fetchMock } = deviceSshMock("http://192.168.0.101:17000");
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-remote-select").getAttribute("aria-checked")).toBe("true");
    });
    fireEvent.click(screen.getByTestId("ssh-save"));
    await waitFor(() => {
      expect(useEnginePresetsStore.getState().presets[0]?.ssh?.host).toBe("192.168.0.101");
    });
    expect(useEnginePresetsStore.getState().presets[0]?.ssh?.port).toBe(22);
  });

  it("device-ssh ⑤(半截①修):编辑生效中设备的 SSH→立即落章 POST(不等切走切回)", async () => {
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.101:17000", label: "A机", lastUsedAt: 1 }],
    });
    const { fetchMock, state } = deviceSshMock("http://192.168.0.101:17000");
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-remote-select").getAttribute("aria-checked")).toBe("true");
    });
    fireEvent.click(screen.getByTestId("engine-device-edit"));
    fireEvent.change(screen.getByTestId("engine-device-edit-ssh-host"), { target: { value: "10.0.0.9" } });
    fireEvent.change(screen.getByTestId("engine-device-edit-ssh-user"), { target: { value: "ops" } });
    fireEvent.click(screen.getByTestId("engine-device-edit-save"));
    await waitFor(() => {
      expect(state.sshPosted).not.toBeNull();
    });
    expect((state.sshPosted as Record<string, unknown>).host).toBe("10.0.0.9");
    expect((state.sshPosted as Record<string, unknown>).user).toBe("ops");
    // 表单同步显新凭据(所见=所连)
    expect((screen.getByTestId("ssh-host") as HTMLInputElement).value).toBe("10.0.0.9");
  });

  it("device-ssh ⑥(半截②修):切换设备→SSH 表单字段随该机档案刷新", async () => {
    useEnginePresetsStore.setState({
      presets: [
        { url: "http://192.168.0.101:17000", label: "A机", lastUsedAt: 2, ssh: { host: "192.168.0.101", port: 22, user: "zbj", keyPath: "" } },
        { url: "http://192.168.0.102:17000", label: "B机", lastUsedAt: 1, ssh: { host: "192.168.0.102", port: 2222, user: "ops", keyPath: "/Users/ops/.ssh/id" } },
      ],
    });
    const { fetchMock } = deviceSshMock(null);
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-local-select").getAttribute("aria-checked")).toBe("true");
    });
    // 点 B 机行(getAllByTestId 取第二台)
    fireEvent.click(screen.getAllByTestId("engine-device-remote-select")[1]!);
    await waitFor(() => {
      expect((screen.getByTestId("ssh-host") as HTMLInputElement).value).toBe("192.168.0.102");
    });
    expect((screen.getByTestId("ssh-port") as HTMLInputElement).value).toBe("2222");
    expect((screen.getByTestId("ssh-user") as HTMLInputElement).value).toBe("ops");
    expect((screen.getByTestId("ssh-key-path") as HTMLInputElement).value).toBe("/Users/ops/.ssh/id");
  });

  it("device-ssh ⑦(半截③修):SSH 区顶部标注当前生效设备名;本机模式=全局单份口径", async () => {
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.101:17000", label: "Windows 主力", lastUsedAt: 1 }],
    });
    const { fetchMock } = deviceSshMock("http://192.168.0.101:17000");
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("ssh-active-device").textContent).toContain("正在生效:Windows 主力");
    });
    expect(screen.getByTestId("ssh-active-device").textContent).toContain("回写进该设备");
  });

  it("1103 追修:保存后状态回读首拍断开(keeper 重连窗口)→沉降轮询终显已连接", async () => {
    // 竞时复刻:/comfy/ssh/status 首两次回 connected:false(重连窗口),第三次回 true
    let statusHits = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/comfy/ssh/status")) {
        statusHits += 1;
        const connected = statusHits >= 3;
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            available: true, configured: true, connected,
            host: "192.168.0.101", user: "zbj", serverVersion: connected ? "SSH-2.0-OpenSSH_for_Windows_9.5" : null,
            lastError: connected ? null : "SSH 连接断开(keeper 重连窗口)",
            tunnelEnabled: true, tunnelActive: connected, tunnelLocalPort: connected ? 17600 : null,
          }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/ssh/config") && init?.method === "POST") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ host: "192.168.0.101", port: 22, user: "zbj", keyPath: "", tunnelEnabled: true }) } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    fireEvent.click(screen.getByTestId("ssh-save"));
    // 沉降轮询:1.5s 后第二拍(仍断)→+3s 第三拍(连上);终态徽章=已连接
    await waitFor(() => {
      expect(screen.getByTestId("ssh-badge").getAttribute("data-state")).toBe("connected");
    }, { timeout: 12000 });
    expect(statusHits).toBeGreaterThanOrEqual(3);
  });

  it("device-ssh ④:编辑 dialog 填 SSH→设备档落块;主机清空=解除设备级凭据", async () => {
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.101:17000", label: "A机", lastUsedAt: 1 }],
    });
    const { fetchMock } = deviceSshMock("http://192.168.0.101:17000");
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    fireEvent.click(screen.getByTestId("engine-device-edit"));
    fireEvent.change(screen.getByTestId("engine-device-edit-ssh-host"), { target: { value: "10.0.0.9" } });
    fireEvent.change(screen.getByTestId("engine-device-edit-ssh-port"), { target: { value: "2222" } });
    fireEvent.click(screen.getByTestId("engine-device-edit-save"));
    expect(useEnginePresetsStore.getState().presets[0]?.ssh).toEqual({ host: "10.0.0.9", port: 2222, user: "", keyPath: "" });
    // 再编辑:清空主机=解除
    fireEvent.click(screen.getByTestId("engine-device-edit"));
    fireEvent.change(screen.getByTestId("engine-device-edit-ssh-host"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("engine-device-edit-save"));
    expect(useEnginePresetsStore.getState().presets[0]?.ssh).toBeUndefined();
  });

  it("R2 族横幅:默认空=自动回落 qi21 展示;组名=引擎与产线", () => {
    render(<McpSettingsTab />);
    expect(screen.getByText("引擎与产线")).toBeTruthy();
    expect(screen.getByTestId("engine-family-current").textContent).toContain("Qwen-Image-2.1");
  });

  it("R2 族切换:下拉选中写 defaultImageModel 真源", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ engineOnline: false, workflows: [] }) } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    // ui/select 测试替身范式:选项=option-{value} 常驻按钮,点击即 onValueChange
    fireEvent.click(screen.getByTestId("option-flux2-klein-9b"));
    await waitFor(() => {
      expect(useAppSettingsStore.getState().imageGenerationSettings.defaultImageModel).toBe("flux2-klein-9b");
    });
  });

  it("R3 工作流列表+绑定:qi21 域拉列,绑 t2i 件写 store,「在用」高亮;不可绑件显标注无绑定钮", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/comfy/workflows")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            engineOnline: true,
            workflows: [
              { id: "1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json", name: "qi21-道劫-t2i" },
              { id: "1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json", name: "qi21-道劫-i2i" },
              // 1102 收口轮:组内非道劫件(同在 1_文生图 目录但无同源 API 模板)——不可绑分支
              { id: "1_图片/Q2-1图像/1_文生图/other-t2i.json", name: "other-t2i" },
            ],
          }),
        } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByText("qi21-道劫-t2i")).toBeTruthy();
    });
    // 不可绑件:显「暂无引擎模板」标注,且不给绑定钮(t2i 组仅道劫一件有钮)
    expect(screen.getByText("暂无引擎模板")).toBeTruthy();
    expect(screen.getAllByTestId("engine-workflow-bind-t2i")).toHaveLength(1);
    fireEvent.click(screen.getAllByTestId("engine-workflow-bind-t2i")[0]);
    await waitFor(() => {
      expect(useWorkflowBindingsStore.getState().t2iWorkflowId).toBe("1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json");
    });
    expect(screen.getByText("在用")).toBeTruthy();
    // 再点=解绑回 null(零迁移默认)
    fireEvent.click(screen.getAllByTestId("engine-workflow-bind-t2i")[0]);
    await waitFor(() => {
      expect(useWorkflowBindingsStore.getState().t2iWorkflowId).toBeNull();
    });
  });
});

describe("S3 绑定注入(11-02 hub:resolveBoundTemplateForGeneration;收口轮映射语义)", () => {
  it("本地模型按参考图有无取对应绑定,经映射层转引擎 API 模板键;未绑/云端=undefined(现行为)", () => {
    expect(resolveBoundTemplateForGeneration("qwen-image-2-1", false)).toBeUndefined();
    useWorkflowBindingsStore.setState({
      t2iWorkflowId: "1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
      i2iWorkflowId: "1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json",
    });
    // 1102 收口轮修复:绑定 id(库内画布路径)→ 引擎 API 模板键(load_template 只吃后者)
    expect(resolveBoundTemplateForGeneration("qwen-image-2-1", false)).toBe("qwen21_道劫_t2i_api");
    expect(resolveBoundTemplateForGeneration("qwen-image-2-1", true)).toBe("qwen21_道劫_i2i_api");
    // 云端模型不绑(返回 undefined=不注入)
    expect(resolveBoundTemplateForGeneration("gpt-image-2", false)).toBeUndefined();
    useWorkflowBindingsStore.setState({ t2iWorkflowId: null, i2iWorkflowId: null });
  });

  it("edit 绑定件映射到 i2i 模板;无引擎模板的库内件(修复超分等)返回 undefined=回落现行为", () => {
    useWorkflowBindingsStore.setState({ t2iWorkflowId: null, i2iWorkflowId: "1_图片/Q2-1图像/2_图生图/qi21-edit.json" });
    expect(resolveBoundTemplateForGeneration("qwen-image-2-1", true)).toBe("qwen21_道劫_i2i_api");
    expect(isBindableWorkflow("1_图片/Q2-1图像/2_图生图/qi21-edit.json")).toBe(true);
    // 修复超分等非道劫件:不可绑(UI 亦不 给绑定钮),即便误注入也回落 undefined
    useWorkflowBindingsStore.setState({ t2iWorkflowId: "1_图片/Q2-1图像/6_修复超分/xxx.json", i2iWorkflowId: null });
    expect(isBindableWorkflow("1_图片/Q2-1图像/6_修复超分/xxx.json")).toBe(false);
    expect(resolveBoundTemplateForGeneration("qwen-image-2-1", false)).toBeUndefined();
    useWorkflowBindingsStore.setState({ t2iWorkflowId: null, i2iWorkflowId: null });
  });
});

// ── SSH 远端连接(11-03-sidecar-ssh-module R4/S3):四请求全走本地 sidecar
// (mock fetch,照远程引擎行范式);needs-runtime=paramiko 未装的指路提示。
// 回执形状逐键对齐后端实装(remote_ssh/service.py status()/test_connection()
// + config.save_config;server.py /comfy/ssh/* 四路由)。──
describe("McpSettingsTab·SSH 远端连接(11-03 R4)", () => {
  // backend SSHService.status() 形状(未配置基线;各测按需覆写字段)
  const SSH_STATUS_UNCONFIGURED = {
    available: true,
    configured: false,
    connected: false,
    host: "",
    user: "",
    serverVersion: null,
    lastError: null,
    tunnelEnabled: true,
    tunnelActive: false,
    tunnelLocalPort: null,
    tokenRefreshedAt: null,
  };
  // backend config.save_config 回执=完整落盘配置(保存后草稿回显真源)
  const SSH_CONFIG_SAVED = {
    host: "",
    port: 22,
    user: "",
    keyPath: "",
    tunnelEnabled: true,
    tunnelLocalPort: 17600,
    tokenConfigPaths: [],
  };

  /** 统一 fetch mock:引擎地址回显 + ssh 四路由 + 工作流清单(族行挂载效应)。 */
  const stubSshFetch = (handlers: {
    engineRemote?: Record<string, unknown>;
    sshStatus?: Record<string, unknown>;
    sshConfigPost?: Record<string, unknown>;
    sshTest?: Record<string, unknown>;
    sshTokenRefresh?: Record<string, unknown>;
  }) => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/comfy/engine/remote")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              handlers.engineRemote ?? { url: null, effective: "http://127.0.0.1:17598", source: "fallback" },
            ),
        } as unknown as Response);
      }
      if (u.includes("/comfy/ssh/status")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(handlers.sshStatus ?? SSH_STATUS_UNCONFIGURED),
        } as unknown as Response);
      }
      if (u.includes("/comfy/ssh/config") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(handlers.sshConfigPost ?? SSH_CONFIG_SAVED),
        } as unknown as Response);
      }
      if (u.includes("/comfy/ssh/test") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(handlers.sshTest ?? { ok: true }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/ssh/token-refresh") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(handlers.sshTokenRefresh ?? { ok: true, tokenRefreshedAt: null }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/workflows")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ engineOnline: false, workflows: [] }),
        } as unknown as Response);
      }
      return Promise.reject(new Error("unexpected fetch " + u));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setComfySidecarLivenessProbeForTests(null);
    localStorage.clear();
  });

  beforeEach(() => {
    setComfySidecarLivenessProbeForTests(async () => true);
    useEnginePresetsStore.setState({ presets: [] });
    toastMocks.success.mockClear();
    toastMocks.error.mockClear();
  });

  it("渲染:四输入+隧道开关(默认开)+徽章「未配置」;开关可翻转", async () => {
    stubSshFetch({});
    render(<McpSettingsTab />);
    expect(screen.getByText("SSH 远端连接（远端信任自动化）")).toBeTruthy();
    // 四输入在位,端口默认 22,密钥路径空(=自动探测)
    await waitFor(() => {
      expect((screen.getByTestId("ssh-host") as HTMLInputElement).value).toBe("");
    });
    expect((screen.getByTestId("ssh-port") as HTMLInputElement).value).toBe("22");
    expect((screen.getByTestId("ssh-user") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("ssh-key-path") as HTMLInputElement).value).toBe("");
    // 隧道开关默认开(Q3 裁定),点击可翻转(草稿接线)
    const tunnelSwitch = screen.getByRole("switch", { name: "SSH 隧道加密通道" });
    expect(tunnelSwitch.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(tunnelSwitch);
    expect(screen.getByRole("switch", { name: "SSH 隧道加密通道" }).getAttribute("aria-checked")).toBe("false");
    // 徽章三态之一:未配置
    const badge = screen.getByTestId("ssh-badge");
    expect(badge.textContent).toBe("未配置");
    expect(badge.getAttribute("data-state")).toBe("unconfigured");
    expect(screen.queryByTestId("ssh-needs-runtime")).toBeNull();
  });

  it("保存流:host 空→预填远端引擎 URL 的 hostname;POST /comfy/ssh/config 携五字段;回执回填草稿", async () => {
    const fetchMock = stubSshFetch({
      engineRemote: {
        url: "http://192.168.0.101:17000",
        effective: "http://192.168.0.101:17000",
        source: "settings",
      },
      sshStatus: SSH_STATUS_UNCONFIGURED,
      sshConfigPost: {
        ...SSH_CONFIG_SAVED,
        host: "192.168.0.101",
        port: 2222,
        user: "zbj",
        keyPath: "/Users/zbj/.ssh/id_ed25519",
      },
    });
    render(<McpSettingsTab />);
    // 等引擎地址回显落位(draft 输入框已随设备列表退役;远端生效=本机行未选中)
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-local-select").getAttribute("aria-checked")).toBe("false");
    });
    fireEvent.change(screen.getByTestId("ssh-user"), { target: { value: "zbj" } });
    fireEvent.change(screen.getByTestId("ssh-port"), { target: { value: "2222" } });
    fireEvent.change(screen.getByTestId("ssh-key-path"), { target: { value: "/Users/zbj/.ssh/id_ed25519" } });
    // host 留空 → 保存时应预填引擎 hostname
    fireEvent.click(screen.getByTestId("ssh-save"));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (c) => String(c[0]).includes("/comfy/ssh/config") && c[1]?.method === "POST",
      );
      expect(post).toBeTruthy();
      const body = JSON.parse(String(post?.[1]?.body)) as Record<string, unknown>;
      expect(body).toEqual({
        host: "192.168.0.101",
        port: 2222,
        user: "zbj",
        keyPath: "/Users/zbj/.ssh/id_ed25519",
        tunnelEnabled: true,
      });
    });
    // 预填+保存回执同步回输入框(用户看得见存了什么;回执=落盘真源)
    await waitFor(() => {
      expect((screen.getByTestId("ssh-host") as HTMLInputElement).value).toBe("192.168.0.101");
    });
    expect((screen.getByTestId("ssh-port") as HTMLInputElement).value).toBe("2222");
    expect((screen.getByTestId("ssh-key-path") as HTMLInputElement).value).toBe("/Users/zbj/.ssh/id_ed25519");
    expect(toastMocks.success).toHaveBeenCalledWith("SSH 配置已保存");
    // 保存后回读 status 刷新徽章(mock 恒未配置——回读链不炸即可)
    expect(screen.getByTestId("ssh-badge").textContent).toBe("未配置");
  });

  it("测试连接回执渲染四件:登录用户/服务器版本/令牌读取(len 掩码)/隧道探活", async () => {
    stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, configured: true, connected: true, host: "192.168.0.101", user: "zbj" },
      sshTest: {
        ok: true,
        user: "zbj",
        serverVersion: "OpenSSH_for_Windows_8.9",
        token: { ok: true, length: 24, source: "E:/IP/漫影工作室/python/profiles/image-gen/config.json" },
        tunnel: { active: true, localPort: 17600 },
      },
    });
    render(<McpSettingsTab />);
    fireEvent.click(screen.getByTestId("ssh-test"));
    await waitFor(() => {
      expect(screen.getByTestId("ssh-test-result").textContent).toContain("登录用户：zbj");
    });
    expect(screen.getByTestId("ssh-test-result").textContent).toContain(
      "服务器版本：OpenSSH_for_Windows_8.9",
    );
    // 令牌 len 掩码:只显长度,内容永不回显(source 路径可见但令牌本体绝不出现)
    expect(screen.getByTestId("ssh-test-token").textContent).toContain("长度 24");
    expect(screen.getByTestId("ssh-test-token").textContent).toContain("掩码");
    expect(screen.getByTestId("ssh-test-tunnel").textContent).toContain("17600");
  });

  it("测试连接失败态:断开时透出 reason/message大白话(不炸不空)", async () => {
    stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, configured: true, connected: false, host: "192.168.0.101" },
      sshTest: {
        ok: false,
        reason: "disconnected",
        host: "192.168.0.101",
        message: "SSH 未连接(keeper 重连中)",
      },
    });
    render(<McpSettingsTab />);
    fireEvent.click(screen.getByTestId("ssh-test"));
    await waitFor(() => {
      expect(screen.getByTestId("ssh-test-error-line").textContent).toContain("SSH 未连接");
    });
    expect(screen.queryByTestId("ssh-needs-runtime")).toBeNull();
  });

  it("徽章三态:已连接✓ / 断开✗含 lastError", async () => {
    stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, configured: true, connected: true, host: "192.168.0.101", user: "zbj" },
    });
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("ssh-badge").getAttribute("data-state")).toBe("connected");
    });
    expect(screen.getByTestId("ssh-badge").textContent).toBe("已连接 ✓");
    expect(screen.queryByTestId("ssh-last-error")).toBeNull();
    // 断开态:徽章✗红 + lastError 行
    cleanup();
    stubSshFetch({
      sshStatus: {
        ...SSH_STATUS_UNCONFIGURED,
        configured: true,
        connected: false,
        host: "192.168.0.101",
        lastError: "Authentication failed (publickey)",
      },
    });
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("ssh-badge").getAttribute("data-state")).toBe("disconnected");
    });
    expect(screen.getByTestId("ssh-badge").textContent).toBe("断开 ✗");
    expect(screen.getByTestId("ssh-last-error").textContent).toContain("Authentication failed");
  });

  it("needs-runtime:paramiko 未装→提示去 Python 运行环境页;测试回执同族也点亮提示", async () => {
    stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, available: false },
      sshTest: {
        ok: false,
        reason: "needs-runtime",
        message: "paramiko 未安装:请在设置的 Python 运行环境页完成依赖配置后重试",
      },
    });
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("ssh-needs-runtime").textContent).toContain("paramiko");
    });
    expect(screen.getByTestId("ssh-needs-runtime").textContent).toContain("Python 运行环境");
    // fail-open:徽章仍按连接态展示(此处=未配置),不拦操作
    expect(screen.getByTestId("ssh-badge").textContent).toBe("未配置");
    // 点「测试连接」:回执 needs-runtime 透出大白话 message
    fireEvent.click(screen.getByTestId("ssh-test"));
    await waitFor(() => {
      expect(screen.getByTestId("ssh-test-error-line").textContent).toContain("paramiko 未安装");
    });
    expect(screen.getByTestId("ssh-test-error-line").textContent).toContain("Python 运行环境");
  });

  it("立即刷新令牌:成功给时间文案;失败给定位指引", async () => {
    stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, configured: true, connected: true },
      sshTokenRefresh: { ok: true, tokenRefreshedAt: 1761234567 },
    });
    render(<McpSettingsTab />);
    fireEvent.click(screen.getByTestId("ssh-token-refresh"));
    await waitFor(() => {
      expect(screen.getByTestId("ssh-token-result").textContent).toContain("令牌已刷新");
    });
    // 失败分支:ok=false→定位指引(后端失败态无附加详情,ok 即全部)
    cleanup();
    stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, configured: true, connected: false },
      sshTokenRefresh: { ok: false, tokenRefreshedAt: null },
    });
    render(<McpSettingsTab />);
    fireEvent.click(screen.getByTestId("ssh-token-refresh"));
    await waitFor(() => {
      expect(screen.getByTestId("ssh-token-result").textContent).toContain("令牌刷新失败");
    });
    expect(screen.getByTestId("ssh-token-result").textContent).toContain("测试连接");
  });
});
