"use client";

// MCP 服务设置 tab(09-01-mcp-settings-section;tab 标签现称「远程配置」)。
// 布局仿「本地配置」页:分组标签 + 可折叠行 + 行级状态胶囊(PluginSettingsTab 同款范式,
// 折叠态持久化 localStorage)。三组:引擎与产线(1102 三层:远端/本机设备+模型族下拉+
// 工作流绑定;原「服务连接」组名与桥接探活行已退役,专业流/道劫型两设置随行保留)
// → MCP 服务器 → JSON 配置。
// 1124 超线文件拆分:本文件只留页骨架与较短的几行;远程引擎/SSH 两个大区块与顶层
// 弹窗群在 Mcp*Section / McpSettingsDialogs,业务逻辑在六个 use-* 域钩子,公共件在 McpSettingsParts。

import { useRef, useState } from "react";
import { Check, FileJson, Loader2, Pencil, Plug, Plus, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { useMcpServersStore, importMcpServersJson, exportMcpServersJson, MCP_SERVERS_STORAGE_KEY } from "@/stores/mcp/mcp-servers-store";
import { isBindableWorkflow, type BoundWorkflowKind } from "@/stores/settings/workflow-bindings-store";
import { ALL_ENGINE_FAMILIES } from "@/lib/studio/engine-line/engine-options";
import { SecureVaultBanner } from "./SecureVaultBanner";
import { useMcpServerAdmin } from "./use-mcp-server-admin";
import { useRemoteEngineAdmin } from "./use-remote-engine-admin";
import { useSshAdmin } from "./use-ssh-admin";
import { useEngineSyncAdmin } from "./use-engine-sync-admin";
import { useTorchUpgradeAdmin } from "./use-torch-upgrade-admin";
import { useEngineFamilyWorkflows } from "./use-engine-family-workflows";
import { McpRemoteEngineSection } from "./McpRemoteEngineSection";
import { McpSshConnectionsSection } from "./McpSshConnectionsSection";
import { McpSettingsDialogs } from "./McpSettingsDialogs";
import type { SectionId } from "./McpSettingsParts";
import { COLLAPSED_STORAGE_KEY, readCollapsedSections, McpGroup, McpRow, LOCAL_IMAGE_BASE_TYPES } from "./McpSettingsParts";

export function McpSettingsTab() {
  // 跨域在跑态镜像(恒稳 ref):同步守卫读 Torch 在跑/Torch 守卫读同步在跑。
  // 钩子体每渲染回写一次;守卫事件时读 .current=上一帧值,与原「每渲染重建闭包、
  // 事件时读上一帧值」语义相同。
  const torchRunningMirror = useRef(false);
  const torchBusyMirror = useRef(false);
  const syncRunningMirror = useRef(false);
  const mcpAdmin = useMcpServerAdmin();
  const {
    servers,
    updateServer,
    removeServer,
    hasRuntime,
    tests,
    jsonText,
    setJsonText,
    jsonError,
    setJsonError,
    openCreate,
    openEdit,
    runTest,
    enabledCount,
    transportLabel,
  } = mcpAdmin;
  const remoteAdmin = useRemoteEngineAdmin();
  const {
    remoteEngine,
  } = remoteAdmin;
  const sshAdmin = useSshAdmin();
  const {
    sshStatus,
  } = sshAdmin;
  const syncAdmin = useEngineSyncAdmin({
    sshConnected: Boolean(sshStatus?.connected),
    torchRunningMirror,
    torchBusyMirror,
    syncRunningMirror,
  });
  const torchAdmin = useTorchUpgradeAdmin({
    remoteEngine,
    sshStatus,
    syncRunningMirror,
    torchRunningMirror,
    torchBusyMirror,
  });
  const familyAdmin = useEngineFamilyWorkflows();
  const {
    defaultImageModel,
    currentFamily,
    handleFamilySwitch,
    bindings,
    familyWorkflows,
    workflowsLoading,
    workflowsError,
    t2iCandidates,
    i2iCandidates,
  } = familyAdmin;
  const [collapsedSections, setCollapsedSections] = useState<Set<SectionId>>(
    () => readCollapsedSections(),
  );

  const localImageLoraEnabled = useAppSettingsStore(
    (state) => state.imageGenerationSettings.localImageLoraEnabled,
  );

  const localImageBaseType = useAppSettingsStore(
    (state) => state.imageGenerationSettings.localImageBaseType,
  );

  const toggleSectionCollapsed = (sectionId: SectionId) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      window.localStorage.setItem(
        COLLAPSED_STORAGE_KEY,
        JSON.stringify([...next]),
      );
      return next;
    });
  };

  return (
    <>
      {/* 0924 范式重构后内容超一屏;设置页全家模式=tab 自带 ScrollArea(祖先链恒 overflow-hidden) */}
      <ScrollArea className="h-full">
        <div className="p-8 w-full max-w-[1200px] mx-auto space-y-8">
          {/* 0924 C1(§7):密钥保险箱状态横幅(env 含 token,与 API 密钥同批加密) */}
          <SecureVaultBanner
            storageKey={MCP_SERVERS_STORAGE_KEY}
            subjectLabel="远程配置"
            onRetry={() => useMcpServersStore.persist.rehydrate()}
          />

          <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
                <Server className="h-5 w-5 text-primary" aria-hidden />
                远程配置
              </h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                管理这台 App 之外的远端资源：引擎地址与设备、引擎同步、SSH
                连接、PyTorch/CUDA 升级，以及 MCP 服务器登记（AI
                工具联动标准协议，先用「测试连接」确认连通）。
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
                    <div className="text-sm font-medium">
                      专业流增强（本地）
                    </div>
                    <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      开启后本地生图自动走专业流：Krea2 挂 NSFW
                      增强组件，ComfyUI 桥改走 NSFW
                      专业流。默认关闭——对普通画面有模糊/偏色副作用；仅本地引擎生效，云端不受影响。
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
                    <div className="text-sm font-medium">
                      道劫型选择（本地生图）
                    </div>
                    <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      指定后本地 Qwen-Image-2.1
                      生图按该型拼接型文与型档画幅（十型真源=引擎
                      qi21_bases.json，非法值由引擎拒单兜底）；「不指定」沿用产线默认。仅本地引擎生效，云端不受影响。
                    </div>
                  </div>
                  <select
                    className="h-8 shrink-0 self-center rounded-md border border-border bg-background px-2 text-sm"
                    value={localImageBaseType}
                    onChange={(e) =>
                      useAppSettingsStore
                        .getState()
                        .setImageGenerationSettings({
                          localImageBaseType: e.target.value,
                        })
                    }
                    aria-label="道劫型选择（本地）"
                    data-local-image-base-type-select
                  >
                    <option value="">不指定</option>
                    {LOCAL_IMAGE_BASE_TYPES.map((baseType) => (
                      <option key={baseType} value={baseType}>
                        {baseType}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </McpRow>
            {/* 远程引擎地址(10-29 D1 终裁):URL 配一条,任务发远端 MYStudio 的 ComfyUI+产物回流 */}
            <McpRemoteEngineSection
              remoteAdmin={remoteAdmin}
              sshAdmin={sshAdmin}
              syncAdmin={syncAdmin}
              torchAdmin={torchAdmin}
              collapsedSections={collapsedSections}
              toggleSectionCollapsed={toggleSectionCollapsed}
            />

            {/* ── SSH 远端连接(1103 终版):多条连接列表(照引擎设备列表同款范式,
            引擎/SSH 两列表零联动);点行=POST /comfy/ssh/config 切换当前连接 ── */}
            <McpSshConnectionsSection
              sshAdmin={sshAdmin}
              collapsedSections={collapsedSections}
              toggleSectionCollapsed={toggleSectionCollapsed}
            />

            {/* ── R2 模型族(1102 控制中心):切换=写 defaultImageModel 真源,出图即走新族 ── */}
            <McpRow
              sectionId="family"
              icon={Server}
              title="模型族（产线）"
              pill={
                currentFamily.status === "ready" ? "ready" : "needs-runtime"
              }
              collapsed={collapsedSections.has("family")}
              onToggle={toggleSectionCollapsed}
            >
              <div
                className="space-y-3 px-5 py-3"
                data-testid="engine-family-section"
              >
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
                  <div className="min-w-0">
                    <div
                      className="text-sm font-medium"
                      data-testid="engine-family-current"
                    >
                      当前产线:{currentFamily.label}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {currentFamily.hint}——切换即改全局默认出图模型,canvas
                      出图立即走新族;分镜批量恒走 Qwen-Image-2.1(既有裁定)。
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={defaultImageModel}
                    onValueChange={handleFamilySwitch}
                  >
                    <SelectTrigger
                      className="w-[240px]"
                      aria-label="模型族选择"
                      data-testid="engine-family-select"
                    >
                      <SelectValue placeholder="选择模型族" />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_ENGINE_FAMILIES.map((family) => (
                        <SelectItem
                          key={family.value}
                          value={family.value}
                          disabled={family.status !== "ready"}
                        >
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
              <div
                className="space-y-3 px-5 py-3"
                data-testid="engine-workflows-section"
              >
                {!currentFamily.workflowPrefix ? (
                  <p className="text-xs text-muted-foreground">
                    当前族工作流为引擎内置模板,库内暂无域目录——绑定待该族入库后开放。
                  </p>
                ) : workflowsLoading ? (
                  <p className="text-xs text-muted-foreground">清单拉取中…</p>
                ) : workflowsError ? (
                  <p
                    className="text-xs text-destructive"
                    data-testid="engine-workflows-error"
                  >
                    {workflowsError}
                  </p>
                ) : (
                  <>
                    {(
                      [
                        ["t2i", "文生图", t2iCandidates],
                        ["i2i", "图生图(含编辑)", i2iCandidates],
                      ] as const
                    ).map(([kind, kindLabel, candidates]) => (
                      <div key={kind} className="space-y-1.5">
                        <div className="text-xs font-medium text-muted-foreground">
                          {kindLabel}
                        </div>
                        {candidates.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            (该类型暂无库内件)
                          </p>
                        ) : (
                          candidates.map((workflow) => {
                            const bound =
                              bindings[`${kind}WorkflowId` as const] ===
                              workflow.id;
                            return (
                              <div
                                key={workflow.id}
                                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${bound ? "border-primary/60 bg-primary/5" : "border-border"}`}
                                data-testid={`engine-workflow-row-${kind}`}
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm">
                                    {workflow.name}
                                  </div>
                                  <div
                                    className="truncate text-[11px] text-muted-foreground"
                                    title={workflow.id}
                                  >
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
                                      onClick={() =>
                                        bindings.setBinding(
                                          kind as BoundWorkflowKind,
                                          bound ? null : workflow.id,
                                        )
                                      }
                                      data-testid={`engine-workflow-bind-${kind}`}
                                    >
                                      {bound ? "解绑" : `设为${kindLabel}用`}
                                    </Button>
                                  ) : (
                                    // 1102 收口轮:引擎 load_template 只吃 API 模板名,非道劫件
                                    // 无同源模板——诚实标注不给绑定钮(防绑了不生效的假绑定)
                                    <span className="text-[10px] text-muted-foreground">
                                      暂无引擎模板
                                    </span>
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
                  <Button
                    size="sm"
                    onClick={openCreate}
                    data-testid="mcp-add-server"
                  >
                    <Plus className="mr-2 h-4 w-4" aria-hidden />
                    添加服务器
                  </Button>
                </div>
                {!hasRuntime ? (
                  <p className="text-xs text-muted-foreground">
                    桌面应用中可用。
                  </p>
                ) : servers.length === 0 ? (
                  <p className="px-1 text-xs text-muted-foreground">
                    还没有登记 MCP 服务器。点右上角「添加服务器」开始。
                  </p>
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
                            <span className="text-sm font-medium">
                              {server.name}
                            </span>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                              {transportLabel(server.transport)}
                            </span>
                          </div>
                          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                            {server.transport === "stdio"
                              ? [server.command, ...(server.args ?? [])].join(
                                  " ",
                                )
                              : server.url}
                          </p>
                          {test.status === "ok" ? (
                            <p
                              className="mt-1 text-xs text-success"
                              data-testid={`mcp-test-ok-${server.name}`}
                            >
                              已连上
                              {test.serverName ? `（${test.serverName}）` : ""}
                              ，提供 {test.tools.length} 个能力
                              {test.tools.length
                                ? `：${test.tools
                                    .slice(0, 3)
                                    .map((t) => t.name)
                                    .join(
                                      "、",
                                    )}${test.tools.length > 3 ? " 等" : ""}`
                                : ""}
                            </p>
                          ) : null}
                          {test.status === "error" ? (
                            <p
                              className="mt-1 text-xs text-destructive"
                              data-testid={`mcp-test-err-${server.name}`}
                            >
                              {test.message}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                            <Switch
                              checked={server.enabled}
                              onCheckedChange={(checked) =>
                                updateServer(server.id, {
                                  enabled: checked === true,
                                })
                              }
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
                              <Loader2
                                className="mr-2 h-4 w-4 animate-spin"
                                aria-hidden
                              />
                            ) : (
                              <Check className="mr-2 h-4 w-4" aria-hidden />
                            )}
                            {test.status === "testing" ? "测试中…" : "测试连接"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(server)}
                            aria-label={`编辑 ${server.name}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeServer(server.id)}
                            aria-label={`删除 ${server.name}`}
                          >
                            <Trash2
                              className="h-4 w-4 text-destructive"
                              aria-hidden
                            />
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
              <div
                className="space-y-3 px-5 py-4"
                data-testid="mcp-json-config"
              >
                <p className="text-xs leading-5 text-muted-foreground">
                  与其他软件通用的配置格式：粘贴别处的 mcpServers
                  配置点「导入」（同名更新、新名新增）；也可以复制当前配置到别的软件用。
                </p>
                <Textarea
                  value={jsonText}
                  onChange={(event) => setJsonText(event.target.value)}
                  rows={8}
                  className="font-mono text-xs"
                  placeholder={
                    '{\n  "mcpServers": {\n    "本地文件": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]\n    }\n  }\n}'
                  }
                  aria-label="mcpServers JSON 配置"
                  data-testid="mcp-json-textarea"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard.writeText(jsonText);
                      toast.success("已复制到剪贴板");
                    }}
                  >
                    复制
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setJsonText(exportMcpServersJson())}
                  >
                    刷新为当前配置
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      const result = importMcpServersJson(jsonText);
                      if (result.ok) {
                        setJsonError(null);
                        toast.success(
                          `导入成功：新增 ${result.added} 个，更新 ${result.updated} 个`,
                        );
                      } else {
                        setJsonError(result.error);
                      }
                    }}
                  >
                    导入
                  </Button>
                </div>
                {jsonError ? (
                  <p
                    className="text-xs text-destructive"
                    data-testid="mcp-json-error"
                  >
                    {jsonError}
                  </p>
                ) : null}
              </div>
            </McpRow>
          </McpGroup>
        </div>
      </ScrollArea>

      <McpSettingsDialogs
        mcpAdmin={mcpAdmin}
        sshAdmin={sshAdmin}
        torchAdmin={torchAdmin}
      />
    </>
  );
}
