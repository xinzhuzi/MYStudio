"use client";

// MCP 服务设置 tab(09-01-mcp-settings-section)。
// 布局仿「本地配置」页:分组标签 + 可折叠行 + 行级状态胶囊(PluginSettingsTab 同款范式,
// 折叠态持久化 localStorage)。三组:服务连接(ComfyUI 桥+专业流开关)→ MCP 服务器 → JSON 配置。

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, FileJson, Loader2, Pencil, Plug, Plus, Server, Star, Trash2, X } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
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
  MCP_SERVERS_STORAGE_KEY,
  type McpServerConfig,
  type McpTransport,
} from "@/stores/mcp/mcp-servers-store";
import {
  LOCAL_ENGINE_PRESET_KEY,
  normalizeEngineUrl,
  useEnginePresetsStore,
} from "@/stores/settings/engine-presets-store";
import { useWorkflowBindingsStore, isBindableWorkflow, type BoundWorkflowKind } from "@/stores/settings/workflow-bindings-store";
import { engineFamilyMeta } from "@/lib/studio/engine-line/family-catalog";
import { ALL_ENGINE_FAMILIES } from "@/lib/studio/engine-line/engine-options";
import {
  getRemoteEngine,
  setRemoteEngine,
  probeEngineUrl,
  comfySidecarRequest,
  SIDECAR_DOWN_GUIDANCE,
  isSidecarDownError,
  type ComfyRemoteEngineStatus,
} from "@/lib/assist/image-studio/comfy-sidecar-bridge";
import { SecureVaultBanner } from "./SecureVaultBanner";

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
type SectionId = "bridge" | "remote-engine" | "family" | "workflows" | "servers" | "json";
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

// 1016 型选择(本地生图):道劫十型展示层枚举(真源=引擎家 qi21_bases.json;
// 引擎侧 COMBO 校验拒非法值兜底)
const LOCAL_IMAGE_BASE_TYPES = [
  "人物海报", "场景", "道具", "美宣", "人物多视图", "高清人脸",
  "分镜剧情图", "表情差分", "概念气氛图", "设定卡",
] as const;

// T15/G3+T17:探活成功文案「ComfyUI x.y · GPU名」。桥行(挂载探测)由
// comfyui_bridge.resolve_big_files → inventory gpuName 透传;保存即测(T17)
// 则直探引擎 /system_stats devices[0].name。引擎没给时只显示版本段。
// 引擎地址归一(全角 ：／→半角)已迁 engine-presets-store 统一导出
// (11-02 预设条目入库与保存链路共用同一归一口径,防双源)。

