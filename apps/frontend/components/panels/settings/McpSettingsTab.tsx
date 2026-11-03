"use client";

// MCP 服务设置 tab(09-01-mcp-settings-section)。
// 布局仿「本地配置」页:分组标签 + 可折叠行 + 行级状态胶囊(PluginSettingsTab 同款范式,
// 折叠态持久化 localStorage)。三组:服务连接(ComfyUI 桥+专业流开关)→ MCP 服务器 → JSON 配置。

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, FileJson, Loader2, Monitor, Pencil, Plug, Plus, Server, Terminal, Trash2, X } from "lucide-react";
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
  normalizeEngineUrl,
  useEnginePresetsStore,
  type EnginePreset,
} from "@/stores/settings/engine-presets-store";
import {
  useSshPresetsStore,
  type SshActiveFingerprint,
  type SshPreset,
} from "@/stores/settings/ssh-presets-store";
import { useWorkflowBindingsStore, isBindableWorkflow, type BoundWorkflowKind } from "@/stores/settings/workflow-bindings-store";
import { engineFamilyMeta } from "@/lib/studio/engine-line/family-catalog";
import { ALL_ENGINE_FAMILIES } from "@/lib/studio/engine-line/engine-options";
import { notifyRemoteEngineChanged } from "@/lib/studio/engine-line/resolve-engine-base-url";
import {
  getRemoteEngine,
  setRemoteEngine,
  probeEngineUrl,
  comfySidecarRequest,
  ComfySidecarHttpError,
  SIDECAR_DOWN_GUIDANCE,
  isSidecarDownError,
  getComfySshStatus,
  setComfySshConfig,
  testComfySshConnection,
  refreshComfySshToken,
  getEngineSyncManifest,
  syncEngine,
  restartRemoteEngine,
  ENGINE_SYNC_OVERALL_TIMEOUT_MS,
  type ComfyRemoteEngineStatus,
  type ComfySshStatus,
  type ComfySshTestReply,
  type EngineSyncManifest,
  type EngineSyncManifestItem,
  type EngineSyncResultItem,
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

// SSH 连接表单草稿(11-03 终版:多条连接列表的添加/编辑共用形态):port 用
// string 承接输入态(保存时解析 int,非法回退 22);密钥路径留空=后端自动
// 探测(~/.ssh/id_ed25519 → id_ecdsa → id_rsa)。label 选填,缺省=host。
interface SshFormDraft {
  password: string;
  label: string;
  host: string;
  port: string;
  user: string;
  keyPath: string;
}

const emptySshFormDraft: SshFormDraft = { label: "", host: "", port: "22", user: "", keyPath: "", password: "" };

/** 表单草稿 → store 入参(host 必填校验由 store 承接,非法回 null)。 */
const sshDraftToInput = (draft: SshFormDraft, id?: string) => ({
    password: draft.password || "",
  ...(id ? { id } : {}),
  label: draft.label,
  host: draft.host,
  port: Number.parseInt(draft.port.trim(), 10),
  user: draft.user,
  keyPath: draft.keyPath,
});

/** SSH「当前连接」指纹匹配(1103 终版 Q1 + ③修复:port 纳入,PRD host+port+user
 *  三全比对):host/user 以 GET /comfy/ssh/status 实时回读为准(契约不回
 *  port/keyPath);port 侧取 store.activeFingerprint——最近一次成功 POST
 *  /comfy/ssh/config 回执(save_config 返回完整落盘配置含 port),持久化跨重开
 *  存活。指纹与 status 的 host+user 脱节(配置被外部改过)= port 侧退回未知。
 *  恒零或一行命中:① port 已知→按 port 过滤,零命中(激活行被改 port 未重新
 *  落章)或多行同指纹(完全重复行)都不冒认;② port 未知(legacy 未经 UI 落章)
 *  → 同 host+user 多行无法消歧,零命中不冒认——点行一次即落章回执重建真相。
 *  凭据真源恒是后端 ssh-remote.json,指纹只承载 port 侧匹配事实(C5 不破)。 */
function resolveActiveSshPresetId(
  presets: SshPreset[],
  status: ComfySshStatus | null | undefined,
  fingerprint: SshActiveFingerprint | null,
): string | null {
  if (!status?.configured || !status.host) return null;
  const hostUserMatches = presets.filter(
    (p) => p.host === status.host && p.user === (status.user ?? ""),
  );
  if (hostUserMatches.length === 0) return null;
  const portKnown =
    fingerprint !== null &&
    fingerprint.host === status.host &&
    fingerprint.user === (status.user ?? "");
  const finalMatches = portKnown
    ? hostUserMatches.filter((p) => p.port === fingerprint.port)
    : hostUserMatches;
  return finalMatches.length === 1 ? finalMatches[0].id : null;
}

const COLLAPSED_STORAGE_KEY = "mystudio.settings.mcp.collapsedSections";
type SectionId = "bridge" | "remote-engine" | "engine-sync" | "ssh-remote" | "family" | "workflows" | "servers" | "json";
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
  // ── SSH 远端连接(11-03 终版:多条连接列表,引擎/SSH 两列表零联动)──
  const [sshStatus, setSshStatus] = useState<ComfySshStatus | null>(null);
  // 隧道开关=全局单份(不随条目;status 回显,切换连接/拨开关时随凭据落章)
  const [sshTunnelEnabled, setSshTunnelEnabled] = useState(true);
  const [sshSwitching, setSshSwitching] = useState(false);
  const [sshTesting, setSshTesting] = useState(false);
  const [sshRefreshing, setSshRefreshing] = useState(false);
  const [sshTest, setSshTest] = useState<
    { status: "idle" } | { status: "ok"; reply: ComfySshTestReply } | { status: "error"; message: string }
  >({ status: "idle" });
  // 「立即刷新令牌」结果行(null=未操作;ok 决定着色)
  const [sshTokenMsg, setSshTokenMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 添加表单(展开态)+编辑 dialog(1103 终版 R2:form→list 范式迁移,照引擎区)
  const [addingSsh, setAddingSsh] = useState(false);
  const [sshAddDraft, setSshAddDraft] = useState<SshFormDraft>(emptySshFormDraft);
  const [sshEditing, setSshEditing] = useState<SshPreset | null>(null);
  const [sshEditDraft, setSshEditDraft] = useState<SshFormDraft>(emptySshFormDraft);
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

  // SSH 状态回显(1103 终版 Q1 指纹真源):sidecar 未运行/老 sidecar 无 SSH 路由
  // (404 同族)时静默空态——照远程引擎行范式,首开设置页不弹错。status 只带
  // host/user/tunnelEnabled(port/keyPath 后端契约不回显;port 侧匹配事实住
  // store.activeFingerprint,见 resolveActiveSshPresetId)。同一拍做存量迁移
  // (Q2):store 空+后端已配置 → ssh-remote.json 现连自动入列为第一条
  // (label=host,port 走默认 22,status 不回显;真 port 点行落章后由回执扶正);
  // GET 失败=静默跳过(C6)。
  useEffect(() => {
    let cancelled = false;
    getComfySshStatus()
      .then((status) => {
        if (cancelled) return;
        setSshStatus(status);
        // ?? 兜底:老 sidecar/异常回执缺键时不把 undefined 写进开关
        // (Switch checked 失控告警防线)
        setSshTunnelEnabled(status.tunnelEnabled ?? true);
        if (
          status.configured &&
          status.host &&
          useSshPresetsStore.getState().presets.length === 0
        ) {
          useSshPresetsStore.getState().save({
            host: status.host,
            user: status.user ?? "",
            label: status.host,
          });
        }
      })
      .catch(() => {
        /* 保持空态,操作时会给出大白话;迁移一并跳过(C6) */
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
  const testRemoteConnection = async (rawUrlOverride?: string) => {
    // rawUrlOverride(1103 devices-list):设备行/添加表单直传待探地址;缺省=输入框草稿
    const base = normalizeEngineUrl(rawUrlOverride ?? remoteDraft) || normalizeEngineUrl(remoteEngine?.effective ?? "");
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
        // 1102 F4 终态:成功=弹窗即全部;1103 修:note 随被测地址与生效引擎
        // 的关系分口径(旧「未保存」文案是输入框时代残留,设备列表已无「保存
        // 并测试」按钮——测当前生效机=已生效,测其他设备=点行切换)
        const testingActive = remoteEngine?.source === "settings" && base === normalizeEngineUrl(remoteEngine.url ?? "");
        setEngineOkDialog({
          headline: `连接成功(${comfyVersionLabel(probe.comfyui_version ?? "未知版本", probe.device ?? null)})`,
          note: testingActive ? "该设备已是当前生效引擎" : "点该设备行即可切换生效",
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
      // 引擎地址变更广播(1102 R1):画布 src/配置页提示条等跟随视图零重启刷新。
      notifyRemoteEngineChanged();
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

  // ── SSH 远端连接(1103 终版):切换连接/测试连接(仅探活)/立即刷新令牌 ──
  // 1103 追修(保存即显"断开"假断,保留项):切换触发的 keeper 重连有 1-2s 撕旧
  // 建新窗口,单次状态回读会吃到处断开态且永不再刷——带退避沉降轮询直到连上或
  // 试尽。
  // (1104 engine-sync R4:旧「同步插件」行内按钮+handleSyncPlugins 已撤,换引擎
  // 地址区「引擎同步」折叠子区;后端 /comfy/ssh/sync-plugins 端点保留兼容。)

  // ── 引擎同步(11-04 engine-sync R3):单真源清单+勾选+逐项同步+结果弹窗 ──
  const [engineSyncManifest, setEngineSyncManifest] = useState<EngineSyncManifest | null>(null);
  const [engineSyncError, setEngineSyncError] = useState<string | null>(null);
  const [engineSyncChecked, setEngineSyncChecked] = useState<Record<string, boolean>>({});
  // 逐项进度(Q3:每完成一件更新一行):name → "pending" ⬜等待 | "syncing" ⏳ | 完成回执
  const [engineSyncProgress, setEngineSyncProgress] = useState<Record<string, "pending" | "syncing" | EngineSyncResultItem>>({});
  const [engineSyncRunning, setEngineSyncRunning] = useState(false);
  // 同步完成结果弹窗(null=关;⚠️ pip 失败不阻断,随行展示)
  const [engineSyncDialog, setEngineSyncDialog] = useState<EngineSyncResultItem[] | null>(null);
  const [engineRestarting, setEngineRestarting] = useState(false);

  // 挂载即取清单(R3):GET manifest → 渲染勾选清单。SSH 未连接(503 ssh-
  // disconnected)/sidecar 未在驾 → 静默留空态+提示,按钮禁用(照 SSH 行范式
  // 首开设置页不弹错)。win-only 默认取消勾选(Q1 并集不删);skip(my-nodes,
  // Q2)不渲染。
  useEffect(() => {
    let cancelled = false;
    getEngineSyncManifest()
      .then((manifest) => {
        if (cancelled) return;
        setEngineSyncManifest(manifest);
        setEngineSyncError(null);
        setEngineSyncChecked(
          Object.fromEntries(
            manifest.items
              .filter((item) => item.status === "both" || item.status === "mac-only")
              .map((item) => [item.name, true]),
          ),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        if (isSidecarDownError(error)) setEngineSyncError(SIDECAR_DOWN_GUIDANCE);
        else if (error instanceof ComfySidecarHttpError && error.status === 503)
          setEngineSyncError("需先连接 SSH(下方 SSH 远端连接点一条连接)再取同步清单");
        else setEngineSyncError(error instanceof Error ? error.message : "取同步清单失败");
      });
    return () => { cancelled = true; };
  }, []);

  // 引擎同步清单可见行(skip 态不渲染;skip=my-nodes Q2 归 deploy-dual 管——
  // 手动清单条目双侧均无时后端报 mac-only,不落 skip,可见可勾选)
  const engineSyncRows: EngineSyncManifestItem[] = (engineSyncManifest?.items ?? []).filter(
    (item) => item.status !== "skip",
  );

  const toggleEngineSyncItem = (name: string, checked: boolean) => {
    setEngineSyncChecked((prev) => ({ ...prev, [name]: checked }));
  };

  // 开始同步(R3):勾选项逐件 POST sync-engine——单发 POST 拿不到中途回执,
  // 逐件串行发=真·逐项进度(Q3 每完成一件更新一行);单件失败不拦后续(C8)。
  // 整体超时 30min(Q3;1104 修正 10→30min,41 件全量 clone 需要时间)跨批次
  // 生效(1104 复核修):逐件单发会让每件都拿全新预算,故前端持全局 deadline
  // ——每件 POST 带剩余秒数(timeoutS),预算耗尽后剩余件不再发、按后端同口径
  // 标「整体超时」。
  const startEngineSync = async () => {
    const names = engineSyncRows
      .filter((item) => item.status !== "win-only" && engineSyncChecked[item.name])
      .map((item) => item.name);
    if (names.length === 0 || engineSyncRunning) return;
    setEngineSyncRunning(true);
    setEngineSyncProgress(Object.fromEntries(names.map((name) => [name, "pending" as const])));
    const deadline = Date.now() + ENGINE_SYNC_OVERALL_TIMEOUT_MS;
    const overallTimeoutError = `整体超时(${ENGINE_SYNC_OVERALL_TIMEOUT_MS / 60_000}min),未同步`;
    const results: EngineSyncResultItem[] = [];
    for (const name of names) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        // 预算耗尽:不发新 POST,剩余件按后端超时同口径收摊
        const timedOut: EngineSyncResultItem = {
          name,
          type: name === "ComfyUI" ? "engine" : "plugin",
          macHead: null,
          winHead: null,
          action: "failed",
          verified: false,
          error: overallTimeoutError,
        };
        results.push(timedOut);
        setEngineSyncProgress((prev) => ({ ...prev, [name]: timedOut }));
        continue;
      }
      setEngineSyncProgress((prev) => ({ ...prev, [name]: "syncing" }));  // 当前件 ⏳,其余 ⬜ 等待
      try {
        const reply = await syncEngine([name], Math.max(1, Math.ceil(remainingMs / 1000)));
        const item = reply.items[0];
        results.push(item);
        setEngineSyncProgress((prev) => ({ ...prev, [name]: item }));
      } catch (error) {
        const failed: EngineSyncResultItem = {
          name,
          type: name === "ComfyUI" ? "engine" : "plugin",
          macHead: null,
          winHead: null,
          action: "failed",
          verified: false,
          error: error instanceof Error ? error.message : "同步失败",
        };
        results.push(failed);
        setEngineSyncProgress((prev) => ({ ...prev, [name]: failed }));
      }
    }
    setEngineSyncRunning(false);
    setEngineSyncDialog(results);
    if (results.some((r) => r.action === "failed")) {
      toast.error(`引擎同步有 ${results.filter((r) => r.action === "failed").length} 件失败——见结果弹窗`);
    } else {
      toast.success("引擎同步完成——建议重启引擎使插件生效");
    }
  };

  // 重启引擎(R3):SSH schtasks /Run /TN EngineDurable(远端 Windows 计划任务)
  const restartEngine = async () => {
    setEngineRestarting(true);
    try {
      const reply = await restartRemoteEngine();
      if (reply.ok) toast.success("重启指令已发(EngineDurable),引擎约需 1-2 分钟起");
      else toast.error(`重启指令失败: ${reply.output || "schtasks 未成功"}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重启失败");
    } finally {
      setEngineRestarting(false);
    }
  };

  const refreshSshStatusWithSettle = async (maxAttempts = 4) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const status = await getComfySshStatus();
        setSshStatus(status);
        if (status.connected) return;
      } catch {
        /* 回读失败保留上次态,下轮再试 */
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1500 : 3000));
      }
    }
  };

  // 切换当前 SSH 连接(点行,R2):POST /comfy/ssh/config 写该条凭据(隧道随行,
  // 全局开关态一并落章)→keeper 重连→沉降轮询翻绿→LRU 置顶。后端 ssh-remote.json
  // 恒单份=当前连接(一时刻一连接,R4 契约零改)。回执(save_config 返回完整落盘
  // 配置,含 port)存为当前连接指纹(③修复:同 host+user 异 port 双档的匹配消歧
  // 靠它,持久化跨重开存活)。
  const switchSshConnection = async (preset: SshPreset) => {
    setSshSwitching(true);
    setSshTest({ status: "idle" });
    try {
      const reply = await setComfySshConfig({
        host: preset.host,
        port: preset.port,
        user: preset.user,
        keyPath: preset.keyPath,
        tunnelEnabled: sshTunnelEnabled,
      password: preset.password || "",});
      useSshPresetsStore.getState().setActiveFingerprint({
        host: reply.host,
        port: reply.port,
        user: reply.user,
      });
      toast.success(`SSH 已切换:${preset.label}`);
      useSshPresetsStore.getState().touch(preset.id);
      // 切换后刷新实时态=沉降轮询(单次回读会吃 keeper 重连窗口的假断态,1103 追修)
      void refreshSshStatusWithSettle();
    } catch (error) {
      const message = isSidecarDownError(error)
        ? SIDECAR_DOWN_GUIDANCE
        : error instanceof Error
          ? error.message
          : "切换失败";
      setSshTest({ status: "error", message });
      toast.error(message);
    } finally {
      setSshSwitching(false);
    }
  };

  // 添加表单保存(R2):只入 store 不落章——激活走点行(与引擎设备「保存并生效」
  // 区分:SSH 列表保存=存意图,零副作用)。host 空=store 拒收,这里给文案。
  const submitAddSsh = () => {
    const saved = useSshPresetsStore.getState().save(sshDraftToInput(sshAddDraft));
    if (!saved) {
      setSshTest({ status: "error", message: "SSH 主机必填(如 192.168.0.101)" });
      return;
    }
    setAddingSsh(false);
    setSshAddDraft(emptySshFormDraft);
    setSshTest({ status: "idle" });
    toast.success(`SSH 连接「${saved.label}」已保存,点击该行即可连接`);
  };

  // 编辑 dialog 保存(R2:改所有字段,保 id):只改 store 档案;若改的正是当前
  // 连接行,后端仍持旧凭据——点该行重新落章即生效(toast 指路,不偷写)。
  const submitEditSsh = () => {
    if (!sshEditing) return;
    const saved = useSshPresetsStore.getState().save(sshDraftToInput(sshEditDraft, sshEditing.id));
    if (!saved) {
      toast.error("SSH 主机必填(如 192.168.0.101)");
      return;
    }
    setSshEditing(null);
    toast.success(`SSH 连接「${saved.label}」已更新,点该行应用新凭据`);
  };

  // 隧道开关(全局,保留现位置):翻转即写回当前连接(resolveActiveSshPresetId
  // 消歧后的那一条携全量凭据落章——同 host+user 异 port 双档时恒取 UI 标
  // 「当前连接」的那行,不冒认;防 status 无 keyPath 回显被空值覆写);无当前
  // 连接/无法消歧=只翻本地态,随下次点行激活落章。
  const toggleSshTunnel = async (checked: boolean) => {
    setSshTunnelEnabled(checked);
    const presets = useSshPresetsStore.getState().presets;
    const activePreset = presets.find(
      (p) => p.id === resolveActiveSshPresetId(presets, sshStatus, sshActiveFingerprint),
    );
    if (!activePreset) return;
    try {
      const reply = await setComfySshConfig({
        host: activePreset.host,
        port: activePreset.port,
        user: activePreset.user,
        keyPath: activePreset.keyPath,
        tunnelEnabled: checked,
      });
      useSshPresetsStore.getState().setActiveFingerprint({
        host: reply.host,
        port: reply.port,
        user: reply.user,
      });
      void refreshSshStatusWithSettle();
    } catch {
      /* 写回失败保本地态(下次点行激活随行),不给打断性报错 */
    }
  };

  // 测试连接(POST /comfy/ssh/test,仅测不存;后端契约=测当前连接,行内/表单
  // 钮共用):回执四件——登录用户/服务器版本(SSHServer banner)/令牌读取结果
  // (len 掩码,内容永不回显)/隧道探活。失败态带 reason(needs-runtime/
  // not-configured/disconnected)+message。
  const testSshConnection = async () => {
    setSshTesting(true);
    setSshTest({ status: "idle" });
    try {
      const reply = await testComfySshConnection();
      setSshTest({ status: "ok", reply });
    } catch (error) {
      const message = isSidecarDownError(error)
        ? SIDECAR_DOWN_GUIDANCE
        : error instanceof Error
          ? error.message
          : "测试失败";
      setSshTest({ status: "error", message });
    } finally {
      setSshTesting(false);
    }
  };

  // 立即刷新令牌(POST /comfy/ssh/token-refresh):SFTP 自动重取远端
  // controlToken(R2 病根根治的手动触发点);回执 ok+tokenRefreshedAt(epoch 秒)。
  const refreshSshTokenNow = async () => {
    setSshRefreshing(true);
    setSshTokenMsg(null);
    try {
      const reply = await refreshComfySshToken();
      if (reply.ok) {
        const at = typeof reply.tokenRefreshedAt === "number" ? reply.tokenRefreshedAt : null;
        setSshTokenMsg({
          ok: true,
          text: `令牌已刷新${at ? `(${new Date(at * 1000).toLocaleTimeString()})` : ""}`,
        });
      } else {
        setSshTokenMsg({
          ok: false,
          text: "令牌刷新失败(SSH 未连接,或令牌真源路径均未取到有效令牌)——可先「测试连接」看四项回执定位",
        });
      }
    } catch (error) {
      setSshTokenMsg({
        ok: false,
        text: isSidecarDownError(error)
          ? SIDECAR_DOWN_GUIDANCE
          : error instanceof Error
            ? error.message
            : "刷新失败",
      });
    } finally {
      setSshRefreshing(false);
    }
  };

  // needs-runtime(C2 终版:SSH 列表区顶部全局黄条,环境级不随条目):
  // status.available=false(paramiko 未装)或测试回执点名 needs-runtime——提示去
  // Python 运行环境页;实时态仍按连接态展示(fail-open 不拦操作)。
  const sshNeedsRuntime =
    sshStatus?.available === false ||
    (sshTest.status === "ok" && sshTest.reply.reason === "needs-runtime");

  // ── 引擎地址常用条目(11-02;1103 终版回归纯引擎:零 SSH 字段,D1-D7)──
  const enginePresets = useEnginePresetsStore((s) => s.presets);
  const enginePresetFavorite = useEnginePresetsStore((s) => s.favorite);
  const enginePresetTouch = useEnginePresetsStore((s) => s.touch);
  const enginePresetRemove = useEnginePresetsStore((s) => s.remove);
  const enginePresetRename = useEnginePresetsStore((s) => s.rename);
  // ── SSH 连接条目(1103 终版:独立多条 store,与引擎列表零联动)──
  const sshPresets = useSshPresetsStore((s) => s.presets);
  // 当前连接指纹(1103 ③修复):落章回执记住的 host+port+user,随 store 持久化;
  // 与 sshStatus(host/user 实时真源)合力做 host+port+user 三全比对(见
  // resolveActiveSshPresetId),同 host+user 异 port 双档恒零或一行命中。
  const sshActiveFingerprint = useSshPresetsStore((s) => s.activeFingerprint);
  const activeSshPresetId = useMemo(
    () => resolveActiveSshPresetId(sshPresets, sshStatus, sshActiveFingerprint),
    [sshPresets, sshStatus, sshActiveFingerprint],
  );
  // R1 生效判定(1102→1103 devices-list):地址指向远端=有远端设备生效,否则本机
  const remoteActive = remoteEngine?.source === "settings" && Boolean(remoteEngine.url);
  const activeRemoteUrl = remoteActive ? normalizeEngineUrl(remoteEngine?.url ?? "") : "";

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

  // ── 设备列表(1103 devices-list 役,模仿 ZCode RemoteConnectionSelection)──
  // 激活设备:点设备行即切换(坑①沿用:必传 urlOverride——setRemoteDraft 异步落帧)。
  // 1103 终版(D3):activateDevice 只 POST /comfy/engine/remote——引擎与 SSH 零
  // 联动,切引擎绝不碰 SSH 配置(前案双写块全数退役)。
  const activateDevice = (url: string) => {
    setRemoteDraft(url);
    void saveRemoteEngine(url);
  };

  // 添加设备表单:名字选填(缺省 hostname)+地址;保存=保存生效(saveRemoteEngine
  // 成功即自动 favorite 入列)+ 自定义名 rename 覆盖。1103 终版(D4):纯引擎
  // 表单,SSH 字段退役——SSH 连接在下方 SSH 列表独立管理。
  const [addingDevice, setAddingDevice] = useState(false);
  const [addDraft, setAddDraft] = useState({ label: "", url: "" });
  const submitAddDevice = () => {
    const url = normalizeEngineUrl(addDraft.url);
    if (!/^https?:\/\//.test(url)) {
      setRemoteTest({ status: "error", message: "地址格式不对(须 http(s)://主机[:端口];全角：／已自动归一)" });
      return;
    }
    const label = addDraft.label.trim();
    setRemoteDraft(url);
    void saveRemoteEngine(url).then(() => {
      // favorite 已入列(label 缺省=hostname);用户填了名→rename 覆盖
      if (label) enginePresetRename(url, label);
    });
    setAddingDevice(false);
  };

  // 编辑设备(名字/地址):地址不变=只 rename;地址变=删旧加新(自定义名带入),
  // 旧地址若正是生效机→保存并激活新地址(生效连续性);否则不动引擎。
  const [editingDevice, setEditingDevice] = useState<EnginePreset | null>(null);
  const [editDraft, setEditDraft] = useState({ label: "", url: "" });
  const submitEditDevice = () => {
    if (!editingDevice) return;
    const oldUrl = editingDevice.url;
    const newUrl = normalizeEngineUrl(editDraft.url);
    const label = editDraft.label.trim();
    if (newUrl === oldUrl) {
      enginePresetRename(oldUrl, label);
    } else {
      const wasActive = remoteActive && normalizeEngineUrl(remoteEngine?.url ?? "") === oldUrl;
      enginePresetRemove(oldUrl);
      if (/^https?:\/\//.test(newUrl)) enginePresetFavorite(newUrl, label);
      if (wasActive) activateDevice(newUrl);
    }
    setEditingDevice(null);
    toast.success("设备已更新");
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
            {/* R2 全景状态条(1104 engine-failure-guidance):远端引擎/SSH 隧道/远端管理/本地备胎
                四组件一排状态,有红/黄时给一句话建议——用户令:每种情况都要有提示 */}
            <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="engine-status-bar">
              {remoteActive ? (
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${remoteTest.status === "ok" || remoteEngine ? "border-success/25 bg-success/10 text-success" : "border-destructive/25 bg-destructive/[0.08] text-destructive/90"}`}>
                  {remoteTest.status === "ok" || remoteEngine ? "✅" : "❌"} 远端引擎
                </span>
              ) : null}
              {sshStatus?.configured ? (
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${sshStatus.connected ? "border-success/25 bg-success/10 text-success" : "border-destructive/25 bg-destructive/[0.08] text-destructive/90"}`}>
                  {sshStatus.connected ? "✅" : "❌"} SSH 隧道
                </span>
              ) : null}
              {remoteActive ? (
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${sshStatus?.connected ? "border-success/25 bg-success/10 text-success" : "border-warning/40 bg-warning/[0.06] text-warning"}`}>
                  {sshStatus?.connected ? "✅" : "⚠️"} 远端管理
                </span>
              ) : null}
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${useEnginePresetsStore.getState().presets.length > 0 ? "border-success/25 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground"}`}>
                {remoteActive ? "✅" : "⚠️"} 本地备胎{!remoteActive ? "(当前本机模式)" : ""}
              </span>
            </div>
            {(sshStatus?.configured && !sshStatus.connected) || (remoteActive && !remoteEngine) ? (
              <p className="text-xs leading-4 text-warning" data-testid="engine-status-hint">
                {remoteActive && !remoteEngine ? "远端引擎不可达——出图会失败,请检查 Windows ComfyUI" : ""}
                {remoteActive && !remoteEngine && sshStatus?.configured && !sshStatus.connected ? "; " : ""}
                {sshStatus?.configured && !sshStatus.connected ? "SSH 隧道断开——工作流列表/模型库存不可用,出图不受影响" : ""}
              </p>
            ) : null}
            {/* R1 设备列表(1103 devices-list 役,模仿 ZCode RemoteConnectionSelection):
                本机行恒在恒首 + N 远端设备行;行点击=激活;选中=圆点+高亮+「当前生效」
                徽标(恒恰一行);行内 测试/编辑/删除;底部「+ 添加设备」(ZCode 底部
                新建连接排范式)。多机真源=presets store;生效机=remote-engine.json
                单值切换——列表是配置管理,一时刻一生效机。 */}
            <div className="space-y-2" data-testid="engine-devices-list">
              {/* 本机行(kind=local):恒在恒首不可删;点行=清地址切回本机 */}
              <div
                className={`rounded-xl border p-3 ${!remoteActive ? "border-primary/60 bg-primary/5" : "border-border"}`}
                data-testid="engine-device-local"
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!remoteActive}
                    onClick={() => {
                      if (remoteActive) activateDevice("");
                    }}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left"
                    data-testid="engine-device-local-select"
                    title="选中本机引擎(清空远端地址)"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Monitor className="size-4 text-muted-foreground" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={`h-3 w-3 shrink-0 rounded-full border-2 ${!remoteActive ? "border-primary bg-primary" : "border-muted-foreground/40 bg-transparent"}`}
                          aria-hidden
                        />
                        <span className="truncate text-sm font-medium">本机引擎(Mac 托管)</span>
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        Mac 本机托管 · 启停/模型在「设置 → 本地配置」
                      </span>
                    </span>
                  </button>
                  {!remoteActive && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">当前生效</span>
                  )}
                </div>
              </div>
              {/* 远端设备行:presets 逐台;点行=保存该机地址生效(saveRemoteEngine
                  成功即自动收藏置顶+LRU 刷新) */}
              {enginePresets.map((p) => {
                const isActive = remoteActive && activeRemoteUrl === p.url;
                return (
                  <div
                    key={p.url}
                    className={`rounded-xl border p-3 ${isActive ? "border-primary/60 bg-primary/5" : "border-border"}`}
                    data-testid="engine-device-remote"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        onClick={() => {
                          if (!isActive) activateDevice(p.url);
                        }}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left"
                        data-testid="engine-device-remote-select"
                        data-url={p.url}
                        title={`切换到 ${p.label}`}
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Server className="size-4 text-muted-foreground" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span
                              className={`h-3 w-3 shrink-0 rounded-full border-2 ${isActive ? "border-primary bg-primary" : "border-muted-foreground/40 bg-transparent"}`}
                              aria-hidden
                            />
                            <span className="truncate text-sm font-medium">{p.label}</span>
                          </span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">{p.url}</span>
                        </span>
                      </button>
                      {isActive && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">当前生效</span>
                      )}
                      <span className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2 text-xs"
                          onClick={() => void testRemoteConnection(p.url)}
                          disabled={remoteProbing}
                          data-testid="engine-device-test"
                          data-url={p.url}
                          title="仅探活不保存"
                        >测试</Button>
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2 text-xs"
                          onClick={() => {
                            setEditingDevice(p);
                            setEditDraft({ label: p.label, url: p.url });
                          }}
                          data-testid="engine-device-edit"
                          data-url={p.url}
                        ><Pencil className="mr-0.5 h-3 w-3" aria-hidden />编辑</Button>
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => enginePresetRemove(p.url)}
                          aria-label={`删除设备 ${p.label}`}
                          data-testid="engine-device-delete"
                          data-url={p.url}
                          title="删除设备条目(不改动当前生效引擎)"
                        ><Trash2 className="h-3 w-3" aria-hidden /></Button>
                      </span>
                    </div>
                  </div>
                );
              })}
              {enginePresets.length === 0 && !addingDevice && (
                <p className="px-1 text-xs leading-5 text-muted-foreground" data-testid="engine-devices-empty">
                  暂无远端设备——点下方「添加设备」录入 Windows 等机器的引擎地址,可配多台随时切换。
                </p>
              )}
            </div>
            {/* + 添加设备(ZCode 底部新建连接排范式):名字选填+地址;可先测试再保存生效 */}
            {!addingDevice ? (
              <Button
                variant="outline" size="sm" className="self-start"
                onClick={() => {
                  setAddingDevice(true);
                  setAddDraft({ label: "", url: "" });
                  setRemoteTest({ status: "idle" });
                }}
                disabled={remoteSaving || remoteProbing}
                data-testid="engine-device-add"
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />添加设备
              </Button>
            ) : (
              <div className="space-y-2.5 rounded-xl border border-border p-3" data-testid="engine-device-add-form">
                <div className="grid gap-2.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="engine-device-name">设备名(选填)</Label>
                    <Input
                      id="engine-device-name"
                      value={addDraft.label}
                      onChange={(e) => setAddDraft((prev) => ({ ...prev, label: e.target.value }))}
                      placeholder="如:Windows 主力(缺省=主机地址)"
                      data-testid="engine-device-add-name"
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="engine-device-url">引擎地址</Label>
                    <Input
                      id="engine-device-url"
                      value={addDraft.url}
                      onChange={(e) => setAddDraft((prev) => ({ ...prev, url: e.target.value }))}
                      placeholder="http://192.168.x.x:17000(全角：／自动归一)"
                      data-testid="engine-device-add-url"
                      spellCheck={false}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => void testRemoteConnection(normalizeEngineUrl(addDraft.url))}
                    disabled={remoteProbing || remoteSaving || !addDraft.url.trim()}
                    data-testid="engine-device-add-test"
                  >{remoteProbing ? "测试中…" : "测试连接"}</Button>
                  <Button
                    size="sm"
                    onClick={submitAddDevice}
                    disabled={remoteSaving || !addDraft.url.trim()}
                    data-testid="engine-device-add-save"
                  >{remoteSaving ? "保存中…" : "保存并生效"}</Button>
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => setAddingDevice(false)}
                    disabled={remoteSaving}
                    data-testid="engine-device-add-cancel"
                  >取消</Button>
                </div>
              </div>
            )}
            {/* 编辑设备(名字/地址):地址不变=只改名;地址变=删旧加新(自定义名带入),
                被编辑的正是生效机时无缝续活到新地址 */}
            <Dialog open={editingDevice !== null} onOpenChange={(open) => !open && setEditingDevice(null)}>
              <DialogContent className="max-w-sm" data-testid="engine-device-edit-dialog">
                <DialogHeader>
                  <DialogTitle>编辑设备</DialogTitle>
                  <DialogDescription>改名或换地址;正在生效的设备换地址会自动切到新地址。</DialogDescription>
                </DialogHeader>
                <div className="grid gap-2.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="engine-device-edit-name">设备名</Label>
                    <Input
                      id="engine-device-edit-name"
                      value={editDraft.label}
                      onChange={(e) => setEditDraft((prev) => ({ ...prev, label: e.target.value }))}
                      data-testid="engine-device-edit-name"
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="engine-device-edit-url">引擎地址</Label>
                    <Input
                      id="engine-device-edit-url"
                      value={editDraft.url}
                      onChange={(e) => setEditDraft((prev) => ({ ...prev, url: e.target.value }))}
                      data-testid="engine-device-edit-url"
                      spellCheck={false}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button size="sm" variant="ghost" onClick={() => setEditingDevice(null)}>取消</Button>
                  <Button size="sm" onClick={submitEditDevice} data-testid="engine-device-edit-save">保存</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
            {/* ── 引擎同步(11-04 engine-sync R3):单真源清单+勾选+逐项同步+结果弹窗。
                C4:放引擎地址区(同步的是 ComfyUI 的东西),SSH 只是传输通道 ── */}
            <Collapsible
              open={!collapsedSections.has("engine-sync")}
              onOpenChange={() => toggleSectionCollapsed("engine-sync")}
            >
              <CollapsibleTrigger className="w-full text-left">
                <div className="flex items-center gap-2 rounded-lg px-1 py-2" data-testid="engine-sync-header">
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      collapsedSections.has("engine-sync") && "-rotate-90",
                    )}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium">引擎同步</span>
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        把引擎与插件从 GitHub 拉最新到 Windows(单真源清单,经 SSH)
                      </span>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-3 rounded-xl border border-border p-3" data-testid="engine-sync-section">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      同步源: GitHub(各件 origin 仓库;Win 已有即拉最新,缺件即克隆)
                      {engineSyncRows.filter((i) => i.status === "mac-only").length > 0
                        ? `(含 Win 待装 ${engineSyncRows.filter((i) => i.status === "mac-only").length} 件)`
                        : ""}
                    </span>
                    <span>目标: Windows(经 SSH 当前会话拉取)</span>
                  </div>
                  {/* SSH 断开/清单取失败:按钮禁用+提示(R3);清单空同样提示 */}
                  {!sshStatus?.connected ? (
                    <p className="text-xs leading-5 text-warning" data-testid="engine-sync-ssh-hint">
                      需先连接 SSH——在下方「SSH 远端连接」点一条连接后再同步。
                    </p>
                  ) : engineSyncError ? (
                    <p className="text-xs leading-5 text-destructive" data-testid="engine-sync-error">{engineSyncError}</p>
                  ) : engineSyncRows.length === 0 ? (
                    <p className="text-xs leading-5 text-muted-foreground" data-testid="engine-sync-empty">
                      同步清单为空——本机引擎还没扫到可同步的 git 插件(先在 设置→本地配置 准备本机引擎)。
                    </p>
                  ) : (
                    <div className="space-y-1.5" data-testid="engine-sync-list">
                      {engineSyncRows.map((item) => {
                        const progress = engineSyncProgress[item.name];
                        const winOnly = item.status === "win-only";
                        return (
                          <div
                            key={item.name}
                            className={cn(
                              "flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5",
                              winOnly && "opacity-50",
                            )}
                            data-testid="engine-sync-row"
                            data-name={item.name}
                          >
                            <Checkbox
                              checked={winOnly ? false : (engineSyncChecked[item.name] ?? false)}
                              disabled={winOnly || engineSyncRunning}
                              onCheckedChange={(checked) => toggleEngineSyncItem(item.name, checked === true)}
                              aria-label={`同步 ${item.name}`}
                              data-testid="engine-sync-check"
                            />
                            <span className="min-w-0 flex-1 truncate text-sm">
                              {item.name === "ComfyUI" ? "ComfyUI 引擎" : item.name}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                              Mac {item.macHead?.slice(0, 8) ?? "—"} → Win {item.winHead?.slice(0, 8) ?? "—"}
                            </span>
                            {/* 状态标签(Q1 四态:win-only 灰显 ⏭️)。引擎行 Win 缺不
                                承诺 clone——_sync_one 引擎恒 pull 无 clone 分支,
                                Win 无引擎目录时同步将诚实报错(引擎由部署脚本装) */}
                            <span
                              className={cn(
                                "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]",
                                item.status === "mac-only"
                                  ? "border-warning/40 bg-warning/[0.06] text-warning"
                                  : item.status === "win-only"
                                    ? "border-border bg-muted/50 text-muted-foreground"
                                    : "border-border bg-muted/50 text-muted-foreground",
                              )}
                              data-testid="engine-sync-status"
                            >
                              {item.status === "mac-only"
                                ? item.name === "ComfyUI"
                                  ? "Win 缺(引擎不自动 clone)"
                                  : "Win 缺 → clone"
                                : winOnly
                                  ? "⏭️ Win 独有,保留"
                                  : "两侧都有"}
                            </span>
                            {/* 逐项进度(Q3:⬜ 等待 / ⏳ 同步中 / ✅ 完成 / ❌ 失败 / ⏭️ 跳过) */}
                            {progress === "pending" ? (
                              <span className="shrink-0 text-xs text-muted-foreground" data-testid="engine-sync-progress">⬜ 等待</span>
                            ) : progress === "syncing" ? (
                              <span className="shrink-0 text-xs text-warning" data-testid="engine-sync-progress">⏳ 同步中</span>
                            ) : progress ? (
                              <span
                                className={cn(
                                  "shrink-0 text-xs",
                                  progress.action === "failed" || !progress.verified ? "text-destructive" : "text-success",
                                )}
                                data-testid="engine-sync-progress"
                              >
                                {progress.action === "skipped"
                                  ? "⏭️ 跳过"
                                  : progress.action === "failed" || !progress.verified
                                    ? "❌ 失败"
                                    : "✅ 完成"}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => void startEngineSync()}
                      disabled={
                        engineSyncRunning ||
                        !sshStatus?.connected ||
                        engineSyncRows.length === 0 ||
                        !engineSyncRows.some((i) => i.status !== "win-only" && engineSyncChecked[i.name])
                      }
                      data-testid="engine-sync-start"
                    >
                      {engineSyncRunning ? "同步中…" : "开始同步"}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      勾选项从 GitHub 拉最新(Win 已有即更新、缺件即克隆);Win 独有件保留不动;整体超时 30 分钟。
                    </span>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
            {/* 同步完成结果弹窗(R3:逐项 ✅/❌/⏭️ + 重启建议+[重启引擎]) */}
            <Dialog open={engineSyncDialog !== null} onOpenChange={(open) => !open && setEngineSyncDialog(null)}>
              <DialogContent className="max-w-md" data-testid="engine-sync-result-dialog">
                <DialogHeader>
                  <DialogTitle>同步结果</DialogTitle>
                  <DialogDescription>逐项结果(已验证=Windows 侧目录在且 HEAD 可读)</DialogDescription>
                </DialogHeader>
                <div className="max-h-72 space-y-1.5 overflow-y-auto" data-testid="engine-sync-result-list">
                  {(engineSyncDialog ?? []).map((result) => (
                    <div key={result.name} className="flex items-start gap-2 text-xs leading-5" data-testid="engine-sync-result-row">
                      <span className="shrink-0">
                        {result.action === "failed" || !result.verified ? "❌" : result.action === "skipped" ? "⏭️" : "✅"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{result.name === "ComfyUI" ? "ComfyUI 引擎" : result.name}</span>
                        {result.action === "pulled" && result.verified
                          ? ": 已从 GitHub 拉取最新"
                          : result.action === "cloned" && result.verified
                            ? ": 已安装(新)"
                            : result.action === "skipped"
                              ? `: ${result.error ?? "跳过"}`
                              : `: ${result.error ?? "未通过验证"}`}
                        {result.pipError ? (
                          <span className="mt-0.5 block text-warning" data-testid="engine-sync-pip-warning">⚠️ {result.pipError}(不阻断)</span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">建议: 重启引擎使插件生效。</p>
                <DialogFooter>
                  <Button size="sm" variant="ghost" onClick={() => setEngineSyncDialog(null)}>关闭</Button>
                  <Button
                    size="sm"
                    onClick={() => void restartEngine()}
                    disabled={engineRestarting}
                    data-testid="engine-sync-restart"
                  >{engineRestarting ? "重启指令中…" : "重启引擎"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </McpRow>

        {/* ── SSH 远端连接(1103 终版):多条连接列表(照引擎设备列表同款范式,
            引擎/SSH 两列表零联动);点行=POST /comfy/ssh/config 切换当前连接 ── */}
        <McpRow
          sectionId="ssh-remote"
          icon={Terminal}
          title="SSH 远端连接（多条）"
          pill={
            sshNeedsRuntime
              ? "needs-runtime"
              : sshStatus?.connected
                ? "ready"
                : "neutral"
          }
          collapsed={collapsedSections.has("ssh-remote")}
          onToggle={toggleSectionCollapsed}
        >
          <div className="space-y-3 px-5 py-3" data-testid="ssh-remote-section">
            <p className="text-xs text-muted-foreground">
              管理 SSH 连接目标(隧道终点+令牌发现)——点行即连接该机;与上方引擎地址互不影响。
            </p>
            {/* C2:依赖未装(paramiko 缺失)=环境级全局黄条(不随条目)→ 指路 Python
                运行环境页(本地配置);fail-open 不拦操作 */}
            {sshNeedsRuntime && (
              <p className="text-xs leading-5 text-warning" data-testid="ssh-needs-runtime">
                SSH 依赖未安装（paramiko 缺失）：请在 设置→本地配置 →「Python 运行环境」完成准备后再使用 SSH 功能。
              </p>
            )}
            {/* 连接列表(引擎设备行同构:图标瓦+名+mono 地址+radio+徽标+行内动作)。
                「当前连接」=指纹匹配(Q1+③修复):host+user 对 status 回读,port 对
                落章回执指纹,host+port+user 三全比对恒零或一行命中(后端一时刻一
                连接;port 无法消歧的 legacy 双档=零命中不冒认,点行即重建);选中
                行显实时态,未选中行不显态。 */}
            <div className="space-y-2" data-testid="ssh-connections-list">
              {sshPresets.map((preset) => {
                const isActive = preset.id === activeSshPresetId;
                return (
                  <div
                    key={preset.id}
                    className={`rounded-xl border p-3 ${isActive ? "border-primary/60 bg-primary/5" : "border-border"}`}
                    data-testid="ssh-connection-row"
                    data-id={preset.id}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        onClick={() => {
                          if (!isActive) void switchSshConnection(preset);
                        }}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left"
                        data-testid="ssh-connection-select"
                        data-host={preset.host}
                        disabled={sshSwitching}
                        title={`切换到 ${preset.label}`}
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Server className="size-4 text-muted-foreground" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span
                              className={`h-3 w-3 shrink-0 rounded-full border-2 ${isActive ? "border-primary bg-primary" : "border-muted-foreground/40 bg-transparent"}`}
                              aria-hidden
                            />
                            <span className="truncate text-sm font-medium">{preset.label}</span>
                          </span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {preset.user ? `${preset.user}@` : ""}{preset.host}:{preset.port}
                          </span>
                          {/* 选中行实时态(唯一真连):已连接✓/断开✗;断开带 lastError */}
                          {isActive && (
                            <span className="mt-0.5 flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${
                                  sshStatus?.connected
                                    ? "border-success/25 bg-success/10 text-success"
                                    : "border-destructive/25 bg-destructive/[0.08] text-destructive/90"
                                }`}
                                data-testid="ssh-row-live-state"
                              >{sshStatus?.connected ? "SSH 已连接 ✓" : "SSH 断开 ✗"}</span>
                              {!sshStatus?.connected && sshStatus?.lastError && (
                                <span
                                  className="min-w-0 max-w-[280px] truncate text-[10px] text-destructive"
                                  data-testid="ssh-last-error"
                                  title={sshStatus.lastError}
                                >
                                  {sshStatus.lastError}
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </button>
                      {isActive && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">当前连接</span>
                      )}
                      <span className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2 text-xs"
                          onClick={() => void testSshConnection()}
                          disabled={sshTesting || sshSwitching}
                          data-testid="ssh-row-test"
                          data-host={preset.host}
                          title="仅探活不保存(测当前连接;后端一时刻一连接)"
                        >测试</Button>
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2 text-xs"
                          onClick={() => {
                            setSshEditing(preset);
                            setSshEditDraft({
                              label: preset.label,
                              host: preset.host,
                              port: String(preset.port),
                              user: preset.user,
                              keyPath: preset.keyPath,
          password: preset.password || "",});
                          }}
                          data-testid="ssh-row-edit"
                          data-host={preset.host}
                        ><Pencil className="mr-0.5 h-3 w-3" aria-hidden />编辑</Button>
                        {/* C1:刷令牌=选中行行内第四动作(令牌走当前连接,仅选中行显) */}
                        {isActive && (
                          <Button
                            size="sm" variant="ghost" className="h-7 px-2 text-xs"
                            onClick={() => void refreshSshTokenNow()}
                            disabled={sshRefreshing}
                            data-testid="ssh-row-token-refresh"
                            title="手动触发令牌自愈(POST /comfy/ssh/token-refresh,走当前连接)"
                          >{sshRefreshing ? "刷新中…" : "刷令牌"}</Button>
                        )}
                        {/* 1104 engine-sync R4:「同步插件」行内按钮已撤——同步入口收编到
                            上方引擎地址区「引擎同步」折叠子区(单真源清单+逐项进度+结果弹窗) */}
                        <Button
                          size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => useSshPresetsStore.getState().remove(preset.id)}
                          aria-label={`删除 SSH 连接 ${preset.label}`}
                          data-testid="ssh-row-delete"
                          data-host={preset.host}
                          title="删除连接条目(不影响当前已建立的连接)"
                        ><Trash2 className="h-3 w-3" aria-hidden /></Button>
                      </span>
                    </div>
                  </div>
                );
              })}
              {sshPresets.length === 0 && !addingSsh && (
                <p className="px-1 text-xs leading-5 text-muted-foreground" data-testid="ssh-connections-empty">
                  暂无 SSH 连接——点下方「添加 SSH 连接」录入远端机器,可配多条随时切换。
                </p>
              )}
            </div>
            {/* + 添加 SSH 连接(引擎区底部新建排同款):名字选填+主机/端口/用户/密钥;
                保存=只入列表(store),点行才落章生效(存意图零副作用) */}
            {!addingSsh ? (
              <Button
                variant="outline" size="sm" className="self-start"
                onClick={() => {
                  setAddingSsh(true);
                  setSshAddDraft(emptySshFormDraft);
                  setSshTest({ status: "idle" });
                }}
                data-testid="ssh-connection-add"
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />添加 SSH 连接
              </Button>
            ) : (
              <div className="space-y-2.5 rounded-xl border border-border p-3" data-testid="ssh-connection-add-form">
                <div className="grid gap-2.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-connection-name">名字(选填)</Label>
                    <Input
                      id="ssh-connection-name"
                      value={sshAddDraft.label}
                      onChange={(e) => setSshAddDraft((prev) => ({ ...prev, label: e.target.value }))}
                      placeholder="如:Windows 主力(缺省=主机地址)"
                      data-testid="ssh-connection-add-name"
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-connection-host">主机</Label>
                    <Input
                      id="ssh-connection-host"
                      value={sshAddDraft.host}
                      onChange={(e) => setSshAddDraft((prev) => ({ ...prev, host: e.target.value }))}
                      placeholder="如 192.168.0.101"
                      data-testid="ssh-connection-add-host"
                      spellCheck={false}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="ssh-connection-port">端口</Label>
                      <Input
                        id="ssh-connection-port"
                        value={sshAddDraft.port}
                        onChange={(e) => setSshAddDraft((prev) => ({ ...prev, port: e.target.value }))}
                        placeholder="22"
                        inputMode="numeric"
                        data-testid="ssh-connection-add-port"
                        spellCheck={false}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ssh-connection-user">用户</Label>
                      <Input
                        id="ssh-connection-user"
                        value={sshAddDraft.user}
                        onChange={(e) => setSshAddDraft((prev) => ({ ...prev, user: e.target.value }))}
                        placeholder="如 zbj"
                        data-testid="ssh-connection-add-user"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-connection-key">密钥路径</Label>
                    <Input
                      id="ssh-connection-key"
                      value={sshAddDraft.keyPath}
                      onChange={(e) => setSshAddDraft((prev) => ({ ...prev, keyPath: e.target.value }))}
                      placeholder="留空=自动探测 ~/.ssh/id_ed25519 → id_ecdsa → id_rsa"
                      data-testid="ssh-connection-add-key"
                      spellCheck={false}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => void testSshConnection()}
                    disabled={sshTesting}
                    data-testid="ssh-connection-add-test"
                    title="仅探活(后端契约=测当前连接,非表单草稿)"
                  >{sshTesting ? "测试中…" : "测试连接"}</Button>
                  <Button
                    size="sm"
                    onClick={submitAddSsh}
                    disabled={!sshAddDraft.host.trim()}
                    data-testid="ssh-connection-add-save"
                  >保存</Button>
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => setAddingSsh(false)}
                    data-testid="ssh-connection-add-cancel"
                  >取消</Button>
                </div>
              </div>
            )}
            {/* 编辑连接 dialog(R2:改所有字段,保 id;只改 store 档案,点行应用) */}
            <Dialog open={sshEditing !== null} onOpenChange={(open) => !open && setSshEditing(null)}>
              <DialogContent className="max-w-sm" data-testid="ssh-connection-edit-dialog">
                <DialogHeader>
                  <DialogTitle>编辑 SSH 连接</DialogTitle>
                  <DialogDescription>改名或换主机;改完点该行重新连接即生效。</DialogDescription>
                </DialogHeader>
                <div className="grid gap-2.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-connection-edit-name">名字</Label>
                    <Input
                      id="ssh-connection-edit-name"
                      value={sshEditDraft.label}
                      onChange={(e) => setSshEditDraft((prev) => ({ ...prev, label: e.target.value }))}
                      data-testid="ssh-connection-edit-name"
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-connection-edit-host">主机</Label>
                    <Input
                      id="ssh-connection-edit-host"
                      value={sshEditDraft.host}
                      onChange={(e) => setSshEditDraft((prev) => ({ ...prev, host: e.target.value }))}
                      data-testid="ssh-connection-edit-host"
                      spellCheck={false}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="ssh-connection-edit-port">端口</Label>
                      <Input
                        id="ssh-connection-edit-port"
                        value={sshEditDraft.port}
                        onChange={(e) => setSshEditDraft((prev) => ({ ...prev, port: e.target.value }))}
                        inputMode="numeric"
                        data-testid="ssh-connection-edit-port"
                        spellCheck={false}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ssh-connection-edit-user">用户</Label>
                      <Input
                        id="ssh-connection-edit-user"
                        value={sshEditDraft.user}
                        onChange={(e) => setSshEditDraft((prev) => ({ ...prev, user: e.target.value }))}
                        data-testid="ssh-connection-edit-user"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-connection-edit-key">密钥路径</Label>
                    <Input
                      id="ssh-connection-edit-key"
                      value={sshEditDraft.keyPath}
                      onChange={(e) => setSshEditDraft((prev) => ({ ...prev, keyPath: e.target.value }))}
                      data-testid="ssh-connection-edit-key"
                      spellCheck={false}
                    />
                  </div>
                </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ssh-conn-password" className="text-xs">密码(可选;空=走密钥认证)</Label>
                      <Input
                        id="ssh-conn-password"
                        type="password"
                        value={sshEditDraft.password}
                        onChange={(e) => setSshEditDraft((prev) => ({ ...prev, password: e.target.value }))}
                        placeholder="留空=用密钥连接(自动探测 ~/.ssh/id_ed25519)"
                        data-testid="ssh-conn-password"
                        spellCheck={false}
                      />
                    </div>
                <DialogFooter>
                  <Button size="sm" variant="ghost" onClick={() => setSshEditing(null)}>取消</Button>
                  <Button size="sm" onClick={submitEditSsh} data-testid="ssh-connection-edit-save">保存</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {/* 隧道开关(全局,保留现位):不随条目——隧道走哪条连接由选中行决定 */}
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium">SSH 隧道加密通道</div>
                <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  开启后远端代理流量默认走本地隧道口（17600 起，被占自动避让，避开 17593/17595-17598 保留区）；隧道断开自动回落直连。Windows 侧最终可关局域网监听，仅留隧道入口。
                </div>
              </div>
              <label
                className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-muted-foreground"
                title="开启后远端 sidecar 代理走 SSH 隧道加密通道"
              >
                <Switch
                  checked={sshTunnelEnabled}
                  onCheckedChange={(checked) => void toggleSshTunnel(checked === true)}
                  aria-label="SSH 隧道加密通道"
                />
              </label>
            </div>
            {sshTest.status === "ok" && (
              <div
                className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs leading-5"
                data-testid="ssh-test-result"
              >
                {sshTest.reply.ok ? (
                  <>
                    <div>登录用户：{sshTest.reply.user || "—"}</div>
                    <div>服务器版本：{sshTest.reply.serverVersion || "—"}</div>
                    <div data-testid="ssh-test-token">
                      令牌读取结果：
                      {sshTest.reply.token
                        ? sshTest.reply.token.ok
                          ? `已读取（长度 ${sshTest.reply.token.length ?? "未知"}，内容掩码不回显）`
                          : sshTest.reply.token.length != null
                            ? `读取到令牌但格式校验未过（长度 ${sshTest.reply.token.length}）`
                            : "未取到有效令牌（真源路径均 miss）"
                        : "未执行"}
                    </div>
                    <div data-testid="ssh-test-tunnel">
                      隧道探活：
                      {sshTest.reply.tunnel
                        ? sshTest.reply.tunnel.active
                          ? `通（本地口 ${sshTest.reply.tunnel.localPort ?? "—"}）`
                          : "未活（未启用或远端不可达）"
                        : "未执行"}
                    </div>
                  </>
                ) : (
                  // 失败态:reason+message(needs-runtime 已由上方提示行承接,此处原样透出)
                  <div className="text-destructive" data-testid="ssh-test-error-line">
                    {sshTest.reply.message || `测试失败（${sshTest.reply.reason ?? "未知原因"}）`}
                  </div>
                )}
              </div>
            )}
            {sshTest.status === "error" && (
              <p className="text-xs text-destructive" data-testid="ssh-error">{sshTest.message}</p>
            )}
            {sshTokenMsg && (
              <p
                className={cn("text-xs", sshTokenMsg.ok ? "text-success" : "text-destructive")}
                data-testid="ssh-token-result"
              >
                {sshTokenMsg.text}
              </p>
            )}
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
