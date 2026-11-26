/**
 * MCP 设置页·SSH 远端连接区块(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。
 */
import { McpRow, emptySshFormDraft } from "./McpSettingsParts";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useSshPresetsStore } from "@/stores/settings/ssh-presets-store";
import { Pencil, Plus, Server, Terminal, Trash2 } from "lucide-react";
import { SshConnectionAddForm, SshConnectionEditDialog } from "./McpSshForms";
import type { useSshAdmin } from "./use-ssh-admin";
import type { SectionId } from "./McpSettingsParts";

/**
 * SSH 远端连接区块(多条):连接列表(点行即连接)+隧道开关+测试/令牌结果,内嵌添加表单与编辑弹窗。
 */
export function McpSshConnectionsSection({
  sshAdmin,
  collapsedSections,
  toggleSectionCollapsed,
}: {
  sshAdmin: ReturnType<typeof useSshAdmin>;
  collapsedSections: Set<SectionId>;
  toggleSectionCollapsed: (sectionId: SectionId) => void;
}) {
  const {
    activeSshPresetId,
    addingSsh,
    mystudioAction,
    refreshSshTokenNow,
    runMystudioAction,
    setAddingSsh,
    setShutdownConfirmOpen,
    setSshAddDraft,
    setSshEditDraft,
    setSshEditing,
    setSshTest,
    sshNeedsRuntime,
    sshPresets,
    sshRefreshing,
    sshStatus,
    sshSwitching,
    sshTest,
    sshTesting,
    sshTokenMsg,
    sshTunnelEnabled,
    switchSshConnection,
    testSshConnection,
    toggleSshTunnel,
  } = sshAdmin;
  return (
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
              <div
                className="space-y-3 px-5 py-3"
                data-testid="ssh-remote-section"
              >
                <p className="text-xs text-muted-foreground">
                  管理 SSH
                  连接目标(隧道终点+令牌发现)——点行即连接该机;与上方引擎地址互不影响。
                </p>
                {/* C2:依赖未装(paramiko 缺失)=环境级全局黄条(不随条目)→ 指路 Python
                运行环境页(本地配置);fail-open 不拦操作 */}
                {sshNeedsRuntime && (
                  <p
                    className="text-xs leading-5 text-warning"
                    data-testid="ssh-needs-runtime"
                  >
                    SSH 依赖未安装（paramiko 缺失）：请在 设置→本地配置
                    →「Python 运行环境」完成准备后再使用 SSH 功能。
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
                              <Server
                                className="size-4 text-muted-foreground"
                                aria-hidden
                              />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span
                                  className={`h-3 w-3 shrink-0 rounded-full border-2 ${isActive ? "border-primary bg-primary" : "border-muted-foreground/40 bg-transparent"}`}
                                  aria-hidden
                                />
                                <span className="truncate text-sm font-medium">
                                  {preset.label}
                                </span>
                              </span>
                              <span className="block truncate font-mono text-xs text-muted-foreground">
                                {preset.user ? `${preset.user}@` : ""}
                                {preset.host}:{preset.port}
                              </span>
                              {/* 选中行实时态(唯一真连):已连接✓/断开✗;断开带 lastError */}
                              {isActive && (
                                <span className="mt-0.5 flex flex-wrap items-center gap-2">
                                  <span
                                    className={`inline-flex w-fit items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${
                                      sshStatus?.connected
                                        ? "border-success/25 bg-success/10 text-success"
                                        : "border-destructive/65 bg-destructive/[0.08] text-destructive/90"
                                    }`}
                                    data-testid="ssh-row-live-state"
                                  >
                                    {sshStatus?.connected
                                      ? "SSH 已连接 ✓"
                                      : "SSH 断开 ✗"}
                                  </span>
                                  {!sshStatus?.connected &&
                                    sshStatus?.lastError && (
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
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                              当前连接
                            </span>
                          )}
                          <span className="flex shrink-0 items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => void testSshConnection()}
                              disabled={sshTesting || sshSwitching}
                              data-testid="ssh-row-test"
                              data-host={preset.host}
                              title="仅探活不保存(测当前连接;后端一时刻一连接)"
                            >
                              测试
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                setSshEditing(preset);
                                setSshEditDraft({
                                  label: preset.label,
                                  host: preset.host,
                                  port: String(preset.port),
                                  user: preset.user,
                                  keyPath: preset.keyPath,
                                  // 密码不回填(防明文回显):留空保存=保留旧值,见 store.save
                                  password: "",
                                });
                              }}
                              data-testid="ssh-row-edit"
                              data-host={preset.host}
                            >
                              <Pencil className="mr-0.5 h-3 w-3" aria-hidden />
                              编辑
                            </Button>
                            {/* C1:刷令牌=选中行行内第四动作(令牌走当前连接,仅选中行显) */}
                            {isActive && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => void refreshSshTokenNow()}
                                disabled={sshRefreshing}
                                data-testid="ssh-row-token-refresh"
                                title="手动触发令牌自愈(POST /comfy/ssh/token-refresh,走当前连接)"
                              >
                                {sshRefreshing ? "刷新中…" : "刷令牌"}
                              </Button>
                            )}
                            {isActive && (
                              <>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                                  data-testid="ssh-row-launch-mystudio" data-host={preset.host}
                                  disabled={!sshStatus?.connected || mystudioAction !== "idle"}
                                  onClick={() => void runMystudioAction("launching")}>
                                  {mystudioAction === "launching" ? "拉起中…" : "拉起 MYStudio"}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                                  data-testid="ssh-row-shutdown-mystudio" data-host={preset.host}
                                  disabled={!sshStatus?.connected || mystudioAction !== "idle"}
                                  onClick={() => setShutdownConfirmOpen(true)}>
                                  {mystudioAction === "shutting" ? "关闭中…" : "关闭 MYStudio"}
                                </Button>
                              </>
                            )}
                            {/* 1104 engine-sync R4:「同步插件」行内按钮已撤——同步入口收编到
                            上方引擎地址区「引擎同步」折叠子区(单真源清单+逐项进度+结果弹窗) */}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                              onClick={() =>
                                useSshPresetsStore.getState().remove(preset.id)
                              }
                              aria-label={`删除 SSH 连接 ${preset.label}`}
                              data-testid="ssh-row-delete"
                              data-host={preset.host}
                              title="删除连接条目(不影响当前已建立的连接)"
                            >
                              <Trash2 className="h-3 w-3" aria-hidden />
                            </Button>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {sshPresets.length === 0 && !addingSsh && (
                    <p
                      className="px-1 text-xs leading-5 text-muted-foreground"
                      data-testid="ssh-connections-empty"
                    >
                      暂无 SSH 连接——点下方「添加 SSH
                      连接」录入远端机器,可配多条随时切换。
                    </p>
                  )}
                </div>
                {/* + 添加 SSH 连接(引擎区底部新建排同款):名字选填+主机/端口/用户/密钥;
                保存=只入列表(store),点行才落章生效(存意图零副作用) */}
                {!addingSsh ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => {
                      setAddingSsh(true);
                      setSshAddDraft(emptySshFormDraft);
                      setSshTest({ status: "idle" });
                    }}
                    data-testid="ssh-connection-add"
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                    添加 SSH 连接
                  </Button>
                ) : (
                  <SshConnectionAddForm sshAdmin={sshAdmin} />
                )}
                {/* 编辑连接 dialog(R2:改所有字段,保 id;只改 store 档案,点行应用) */}
                <SshConnectionEditDialog sshAdmin={sshAdmin} />
                {/* 隧道开关(全局,保留现位):不随条目——隧道走哪条连接由选中行决定 */}
                <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">SSH 隧道加密通道</div>
                    <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      开启后远端代理流量默认走本地隧道口（17600
                      起，被占自动避让，避开 17593/17595-17598
                      保留区）；隧道断开自动回落直连。Windows
                      侧最终可关局域网监听，仅留隧道入口。
                    </div>
                  </div>
                  <label
                    className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-muted-foreground"
                    title="开启后远端 sidecar 代理走 SSH 隧道加密通道"
                  >
                    <Switch
                      checked={sshTunnelEnabled}
                      onCheckedChange={(checked) =>
                        void toggleSshTunnel(checked === true)
                      }
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
                        <div>
                          服务器版本：{sshTest.reply.serverVersion || "—"}
                        </div>
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
                      <div
                        className="text-destructive"
                        data-testid="ssh-test-error-line"
                      >
                        {sshTest.reply.message ||
                          `测试失败（${sshTest.reply.reason ?? "未知原因"}）`}
                      </div>
                    )}
                  </div>
                )}
                {sshTest.status === "error" && (
                  <p
                    className="text-xs text-destructive"
                    data-testid="ssh-error"
                  >
                    {sshTest.message}
                  </p>
                )}
                {sshTokenMsg && (
                  <p
                    className={cn(
                      "text-xs",
                      sshTokenMsg.ok ? "text-success" : "text-destructive",
                    )}
                    data-testid="ssh-token-result"
                  >
                    {sshTokenMsg.text}
                  </p>
                )}
              </div>
            </McpRow>
  );
}
