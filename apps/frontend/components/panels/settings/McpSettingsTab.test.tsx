// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { McpSettingsTab } from "./McpSettingsTab";
import { useMcpServersStore } from "@/stores/mcp/mcp-servers-store";
import { useEnginePresetsStore } from "@/stores/settings/engine-presets-store";
import {
  useSshPresetsStore,
  type SshPreset,
} from "@/stores/settings/ssh-presets-store";
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
    // SSH 连接 store 跨测复位(1103 终版:防上一 describe 残行/迁移态泄漏)
    useSshPresetsStore.setState({ presets: [] });
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
    useSshPresetsStore.setState({ presets: [] });
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

  it("测试连接(仅探活不保存):经 sidecar 代理探引擎报版本/GPU,不发 POST,note 随生效关系分口径(1103 修:测已生效机=已生效/测其他=点行切换)", async () => {
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
    expect(screen.getByTestId("remote-engine-ok-dialog").textContent).toContain("生效");
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
    useSshPresetsStore.setState({ presets: [] });
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
    useEnginePresetsStore.setState({ presets: [] });
    useSshPresetsStore.setState({ presets: [] });
    toastMocks.success.mockClear();
    toastMocks.error.mockClear();
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

  // ── 1103 终版(11-03-device-level-ssh PRD):引擎/SSH 两列表零联动 + 引擎回归
  // 纯引擎。前案 device-ssh ①-⑨(凭据绑设备/双写/chips/状态签)全数退役改写。──
  /** 双列表同屏 mock:引擎 remote(可 POST 切换)+ ssh status/config(可 POST 切换)
   *  + 工作流清单;记录两侧 POST 供零联动断言。 */
  const dualListMock = (opts: { engine0?: string | null; sshHost0?: string } = {}) => {
    const state = {
      engine: opts.engine0 ?? null,
      sshHost: opts.sshHost0 ?? "",
      enginePosted: null as Record<string, unknown> | null,
      sshPosted: null as Record<string, unknown> | null,
    };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/comfy/engine/remote")) {
        if (init?.method === "POST") {
          state.enginePosted = JSON.parse(String(init.body)) as Record<string, unknown>;
          state.engine = (state.enginePosted as { url?: string }).url || null;
        }
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve(
            state.engine
              ? { url: state.engine, effective: state.engine, source: "settings" }
              : { url: null, effective: "http://127.0.0.1:17598", source: "fallback" },
          ),
        } as unknown as Response);
      }
      if (u.includes("/comfy/ssh/config") && init?.method === "POST") {
        state.sshPosted = JSON.parse(String(init.body)) as Record<string, unknown>;
        state.sshHost = String(state.sshPosted.host ?? "");
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...state.sshPosted, tunnelLocalPort: 17600, tokenConfigPaths: [] }) } as unknown as Response);
      }
      if (u.includes("/comfy/ssh/status")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            available: true, configured: Boolean(state.sshHost), connected: Boolean(state.sshHost),
            host: state.sshHost, user: "zbj", serverVersion: null, lastError: null,
            tunnelEnabled: true, tunnelActive: false, tunnelLocalPort: null, tokenRefreshedAt: null,
          }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/workflows")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ engineOnline: false, workflows: [] }) } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as unknown as Response);
    });
    return { fetchMock, state };
  };

  it("零联动①(D3):切引擎只 POST /comfy/engine/remote——零 /comfy/ssh/config POST", async () => {
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.101:17000", label: "A机", lastUsedAt: 1 }],
    });
    useSshPresetsStore.setState({
      presets: [{ id: "ssh-a", label: "A连", host: "192.168.0.101", port: 22, user: "zbj", keyPath: "", password: "", lastUsedAt: 1 }],
    });
    const { fetchMock } = dualListMock({ sshHost0: "192.168.0.101" });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("engine-device-local-select").getAttribute("aria-checked")).toBe("true");
    });
    fireEvent.click(screen.getByTestId("engine-device-remote-select"));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/comfy/engine/remote") && c[1]?.method === "POST"),
      ).toBe(true);
    });
    // 零联动铁证:整场零 SSH 配置写
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/comfy/ssh/config"))).toBe(false);
  });

  it("引擎回归(D4):添加表单与编辑 dialog 均无 SSH 字段;设备行零 SSH 状态签(D7)", async () => {
    useEnginePresetsStore.setState({
      presets: [{ url: "http://192.168.0.101:17000", label: "A机", lastUsedAt: 1 }],
    });
    const { fetchMock } = dualListMock({ engine0: "http://192.168.0.101:17000" });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    // 添加表单:纯引擎两字段(名+地址),无 SSH 四字段
    fireEvent.click(screen.getByTestId("engine-device-add"));
    expect(screen.getByTestId("engine-device-add-name")).toBeTruthy();
    expect(screen.getByTestId("engine-device-add-url")).toBeTruthy();
    expect(screen.queryByTestId("engine-device-add-ssh-host")).toBeNull();
    // 编辑 dialog:同纯引擎
    fireEvent.click(screen.getByTestId("engine-device-edit"));
    expect(screen.getByTestId("engine-device-edit-name")).toBeTruthy();
    expect(screen.getByTestId("engine-device-edit-url")).toBeTruthy();
    expect(screen.queryByTestId("engine-device-edit-ssh-host")).toBeNull();
    fireEvent.click(screen.getByTestId("engine-device-edit-save"));
    // 设备行零 SSH 状态签(Q4:行=名+URL+选中态+测试/编辑/删除,零 SSH 信息)
    expect(screen.queryByTestId(/^engine-device-ssh-state-/)).toBeNull();
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
  it("大模型按参考图有无取对应绑定,经映射层转引擎 API 模板键;未绑/云端=undefined(现行为)", () => {
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

// ── SSH 连接列表(11-03 终版:多条列表,引擎/SSH 零联动;照引擎设备列表同款
// 范式)。四请求全走本地 sidecar(mock fetch,照远程引擎行范式);回执形状逐键
// 对齐后端实装(remote_ssh/service.py status()/test_connection() +
// config.save_config;server.py /comfy/ssh/* 四路由)。──
describe("McpSettingsTab·SSH 连接列表(11-03 终版)", () => {
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

  /** 种子 SSH 连接条目(id 固定便于行定位)。 */
  const makeSshPreset = (host: string, id: string, extra: Partial<SshPreset> = {}): SshPreset => ({
    id,
    label: host,
    host,
    port: 22,
    user: "zbj",
    keyPath: "",
  password: "",
    lastUsedAt: 1,
    ...extra,
  });

  /** 统一 fetch mock:引擎地址回显 + ssh 四路由 + 工作流清单(族行挂载效应)。
   *  sshStatus 可传对象(静态)或工厂(每拍现算——切换/沉降场景)。 */
  const stubSshFetch = (handlers: {
    engineRemote?: Record<string, unknown>;
    sshStatus?: Record<string, unknown> | (() => Record<string, unknown>);
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
        const status =
          typeof handlers.sshStatus === "function" ? handlers.sshStatus() : (handlers.sshStatus ?? SSH_STATUS_UNCONFIGURED);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(status),
        } as unknown as Response);
      }
      if (u.includes("/comfy/ssh/config") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              // 默认回显保存体(照后端 save_config:返回完整落盘配置,③修复的
              // 指纹真源;显式覆写仍可)
              handlers.sshConfigPost ?? {
                ...(JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>),
                tunnelLocalPort: 17600,
                tokenConfigPaths: [],
              },
            ),
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
    // ③修复:指纹随 store 持久化,测试间一并归零防串场
    useSshPresetsStore.setState({ presets: [], activeFingerprint: null });
    toastMocks.success.mockClear();
    toastMocks.error.mockClear();
  });

  it("渲染:多条连接行(名+mono 地址 user@host:port)+radio;未配置零「当前连接」;隧道开关默认开可翻转", async () => {
    useSshPresetsStore.setState({
      presets: [
        makeSshPreset("192.168.0.101", "ssh-a", { label: "Windows 主力" }),
        makeSshPreset("192.168.0.102", "ssh-b", { port: 2222, user: "ops" }),
      ],
    });
    stubSshFetch({});
    render(<McpSettingsTab />);
    expect(screen.getByText("SSH 远端连接（多条）")).toBeTruthy();
    const rows = screen.getAllByTestId("ssh-connection-row");
    expect(rows).toHaveLength(2);
    // 行=名+mono 地址 user@host:port(照引擎设备行范式)
    expect(screen.getByText("Windows 主力")).toBeTruthy();
    expect(screen.getByText("zbj@192.168.0.101:22")).toBeTruthy();
    expect(screen.getByText("ops@192.168.0.102:2222")).toBeTruthy();
    // 未配置(status 回空):零「当前连接」徽标,radio 全未选
    expect(screen.queryByText("当前连接")).toBeNull();
    expect(screen.getAllByTestId("ssh-connection-select").every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);
    // 隧道开关默认开(status 未配置回退 true),点击可翻转
    const tunnelSwitch = screen.getByRole("switch", { name: "SSH 隧道加密通道" });
    expect(tunnelSwitch.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(tunnelSwitch);
    expect(screen.getByRole("switch", { name: "SSH 隧道加密通道" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("ssh-needs-runtime")).toBeNull();
    expect(screen.queryByTestId("ssh-connections-empty")).toBeNull();
  });

  it("指纹匹配(Q1):status 回读 host+user 命中行标「当前连接」+radio 选中;未选中行不显实时态", async () => {
    useSshPresetsStore.setState({
      presets: [
        makeSshPreset("192.168.0.101", "ssh-a", { label: "Windows 主力" }),
        makeSshPreset("192.168.0.102", "ssh-b"),
      ],
    });
    stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, configured: true, connected: true, host: "192.168.0.101", user: "zbj" },
    });
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(
        screen.getAllByTestId("ssh-connection-select").find((b) => b.dataset.host === "192.168.0.101")!.getAttribute("aria-checked"),
      ).toBe("true");
    });
    expect(screen.getByText("当前连接")).toBeTruthy(); // 恒恰一行
    expect(screen.getAllByText(/当前连接/)).toHaveLength(1);
    // 未选中行不显实时态(后端一时刻一连接)
    expect(
      screen.getAllByTestId("ssh-connection-row").find((r) => r.dataset.id === "ssh-b")!.querySelector('[data-testid="ssh-row-live-state"]'),
    ).toBeNull();
  });

  it("③指纹含 port:同 host+user 异 port 双档——落章回执指纹(port 2222)只命中 2222 行恒恰一行;翻隧道开关携 2222 行凭据落章(不拿列表首个 22 行)", async () => {
    useSshPresetsStore.setState({
      presets: [
        makeSshPreset("192.168.0.101", "ssh-22", { port: 22, label: "22口" }),
        makeSshPreset("192.168.0.101", "ssh-2222", {
          port: 2222,
          label: "2222口",
          keyPath: "/Users/zbj/.ssh/id_ed25519",
        }),
      ],
      activeFingerprint: { host: "192.168.0.101", port: 2222, user: "zbj" },
    });
    const fetchMock = stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, configured: true, connected: true, host: "192.168.0.101", user: "zbj" },
    });
    render(<McpSettingsTab />);
    const checkedOf = (id: string) =>
      screen
        .getAllByTestId("ssh-connection-row")
        .find((r) => r.dataset.id === id)!
        .querySelector('[data-testid="ssh-connection-select"]')!
        .getAttribute("aria-checked");
    await waitFor(() => expect(checkedOf("ssh-2222")).toBe("true"));
    // host+port+user 三全比对:同 host+user 异 port 的 22 行不冒认
    expect(checkedOf("ssh-22")).toBe("false");
    expect(screen.getAllByText(/当前连接/)).toHaveLength(1); // 恒恰一行(修复前双行同中)
    const row22 = screen.getAllByTestId("ssh-connection-row").find((r) => r.dataset.id === "ssh-22")!;
    expect(row22.querySelector('[data-testid="ssh-row-live-state"]')).toBeNull();
    expect(row22.querySelector('[data-testid="ssh-row-token-refresh"]')).toBeNull();
    expect(screen.getByTestId("ssh-row-live-state").textContent).toBe("SSH 已连接 ✓");
    // (b) 修复铁证:翻隧道开关携消歧行(2222)凭据落章——修复前 presets.find 首个
    // host+user 命中=列表首个 22 行,静默改掉当前连接的 port
    fireEvent.click(screen.getByRole("switch", { name: "SSH 隧道加密通道" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/comfy/ssh/config") && c[1]?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        host: "192.168.0.101",
        port: 2222,
        user: "zbj",
        keyPath: "/Users/zbj/.ssh/id_ed25519",
        tunnelEnabled: false,
      });
    });
  });

  it("③port 未知(legacy 未经 UI 落章):同 host+user 异 port 双档零命中不冒认;翻隧道开关零 /comfy/ssh/config 写(不盲写错 port)", async () => {
    useSshPresetsStore.setState({
      presets: [
        makeSshPreset("192.168.0.101", "ssh-22", { port: 22 }),
        makeSshPreset("192.168.0.101", "ssh-2222", { port: 2222 }),
      ],
      activeFingerprint: null,
    });
    const fetchMock = stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, configured: true, connected: true, host: "192.168.0.101", user: "zbj" },
    });
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByText("zbj@192.168.0.101:22")).toBeTruthy();
    });
    // 无法消歧(status 不回 port+无落章指纹):恒零命中,两行都不冒认「当前连接」
    expect(screen.queryByText("当前连接")).toBeNull();
    expect(
      screen.getAllByTestId("ssh-connection-select").every((b) => b.getAttribute("aria-checked") === "false"),
    ).toBe(true);
    // 翻隧道开关=只翻本地态零配置写(盲写会拿列表首个 host+user 行的 22 落章)
    fireEvent.click(screen.getByRole("switch", { name: "SSH 隧道加密通道" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/comfy/ssh/config") && c[1]?.method === "POST"),
    ).toBe(false);
    expect(screen.getByRole("switch", { name: "SSH 隧道加密通道" }).getAttribute("aria-checked")).toBe("false");
  });

  it("③点行切换=回执指纹随章记住(host+port+user),此后同 host+user 双档恒消歧(点行一次即重建真相)", async () => {
    useSshPresetsStore.setState({
      presets: [
        makeSshPreset("192.168.0.101", "ssh-22", { port: 22, label: "22口" }),
        makeSshPreset("192.168.0.101", "ssh-2222", { port: 2222, label: "2222口" }),
      ],
      activeFingerprint: null,
    });
    // 状态随 POST 翻(照「点行切换」测范式);回执=保存体回显(save_config 返回
    // 完整落盘配置含 port=指纹真源)
    const state = { host: "192.168.0.101" };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/comfy/ssh/config") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        state.host = String(body.host ?? "");
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...body, tunnelLocalPort: 17600, tokenConfigPaths: [] }) } as unknown as Response);
      }
      if (u.includes("/comfy/ssh/status")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            available: true, configured: true, connected: true, host: state.host, user: "zbj",
            serverVersion: "SSH-2.0-OpenSSH_for_Windows_9.5", lastError: null,
            tunnelEnabled: true, tunnelActive: true, tunnelLocalPort: 17600, tokenRefreshedAt: null,
          }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/engine/remote")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ url: null, effective: "http://127.0.0.1:17598", source: "fallback" }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/workflows")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ engineOnline: false, workflows: [] }) } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    // legacy 零指纹:同 host+user 双档零命中(上一用例钉死),点 2222 行落章
    fireEvent.click(
      screen.getAllByTestId("ssh-connection-row").find((r) => r.dataset.id === "ssh-2222")!
        .querySelector('[data-testid="ssh-connection-select"]')!,
    );
    // 回执指纹随章记住(store 持久化字段,重开设置页仍记得)
    await waitFor(() => {
      expect(useSshPresetsStore.getState().activeFingerprint).toEqual({
        host: "192.168.0.101",
        port: 2222,
        user: "zbj",
      });
    });
    expect(toastMocks.success).toHaveBeenCalledWith("SSH 已切换:2222口");
    // 沉降后 2222 行命中(消歧生效,22 行仍 false)
    await waitFor(() => {
      const row2222 = screen.getAllByTestId("ssh-connection-row").find((r) => r.dataset.id === "ssh-2222")!;
      expect(row2222.querySelector('[data-testid="ssh-connection-select"]')!.getAttribute("aria-checked")).toBe("true");
    });
    const row22 = screen.getAllByTestId("ssh-connection-row").find((r) => r.dataset.id === "ssh-22")!;
    expect(row22.querySelector('[data-testid="ssh-connection-select"]')!.getAttribute("aria-checked")).toBe("false");
  });

  it("选中行实时态:已连接✓ / 断开✗含 lastError", async () => {
    useSshPresetsStore.setState({ presets: [makeSshPreset("192.168.0.101", "ssh-a")] });
    stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, configured: true, connected: true, host: "192.168.0.101", user: "zbj" },
    });
    const { unmount } = render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("ssh-row-live-state").textContent).toBe("SSH 已连接 ✓");
    });
    expect(screen.queryByTestId("ssh-last-error")).toBeNull();
    // 断开态:✗红 + lastError 行
    unmount();
    stubSshFetch({
      sshStatus: {
        ...SSH_STATUS_UNCONFIGURED,
        configured: true,
        connected: false,
        host: "192.168.0.101",
        user: "zbj",
        lastError: "Authentication failed (publickey)",
      },
    });
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("ssh-row-live-state").textContent).toBe("SSH 断开 ✗");
    });
    expect(screen.getByTestId("ssh-last-error").textContent).toContain("Authentication failed");
  });

  it("点行切换(R2):POST /comfy/ssh/config 携该行六字段(含 password)+touch 置顶+沉降后指纹翻到新行+零引擎 POST(零联动②)", async () => {
    useSshPresetsStore.setState({
      presets: [
        makeSshPreset("192.168.0.101", "ssh-a", { label: "A连" }),
        makeSshPreset("192.168.0.102", "ssh-b", { port: 2222, user: "ops", keyPath: "/Users/ops/.ssh/id", label: "B连" }),
      ],
    });
    // 状态随 POST 翻转(切换后 status 回 B=指纹翻到 B 行)
    const state = { host: "192.168.0.101" };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/comfy/ssh/config") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        state.host = String(body.host ?? "");
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...body, tunnelLocalPort: 17600, tokenConfigPaths: [] }) } as unknown as Response);
      }
      if (u.includes("/comfy/ssh/status")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            available: true, configured: true, connected: true, host: state.host, user: state.host === "192.168.0.102" ? "ops" : "zbj",
            serverVersion: "SSH-2.0-OpenSSH_for_Windows_9.5", lastError: null,
            tunnelEnabled: true, tunnelActive: true, tunnelLocalPort: 17600, tokenRefreshedAt: null,
          }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/engine/remote")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ url: null, effective: "http://127.0.0.1:17598", source: "fallback" }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/workflows")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ engineOnline: false, workflows: [] }) } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    // 初始指纹=A 行
    await waitFor(() => {
      expect(screen.getAllByTestId("ssh-connection-select").find((b) => b.dataset.host === "192.168.0.101")!.getAttribute("aria-checked")).toBe("true");
    });
    // 点 B 行 → POST B 凭据(五字段含隧道)
    fireEvent.click(screen.getAllByTestId("ssh-connection-select").find((b) => b.dataset.host === "192.168.0.102")!);
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/comfy/ssh/config") && c[1]?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        host: "192.168.0.102",
        port: 2222,
        user: "ops",
        keyPath: "/Users/ops/.ssh/id",
        tunnelEnabled: true,
        password: "",
      });
    });
    expect(toastMocks.success).toHaveBeenCalledWith("SSH 已切换:B连");
    // 沉降后指纹翻到 B 行(「当前连接」随行)
    await waitFor(() => {
      expect(screen.getAllByTestId("ssh-connection-select").find((b) => b.dataset.host === "192.168.0.102")!.getAttribute("aria-checked")).toBe("true");
    });
    // touch 置顶:B 行排第一
    expect(screen.getAllByTestId("ssh-connection-row")[0].dataset.id).toBe("ssh-b");
    // 零联动②铁证:切 SSH 零引擎 POST(挂载 GET 不算)
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/comfy/engine/remote") && c[1]?.method === "POST"),
    ).toBe(false);
  });

  it("添加:展开表单保存=只入 store 零 POST;host 空保存钮禁用;列表渲染新行", async () => {
    const fetchMock = stubSshFetch({});
    render(<McpSettingsTab />);
    expect(screen.getByTestId("ssh-connections-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("ssh-connection-add"));
    // host 空时保存钮禁用(存意图也不许空主机)
    expect((screen.getByTestId("ssh-connection-add-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("ssh-connection-add-name"), { target: { value: "Windows 主力" } });
    fireEvent.change(screen.getByTestId("ssh-connection-add-host"), { target: { value: "192.168.0.101" } });
    fireEvent.change(screen.getByTestId("ssh-connection-add-port"), { target: { value: "2222" } });
    fireEvent.change(screen.getByTestId("ssh-connection-add-user"), { target: { value: "zbj" } });
    fireEvent.change(screen.getByTestId("ssh-connection-add-key"), { target: { value: "/Users/zbj/.ssh/id_ed25519" } });
    fireEvent.change(screen.getByTestId("ssh-connection-add-password"), { target: { value: "pw-1104" } });
    expect((screen.getByTestId("ssh-connection-add-save") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("ssh-connection-add-save"));
    // 入列(store+渲染),表单收起
    const presets = useSshPresetsStore.getState().presets;
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({ label: "Windows 主力", host: "192.168.0.101", port: 2222, user: "zbj", keyPath: "/Users/zbj/.ssh/id_ed25519", password: "pw-1104" });
    expect(screen.getByText("zbj@192.168.0.101:2222")).toBeTruthy();
    expect(screen.queryByTestId("ssh-connection-add-form")).toBeNull();
    expect(toastMocks.success).toHaveBeenCalledWith("SSH 连接「Windows 主力」已保存,点击该行即可连接");
    // 零副作用:整场零 /comfy/ssh/config POST(保存=存意图,激活走点行)
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/comfy/ssh/config") && c[1]?.method === "POST"),
    ).toBe(false);
  });

  it("编辑 dialog:回显字段→保存更新(同 id 不增行);host 清空给 toast 拒收;密码不回显+留空=不改(1104)", async () => {
    useSshPresetsStore.setState({
      presets: [makeSshPreset("192.168.0.101", "ssh-a", { label: "A连", password: "old-pw" })],
    });
    stubSshFetch({});
    render(<McpSettingsTab />);
    fireEvent.click(screen.getByTestId("ssh-row-edit"));
    expect((screen.getByTestId("ssh-connection-edit-host") as HTMLInputElement).value).toBe("192.168.0.101");
    // 密码框恒空起步(不回填明文,防泄)
    expect((screen.getByTestId("ssh-conn-password") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByTestId("ssh-connection-edit-host"), { target: { value: "10.0.0.9" } });
    fireEvent.change(screen.getByTestId("ssh-connection-edit-port"), { target: { value: "2222" } });
    fireEvent.change(screen.getByTestId("ssh-connection-edit-user"), { target: { value: "ops" } });
    fireEvent.click(screen.getByTestId("ssh-connection-edit-save"));
    // 同 id 更新不增行;列表渲染新 mono 地址;密码留空=旧值保留
    const presets = useSshPresetsStore.getState().presets;
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({ id: "ssh-a", host: "10.0.0.9", port: 2222, user: "ops", password: "old-pw" });
    expect(screen.getByText("ops@10.0.0.9:2222")).toBeTruthy();
    expect(toastMocks.success).toHaveBeenCalledWith("SSH 连接「A连」已更新,点该行应用新凭据");
    // 重开编辑:输入新密码=更换
    fireEvent.click(screen.getByTestId("ssh-row-edit"));
    fireEvent.change(screen.getByTestId("ssh-conn-password"), { target: { value: "new-pw" } });
    fireEvent.click(screen.getByTestId("ssh-connection-edit-save"));
    expect(useSshPresetsStore.getState().presets[0]?.password).toBe("new-pw");
    // host 清空=store 拒收,toast 报错
    fireEvent.click(screen.getByTestId("ssh-row-edit"));
    fireEvent.change(screen.getByTestId("ssh-connection-edit-host"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("ssh-connection-edit-save"));
    expect(toastMocks.error).toHaveBeenCalledWith("SSH 主机必填(如 192.168.0.101)");
    expect(useSshPresetsStore.getState().presets[0]?.host).toBe("10.0.0.9");
  });

  it("删除:行内删除钮出列(列表消失,他行不受扰)", () => {
    useSshPresetsStore.setState({
      presets: [makeSshPreset("192.168.0.101", "ssh-a"), makeSshPreset("192.168.0.102", "ssh-b")],
    });
    stubSshFetch({});
    render(<McpSettingsTab />);
    fireEvent.click(screen.getAllByTestId("ssh-row-delete").find((b) => b.dataset.host === "192.168.0.101")!);
    expect(useSshPresetsStore.getState().presets.map((p) => p.id)).toEqual(["ssh-b"]);
    expect(screen.queryByText("zbj@192.168.0.101:22")).toBeNull();
    expect(screen.getByText("zbj@192.168.0.102:22")).toBeTruthy();
  });

  it("刷令牌(C1):仅选中行显第四动作;点击 POST /comfy/ssh/token-refresh 给结果行", async () => {
    useSshPresetsStore.setState({
      presets: [makeSshPreset("192.168.0.101", "ssh-a"), makeSshPreset("192.168.0.102", "ssh-b")],
    });
    const fetchMock = stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, configured: true, connected: true, host: "192.168.0.101", user: "zbj" },
      sshTokenRefresh: { ok: true, tokenRefreshedAt: 1761234567 },
    });
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getAllByTestId("ssh-connection-select").find((b) => b.dataset.host === "192.168.0.101")!.getAttribute("aria-checked")).toBe("true");
    });
    // 仅选中行(A)显刷令牌钮;B 行没有
    expect(
      screen.getAllByTestId("ssh-connection-row").find((r) => r.dataset.id === "ssh-a")!.querySelector('[data-testid="ssh-row-token-refresh"]'),
    ).toBeTruthy();
    expect(
      screen.getAllByTestId("ssh-connection-row").find((r) => r.dataset.id === "ssh-b")!.querySelector('[data-testid="ssh-row-token-refresh"]'),
    ).toBeNull();
    fireEvent.click(screen.getByTestId("ssh-row-token-refresh"));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/comfy/ssh/token-refresh") && c[1]?.method === "POST"),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByTestId("ssh-token-result").textContent).toContain("令牌已刷新");
    });
  });

  it("needs-runtime(C2):paramiko 未装→列表区顶部全局黄条在位(fail-open 行仍渲染)", async () => {
    useSshPresetsStore.setState({ presets: [makeSshPreset("192.168.0.101", "ssh-a")] });
    stubSshFetch({ sshStatus: { ...SSH_STATUS_UNCONFIGURED, available: false } });
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("ssh-needs-runtime").textContent).toContain("paramiko");
    });
    expect(screen.getByTestId("ssh-needs-runtime").textContent).toContain("Python 运行环境");
    // fail-open:提示不拦操作,连接行照常渲染
    expect(screen.getAllByTestId("ssh-connection-row")).toHaveLength(1);
  });

  it("行内测试(仅探活):POST /comfy/ssh/test 回执渲染四件(登录用户/版本/令牌 len 掩码/隧道);失败态透出大白话", async () => {
    useSshPresetsStore.setState({ presets: [makeSshPreset("192.168.0.101", "ssh-a")] });
    const fetchMock = stubSshFetch({
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
    fireEvent.click(screen.getByTestId("ssh-row-test"));
    await waitFor(() => {
      expect(screen.getByTestId("ssh-test-result").textContent).toContain("登录用户：zbj");
    });
    expect(screen.getByTestId("ssh-test-result").textContent).toContain("服务器版本：OpenSSH_for_Windows_8.9");
    // 令牌 len 掩码:只显长度,内容永不回显
    expect(screen.getByTestId("ssh-test-token").textContent).toContain("长度 24");
    expect(screen.getByTestId("ssh-test-token").textContent).toContain("掩码");
    expect(screen.getByTestId("ssh-test-tunnel").textContent).toContain("17600");
    // 仅探活:不发配置写
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/comfy/ssh/config") && c[1]?.method === "POST")).toBe(false);
    // 失败分支:needs-runtime 回执透出大白话 + 点亮黄条
    cleanup();
    stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, available: false },
      sshTest: {
        ok: false,
        reason: "needs-runtime",
        message: "paramiko 未安装:请在设置的 Python 运行环境页完成依赖配置后重试",
      },
    });
    render(<McpSettingsTab />);
    fireEvent.click(screen.getByTestId("ssh-row-test"));
    await waitFor(() => {
      expect(screen.getByTestId("ssh-test-error-line").textContent).toContain("paramiko 未安装");
    });
    expect(screen.getByTestId("ssh-needs-runtime").textContent).toContain("Python 运行环境");
  });

  it("存量迁移(Q2):store 空+status 已配置→自动入列(label=host,port 22)且指纹即命中;store 非空不迁移", async () => {
    stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, configured: true, connected: true, host: "192.168.0.109", user: "ops" },
    });
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(useSshPresetsStore.getState().presets).toHaveLength(1);
    });
    expect(useSshPresetsStore.getState().presets[0]).toMatchObject({
      host: "192.168.0.109",
      user: "ops",
      port: 22,
      label: "192.168.0.109", // Q2 裁定:label=host
    });
    // 迁移行指纹即命中=「当前连接」(零操作过渡)
    await waitFor(() => {
      expect(screen.getAllByTestId("ssh-connection-select").find((b) => b.dataset.host === "192.168.0.109")!.getAttribute("aria-checked")).toBe("true");
    });
    // 反向:store 非空→不再迁移(长度守恒)
    useSshPresetsStore.setState({ presets: [makeSshPreset("192.168.0.101", "ssh-a")] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useSshPresetsStore.getState().presets).toHaveLength(1);
    expect(useSshPresetsStore.getState().presets[0].host).toBe("192.168.0.101");
  });

  it("隧道开关翻转=携当前行凭据落章(防 status 无 keyPath 回显被空值覆写)", async () => {
    useSshPresetsStore.setState({
      presets: [makeSshPreset("192.168.0.101", "ssh-a", { keyPath: "/Users/zbj/.ssh/id_ed25519", port: 2222 })],
    });
    const fetchMock = stubSshFetch({
      sshStatus: { ...SSH_STATUS_UNCONFIGURED, configured: true, connected: true, host: "192.168.0.101", user: "zbj" },
    });
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("ssh-connection-select").getAttribute("aria-checked")).toBe("true");
    });
    fireEvent.click(screen.getByRole("switch", { name: "SSH 隧道加密通道" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/comfy/ssh/config") && c[1]?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({
        host: "192.168.0.101",
        port: 2222,
        user: "zbj",
        keyPath: "/Users/zbj/.ssh/id_ed25519", // 全量凭据随行落章,keyPath 不被空值清
        tunnelEnabled: false,
      });
    });
    expect(screen.getByRole("switch", { name: "SSH 隧道加密通道" }).getAttribute("aria-checked")).toBe("false");
  });

  it("1103 追修(保留项):点行切换后首拍断开(keeper 重连窗口)→沉降轮询终显已连接", async () => {
    useSshPresetsStore.setState({
      presets: [
        makeSshPreset("192.168.0.101", "ssh-a", { label: "A连" }),
        makeSshPreset("192.168.0.102", "ssh-b", { user: "ops", label: "B连" }),
      ],
    });
    // 竞时复刻:/comfy/ssh/status 首两次回 connected:false(重连窗口),第三次回 true;
    // host 随 POST 翻到 B(指纹跟随)
    let statusHits = 0;
    const state = { host: "192.168.0.101" };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/comfy/ssh/config") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        state.host = String(body.host ?? "");
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...body, tunnelLocalPort: 17600, tokenConfigPaths: [] }) } as unknown as Response);
      }
      if (u.includes("/comfy/ssh/status")) {
        statusHits += 1;
        const connected = statusHits >= 3;
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            available: true, configured: true, connected,
            host: state.host, user: state.host === "192.168.0.102" ? "ops" : "zbj",
            serverVersion: connected ? "SSH-2.0-OpenSSH_for_Windows_9.5" : null,
            lastError: connected ? null : "SSH 连接断开(keeper 重连窗口)",
            tunnelEnabled: true, tunnelActive: connected, tunnelLocalPort: connected ? 17600 : null,
            tokenRefreshedAt: null,
          }),
        } as unknown as Response);
      }
      if (u.includes("/comfy/engine/remote")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ url: null, effective: "http://127.0.0.1:17598", source: "fallback" }) } as unknown as Response);
      }
      if (u.includes("/comfy/workflows")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ engineOnline: false, workflows: [] }) } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<McpSettingsTab />);
    // 点 B 行切换(沉降:1.5s 后第二拍仍断→+3s 第三拍连上)
    fireEvent.click(screen.getAllByTestId("ssh-connection-select").find((b) => b.dataset.host === "192.168.0.102")!);
    await waitFor(() => {
      expect(screen.getByTestId("ssh-row-live-state").textContent).toBe("SSH 已连接 ✓");
    }, { timeout: 12000 });
    expect(statusHits).toBeGreaterThanOrEqual(3);
  });
});


