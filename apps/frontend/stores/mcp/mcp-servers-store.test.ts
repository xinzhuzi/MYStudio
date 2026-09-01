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
