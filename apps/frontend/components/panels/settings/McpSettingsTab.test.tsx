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