// ── 引擎同步(11-04 engine-sync R3/R5):清单渲染+勾选同步流+结果弹窗+旧按钮已撤 ──
describe("McpSettingsTab·引擎同步(11-04 engine-sync)", () => {
  /** manifest 夹具:四态各一(both 引擎/both 插件/mac-only×2——本机件+手动清单件/
   * win-only)+ my-nodes(skip)。pluginManual=手动 engine-sync.json 条目双侧均无
   * (1104 复核修:后端报 mac-only 不落 skip,面板可见可勾选)。 */
  const MANIFEST = {
    items: [
      { name: "ComfyUI", url: "https://github.com/comfyanonymous/ComfyUI", macHead: "aaaa1111bbbb2222", winHead: "cccc2222dddd3333", status: "both" },
      { name: "pluginA", url: "https://example.com/a.git", macHead: "aaaa000011112222", winHead: "aaaa000011112222", status: "both" },
      { name: "pluginB", url: "https://example.com/b.git", macHead: "bbbb000011112222", winHead: null, status: "mac-only" },
      { name: "pluginManual", url: "https://example.com/m.git", macHead: null, winHead: null, status: "mac-only" },
      { name: "seedvr2_videoupscaler", url: "", macHead: null, winHead: "dddd000011112222", status: "win-only" },
      { name: "my-nodes", url: "", macHead: null, winHead: null, status: "skip" },
    ],
  };

  const SSH_CONNECTED = {
    available: true, configured: true, connected: true,
    host: "192.168.0.101", user: "zbj", serverVersion: null, lastError: null,
    tunnelEnabled: true, tunnelActive: true, tunnelLocalPort: 17600, tokenRefreshedAt: null,
  };

  /** 统一 fetch stub:引擎地址/SSH 状态/清单/同步/重启五路;同步按 items[0] 逐件回执。 */
  const stubEngineSyncFetch = (handlers: {
    sshConnected?: boolean;
    manifest?: unknown; // 缺省=MANIFEST;传 Response 形状可模拟 503
    manifestStatus?: number;
    syncReply?: (name: string) => unknown;
    restartReply?: unknown;
  }) => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const reply = (payload: unknown, status = 200) =>
        Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(payload) } as unknown as Response);
      if (u.includes("/comfy/engine/remote")) {
        return reply({ url: null, effective: "http://127.0.0.1:17598", source: "fallback" });
      }
      if (u.includes("/comfy/ssh/status")) {
        return reply(handlers.sshConnected === false ? { ...SSH_CONNECTED, connected: false } : SSH_CONNECTED);
      }
      if (u.includes("/comfy/ssh/engine-sync-manifest")) {
        if (handlers.manifestStatus && handlers.manifestStatus >= 400) {
          return reply(handlers.manifest ?? { error: { message: "SSH 未连接", code: "ssh-disconnected" } }, handlers.manifestStatus);
        }
        return reply(handlers.manifest ?? MANIFEST);
      }
      if (u.includes("/comfy/ssh/sync-engine") && init?.method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}")) as { items: string[] };
        const name = body.items[0] ?? "";
        const fallback = (n: string) => ({
          items: [{
            name: n, type: n === "ComfyUI" ? "engine" : "plugin",
            macHead: n === "ComfyUI" ? "aaaa1111bbbb2222" : n === "pluginA" ? "aaaa000011112222" : "bbbb000011112222",
            winHead: n === "ComfyUI" ? "aaaa1111bbbb2222" : n === "pluginA" ? "aaaa000011112222" : "bbbb999988887777",
            action: n === "pluginB" ? "cloned" : "pulled", verified: true, error: null, pipError: null,
          }],
        });
        // syncReply 可返回载荷/Promise/undefined(undefined=回落默认回执,便于只改道单件)
        const custom = handlers.syncReply ? handlers.syncReply(name) : undefined;
        if (custom instanceof Promise) {
          return custom.then((resolved) => reply(resolved ?? fallback(name)));
        }
        return reply(custom ?? fallback(name));
      }
      if (u.includes("/comfy/ssh/restart-engine") && init?.method === "POST") {
        return reply(handlers.restartReply ?? { ok: true, output: "SUCCESS: EngineDurable" });
      }
      if (u.includes("/comfy/workflows")) {
        return reply({ engineOnline: false, workflows: [] });
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
    useSshPresetsStore.setState({ presets: [], activeFingerprint: null });
    toastMocks.success.mockClear();
    toastMocks.error.mockClear();
  });

  const rowOf = (name: string) =>
    screen.getAllByTestId("engine-sync-row").find((r) => r.dataset.name === name)!;

  it("清单渲染:四态行(引擎恒首+HEAD 前8字+状态标签);win-only 默认取消勾选+⏭️;my-nodes 不显示;手动清单件(双侧均无)可见可勾选", async () => {
    stubEngineSyncFetch({});
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("engine-sync-section")).toBeTruthy();
    });
    const rows = screen.getAllByTestId("engine-sync-row");
    expect(rows.map((r) => r.dataset.name)).toEqual(["ComfyUI", "pluginA", "pluginB", "pluginManual", "seedvr2_videoupscaler"]);
    expect(rows[0].textContent).toContain("ComfyUI 引擎");
    expect(rows[0].textContent).toContain("✅ 已装"); // HEAD 前 8 字
    expect(rowOf("pluginB").textContent).toContain("❌ Windows 未装");
    expect(rowOf("seedvr2_videoupscaler").textContent).toContain("⏭️ 跳过(Win 独有)");
    // 勾选态:both/mac-only 默认勾上(含手动清单件 pluginManual),win-only 恒不勾
    const checkedOf = (name: string) =>
      rowOf(name).querySelector('[data-testid="engine-sync-check"]')!.getAttribute("data-state");
    expect(checkedOf("ComfyUI")).toBe("checked");
    expect(checkedOf("pluginB")).toBe("checked");
    expect(checkedOf("pluginManual")).toBe("checked");
    expect(checkedOf("seedvr2_videoupscaler")).toBe("unchecked");
  });

  it("SSH 断开:开始同步禁用+指路提示;manifest 503 同口径", async () => {
    stubEngineSyncFetch({ sshConnected: false, manifestStatus: 503 });
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("engine-sync-ssh-hint").textContent).toContain("需先连接 SSH");
    });
    const start = screen.getByTestId("engine-sync-start") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it("勾选+开始同步:逐件 POST(单件单发=真逐项进度),⏳→✅ 逐行翻绿,POST 体={items:[名]}", async () => {
    // 首件(ComfyUI)挂起受控 promise:钉死「⏳ 同步中」的中途态
    // (ref 对象承载 resolve:TS 流分析不跟踪回调内赋值,裸 let 会被收窄成 null)
    const firstGate: { release: ((v: unknown) => void) | null } = { release: null };
    const fetchMock = stubEngineSyncFetch({
      syncReply: (name) =>
        name === "ComfyUI"
          ? new Promise((resolve) => { firstGate.release = resolve; }).then(() => ({
              items: [{ name: "ComfyUI", type: "engine", macHead: "aaaa1111bbbb2222", winHead: "aaaa1111bbbb2222", action: "pulled", verified: true, error: null, pipError: null }],
            }))
          : undefined,
    });
    render(<McpSettingsTab />);
    // 清单挂载异步:先等行就绪(开始按钮才从禁用解锁)
    await waitFor(() => {
      expect(screen.getAllByTestId("engine-sync-row").length).toBe(5);
    });
    fireEvent.click(screen.getByTestId("engine-sync-start"));
    // 首件在途:⏳ 同步中;后面几件未开始
    await waitFor(() => {
      expect(rowOf("ComfyUI").querySelector('[data-testid="engine-sync-progress"]')!.textContent).toContain("⏳ 同步中");
    });
    expect(rowOf("pluginA").querySelector('[data-testid="engine-sync-progress"]')!.textContent).toContain("⬜ 等待");
    firstGate.release?.(null);
    await waitFor(() => {
      expect(rowOf("pluginB").querySelector('[data-testid="engine-sync-progress"]')!.textContent).toContain("✅ 完成");
    });
    expect(rowOf("ComfyUI").querySelector('[data-testid="engine-sync-progress"]')!.textContent).toContain("✅ 完成");
    // 逐件单发:POST 体恰为单名数组,顺序=清单序(勾选项;含手动清单件 pluginManual)
    const posts = fetchMock.mock.calls
      .filter((c) => String(c[0]).includes("/comfy/ssh/sync-engine") && c[1]?.method === "POST")
      .map((c) => JSON.parse(String(c[1]?.body)) as { items: string[]; timeoutS?: number });
    expect(posts.map((p) => p.items)).toEqual([["ComfyUI"], ["pluginA"], ["pluginB"], ["pluginManual"]]);
    // 每件带剩余预算(timeoutS>0):整体 30min 超时跨批次生效(1104 复核修+修正)
    expect(posts.every((p) => typeof p.timeoutS === "number" && p.timeoutS > 0)).toBe(true);
    expect(posts[0].timeoutS).toBeLessThanOrEqual(1800);
  });

  it("完成弹结果 Dialog:逐项 ✅ 文案+重启建议+[重启引擎]→POST /comfy/ssh/restart-engine;⚠️ pip 失败不阻断", async () => {
    const fetchMock = stubEngineSyncFetch({
      syncReply: (name) => ({
        items: [{
          name, type: name === "ComfyUI" ? "engine" : "plugin",
          macHead: "aaaa1111bbbb2222", winHead: "aaaa1111bbbb2222",
          action: "pulled", verified: true, error: null,
          pipError: name === "pluginA" ? "pip install 失败: ERROR: no version" : null,
        }],
      }),
    });
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getAllByTestId("engine-sync-row").length).toBe(5);
    });
    fireEvent.click(screen.getByTestId("engine-sync-start"));
    await waitFor(() => {
      expect(screen.getByTestId("engine-sync-result-dialog").textContent).toContain("同步结果");
    });
    const dialog = screen.getByTestId("engine-sync-result-dialog");
    expect(dialog.textContent).toContain("已从 GitHub 拉取最新");
    expect(screen.getByTestId("engine-sync-pip-warning").textContent).toContain("不阻断");
    expect(dialog.textContent).toContain("重启引擎使插件生效");
    // [重启引擎] → SSH schtasks(R3)
    fireEvent.click(screen.getByTestId("engine-sync-restart"));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes("/comfy/ssh/restart-engine") && c[1]?.method === "POST"),
      ).toBe(true);
    });
    expect(toastMocks.success).toHaveBeenCalledWith(expect.stringContaining("重启指令已发"));
  });

  it("整体超时(1104 复核修+修正):30min 预算耗尽后不再发新 POST,剩余件按后端同口径标「整体超时」", async () => {
    // 只假 Date(定时器留真,waitFor 不受影响):首件挂起中把系统时间推过
    // deadline,释放后剩余件应直接收摊、零新 POST
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const firstGate: { release: ((v: unknown) => void) | null } = { release: null };
      const fetchMock = stubEngineSyncFetch({
        syncReply: (name) =>
          name === "ComfyUI"
            ? new Promise((resolve) => { firstGate.release = resolve; }).then(() => ({
                items: [{ name: "ComfyUI", type: "engine", macHead: "aaaa1111bbbb2222", winHead: "aaaa1111bbbb2222", action: "pulled", verified: true, error: null, pipError: null }],
              }))
            : undefined,
      });
      render(<McpSettingsTab />);
      await waitFor(() => {
        expect(screen.getAllByTestId("engine-sync-row").length).toBe(5);
      });
      fireEvent.click(screen.getByTestId("engine-sync-start"));
      await waitFor(() => {
        expect(rowOf("ComfyUI").querySelector('[data-testid="engine-sync-progress"]')!.textContent).toContain("⏳ 同步中");
      });
      // 预算耗尽:系统时间推过 30min deadline 再释放首件
      vi.setSystemTime(new Date(Date.now() + 30 * 60 * 1000 + 1000));
      firstGate.release?.(null);
      await waitFor(() => {
        expect(rowOf("pluginManual").querySelector('[data-testid="engine-sync-progress"]')!.textContent).toContain("❌ 失败");
      });
      expect(rowOf("pluginA").querySelector('[data-testid="engine-sync-progress"]')!.textContent).toContain("❌ 失败");
      // 只发过首件一件 POST——剩余件零新请求
      const posts = fetchMock.mock.calls.filter(
        (c) => String(c[0]).includes("/comfy/ssh/sync-engine") && c[1]?.method === "POST",
      );
      expect(posts.length).toBe(1);
      // 结果弹窗按后端同口径报整体超时
      await waitFor(() => {
        expect(screen.getByTestId("engine-sync-result-dialog").textContent).toContain("整体超时(30min),未同步");
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("引擎行 Win 缺(1104 复核修):标签不承诺 clone——引擎同步恒 pull,Win 无引擎目录将诚实报错", async () => {
    stubEngineSyncFetch({
      manifest: {
        items: [
          { name: "ComfyUI", url: "https://github.com/comfyanonymous/ComfyUI", macHead: "aaaa1111bbbb2222", winHead: null, status: "mac-only" },
        ],
      },
    });
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getAllByTestId("engine-sync-row").length).toBe(1);
    });
    expect(rowOf("ComfyUI").querySelector('[data-testid="engine-sync-status"]')!.textContent)
      .toContain("❌ Windows 未装");
  });

  it("旧「同步插件」按钮已撤(R4):ssh-sync-plugins testid 不复存在", async () => {
    stubEngineSyncFetch({});
    render(<McpSettingsTab />);
    await waitFor(() => {
      expect(screen.getByTestId("engine-sync-section")).toBeTruthy();
    });
    expect(screen.queryByTestId("ssh-sync-plugins")).toBeNull();
  });
});
