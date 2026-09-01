"use client";

// MCP 服务设置 tab(09-01-mcp-settings-section)。
// 布局仿「本地配置」页:分组标签 + 可折叠行 + 行级状态胶囊(PluginSettingsTab 同款范式,
// 折叠态持久化 localStorage)。三组:服务连接(ComfyUI 桥+专业流开关)→ MCP 服务器 → JSON 配置。

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, FileJson, Loader2, Pencil, Plug, Plus, Server, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import {
  useMcpServersStore,
  importMcpServersJson,
  exportMcpServersJson,
  type McpServerConfig,
  type McpTransport,
} from "@/stores/mcp/mcp-servers-store";

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; serverName?: string; tools: { name: string; description?: string }[] }
  | { status: "error"; message: string };

interface DraftForm {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  url: string;
  env: string;
  enabled: boolean;
}

const emptyDraft: DraftForm = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  env: "",
  enabled: true,
};

const COLLAPSED_STORAGE_KEY = "mystudio.settings.mcp.collapsedSections";
type SectionId = "bridge" | "servers" | "json";
type PillState = "ready" | "needs-runtime" | "neutral";

const PILL_LABELS: Record<PillState, string> = {
  ready: "已就绪",
  "needs-runtime": "需准备",
  neutral: "配置区",
};

const PILL_STYLES: Record<PillState, string> = {
  ready: "border-success/40 bg-success/10 text-success",
  "needs-runtime": "border-warning/40 bg-warning/10 text-warning",
  neutral: "border-border bg-muted/50 text-muted-foreground",
};

function readCollapsedSections(): Set<SectionId> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as SectionId[]) : new Set();
  } catch {
    return new Set();
  }
}

function McpGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="space-y-2">
      <div className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border/80 bg-card/70">
        {children}
      </div>
    </section>
  );
}

