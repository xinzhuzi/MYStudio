/**
 * MCP 设置页·PyTorch/CUDA 升级子区(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。
 */
import { TorchUpgradeProgress } from "./TorchUpgradeProgress";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TorchUpgradeChannel } from "@/lib/comfyui/comfy/comfy-sidecar-bridge";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import type { useRemoteEngineAdmin } from "./use-remote-engine-admin";
import type { useSshAdmin } from "./use-ssh-admin";
import type { useEngineSyncAdmin } from "./use-engine-sync-admin";
import type { useTorchUpgradeAdmin } from "./use-torch-upgrade-admin";
import type { SectionId } from "./McpSettingsParts";

/**
 * 引擎 PyTorch / CUDA 升级折叠子区(升级对象说明/三件套对照/目标版本与通道/升级按钮/进度)。
 */
export function TorchUpgradeSection({
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
    activeRemoteUrl,
    remoteActive,
  } = remoteAdmin;
  const {
    sshStatus,
  } = sshAdmin;
  const {
    engineSyncRunning,
  } = syncAdmin;
  const {
    pinnedVersion,
    setTorchChannel,
    setTorchConfirm,
    setTorchConfirmPinned,
    setTorchTarget,
    torchChangeRows,
    torchChannel,
    torchInfo,
    torchJob,
    torchLedgerOnly,
    torchNeedsUpdate,
    torchRunning,
    torchTarget,
    torchTrackingWarning,
    torchVerified,
    torchVersionDisplay,
  } = torchAdmin;
  return (
    <>
{remoteActive && (
                  <Collapsible
                    open={!collapsedSections.has("torch-upgrade")}
                    onOpenChange={() => toggleSectionCollapsed("torch-upgrade")}
                  >
                    <CollapsibleTrigger className="w-full text-left">
                      <div
                        className="flex items-center gap-2 rounded-lg px-1 py-2"
                        data-testid="torch-upgrade-header"
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            collapsedSections.has("torch-upgrade") &&
                              "-rotate-90",
                          )}
                          aria-hidden="true"
                        />
                        <span className="text-sm font-medium">
                          引擎 PyTorch / CUDA
                        </span>
                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                          升级 Windows 引擎的 PyTorch(经 SSH)
                        </span>
                        <span
                          className={cn(
                            "ml-auto shrink-0 rounded-full border px-2 py-0.5 text-xs",
                            remoteActive && sshStatus?.connected
                              ? "border-success/40 text-success"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          {remoteActive && sshStatus?.connected
                            ? "已就绪"
                            : "未连接"}
                        </span>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div
                        className="space-y-3 rounded-xl border border-border p-3"
                        data-testid="torch-upgrade-section"
                      >
                        <p
                          className="text-xs leading-5 text-muted-foreground"
                          data-testid="torch-target-desc"
                        >
                          <span className="font-medium text-foreground">
                            升级对象:
                          </span>
                          Windows 引擎主机{" "}
                          <span className="font-mono">
                            {activeRemoteUrl || sshStatus?.host || "未连接"}
                          </span>{" "}
                          —— 经 SSH 远程操作该机的 ComfyUI 引擎 Python
                          环境(venv),升级{" "}
                          <span className="font-mono">
                            PyTorch + 配套 torchvision/torchaudio
                          </span>
                          ;不动该机的 ComfyUI 本体、插件与模型文件。
                        </p>
                        <p className="text-xs leading-5 text-muted-foreground">
                          <span className="font-medium text-foreground">
                            升级流程:
                          </span>
                          预检(引擎空闲/磁盘/驱动)→ 快照(可回滚)→ 停止引擎 →
                          安装新版本 → 导入验证 → 重启引擎 →
                          烟测;任一步失败自动回滚旧版,预计 15–60 分钟(视网络)。
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span data-testid="torch-section-body">
                            生效版本：
                            <span className="font-mono">
                              {torchVersionDisplay}
                            </span>
                            {torchInfo?.current?.cuda ? (
                              <span className="font-mono">
                                {" "}
                                · CUDA {torchInfo.current.cuda}
                              </span>
                            ) : null}
                            {torchInfo?.current
                              ? torchInfo.live
                                ? "（实时）"
                                : "（账本，未实时验证）"
                              : ""}
                            <span
                              className={cn(
                                "ml-1",
                                !torchVerified
                                  ? "text-muted-foreground"
                                  : torchNeedsUpdate
                                    ? "text-warning"
                                    : "text-success",
                              )}
                            >
                              {torchLedgerOnly
                                ? "未实时验证"
                                : !torchVerified
                                  ? ""
                                  : torchNeedsUpdate
                                    ? `需更新 → ${pinnedVersion}`
                                    : "✅ 已是钉版"}
                            </span>
                          </span>
                        </p>
                        {sshStatus?.connected &&
                          torchInfo &&
                          !torchInfo.hostMatched && (
                            <p className="text-xs text-warning">
                              SSH 主机与当前生效引擎不一致，无法升级。
                            </p>
                          )}
                        {torchChangeRows && (
                          <div
                            className="rounded-lg border border-border/60 p-2"
                            data-testid="torch-change-list"
                          >
                            <p className="mb-1 text-xs font-medium text-foreground">
                              点击升级将核对以下三件套(已达标件 pip
                              判已满足零下载,未达标件才真正安装):
                            </p>
                            <div className="space-y-0.5 font-mono text-xs">
                              {torchChangeRows.rows.map((row) => (
                                <p
                                  key={row.pkg}
                                  className="flex flex-wrap items-center gap-x-2"
                                  data-testid="torch-change-row"
                                  data-pkg={row.pkg}
                                >
                                  <span className="w-24 shrink-0">
                                    {row.pkg}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {row.cur === null
                                      ? "未能读取现装版本"
                                      : row.cur === "NONE"
                                        ? "未安装"
                                        : row.cur}
                                  </span>
                                  <span aria-hidden="true">→</span>
                                  <span>{row.tgt ?? "目标无效"}</span>
                                  <span
                                    className={cn(
                                      "font-sans",
                                      row.tgt && row.cur === row.tgt
                                        ? "text-success"
                                        : row.cur === null
                                          ? "text-muted-foreground"
                                          : "text-warning",
                                    )}
                                  >
                                    {row.tgt && row.cur === row.tgt
                                      ? "✅ 已达标,不重装"
                                      : row.cur === null
                                        ? "升级时 pip 复核"
                                        : "⬆ 将安装"}
                                  </span>
                                </p>
                              ))}
                            </div>
                            <p
                              className="mt-1 text-xs"
                              data-testid="torch-change-summary"
                            >
                              {torchChangeRows.actionable && torchChangeRows.unverified ? (
                                <span className="text-muted-foreground">
                                  有件未能读取现装版本——不冒充缺件;升级时 pip
                                  幂等核对,已达标件零下载。
                                </span>
                              ) : torchChangeRows.actionable ? (
                                <span className="text-muted-foreground">
                                  真升级:存在未达标件,将停引擎安装后重启( 15–60
                                  分钟口径;仅补小件时通常几分钟)。
                                </span>
                              ) : (
                                <span className="text-success">
                                  三件套均已达标——点击将直接跳过(skip-if-latest),不动引擎环境。
                                </span>
                              )}
                            </p>
                          </div>
                        )}
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="space-y-1">
                            <Label htmlFor="torch-target">目标版本</Label>
                            <Input
                              id="torch-target"
                              value={torchTarget}
                              onChange={(event) =>
                                setTorchTarget(event.target.value)
                              }
                              /* 1107 修:默认 h-9 比同排 Select(h-7)/Button(sm=h-7)高 8px 撑破基线 */
                              className="h-7 w-32 px-2 font-mono text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor="torch-channel">CUDA 通道</Label>
                            <Select
                              value={torchChannel}
                              onValueChange={(value) =>
                                setTorchChannel(value as TorchUpgradeChannel)
                              }
                            >
                              <SelectTrigger
                                id="torch-channel"
                                className="w-28"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cu128">cu128</SelectItem>
                                <SelectItem value="cu130">cu130</SelectItem>
                                <SelectItem value="cu132">cu132</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            size="sm"
                            data-testid="torch-upgrade-start"
                            onClick={() => {
                              setTorchConfirmPinned(false);
                              setTorchConfirm(true);
                            }}
                            disabled={
                              !sshStatus?.connected ||
                              engineSyncRunning ||
                              !torchInfo ||
                              torchInfo.busy ||
                              torchRunning ||
                              !torchInfo.allowedTargets?.includes(torchTarget)
                            }
                          >
                            升级
                          </Button>
                        </div>
                        {torchInfo?.allowedTargets?.length &&
                        !torchInfo.allowedTargets.includes(torchTarget) ? (
                          <p className="text-xs text-warning">
                            仅支持 {torchInfo.allowedTargets.join(" / ")}
                          </p>
                        ) : null}
                        {torchJob && (
                          <TorchUpgradeProgress
                            job={torchJob}
                            warning={torchTrackingWarning}
                          />
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
    </>
  );
}
