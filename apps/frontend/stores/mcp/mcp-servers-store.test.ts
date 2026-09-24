import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMcpServersStore, MCP_SERVERS_STORAGE_KEY } from "./mcp-servers-store";

/** 等一拍让上一用例 fire-and-forget 的 setItem 全部落定(§6.4 前置 3:C1 后写盘异步化)。 */
const flushTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("mcp servers store", () => {
  beforeEach(async () => {
    await flushTick();
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
  beforeEach(async () => {
    await flushTick();
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

// ── 0924 C1 专项:safeStorage 加密落盘(env 含 token/key,整包加密)──
// fake 桥注入 + fresh 模块(门禁窗口语义),只 mock safeStorage 系统调用本身。
describe("mcp servers store safeStorage persistence (C1)", () => {
  const fakeEncode = (plaintext: string) => Buffer.from(`fake-cipher:${plaintext}`).toString("base64");
  const fakeDecode = (cipher: string) => {
    const text = Buffer.from(cipher, "base64").toString("utf8");
    return text.startsWith("fake-cipher:") ? text.slice("fake-cipher:".length) : null;
  };

  const installFakeBridge = () => {
    vi.stubGlobal("window", {
      secureStorage: {
        isEncryptionAvailable: async () => ({ ok: true as const, available: true }),
        encrypt: async (plaintext: string) => ({ ok: true as const, cipher: fakeEncode(plaintext) }),
        decrypt: async (cipher: string) => {
          const plaintext = fakeDecode(cipher);
          return plaintext === null
            ? { ok: false as const, reason: "error" }
            : { ok: true as const, plaintext };
        },
      },
    });
  };

  beforeEach(async () => {
    await flushTick();
    localStorage.removeItem(MCP_SERVERS_STORAGE_KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("增:addServer 后盘值为 v2 包装,解密往返与内存 servers 深相等", async () => {
    installFakeBridge();
    vi.resetModules();
    const { useMcpServersStore: freshStore } = await import("./mcp-servers-store");
    await vi.waitFor(() => expect(freshStore.persist.hasHydrated()).toBe(true)); // 空盘水合,门禁 settle

    freshStore.getState().addServer({
      name: "带密钥的服务",
      transport: "stdio",
      command: "npx",
      args: ["-y", "mcp-server"],
      env: { API_TOKEN: "tok-c1-明文" },
      enabled: true,
    });
    await vi.waitFor(() => {
      expect(localStorage.getItem(MCP_SERVERS_STORAGE_KEY)).toContain('"v":2');
    });
    const raw = localStorage.getItem(MCP_SERVERS_STORAGE_KEY) as string;
    expect(raw).not.toContain("tok-c1-明文");
    const decrypted = JSON.parse(fakeDecode(JSON.parse(raw).cipher) as string);
    expect(decrypted.state.servers).toEqual(freshStore.getState().servers);
    expect(decrypted.state.servers[0].env).toEqual({ API_TOKEN: "tok-c1-明文" });
  });

  it("存量 v1 明文盘水合后被钩子覆写为 v2(无 version,钩子是唯一写手)", async () => {
    installFakeBridge();
    const legacy = JSON.stringify({
      state: {
        servers: [
          {
            id: "srv-legacy",
            name: "存量服务",
            transport: "stdio",
            command: "npx",
            env: { KEY: "tok-c1-存量" },
            enabled: true,
          },
        ],
      },
      version: 0,
    });
    localStorage.setItem(MCP_SERVERS_STORAGE_KEY, legacy);
    vi.resetModules();
    const { useMcpServersStore: freshStore } = await import("./mcp-servers-store");

    await vi.waitFor(() => expect(freshStore.persist.hasHydrated()).toBe(true));
    await vi.waitFor(() => {
      expect(localStorage.getItem(MCP_SERVERS_STORAGE_KEY)).toContain('"v":2');
    });
    const raw = localStorage.getItem(MCP_SERVERS_STORAGE_KEY) as string;
    expect(raw).not.toContain("tok-c1-存量");
    const decrypted = JSON.parse(fakeDecode(JSON.parse(raw).cipher) as string);
    expect(decrypted.state.servers).toEqual([
      expect.objectContaining({ id: "srv-legacy", env: { KEY: "tok-c1-存量" } }),
    ]);
    expect(freshStore.getState().servers.map((server) => server.id)).toEqual(["srv-legacy"]);
  });
});
