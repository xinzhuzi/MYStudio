// MCP 设置页公共件(1124 超线文件拆分:自 McpSettingsTab 原样搬出;入口转出口,外部引用零变化)。
"use client";

import type { ReactNode } from "react";
import { ChevronDown, Server } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { McpServerConfig, McpTransport } from "@/stores/mcp/mcp-servers-store";
import type { SshActiveFingerprint, SshPreset } from "@/stores/settings/ssh-presets-store";
import type { ComfySshStatus } from "@/lib/comfyui/comfy/comfy-sidecar-bridge";

export type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | {
      status: "ok";
      serverName?: string;
      tools: { name: string; description?: string }[];
    }
  | { status: "error"; message: string };

export interface DraftForm {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  url: string;
  env: string;
  enabled: boolean;
}

// 1122 Win UI 冲突根修(用户实录):远程面板文案曾硬编码「Mac 托管」,在
// Windows 上仍宣称本机=Mac、还教 Win 用户「录入 Windows 等机器」(把自己
// 当远端)。托管方标签按实际平台给:Mac 保留原词,其余平台=「本机托管」。
export const ENGINE_HOST_LABEL = navigator.userAgent.includes("Mac")
  ? "Mac 托管"
  : "本机托管";

export const emptyDraft: DraftForm = {
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
// password 编辑框不回填明文:留空保存=保留旧值(store.save 兜底)。
export interface SshFormDraft {
  password: string;
  label: string;
  host: string;
  port: string;
  user: string;
  keyPath: string;
}

export const emptySshFormDraft: SshFormDraft = {
  label: "",
  host: "",
  port: "22",
  user: "",
  keyPath: "",
  password: "",
};

/** 表单草稿 → store 入参(host 必填校验由 store 承接,非法回 null)。 */
export const sshDraftToInput = (draft: SshFormDraft, id?: string) => ({
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
export function resolveActiveSshPresetId(
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

export const COLLAPSED_STORAGE_KEY = "mystudio.settings.mcp.collapsedSections";

export type SectionId =
  | "bridge"
  | "remote-engine"
  | "engine-sync"
  | "torch-upgrade"
  | "ssh-remote"
  | "family"
  | "workflows"
  | "servers"
  | "json";

export type PillState = "ready" | "needs-runtime" | "neutral";

export const PILL_LABELS: Record<PillState, string> = {
  ready: "已就绪",
  "needs-runtime": "需准备",
  neutral: "配置区",
};

export const PILL_STYLES: Record<PillState, string> = {
  ready: "border-success/40 bg-success/10 text-success",
  "needs-runtime": "border-warning/40 bg-warning/10 text-warning",
  neutral: "border-border bg-muted/50 text-muted-foreground",
};

export function readCollapsedSections(): Set<SectionId> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as SectionId[]) : new Set();
  } catch {
    return new Set();
  }
}

export function McpGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="space-y-2">
      <div className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border/80 bg-card/70">
        {children}
      </div>
    </section>
  );
}

export function McpRow({
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
          <Icon
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <h4 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {title}
          </h4>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
              PILL_STYLES[pill],
            )}
            data-capability-pill={pill}
          >
            {PILL_LABELS[pill]}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              collapsed && "-rotate-90",
            )}
            aria-hidden="true"
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function parseEnvLines(text: string): Record<string, string> | undefined {
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

export function configToDraft(server: McpServerConfig): DraftForm {
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
// 引擎侧 COMBO 校验拒非法值兜底)。注:「分镜剧情图」非死数据——分镜批量
// 生图节点级 base_type 注入消费(run-image-workflow-node-generation.ts,
// 11-15 L5 接通),此处仅作全局手选项,节点级恒优先。
export const LOCAL_IMAGE_BASE_TYPES = [
  "人物海报",
  "场景",
  "道具",
  "美宣",
  "人物多视图",
  "高清人头",
  "分镜剧情图",
  "表情差分",
  "概念气氛图",
  "设定卡",
] as const;

// T15/G3+T17:探活成功文案「ComfyUI x.y · GPU名」。桥行(挂载探测)由
// comfyui_bridge.resolve_big_files → inventory gpuName 透传;保存即测(T17)
// 则直探引擎 /system_stats devices[0].name。引擎没给时只显示版本段。
// 引擎地址归一(全角 ：／→半角)已迁 engine-presets-store 统一导出
// (11-02 预设条目入库与保存链路共用同一归一口径,防双源)。

export function comfyVersionLabel(
  version?: string | null,
  gpu?: string | null,
): string {
  return `ComfyUI ${version ?? ""}${gpu ? ` · ${gpu}` : ""}`;
}
