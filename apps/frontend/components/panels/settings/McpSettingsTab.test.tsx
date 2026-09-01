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
    expect(screen.getByText("MCP 服务配置仅在桌面应用中可用。")).toBeTruthy();
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
});