function McpRow({
  sectionId,
  icon: Icon,
  title,
  pill,
  collapsed,
  onToggle,
  children,
}: {
  sectionId: SectionId;
  icon: typeof Server;
  title: string;
  pill: PillState;
  collapsed: boolean;
  onToggle: (id: SectionId) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible open={!collapsed} onOpenChange={() => onToggle(sectionId)}>
      <CollapsibleTrigger className="w-full text-left">
        <div className="flex items-center gap-3 px-4 py-3">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h4 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</h4>
          <span
            className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", PILL_STYLES[pill])}
            data-capability-pill={pill}
          >
            {PILL_LABELS[pill]}
          </span>
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", collapsed && "-rotate-90")}
            aria-hidden="true"
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function parseEnvLines(text: string): Record<string, string> | undefined {
  const entries = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : null;
    })
    .filter((entry): entry is [string, string] => Boolean(entry));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function configToDraft(server: McpServerConfig): DraftForm {
  return {
    name: server.name,
    transport: server.transport,
    command: server.command ?? "",
    args: (server.args ?? []).join(" "),
    url: server.url ?? "",
    env: Object.entries(server.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    enabled: server.enabled,
  };
}

export function McpSettingsTab() {
  const { servers, addServer, updateServer, removeServer } = useMcpServersStore();
  const hasRuntime = typeof window !== "undefined" && Boolean(window.mcpRuntime);
  const [collapsedSections, setCollapsedSections] = useState<Set<SectionId>>(() => readCollapsedSections());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftForm>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [bridge, setBridge] = useState<{ ready: boolean; version?: string } | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const localImageLoraEnabled = useAppSettingsStore(
    (state) => state.imageGenerationSettings.localImageLoraEnabled,
  );

  const toggleSectionCollapsed = (sectionId: SectionId) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  useEffect(() => setJsonText(exportMcpServersJson()), [servers.length]);

  useEffect(() => () => setTests({}), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const runtime = (window as unknown as { imageGenRuntime?: { status: () => Promise<{ models?: { modelName: string; downloaded: boolean; comfyuiVersion?: string | null }[] }> } }).imageGenRuntime;
        if (!runtime) return;
        const s = await runtime.status();
        if (cancelled) return;
        const row = (s.models ?? []).find((m) => m.modelName === "comfyui-bridge");
        if (row) setBridge({ ready: Boolean(row.downloaded), version: row.comfyuiVersion ?? undefined });
      } catch {
        // 拉取失败保持 null——胶囊显示「需准备」
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const transportLabel = (transport: McpTransport) => (transport === "stdio" ? "本地命令" : "网络地址");

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
        [server.id]: { status: "error", message: exc instanceof Error ? exc.message : String(exc) },
      }));
    }
  };

  const enabledCount = useMemo(() => servers.filter((s) => s.enabled).length, [servers]);

  return (
    <div className="p-8 w-full max-w-[1200px] mx-auto space-y-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Server className="h-5 w-5 text-primary" aria-hidden />
            MCP 服务
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            登记你的 MCP 服务器（AI 工具联动的标准协议），先用「测试连接」确认能连上。这里只保存配置和做连通测试；具体能力的接入会逐步开放。
          </p>
        </div>
      </header>

      {/* ── 服务连接:ComfyUI 桥状态 + 专业流开关(自「本地图片生成」迁此) ── */}
      <McpGroup label="服务连接">
        <McpRow
          sectionId="bridge"
          icon={Plug}
          title="ComfyUI 桥接（多参考编辑）"
          pill={bridge?.ready ? "ready" : "needs-runtime"}
          collapsed={collapsedSections.has("bridge")}
          onToggle={toggleSectionCollapsed}
        >
          <div className="space-y-4 px-5 py-4">
            <div>
              {bridge === null ? (
                <p className="text-xs text-muted-foreground">探测中…</p>
              ) : bridge.ready ? (
                <p className="text-xs text-success" data-testid="comfyui-bridge-ready">
                  已就绪（ComfyUI {bridge.version ?? ""}）——连接本机正在运行的 ComfyUI 出图，支持多张参考图编辑。在生图引擎选择里选用，无需下载模型。
                </p>
              ) : (
                <p className="text-xs text-muted-foreground" data-testid="comfyui-bridge-not-ready">
                  未就绪（需 ComfyUI 正在运行）——打开 ComfyUI 后即可连上。
                </p>
              )}
            </div>
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium">专业流增强（本地）</div>
                <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  开启后本地生图自动走专业流：Krea2 挂 NSFW 增强组件，ComfyUI 桥改走 NSFW 专业流。默认关闭——对普通画面有模糊/偏色副作用；仅本地引擎生效，云端不受影响。
                </div>
              </div>
              <label
                className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-muted-foreground"
                data-local-image-lora-checkbox
                title="开启后本地生图自动挂专业流增强"
              >
                <Checkbox
                  checked={localImageLoraEnabled}
                  onCheckedChange={(checked) =>
                    useAppSettingsStore
                      .getState()
                      .setImageGenerationSettings({
                        localImageLoraEnabled: checked === true,
                      })
                  }
                  aria-label="专业流增强（本地）"
                />
              </label>
            </div>
          </div>
        </McpRow>
      </McpGroup>

      {/* ── MCP 服务器 ── */}
      <McpGroup label="MCP 服务器">
        <McpRow
          sectionId="servers"
          icon={Server}
          title={`MCP 服务器管理${servers.length ? `（共 ${servers.length} 个，已启用 ${enabledCount} 个）` : ""}`}
          pill={enabledCount > 0 ? "ready" : "needs-runtime"}
          collapsed={collapsedSections.has("servers")}
          onToggle={toggleSectionCollapsed}
        >
          <div className="space-y-3 px-5 py-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={openCreate} data-testid="mcp-add-server">
                <Plus className="mr-2 h-4 w-4" aria-hidden />
                添加服务器
              </Button>
            </div>
            {!hasRuntime ? (
              <p className="text-xs text-muted-foreground">桌面应用中可用。</p>
            ) : servers.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground">还没有登记 MCP 服务器。点右上角「添加服务器」开始。</p>
            ) : (
              servers.map((server) => {
                const test = tests[server.id] ?? { status: "idle" };
                return (
                  <div
                    key={server.id}
                    className="rounded-lg border border-border bg-card p-3.5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
                    data-testid={`mcp-server-card-${server.name}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{server.name}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {transportLabel(server.transport)}
                        </span>
                      </div>
                      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                        {server.transport === "stdio"
                          ? [server.command, ...(server.args ?? [])].join(" ")
                          : server.url}
                      </p>
                      {test.status === "ok" ? (
                        <p className="mt-1 text-xs text-success" data-testid={`mcp-test-ok-${server.name}`}>
                          已连上{test.serverName ? `（${test.serverName}）` : ""}，提供 {test.tools.length} 个能力
                          {test.tools.length ? `：${test.tools.slice(0, 3).map((t) => t.name).join("、")}${test.tools.length > 3 ? " 等" : ""}` : ""}
                        </p>
                      ) : null}
                      {test.status === "error" ? (
                        <p className="mt-1 text-xs text-destructive" data-testid={`mcp-test-err-${server.name}`}>
                          {test.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={server.enabled}
                          onCheckedChange={(checked) => updateServer(server.id, { enabled: checked === true })}
                          aria-label={`启用 ${server.name}`}
                        />
                        启用
                      </label>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void runTest(server)}
                        disabled={test.status === "testing"}
                      >
                        {test.status === "testing" ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Check className="mr-2 h-4 w-4" aria-hidden />
                        )}
                        {test.status === "testing" ? "测试中…" : "测试连接"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(server)} aria-label={`编辑 ${server.name}`}>
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeServer(server.id)} aria-label={`删除 ${server.name}`}>
                        <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </McpRow>
      </McpGroup>

      {/* ── JSON 配置 ── */}
      <McpGroup label="JSON 配置">
        <McpRow
          sectionId="json"
          icon={FileJson}
          title="JSON 配置（通用格式）"
          pill="neutral"
          collapsed={collapsedSections.has("json")}
          onToggle={toggleSectionCollapsed}
        >
          <div className="space-y-3 px-5 py-4" data-testid="mcp-json-config">
            <p className="text-xs leading-5 text-muted-foreground">
              与其他软件通用的配置格式：粘贴别处的 mcpServers 配置点「导入」（同名更新、新名新增）；也可以复制当前配置到别的软件用。
            </p>
            <Textarea
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
              rows={8}
              className="font-mono text-xs"
              placeholder={'{\n  "mcpServers": {\n    "本地文件": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]\n    }\n  }\n}'}
              aria-label="mcpServers JSON 配置"
              data-testid="mcp-json-textarea"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(jsonText); toast.success("已复制到剪贴板"); }}>
                复制
              </Button>
              <Button size="sm" variant="outline" onClick={() => setJsonText(exportMcpServersJson())}>
                刷新为当前配置
              </Button>
              <Button size="sm" onClick={() => {
                const result = importMcpServersJson(jsonText);
                if (result.ok) {
                  setJsonError(null);
                  toast.success(`导入成功：新增 ${result.added} 个，更新 ${result.updated} 个`);
                } else {
                  setJsonError(result.error);
                }
              }}>
                导入
              </Button>
            </div>
            {jsonError ? (
              <p className="text-xs text-destructive" data-testid="mcp-json-error">{jsonError}</p>
            ) : null}
          </div>
        </McpRow>
      </McpGroup>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑服务器" : "添加服务器"}</DialogTitle>
            <DialogDescription>
              本地命令方式填一条可执行命令；网络地址方式填服务的网址。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="mcp-name">名称</Label>
              <Input
                id="mcp-name"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="例如：本地文件服务"
              />
            </div>
            <div className="space-y-1.5">
              <Label>连接方式</Label>
              <Select
                value={draft.transport}
                onValueChange={(value) => setDraft({ ...draft, transport: value as McpTransport })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">本地命令</SelectItem>
                  <SelectItem value="http">网络地址</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.transport === "stdio" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-command">启动命令</Label>
                  <Input
                    id="mcp-command"
                    value={draft.command}
                    onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                    placeholder="例如：npx"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-args">命令参数（空格分隔）</Label>
                  <Input
                    id="mcp-args"
                    value={draft.args}
                    onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                    placeholder="例如：-y @modelcontextprotocol/server-filesystem /tmp"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="mcp-url">服务地址</Label>
                <Input
                  id="mcp-url"
                  value={draft.url}
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                  placeholder="例如：http://127.0.0.1:3000/mcp"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="mcp-env">环境变量（每行一条，格式 键=值，可选）</Label>
              <Textarea
                id="mcp-env"
                value={draft.env}
                onChange={(event) => setDraft({ ...draft, env: event.target.value })}
                placeholder={"API_KEY=xxx\nDEBUG=true"}
                rows={3}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Switch
                checked={draft.enabled}
                onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked === true })}
              />
              启用这个服务器
            </label>
            {formError ? (
              <p className="text-xs text-destructive" data-testid="mcp-form-error">
                <X className="mr-1 inline h-3 w-3" aria-hidden />
                {formError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={submit} data-testid="mcp-save-server">
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
