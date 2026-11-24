/**
 * MCP 设置页·引擎同步子区(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。
 */
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
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import type { useRemoteEngineAdmin } from "./use-remote-engine-admin";
import type { useSshAdmin } from "./use-ssh-admin";
import type { useEngineSyncAdmin } from "./use-engine-sync-admin";
import type { useTorchUpgradeAdmin } from "./use-torch-upgrade-admin";
import type { SectionId } from "./McpSettingsParts";

/**
 * 引擎同步折叠子区(单真源清单+勾选+逐项进度)与同步结果弹窗。
 */
export function EngineSyncSection({
  remoteAdmin,
  sshAdmin,
  syncAdmin,
  torchAdmin,
  collapsedSections,
  toggleSectionCollapsed,
}: {
  remoteAdmin: ReturnType<typeof useRemoteEngineAdmin>;
  sshAdmin: ReturnType<typeof useSshAdmin>;
  syncAdmin: ReturnType<typeof useEngineSyncAdmin>;
  torchAdmin: ReturnType<typeof useTorchUpgradeAdmin>;
  collapsedSections: Set<SectionId>;
  toggleSectionCollapsed: (sectionId: SectionId) => void;
}) {
  const {
    remoteActive,
  } = remoteAdmin;
  const {
    sshStatus,
  } = sshAdmin;
  const {
    enginePluginHealth,
    engineRestarting,
    engineSyncChecked,
    engineSyncDialog,
    engineSyncError,
    engineSyncProgress,
    engineSyncRows,
    engineSyncRunning,
    restartEngine,
    setEngineSyncDialog,
    startEngineSync,
    toggleEngineSyncItem,
  } = syncAdmin;
  const {
    torchInfo,
    torchRunning,
  } = torchAdmin;
  return (
    <>
{remoteActive && (
                  <>
                    {/* ── 引擎同步(11-04 engine-sync R3):单真源清单+勾选+逐项同步+结果弹窗。
                C4:放引擎地址区(同步的是 ComfyUI 的东西),SSH 只是传输通道 ── */}
                    <Collapsible
                      open={!collapsedSections.has("engine-sync")}
                      onOpenChange={() => toggleSectionCollapsed("engine-sync")}
                    >
                      <CollapsibleTrigger className="w-full text-left">
                        <div
                          className="flex items-center gap-2 rounded-lg px-1 py-2"
                          data-testid="engine-sync-header"
                        >
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                              collapsedSections.has("engine-sync") &&
                                "-rotate-90",
                            )}
                            aria-hidden="true"
                          />
                          <span className="text-sm font-medium">引擎同步</span>
                          <span className="min-w-0 truncate text-xs text-muted-foreground">
                            把引擎与插件从 GitHub 拉最新到 Windows(单真源清单,经
                            SSH)
                          </span>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div
                          className="space-y-3 rounded-xl border border-border p-3"
                          data-testid="engine-sync-section"
                        >
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>
                              同步源: GitHub(各件 origin 仓库;Win
                              已有即拉最新,缺件即克隆)
                              {engineSyncRows.filter(
                                (i) => i.status === "mac-only",
                              ).length > 0
                                ? `(含 Win 待装 ${engineSyncRows.filter((i) => i.status === "mac-only").length} 件)`
                                : ""}
                            </span>
                            <span>目标: Windows(经 SSH 当前会话拉取)</span>
                            {enginePluginHealth &&
                              enginePluginHealth.failedCount > 0 && (
                                <span
                                  className="text-destructive"
                                  data-testid="engine-sync-health-summary"
                                >
                                  ⚠️ Win 引擎 {enginePluginHealth.failedCount}{" "}
                                  件
                                  加载失败(行内徽标悬停看挂因;重启引擎会自动补装依赖并愈后重启)
                                </span>
                              )}
                          </div>
                          {/* torch 升级入口已收敛至「引擎 PyTorch / CUDA」分节(引擎地址区;1106 用户令:同步面板不再显示,避免双入口) */}
                          {/* SSH 断开/清单取失败:按钮禁用+提示(R3);清单空同样提示 */}
                          {!sshStatus?.connected ? (
                            <p
                              className="text-xs leading-5 text-warning"
                              data-testid="engine-sync-ssh-hint"
                            >
                              需先连接 SSH——在下方「SSH
                              远端连接」点一条连接后再同步。
                            </p>
                          ) : engineSyncError ? (
                            <p
                              className="text-xs leading-5 text-destructive"
                              data-testid="engine-sync-error"
                            >
                              {engineSyncError}
                            </p>
                          ) : engineSyncRows.length === 0 ? (
                            <p
                              className="text-xs leading-5 text-muted-foreground"
                              data-testid="engine-sync-empty"
                            >
                              同步清单为空——本机引擎还没扫到可同步的 git
                              插件(先在 设置→本地配置 准备本机引擎)。
                            </p>
                          ) : (
                            <div
                              className="space-y-1.5"
                              data-testid="engine-sync-list"
                            >
                              {engineSyncRows.map((item) => {
                                const progress = engineSyncProgress[item.name];
                                return (
                                  <div
                                    key={item.name}
                                    className={cn(
                                      "flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5",
                                    )}
                                    data-testid="engine-sync-row"
                                    data-name={item.name}
                                  >
                                    <Checkbox
                                      checked={
                                        engineSyncChecked[item.name] ?? false
                                      }
                                      disabled={engineSyncRunning}
                                      onCheckedChange={(checked) =>
                                        toggleEngineSyncItem(
                                          item.name,
                                          checked === true,
                                        )
                                      }
                                      aria-label={`同步 ${item.name}`}
                                      data-testid="engine-sync-check"
                                    />
                                    <span className="min-w-0 flex-1 truncate text-sm">
                                      {item.name === "ComfyUI"
                                        ? "ComfyUI 引擎"
                                        : item.name}
                                    </span>
                                    {/* 1122 用户令:行内展示版本——git describe
                                        最近 tag 剥 v(引擎 0.45.2);无 tag 插件
                                        回退短 sha;Win 缺不显示 */}
                                    {item.winVersion ? (
                                      <span
                                        className="shrink-0 font-mono text-[10px] text-muted-foreground/80"
                                        data-testid="engine-sync-version"
                                      >
                                        {item.winVersion}
                                      </span>
                                    ) : null}
                                    {/* 1107 自愈可见化:该插件在 Win 引擎的加载健康
                                        (✅ 已加载/❌ 挂(悬停看挂因)/⚠️ 依赖欠账/
                                        ⚪ 未探(引擎未启或探针失败));引擎行不适用 */}
                                    {item.name !== "ComfyUI" &&
                                      (enginePluginHealth?.plugins?.[
                                        item.name
                                      ] ? (
                                        <span
                                          className={cn(
                                            "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]",
                                            enginePluginHealth.plugins[
                                              item.name
                                            ].loaded
                                              ? enginePluginHealth
                                                  .depsFailures?.[item.name]
                                                  ?.length
                                                ? "border-warning/40 text-warning"
                                                : "border-success/30 text-success"
                                              : "border-destructive/40 bg-destructive/10 text-destructive",
                                          )}
                                          title={
                                            enginePluginHealth.plugins[
                                              item.name
                                            ].loaded
                                              ? (
                                                  enginePluginHealth
                                                    .depsFailures?.[
                                                    item.name
                                                  ] ?? []
                                                ).join("\n") || "引擎加载正常"
                                              : enginePluginHealth.plugins[
                                                  item.name
                                                ].cause || "加载失败"
                                          }
                                          data-testid="engine-sync-health"
                                          data-health={
                                            enginePluginHealth.plugins[
                                              item.name
                                            ].loaded
                                              ? enginePluginHealth
                                                  .depsFailures?.[item.name]
                                                  ?.length
                                                ? "deps-debt"
                                                : "loaded"
                                              : "failed"
                                          }
                                        >
                                          {enginePluginHealth.plugins[item.name]
                                            .loaded
                                            ? enginePluginHealth.depsFailures?.[
                                                item.name
                                              ]?.length
                                              ? "⚠️ 依赖欠账"
                                              : "✅ 已加载"
                                            : "❌ 加载失败"}
                                        </span>
                                      ) : enginePluginHealth ? (
                                        <span
                                          className="shrink-0 text-[10px] text-muted-foreground"
                                          data-testid="engine-sync-health"
                                          data-health="unknown"
                                        >
                                          ⚪ 未探
                                        </span>
                                      ) : null)}
                                    {/* 1104 改清晰显示:不比对哈希(策略=GitHub 拉最新),只报安装态 */}
                                    <span
                                      className={cn(
                                        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                        item.status === "mac-only"
                                          ? "border-destructive/25 bg-destructive/[0.08] text-destructive/90"
                                          : item.status === "win-only"
                                            ? "border-border bg-muted/50 text-muted-foreground/60"
                                            : "border-success/25 bg-success/10 text-success",
                                      )}
                                      data-testid="engine-sync-status"
                                    >
                                      {item.status === "mac-only"
                                        ? "❌ Windows 未装"
                                        : item.status === "win-only"
                                          ? "🪟 Win 独有(拉最新)"
                                          : "✅ 已装"}
                                    </span>
                                    {/* 逐项进度(Q3:⬜ 等待 / ⏳ 同步中 / ✅ 完成 / ❌ 失败 / ⏭️ 跳过) */}
                                    {progress === "pending" ? (
                                      <span
                                        className="shrink-0 text-xs text-muted-foreground"
                                        data-testid="engine-sync-progress"
                                      >
                                        ⬜ 等待
                                      </span>
                                    ) : progress === "syncing" ? (
                                      <span
                                        className="shrink-0 text-xs text-warning"
                                        data-testid="engine-sync-progress"
                                      >
                                        ⏳ 同步中
                                      </span>
                                    ) : progress ? (
                                      <span
                                        className={cn(
                                          "shrink-0 text-xs",
                                          progress.action === "failed" ||
                                            !progress.verified
                                            ? "text-destructive"
                                            : "text-success",
                                        )}
                                        data-testid="engine-sync-progress"
                                      >
                                        {progress.action === "skipped"
                                          ? /* 1122 用户裁定:一致=成功态,
                                               显「已是最新」不显「跳过」;
                                               真跳过(非 git 仓等)保留 ⏭️ */
                                            (progress.error ?? "").includes(
                                              "已是最新",
                                            )
                                            ? "✅ 已是最新"
                                            : "⏭️ 跳过"
                                          : progress.action === "failed" ||
                                              !progress.verified
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
                                torchRunning ||
                                Boolean(torchInfo?.busy) ||
                                !sshStatus?.connected ||
                                engineSyncRows.length === 0 ||
                                !engineSyncRows.some(
                                  (i) => engineSyncChecked[i.name],
                                )
                              }
                              data-testid="engine-sync-start"
                            >
                              {engineSyncRunning ? "同步中…" : "开始同步"}
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              勾选项从 GitHub 拉最新(Win
                              已有即更新、缺件即克隆);整体超时 30 分钟。
                            </span>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </>
                )}

                {/* 同步完成结果弹窗(R3:逐项 ✅/❌/⏭️ + 重启建议+[重启引擎]) */}
                <Dialog
                  open={engineSyncDialog !== null}
                  onOpenChange={(open) => !open && setEngineSyncDialog(null)}
                >
                  <DialogContent
                    className="max-w-md"
                    data-testid="engine-sync-result-dialog"
                  >
                    <DialogHeader>
                      <DialogTitle>同步结果</DialogTitle>
                      <DialogDescription>
                        逐项结果(已验证=Windows 侧目录在且 HEAD 可读)
                      </DialogDescription>
                    </DialogHeader>
                    <div
                      className="max-h-72 space-y-1.5 overflow-y-auto"
                      data-testid="engine-sync-result-list"
                    >
                      {(engineSyncDialog ?? []).map((result) => (
                        <div
                          key={result.name}
                          className="flex items-start gap-2 text-xs leading-5"
                          data-testid="engine-sync-result-row"
                        >
                          <span className="shrink-0">
                            {result.action === "failed" || !result.verified
                              ? "❌"
                              : /* 1122 用户裁定:一致=成功态(✅),真跳过才 ⏭️ */
                                result.action === "skipped" &&
                                  !(result.error ?? "").includes("已是最新")
                                ? "⏭️"
                                : "✅"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">
                              {result.name === "ComfyUI"
                                ? "ComfyUI 引擎"
                                : result.name}
                            </span>
                            {result.action === "pulled" && result.verified
                              ? ": 已从 GitHub 拉取最新"
                              : result.action === "cloned" && result.verified
                                ? ": 已安装(新)"
                                : result.action === "skipped"
                                  ? `: ${result.error ?? "跳过"}`
                                  : `: ${result.error ?? "未通过验证"}`}
                            {result.verified && result.winVersion ? (
                              <span
                                className="ml-1 font-mono text-muted-foreground"
                                data-testid="engine-sync-result-version"
                              >
                                → {result.winVersion}
                              </span>
                            ) : null}
                            {result.pipError ? (
                              <span
                                className="mt-0.5 block text-warning"
                                data-testid="engine-sync-pip-warning"
                              >
                                ⚠️ {result.pipError}(不阻断)
                              </span>
                            ) : null}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      建议: 重启引擎使插件生效。
                    </p>
                    <DialogFooter>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEngineSyncDialog(null)}
                      >
                        关闭
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void restartEngine()}
                        disabled={engineRestarting}
                        data-testid="engine-sync-restart"
                      >
                        {engineRestarting ? "重启指令中…" : "重启引擎"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
    </>
  );
}
