// MCP 服务器配置 store(09-01-mcp-settings-section)。
// 配置即资产:登记 stdio/http 双传输服务器,持久化 localStorage;
// 工具消费(agent 流/桥迁移)由后续任务接线,v1 只管存好+测通。

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type McpTransport = "stdio" | "http";

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  /** stdio:可执行命令,如 npx / /usr/local/bin/foo */
  command?: string;
  /** stdio:命令参数 */
  args?: string[];
  /** stdio:额外环境变量 */
  env?: Record<string, string>;
  /** http:服务地址,如 http://127.0.0.1:3000/mcp */
  url?: string;
  enabled: boolean;
}

export type McpServerDraft = Omit<McpServerConfig, "id">;

interface McpServersState {
  servers: McpServerConfig[];
  addServer: (draft: McpServerDraft) => McpServerConfig;
  updateServer: (id: string, patch: Partial<McpServerDraft>) => void;
  removeServer: (id: string) => void;
}

export const MCP_SERVERS_STORAGE_KEY = "mystudio-mcp-servers";

/** 业界统一 JSON 形态(Claude Desktop/Claude Code/Cursor 同款):
 *  { "mcpServers": { 名字: { command?, args?, env?, url? } } }
 *  command=本地命令方式;url=网络地址方式。名字做键。 */
export interface McpServersJsonEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export type McpImportResult =
  | { ok: true; added: number; updated: number }
  | { ok: false; error: string };

function entryToConfig(name: string, entry: McpServersJsonEntry): McpServerDraft | null {
  if (typeof entry !== "object" || entry === null) return null;
  if (entry.command && entry.command.trim()) {
    return {
      name,
      transport: "stdio",
      command: entry.command.trim(),
      args: entry.args?.length ? entry.args : undefined,
      env: entry.env && Object.keys(entry.env).length ? entry.env : undefined,
      enabled: true,
    };
  }
  if (entry.url && entry.url.trim()) {
    return {
      name,
      transport: "http",
      url: entry.url.trim(),
      enabled: true,
    };
  }
  return null;
}

export const useMcpServersStore = create<McpServersState>()(
  persist(
    (set, get) => ({
      servers: [],
      addServer: (draft) => {
        const server: McpServerConfig = { ...draft, id: crypto.randomUUID() };
        set({ servers: [...get().servers, server] });
        return server;
      },
      updateServer: (id, patch) =>
        set({ servers: get().servers.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
      removeServer: (id) => set({ servers: get().servers.filter((s) => s.id !== id) }),
    }),
    { name: MCP_SERVERS_STORAGE_KEY, partialize: (state) => ({ servers: state.servers }) },
  ),
);

/** 导入统一 JSON:同名更新、新名新增;任何条目非法即整体拒绝(fail-closed,不做半截导入)。 */
export function importMcpServersJson(raw: string): McpImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "不是有效的 JSON，请检查格式" };
  }
  const root = parsed as { mcpServers?: Record<string, McpServersJsonEntry> };
  if (typeof parsed !== "object" || parsed === null || typeof root.mcpServers !== "object" || root.mcpServers === null) {
    return { ok: false, error: "缺少 mcpServers 字段（顶层应为 { \"mcpServers\": { ... } }）" };
  }
  const drafts: McpServerDraft[] = [];
  for (const [name, entry] of Object.entries(root.mcpServers)) {
    if (!name.trim()) return { ok: false, error: "存在空名字的服务器条目" };
    const draft = entryToConfig(name, entry);
    if (!draft) {
      return { ok: false, error: `「${name}」缺少 command（本地命令）或 url（网络地址）` };
    }
    drafts.push(draft);
  }
  const store = useMcpServersStore.getState();
  let added = 0;
  let updated = 0;
  for (const draft of drafts) {
    const existing = store.servers.find((s) => s.name === draft.name);
    if (existing) {
      store.updateServer(existing.id, draft);
      updated += 1;
    } else {
      store.addServer(draft);
      added += 1;
    }
  }
  return { ok: true, added, updated };
}

/** 导出为统一 JSON(与其他 MCP 客户端可直接互导)。 */
export function exportMcpServersJson(): string {
  const servers = useMcpServersStore.getState().servers;
  const mcpServers: Record<string, McpServersJsonEntry> = {};
  for (const server of servers) {
    mcpServers[server.name] =
      server.transport === "stdio"
        ? {
            command: server.command,
            ...(server.args?.length ? { args: server.args } : {}),
            ...(server.env && Object.keys(server.env).length ? { env: server.env } : {}),
          }
        : { url: server.url };
  }
  return `${JSON.stringify({ mcpServers }, null, 2)}\n`;
}
