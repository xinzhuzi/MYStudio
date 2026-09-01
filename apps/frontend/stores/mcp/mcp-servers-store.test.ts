import { beforeEach, describe, expect, it } from "vitest";
import { useMcpServersStore, MCP_SERVERS_STORAGE_KEY } from "./mcp-servers-store";

describe("mcp servers store", () => {
  beforeEach(() => {
    useMcpServersStore.setState({ servers: [] });
    localStorage.removeItem(MCP_SERVERS_STORAGE_KEY);
  });

  it("adds a server with a generated id", () => {
    const server = useMcpServersStore.getState().addServer({
      name: "本地文件",
      transport: "stdio",
      command: "npx",
      args: ["-y", "some-server"],
      enabled: true,
    });
    expect(server.id).toBeTruthy();
    expect(useMcpServersStore.getState().servers).toHaveLength(1);
  });

  it("updates a server patch-wise", () => {
    const server = useMcpServersStore.getState().addServer({
      name: "远程",
      transport: "http",
      url: "http://127.0.0.1:3000/mcp",
      enabled: true,
    });
    useMcpServersStore.getState().updateServer(server.id, { enabled: false, name: "远程2" });
    const updated = useMcpServersStore.getState().servers[0];
    expect(updated.name).toBe("远程2");
    expect(updated.enabled).toBe(false);
    expect(updated.url).toBe("http://127.0.0.1:3000/mcp");
  });

  it("removes only the targeted server", () => {
    const a = useMcpServersStore.getState().addServer({ name: "A", transport: "stdio", command: "x", enabled: true });
    useMcpServersStore.getState().addServer({ name: "B", transport: "http", url: "http://x", enabled: false });
    useMcpServersStore.getState().removeServer(a.id);
    expect(useMcpServersStore.getState().servers.map((s) => s.name)).toEqual(["B"]);
  });
});

// ── 统一 JSON 导入/导出(09-01,业界 mcpServers 标准格式互导) ──
describe("mcpServers JSON import/export", () => {
  beforeEach(() => {
    useMcpServersStore.setState({ servers: [] });
    localStorage.removeItem(MCP_SERVERS_STORAGE_KEY);
  });

  it("imports stdio and http entries from the standard format", async () => {
    const { importMcpServersJson } = await import("./mcp-servers-store");
    const result = importMcpServersJson(JSON.stringify({
      mcpServers: {
        "本地文件": { command: "npx", args: ["-y", "fs-server"], env: { K: "v" } },
        "远程": { url: "http://127.0.0.1:3000/mcp" },
      },
    }));
    expect(result).toEqual({ ok: true, added: 2, updated: 0 });
    const servers = useMcpServersStore.getState().servers;
    expect(servers.find((s) => s.name === "本地文件")).toMatchObject({ transport: "stdio", command: "npx", args: ["-y", "fs-server"], env: { K: "v" } });
    expect(servers.find((s) => s.name === "远程")).toMatchObject({ transport: "http", url: "http://127.0.0.1:3000/mcp" });
  });

  it("updates same-name servers and adds new ones on re-import", async () => {
    const { importMcpServersJson } = await import("./mcp-servers-store");
    importMcpServersJson(JSON.stringify({ mcpServers: { A: { command: "x" } } }));
    const result = importMcpServersJson(JSON.stringify({
      mcpServers: { A: { command: "y" }, B: { url: "http://b/mcp" } },
    }));
    expect(result).toEqual({ ok: true, added: 1, updated: 1 });
    const servers = useMcpServersStore.getState().servers;
    expect(servers.find((s) => s.name === "A")?.command).toBe("y");
    expect(servers).toHaveLength(2);
  });

  it("rejects invalid JSON, missing mcpServers, and entry without command/url", async () => {
    const { importMcpServersJson } = await import("./mcp-servers-store");
    expect(importMcpServersJson("not json")).toMatchObject({ ok: false });
    expect(importMcpServersJson('{"foo":1}')).toMatchObject({ ok: false });
    expect(importMcpServersJson('{"mcpServers":{"坏条目":{"cwd":"/x"}}}')).toMatchObject({ ok: false });
    expect(useMcpServersStore.getState().servers).toHaveLength(0); // fail-closed 不做半截导入
  });

  it("round-trips export → import losslessly by name", async () => {
    const { importMcpServersJson, exportMcpServersJson } = await import("./mcp-servers-store");
    importMcpServersJson(JSON.stringify({
      mcpServers: {
        fs: { command: "npx", args: ["-y", "fs"], env: { ROOT: "/tmp" } },
        remote: { url: "https://example.com/mcp" },
      },
    }));
    const exported = exportMcpServersJson();
    expect(JSON.parse(exported)).toEqual({
      mcpServers: {
        fs: { command: "npx", args: ["-y", "fs"], env: { ROOT: "/tmp" } },
        remote: { url: "https://example.com/mcp" },
      },
    });
  });
});
