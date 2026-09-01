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
