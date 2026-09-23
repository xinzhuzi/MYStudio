// MCP 服务器配置 IPC(09-01-mcp-settings-section)。
// 通道名用字符串字面量注册(IPC 契约测试按字面量扫描);handler 一律 fail-closed。
//
// 0924 安全收口 H4:mcp-server-test 的 command 白名单真源=本文件持久化的
// 登记注册表(userData/mcp-command-allowlist.json)。设置页在服务器条目
// 增改后经 mcp-server-commands-sync 推送 stdio 命令清单;主进程不回读
// 渲染层 localStorage(读不到,也信不过)。注册表由渲染层推送的残余取舍
// 见 mcp-host-controller.ts 头注。

import fs from "node:fs";
import path from "node:path";
import { app, dialog, ipcMain } from "electron";

import {
  createMcpHostController,
  type McpHostController,
  type McpServerProbeConfig,
  type McpServerProbeReply,
} from "@rendering/plugins/mcp/mcp-host-controller";

export interface RegisterMcpIpcOptions {
  controller?: McpHostController;
  /** 注册表落盘位置(默认 userData/mcp-command-allowlist.json;测试可注入)。 */
  allowlistPath?: () => string;
}

function defaultAllowlistPath(): string {
  // 懒求值:注册发生在 app ready 后,届时 userData 才稳定
  return path.join(app.getPath("userData"), "mcp-command-allowlist.json");
}

function readRegisteredCommands(pathProvider: () => string): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(pathProvider(), "utf8")) as { commands?: unknown };
    if (Array.isArray(raw.commands)) {
      return new Set(raw.commands.filter((item): item is string => typeof item === "string" && item.trim() !== ""));
    }
  } catch {
    // 缺文件/坏 JSON=空注册表(fail-closed,全走原生确认分支)
  }
  return new Set();
}

function writeRegisteredCommands(pathProvider: () => string, commands: string[]): void {
  fs.mkdirSync(path.dirname(pathProvider()), { recursive: true });
  fs.writeFileSync(pathProvider(), `${JSON.stringify({ commands }, null, 2)}\n`, "utf8");
}

export function registerMcpIpcHandlers(options: RegisterMcpIpcOptions = {}): {
  dispose: () => void;
} {
  const pathProvider = options.allowlistPath ?? defaultAllowlistPath;
  // 设置页推送登记命令清单(整体替换;条目增改/导入/删除后都会重推)
  ipcMain.handle('mcp-server-commands-sync', (_event, commands: unknown): { ok: boolean } => {
    if (!Array.isArray(commands) || commands.some((item) => typeof item !== "string")) {
      return { ok: false };
    }
    const unique = [...new Set(commands.map((item) => item.trim()).filter(Boolean))];
    writeRegisteredCommands(pathProvider, unique);
    return { ok: true };
  });
  const controller = options.controller ?? createMcpHostController({
    isRegisteredCommand: (command) => readRegisteredCommands(pathProvider).has(command),
    confirmUnregisteredCommand: async (command) => {
      // 原生确认=主进程对话框,渲染层无法伪造;未登记的绝对路径命令逐次过闸
      const result = await dialog.showMessageBox({
        type: "warning",
        buttons: ["允许测试", "取消"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        message: "测试未登记的 MCP 服务器命令",
        detail: `即将在本机启动并连接：\n${command}\n\n请确认该命令来源可信。`,
      });
      return result.response === 0;
    },
  });
  ipcMain.handle('mcp-server-test', (_event, config: McpServerProbeConfig) =>
    controller.testConnection(config),
  );
  // 短生命周期宿主暂无常驻会话;通道保留给后续常驻版,先回空操作保持契约稳定
  ipcMain.handle('mcp-server-disconnect', () => ({ ok: true as const }));
  return {
    dispose: () => {
      ipcMain.removeHandler('mcp-server-commands-sync');
      ipcMain.removeHandler('mcp-server-test');
      ipcMain.removeHandler('mcp-server-disconnect');
      controller.dispose();
    },
  };
}

export type { McpServerProbeConfig, McpServerProbeReply };
