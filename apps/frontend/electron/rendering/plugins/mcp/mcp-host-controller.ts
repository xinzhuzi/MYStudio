// MCP 最小宿主(主进程,09-01-mcp-settings-section):短生命周期连接测试。
// connect → listTools → close,10s 超时;不做常驻会话(工具消费是后续任务)。

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpServerProbeConfig {
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface McpToolSummary {
  name: string;
  description?: string;
}

export type McpServerProbeReply =
  | { ok: true; serverName?: string; tools: McpToolSummary[] }
  | { ok: false; error: string };

const TEST_TIMEOUT_MS = 10_000;

/** 大白话错误映射:UI 直接展示,技术细节截断附后。 */
function friendlyError(exc: unknown): string {
  const message = exc instanceof Error ? exc.message : String(exc);
  if (/ENOENT|spawn|not found/i.test(message)) {
    return "无法启动该程序，请检查命令路径是否正确";
  }
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|ECONNRESET|EPROTO/i.test(message)) {
    return "连不上这个地址，请检查服务是否在运行";
  }
  if (/timed?\s?out|timeout|abort/i.test(message)) {
    return "连接超时（10 秒），服务没有响应";
  }
  return `连接失败：${message.slice(0, 120)}`;
}

function buildTransport(config: McpServerProbeConfig) {
  if (config.transport === "stdio") {
    if (!config.command?.trim()) {
      throw new Error("缺少启动命令");
    }
    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
    });
  }
  if (!config.url?.trim()) {
    throw new Error("缺少服务地址");
  }
  return new StreamableHTTPClientTransport(new URL(config.url));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export interface McpHostController {
  testConnection: (config: McpServerProbeConfig) => Promise<McpServerProbeReply>;
  dispose: () => void;
}

export function createMcpHostController(): McpHostController {
  return {
    async testConnection(config) {
      const client = new Client({ name: "manying-studio-mcp-probe", version: "0.1.0" });
      try {
        const transport = buildTransport(config);
        await withTimeout(client.connect(transport), TEST_TIMEOUT_MS);
        const listed = await withTimeout(client.listTools(), TEST_TIMEOUT_MS);
        return {
          ok: true,
          serverName: (listed.serverInfo as { name?: string } | undefined)?.name,
          tools: (listed.tools ?? []).map((tool) => ({
            name: tool.name,
            description: typeof tool.description === "string" ? tool.description.slice(0, 160) : undefined,
          })),
        };
      } catch (exc) {
        return { ok: false, error: friendlyError(exc) };
      } finally {
        try {
          await client.close();
        } catch {
          // 探测会话,关闭失败无需上报
        }
      }
    },
    dispose: () => {
      // 短生命周期设计:无常驻连接可清理
    },
  };
}
