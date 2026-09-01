// MCP 服务器配置 IPC(09-01-mcp-settings-section)。
// 通道名用字符串字面量注册(IPC 契约测试按字面量扫描);handler 一律 fail-closed。

import { ipcMain } from "electron";

import {
  createMcpHostController,
  type McpHostController,
  type McpServerProbeConfig,
  type McpServerProbeReply,
} from "@rendering/plugins/mcp/mcp-host-controller";

export function registerMcpIpcHandlers(controller: McpHostController = createMcpHostController()): {
  dispose: () => void;
} {
  ipcMain.handle('mcp-server-test', (_event, config: McpServerProbeConfig) =>
    controller.testConnection(config),
  );
  // 短生命周期宿主暂无常驻会话;通道保留给后续常驻版,先回空操作保持契约稳定
  ipcMain.handle('mcp-server-disconnect', () => ({ ok: true as const }));
  return {
    dispose: () => {
      ipcMain.removeHandler('mcp-server-test');
      ipcMain.removeHandler('mcp-server-disconnect');
      controller.dispose();
    },
  };
}

export type { McpServerProbeConfig, McpServerProbeReply };
