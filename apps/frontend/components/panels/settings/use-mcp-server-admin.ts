/**
 * MCP 服务器管理域(1124 超线文件拆分:自 McpSettingsTab 原样搬出):
 * 登记表 CRUD/连通测试/JSON 导入导出/命令白名单推送。逻辑零改动。
 */
import { useEffect, useMemo, useState } from "react";
import {
  useMcpServersStore,
  exportMcpServersJson,
  type McpServerConfig,
  type McpTransport,
} from "@/stores/mcp/mcp-servers-store";
import { configToDraft, emptyDraft, parseEnvLines, type DraftForm, type TestState } from "./McpSettingsParts";

export function useMcpServerAdmin() {
  const { servers, addServer, updateServer, removeServer } =
    useMcpServersStore();
  const hasRuntime =
    typeof window !== "undefined" && Boolean(window.mcpRuntime);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftForm>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // 0924 安全收口 H4:登记的 stdio 命令清单推送主进程持久注册表——
  // mcp-server-test 的命令白名单真源(渲染层 localStorage 主进程读不到,
  // 故由本页在条目增改/导入/删除后重推;非 Electron 环境为空操作)。
  useEffect(() => {
    const commands = servers
      .filter(
        (server) => server.transport === "stdio" && server.command?.trim(),
      )
      .map((server) => server.command!.trim());
    void window.mcpRuntime?.syncRegisteredCommands?.(commands);
  }, [servers]);

  // 依赖整个 servers 引用(增/改/删都换新数组):仅依赖 length 会漏掉"编辑不改长度"的刷新,
  // 导致「复制/导出」送出陈旧配置
  useEffect(() => setJsonText(exportMcpServersJson()), [servers]);

  useEffect(() => () => setTests({}), []);

  const transportLabel = (transport: McpTransport) =>
    transport === "stdio" ? "本地命令" : "网络地址";

  const openCreate = () => {
    setEditingId(null);
    setDraft(emptyDraft);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (server: McpServerConfig) => {
    setEditingId(server.id);
    setDraft(configToDraft(server));
    setFormError(null);
    setDialogOpen(true);
  };

  const submit = () => {
    if (!draft.name.trim()) {
      setFormError("请填写名称");
      return;
    }
    // 重名守卫:手动添加放行重名会让导出 JSON 静默合并(名字做键);导入路径才按「同名更新」语义
    const duplicateName = servers.some(
      (s) => s.name === draft.name.trim() && s.id !== editingId,
    );
    if (duplicateName) {
      setFormError("已存在同名服务器，请换个名字（或编辑原条目）");
      return;
    }
    if (draft.transport === "stdio" && !draft.command.trim()) {
      setFormError("本地命令方式需要填写启动命令");
      return;
    }
    if (draft.transport === "http" && !draft.url.trim()) {
      setFormError("网络地址方式需要填写服务地址");
      return;
    }
    const payload = {
      name: draft.name.trim(),
      transport: draft.transport,
      command: draft.transport === "stdio" ? draft.command.trim() : undefined,
      args:
        draft.transport === "stdio" && draft.args.trim()
          ? draft.args.trim().split(/\s+/)
          : undefined,
      env: draft.env.trim() ? parseEnvLines(draft.env) : undefined,
      url: draft.transport === "http" ? draft.url.trim() : undefined,
      enabled: draft.enabled,
    };
    if (editingId) {
      updateServer(editingId, payload);
    } else {
      addServer(payload);
    }
    setDialogOpen(false);
  };

  const runTest = async (server: McpServerConfig) => {
    if (!window.mcpRuntime) return;
    setTests((prev) => ({ ...prev, [server.id]: { status: "testing" } }));
    try {
      const reply = await window.mcpRuntime.testServer({
        transport: server.transport,
        command: server.command,
        args: server.args,
        env: server.env,
        url: server.url,
      });
      setTests((prev) => ({
        ...prev,
        [server.id]: reply.ok
          ? { status: "ok", serverName: reply.serverName, tools: reply.tools }
          : { status: "error", message: reply.error },
      }));
    } catch (exc) {
      setTests((prev) => ({
        ...prev,
        [server.id]: {
          status: "error",
          message: exc instanceof Error ? exc.message : String(exc),
        },
      }));
    }
  };

  const enabledCount = useMemo(
    () => servers.filter((s) => s.enabled).length,
    [servers],
  );

  return {
    servers, addServer, updateServer, removeServer, hasRuntime,
    dialogOpen, setDialogOpen, editingId, draft, setDraft, formError, setFormError, tests,
    jsonText, setJsonText, jsonError, setJsonError,
    openCreate, openEdit, submit, runTest, enabledCount, transportLabel,
  };
}
