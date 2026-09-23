// MCP 最小宿主(主进程,09-01-mcp-settings-section):短生命周期连接测试。
// connect → listTools → close,10s 超时;不做常驻会话(工具消费是后续任务)。
//
// 0924 安全收口 H4:「renderer 已被攻破」威胁模型下,stdio 探测不再裸透传
// 渲染层给的 command/args/env(此前=被攻破的渲染层可直接 spawn 任意命令并
// 继承主进程全部环境变量)。新策略:
//   · command 白名单——仅放行 MCP 设置页已登记的命令(主进程侧持久注册表,
//     由设置页经 mcp-server-commands-sync 推送同步);未登记的绝对路径命令
//     须用户原生对话框逐次确认(dialog 由 mcp-ipc 注入,宿主保持可测)。
//     取舍:登记数据真源在渲染层 localStorage(主进程读不到),注册表由
//     渲染层推送——被完全攻破的渲染层仍可先 sync 再 test。该残余与「设置页
//     本就允许用户登记任意命令」的产品语义一致;收口增量=任意命令+全量 env
//     继承收敛为「登记面内命令 + 白名单 env + 未登记命令可见原生确认」。
//   · env 白名单——子进程不再整包继承 process.env(内含各 API key 等机密),
//     仅传 PATH/HOME 等基础运行变量,再叠加服务器条目显式声明的 env。
//     取舍:需要额外环境变量的服务器须在设置页该条目的 env 里显式声明。

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

/** 宿主依赖注入(mcp-ipc 装配;缺省=fail-closed,便于单测与复用)。 */
export interface McpHostControllerDeps {
  /** 命令是否在设置页登记白名单内(主进程侧注册表)。 */
  isRegisteredCommand?: (command: string) => boolean;
  /** 未登记的绝对路径命令的原生确认(缺省=一律拒绝)。 */
  confirmUnregisteredCommand?: (command: string) => Promise<boolean>;
}

const TEST_TIMEOUT_MS = 10_000;

/** 子进程 env 白名单:跨平台基础运行变量(用户/路径/语言/临时目录)。
 * 机密类(API key、token)一律不透传;Windows 大小写两态都列。 */
const CHILD_ENV_WHITELIST = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "SYSTEMROOT",
  "SystemRoot",
  "SYSTEMDRIVE",
  "SystemDrive",
  "COMSPEC",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "USERNAME",
  "COMPUTERNAME",
  "HOMEDRIVE",
  "HOMEPATH",
];

function buildChildEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV_WHITELIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...(extra ?? {}) };
}

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

function isAbsoluteCommandPath(command: string): boolean {
  // POSIX 绝对路径或 Windows 盘符路径;裸命令名(npx 等)不算
  return command.startsWith("/") || /^[A-Za-z]:[\\/]/.test(command);
}

function buildTransport(config: McpServerProbeConfig) {
  if (config.transport === "stdio") {
    if (!config.command?.trim()) {
      throw new Error("缺少启动命令");
    }
    return new StdioClientTransport({
      command: config.command.trim(),
      args: config.args ?? [],
      env: buildChildEnv(config.env),
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

export function createMcpHostController(deps: McpHostControllerDeps = {}): McpHostController {
  return {
    async testConnection(config) {
      // 命令白名单(仅 stdio;http 探测无子进程,不适用)
      if (config.transport === "stdio") {
        const command = config.command?.trim() ?? "";
        if (!command) {
          return { ok: false, error: "缺少启动命令" };
        }
        const registered = deps.isRegisteredCommand?.(command) ?? false;
        if (!registered) {
          if (!isAbsoluteCommandPath(command)) {
            return { ok: false, error: "该命令未在 MCP 设置页登记，仅支持已登记命令或绝对路径命令" };
          }
          const confirmed = await deps.confirmUnregisteredCommand?.(command);
          if (!confirmed) {
            return { ok: false, error: "用户未确认该命令，已取消测试" };
          }
        }
      }
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