function comfyVersionLabel(version?: string | null, gpu?: string | null): string {
  return `ComfyUI ${version ?? ""}${gpu ? ` · ${gpu}` : ""}`;
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
  // 远程引擎地址(10-29 D1 终裁):配置态回显/草稿/保存与连通测试进行态。
  const [remoteEngine, setRemoteEngineState] = useState<ComfyRemoteEngineStatus | null>(null);
  const [remoteDraft, setRemoteDraft] = useState("");
  const [remoteSaving, setRemoteSaving] = useState(false);
  const [remoteTest, setRemoteTest] = useState<
    { status: "idle" } | { status: "ok"; text: string } | { status: "error"; message: string }
  >({ status: "idle" });
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const localImageLoraEnabled = useAppSettingsStore(
    (state) => state.imageGenerationSettings.localImageLoraEnabled,
  );

  const localImageBaseType = useAppSettingsStore(
    (state) => state.imageGenerationSettings.localImageBaseType,
  );

  // 0924 安全收口 H4:登记的 stdio 命令清单推送主进程持久注册表——
  // mcp-server-test 的命令白名单真源(渲染层 localStorage 主进程读不到,
  // 故由本页在条目增改/导入/删除后重推;非 Electron 环境为空操作)。
  useEffect(() => {
    const commands = servers
      .filter((server) => server.transport === "stdio" && server.command?.trim())
      .map((server) => server.command!.trim());
    void window.mcpRuntime?.syncRegisteredCommands?.(commands);
  }, [servers]);

  const toggleSectionCollapsed = (sectionId: SectionId) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  // 依赖整个 servers 引用(增/改/删都换新数组):仅依赖 length 会漏掉"编辑不改长度"的刷新,
  // 导致「复制/导出」送出陈旧配置
  useEffect(() => setJsonText(exportMcpServersJson()), [servers]);

  useEffect(() => () => setTests({}), []);

  // (1102 控制中心役)原桥接状态探活已撤:灯收编进引擎双卡(统一 probeEngineUrl
  // 一个口径,本地/远端不再两套探活);bridge state 一并退役。

  // 远程引擎配置回显(sidecar 未运行时静默空态——首开设置页不弹错)。
  useEffect(() => {
    let cancelled = false;
    getRemoteEngine()
      .then((status) => {
        if (cancelled) return;
        setRemoteEngineState(status);
        setRemoteDraft(status.url ?? "");
      })
      .catch(() => {
        /* sidecar 未运行/端点不可达:保持空态,保存时会给出大白话 */
      });
    return () => { cancelled = true; };
  }, []);

  // 保存=写 sidecar 配置(原子落 App 家 remote-engine.json,即时生效无需重启)。
  // 保存即测两步探活(10-29 T17/问题#2):①GET /comfy/engine/remote 回读确认
  // url+source==='settings'——保存生效即远程接管,不再依赖 controller IPC 的
  // comfyui-bridge 行(该行版本在新引擎地址下不即时刷新,旧探活偶落
  // 「暂未探活成功」误报);②直连生效引擎 /system_stats(引擎原生 API,
  // 不走 controller)拿 comfyui_version+devices[0].name。两步都通=全绿;
  // ①通②不通=已生效但引擎未启动的诚实降级;失败走既有 error 文案。
  // 测试连接(仅探活不保存,11-02 用户令):直连输入框地址(空则当前生效地址)的
  // /system_stats;与 MCP 服务器卡片「测试连接」同范式;结果共用 remoteTest 展示位。
  const [remoteProbing, setRemoteProbing] = useState(false);
  // 1102 F4:探活成功详情弹窗(headline=实机版本/显卡,note=保存态说明);null=关
  const [engineOkDialog, setEngineOkDialog] = useState<{ headline: string; note: string } | null>(null);
  const testRemoteConnection = async () => {
    const base = normalizeEngineUrl(remoteDraft) || normalizeEngineUrl(remoteEngine?.effective ?? "");
    if (!base) {
      setRemoteTest({ status: "error", message: "先填引擎地址再测试(留空=本机引擎)" });
      return;
    }
    if (!/^https?:\/\//.test(base)) {
      setRemoteTest({
        status: "error",
        message: `引擎地址须为 http(s)://主机[:端口] 形态(如 http://192.168.0.101:17000;当前值:${JSON.stringify(
          remoteDraft.trim(),
        )}——若是中文输入法打出的全角冒号/斜杠,已自动归一仍不过请检查其余字符)`,
      });
      return;
    }
    setRemoteProbing(true);
    setRemoteTest({ status: "idle" });
    try {
      // 走 sidecar 服务端代理探活(11-02:渲染层 CSP connect-src 不放行 http+局域网
      // IP,直连 fetch 恒被拦——引擎明明在跑也报「连接失败」)。
      const probe = await probeEngineUrl(base);
      if (probe.ok) {
        // 1102 F4 终态:成功=弹窗即全部,行内不再重复提示(用户令)
        setEngineOkDialog({
          headline: `连接成功(${comfyVersionLabel(probe.comfyui_version ?? "未知版本", probe.device ?? null)})`,
          note: "未保存,点「保存并测试」生效",
        });
        setRemoteTest({ status: "idle" });
      } else {
        setRemoteTest({
          status: "error",
          message: `连接失败(${base})——引擎可能未启动或地址不可达`,
        });
      }
    } catch (error) {
      const message = isSidecarDownError(error)
        ? SIDECAR_DOWN_GUIDANCE
        : `连接失败(${base})——引擎可能未启动或地址不可达`;
      setRemoteTest({ status: "error", message });
    } finally {
      setRemoteProbing(false);
    }
  };

  // urlOverride(11-02 一键切换):常用条目直传归一 url——坑①:setRemoteDraft 是
  // 异步 setState,同帧闭包里的 remoteDraft 仍是旧值,不传参会把旧草稿存出去。
  const saveRemoteEngine = async (urlOverride?: string) => {
    const url = normalizeEngineUrl(urlOverride ?? remoteDraft);
    setRemoteSaving(true);
    setRemoteTest({ status: "idle" });
    try {
      await setRemoteEngine(url);
      const status = await getRemoteEngine();
      setRemoteEngineState(status);
      toast.success(url ? "引擎地址已保存,即时生效" : "已恢复本机引擎");
      if (url) {
        // ①回读校验:保存的 url 已生效且来源=设置页(远程真正接管;
        // 后端写库前 .rstrip("/"),比较两侧同样去尾斜杠防假阴)。
        const normalizedSaved = url.replace(/\/+$/, "");
        if (status.source !== "settings" || status.url !== normalizedSaved) {
          throw new Error(
            `保存后回读校验失败:生效地址 ${status.effective}(来源 ${status.source}),与刚保存的 ${normalizedSaved} 不一致`,
          );
        }
        setRemoteTest({ status: "ok", text: `已保存并生效(${status.effective}),引擎探活中…` });
        // 保存成功即自动收藏(Q2 双通道①):favorite 去重置顶幂等+touch 刷新 LRU;
        // 本机(空串)不入列(外层 if (url) 已挡)。
        enginePresetFavorite(url);
        enginePresetTouch(url);
        // ②引擎直探:改走 sidecar 代理 /comfy/engine/probe(11-02:渲染层 CSP 不放行
        // http+局域网 IP,直连 fetch 恒被拦,T17 成功分支从未真正可达)。
        try {
          const probe = await probeEngineUrl(status.effective);
          if (probe.ok) {
            // 1102 F4 终态:成功=弹窗即全部,行内不再重复提示(用户令)
            setEngineOkDialog({
              headline: `已连通远端引擎(${comfyVersionLabel(probe.comfyui_version ?? "未知版本", probe.device ?? null)})`,
              note: "产物将自动取回",
            });
            setRemoteTest({ status: "idle" });
          } else {
            setRemoteTest({
              status: "ok",
              text: `已保存并生效(${status.effective}),引擎探活暂不可达(引擎可能未启动)`,
            });
          }
        } catch {
          setRemoteTest({
            status: "ok",
            text: `已保存并生效(${status.effective}),引擎探活暂不可达(引擎可能未启动)`,
          });
        }
      }
    } catch (error) {
      // T9/G8:sidecar 未在驾是保存链第一故障源——探活 false/连接失败两族错误
      // 统一换算成同源指路文案(常量真源=桥文件 sidecarLikelyUp 门禁)。
      const message = isSidecarDownError(error)
        ? SIDECAR_DOWN_GUIDANCE
        : error instanceof Error
          ? error.message
          : "保存失败";
      setRemoteTest({ status: "error", message });
      toast.error(message);
    } finally {
      setRemoteSaving(false);
    }
  };

  // ── 引擎地址常用条目(11-02-engine-address-presets)──
  const enginePresets = useEnginePresetsStore((s) => s.presets);
  const enginePresetFavorite = useEnginePresetsStore((s) => s.favorite);
  const enginePresetTouch = useEnginePresetsStore((s) => s.touch);
  const enginePresetRemove = useEnginePresetsStore((s) => s.remove);
  // 当前生效打勾位:settings.url 为 null=本机;否则归一 url 匹配条目
  const activePresetKey =
    remoteEngine?.url == null ? LOCAL_ENGINE_PRESET_KEY : normalizeEngineUrl(remoteEngine.url);
  // R1 双卡生效判定(1102 控制中心):地址指向远端=远端卡生效,否则本机卡
  const remoteActive = remoteEngine?.source === "settings" && Boolean(remoteEngine.url);

  // ── R2 模型族(1102 控制中心):真源=defaultImageModel;切换即切产线(Q1) ──
  const defaultImageModel = useAppSettingsStore((s) => s.imageGenerationSettings.defaultImageModel);
  const currentFamily = engineFamilyMeta(defaultImageModel);
  const handleFamilySwitch = (value: string) => {
    useAppSettingsStore.getState().setImageGenerationSettings({ defaultImageModel: value });
    toast.success(`产线已切换:${value === "" ? "自动(本地即 Qwen-Image-2.1)" : value}`);
  };

  // ── R3 工作流(1102):当前族域前缀拉清单(prefix+light),双类型绑定(Q3) ──
  const bindings = useWorkflowBindingsStore();
  const [familyWorkflows, setFamilyWorkflows] = useState<{ id: string; name: string }[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(false);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);
  useEffect(() => {
    if (!currentFamily.workflowPrefix) {
      setFamilyWorkflows([]);
      return;
    }
    let cancelled = false;
    setWorkflowsLoading(true);
    setWorkflowsError(null);
    comfySidecarRequest<{ engineOnline: boolean; workflows: { id: string; name: string }[] }>(
      "GET",
      `/comfy/workflows?prefix=${encodeURIComponent(currentFamily.workflowPrefix)}&light=true`,
    )
      .then((res) => {
        if (!cancelled) setFamilyWorkflows(res.workflows ?? []);
      })
      .catch(() => {
        if (!cancelled) setWorkflowsError("清单拉取失败(sidecar 未运行或引擎未启动)");
      })
      .finally(() => {
        if (!cancelled) setWorkflowsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentFamily.workflowPrefix]);
  const t2iCandidates = familyWorkflows.filter((w) => w.id.includes("1_文生图"));
  const i2iCandidates = familyWorkflows.filter((w) => w.id.includes("2_图生图"));

  // 一键切换(Q1 裁定):key 即归一 url;本机=清空保存(回本地发现)。
  // 坑①必传 urlOverride:setRemoteDraft 异步落帧,闭包里 remoteDraft 还是旧值。
  const handlePresetSwitch = (key: string) => {
    const url = key === LOCAL_ENGINE_PRESET_KEY ? "" : key;
    setRemoteDraft(url);
    void saveRemoteEngine(url);
  };

  // ⭐手动收藏(Q2 裁定):未验证地址可先存(入库前 store 自带 normalize+前缀
  // 校验);非法格式走现行 error 文案位。
  const handleFavorite = () => {
    if (enginePresetFavorite(remoteDraft)) toast.success("已存入常用");
    else setRemoteTest({ status: "error", message: "地址格式不对,存不了(须 http(s)://主机[:端口])" });
  };

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
    // 重名守卫:手动添加放行重名会让导出 JSON 静默合并(名字做键);导入路径才按「同名更新」语义
    const duplicateName = servers.some((s) => s.name === draft.name.trim() && s.id !== editingId);
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
        [server.id]: { status: "error", message: exc instanceof Error ? exc.message : String(exc) },
      }));
    }
  };

  const enabledCount = useMemo(() => servers.filter((s) => s.enabled).length, [servers]);

  return (
    <>
      {/* 0924 范式重构后内容超一屏;设置页全家模式=tab 自带 ScrollArea(祖先链恒 overflow-hidden) */}
      <ScrollArea className="h-full">
      <div className="p-8 w-full max-w-[1200px] mx-auto space-y-8">
      {/* 0924 C1(§7):密钥保险箱状态横幅(env 含 token,与 API 密钥同批加密) */}
      <SecureVaultBanner
        storageKey={MCP_SERVERS_STORAGE_KEY}
        subjectLabel="MCP 服务配置"
        onRetry={() => useMcpServersStore.persist.rehydrate()}
      />

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

      {/* ── 引擎与产线(11-02 控制中心役):本地生图增强+引擎双卡+模型族+工作流绑定 ── */}
      <McpGroup label="引擎与产线">
        <McpRow
          sectionId="bridge"
          icon={Plug}
          title="本地生图增强（专业流 · 道劫型）"
          pill="neutral"
          collapsed={collapsedSections.has("bridge")}
          onToggle={toggleSectionCollapsed}
        >
          <div className="space-y-4 px-5 py-4">
            {/* 1102 控制中心役:桥接状态灯收编进下方引擎双卡(统一探活,一个口径);
                此行只留真设置(专业流增强+道劫型选择)。多参考编辑能力随引擎生效:
                当前生效引擎(本机/远端)在跑即用,状态看引擎卡探活。 */}
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
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium">道劫型选择（本地生图）</div>
                <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  指定后本地 Qwen-Image-2.1 生图按该型拼接型文与型档画幅（十型真源=引擎 qi21_bases.json，非法值由引擎拒单兜底）；「不指定」沿用产线默认。仅本地引擎生效，云端不受影响。
                </div>
              </div>
              <select
                className="h-8 shrink-0 self-center rounded-md border border-border bg-background px-2 text-sm"
                value={localImageBaseType}
                onChange={(e) =>
                  useAppSettingsStore
                    .getState()
                    .setImageGenerationSettings({ localImageBaseType: e.target.value })
                }
                aria-label="道劫型选择（本地）"
                data-local-image-base-type-select
              >
                <option value="">不指定</option>
                {LOCAL_IMAGE_BASE_TYPES.map((baseType) => (
                  <option key={baseType} value={baseType}>{baseType}</option>
                ))}
              </select>
            </div>
          </div>
        </McpRow>
        {/* 远程引擎地址(10-29 D1 终裁):URL 配一条,任务发远端 MYStudio 的 ComfyUI+产物回流 */}
        <McpRow
          sectionId="remote-engine"
          icon={Server}
          title="ComfyUI 引擎地址（远程）"
          pill={remoteEngine?.source === "settings" ? "ready" : "neutral"}
          collapsed={collapsedSections.has("remote-engine")}
          onToggle={toggleSectionCollapsed}
        >
          <div className="space-y-3 px-5 py-3" data-testid="remote-engine-section">
            {/* R1 双卡(1102 控制中心役):远端卡=当前控件+生效徽标;本机卡=托管引擎
                摘要+启用条件;互斥联动——地址指向远端则远端卡生效,留空则本机卡生效 */}
            <div className="grid gap-3 md:grid-cols-2">
              <div
                className={`rounded-xl border p-3.5 ${remoteActive ? "border-primary/60 bg-primary/5" : "border-border opacity-70"}`}
                data-testid="engine-card-remote"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">远端引擎</span>
                  {remoteActive && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                      当前生效
                    </span>
                  )}
                </div>
            <div className="flex items-center gap-2">
              {/* 常用快选(11-02 R1.4 一键切换):选中即填入+自动「保存并测试」立即生效 */}
              <Select value={activePresetKey} onValueChange={handlePresetSwitch}>
                <SelectTrigger
                  className="w-[132px] shrink-0"
                  aria-label="常用引擎地址"
                  disabled={remoteSaving || remoteProbing}
                >
                  <SelectValue placeholder="常用" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={LOCAL_ENGINE_PRESET_KEY}>本机引擎</SelectItem>
                  {enginePresets.map((p) => (
                    <SelectItem key={p.url} value={p.url}>
                      {p.label}({p.url.replace(/^https?:\/\//, "")})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={remoteDraft}
                onChange={(e) => setRemoteDraft(e.target.value)}
                placeholder="为空是本地引擎启动,填写URL为远端引擎启动"
                containerClassName="flex-1"
                data-testid="remote-engine-url"
                spellCheck={false}
              />
              {/* ⭐存为常用(G3 第三按钮):未验证地址可先存;切换进行态复用 remoteSaving 禁全部控件 */}
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={handleFavorite}
                disabled={remoteProbing || remoteSaving || !remoteDraft.trim()}
                data-testid="remote-engine-favorite"
              >
                <Star className="mr-1 h-3.5 w-3.5" aria-hidden />存为常用
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={testRemoteConnection}
                disabled={remoteProbing || remoteSaving}
                data-testid="remote-engine-test"
              >
                {remoteProbing ? "测试中…" : "测试连接"}
              </Button>
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => void saveRemoteEngine()}
                disabled={remoteSaving || remoteProbing}
                data-testid="remote-engine-save"
              >
                {remoteSaving ? "保存中…" : "保存并测试"}
              </Button>
              </div>
              </div>
              {/* 本机卡:留空引擎地址即启用;管理入口在本地配置页(引擎启停/模型) */}
              <div
                className={`rounded-xl border p-3.5 ${!remoteActive ? "border-primary/60 bg-primary/5" : "border-border opacity-70"}`}
                data-testid="engine-card-local"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">本机引擎(Mac 托管)</span>
                  {!remoteActive && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                      当前生效
                    </span>
                  )}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  引擎地址留空即走本机引擎出图;启停/模型下载/引擎卡在「设置 → 本地配置」。
                  引擎状态看本卡高亮态连通探活(测试连接)。
                </p>
              </div>
            </div>
            {/* 标签行(G2):仅当有已存条目时;删除当前生效条目只删条目不动引擎 */}
            {enginePresets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1" data-testid="remote-engine-presets-chips">
                {enginePresets.map((p) => (
                  <span
                    key={p.url}
                    title={p.url}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {p.label}
                    <button
                      type="button"
                      aria-label={`删除常用 ${p.label}`}
                      onClick={() => enginePresetRemove(p.url)}
                      className="rounded-full text-muted-foreground/70 transition-colors hover:text-destructive"
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {remoteTest.status === "ok" && (
              <p className="text-xs text-success" data-testid="remote-engine-ok">{remoteTest.text}</p>
            )}
            {remoteTest.status === "error" && (
              <p className="text-xs text-destructive" data-testid="remote-engine-error">{remoteTest.message}</p>
            )}
            {/* 1102 F4:探活成功详情弹窗(实机数据:版本/显卡来自 probe 实时取数) */}
            <Dialog open={engineOkDialog !== null} onOpenChange={(open) => !open && setEngineOkDialog(null)}>
              <DialogContent className="max-w-sm" data-testid="remote-engine-ok-dialog">
                <DialogHeader>
                  <DialogTitle>引擎连接</DialogTitle>
                  <DialogDescription>{engineOkDialog?.headline}</DialogDescription>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">{engineOkDialog?.note}</p>
                <DialogFooter>
                  <Button size="sm" onClick={() => setEngineOkDialog(null)}>知道了</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </McpRow>

        {/* ── R2 模型族(1102 控制中心):切换=写 defaultImageModel 真源,出图即走新族 ── */}
        <McpRow
          sectionId="family"
          icon={Server}
          title="模型族（产线）"
          pill={currentFamily.status === "ready" ? "ready" : "needs-runtime"}
          collapsed={collapsedSections.has("family")}
          onToggle={toggleSectionCollapsed}
        >
          <div className="space-y-3 px-5 py-3" data-testid="engine-family-section">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium" data-testid="engine-family-current">
                  当前产线:{currentFamily.label}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {currentFamily.hint}——切换即改全局默认出图模型,canvas 出图立即走新族;分镜批量恒走 Qwen-Image-2.1(既有裁定)。
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select value={defaultImageModel} onValueChange={handleFamilySwitch}>
                <SelectTrigger className="w-[240px]" aria-label="模型族选择" data-testid="engine-family-select">
                  <SelectValue placeholder="选择模型族" />
                </SelectTrigger>
                <SelectContent>
                  {ALL_ENGINE_FAMILIES.map((family) => (
                    <SelectItem key={family.value} value={family.value} disabled={family.status !== "ready"}>
                      {family.label}
                      {family.status !== "ready" ? `(${family.hint})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </McpRow>

        {/* ── R3 工作流(1102):当前族多列展示+文生图/图生图绑定;出图实走绑定件 ── */}
        <McpRow
          sectionId="workflows"
          icon={Server}
          title="工作流（文生图 / 图生图绑定）"
          pill={familyWorkflows.length > 0 ? "ready" : "neutral"}
          collapsed={collapsedSections.has("workflows")}
          onToggle={toggleSectionCollapsed}
        >
          <div className="space-y-3 px-5 py-3" data-testid="engine-workflows-section">
            {!currentFamily.workflowPrefix ? (
              <p className="text-xs text-muted-foreground">
                当前族工作流为引擎内置模板,库内暂无域目录——绑定待该族入库后开放。
              </p>
            ) : workflowsLoading ? (
              <p className="text-xs text-muted-foreground">清单拉取中…</p>
            ) : workflowsError ? (
              <p className="text-xs text-destructive" data-testid="engine-workflows-error">{workflowsError}</p>
            ) : (
              <>
                {([
                  ["t2i", "文生图", t2iCandidates],
                  ["i2i", "图生图(含编辑)", i2iCandidates],
                ] as const).map(([kind, kindLabel, candidates]) => (
                  <div key={kind} className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">{kindLabel}</div>
                    {candidates.length === 0 ? (
                      <p className="text-xs text-muted-foreground">(该类型暂无库内件)</p>
                    ) : (
                      candidates.map((workflow) => {
                        const bound = bindings[`${kind}WorkflowId` as const] === workflow.id;
                        return (
                          <div
                            key={workflow.id}
                            className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${bound ? "border-primary/60 bg-primary/5" : "border-border"}`}
                            data-testid={`engine-workflow-row-${kind}`}
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm">{workflow.name}</div>
                              <div className="truncate text-[11px] text-muted-foreground" title={workflow.id}>
                                {workflow.id}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {bound && (
                                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                                  在用
                                </span>
                              )}
                              {isBindableWorkflow(workflow.id) ? (
                                <Button
                                  size="sm"
                                  variant={bound ? "default" : "outline"}
                                  onClick={() => bindings.setBinding(kind as BoundWorkflowKind, bound ? null : workflow.id)}
                                  data-testid={`engine-workflow-bind-${kind}`}
                                >
                                  {bound ? "解绑" : `设为${kindLabel}用`}
                                </Button>
                              ) : (
                                // 1102 收口轮:引擎 load_template 只吃 API 模板名,非道劫件
                                // 无同源模板——诚实标注不给绑定钮(防绑了不生效的假绑定)
                                <span className="text-[10px] text-muted-foreground">暂无引擎模板</span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  绑定后出图实走该工作流;不绑=引擎按类型自动选默认模板(零迁移)。
                </p>
              </>
            )}
          </div>
        </McpRow>
      </McpGroup>
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
      </div>
      </ScrollArea>

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
    </>
  );
}
