/**
 * MCP 设置页·远程引擎区块(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。
 */
import { ENGINE_HOST_LABEL, McpRow } from "./McpSettingsParts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEnginePresetsStore } from "@/stores/settings/engine-presets-store";
import { Monitor, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { EngineDeviceAddForm, EngineDeviceEditDialog } from "./McpDeviceForms";
import { EngineSyncSection } from "./McpEngineSyncSection";
import { TorchUpgradeSection } from "./McpTorchUpgradeSection";
import type { useRemoteEngineAdmin } from "./use-remote-engine-admin";
import type { useSshAdmin } from "./use-ssh-admin";
import type { useEngineSyncAdmin } from "./use-engine-sync-admin";
import type { useTorchUpgradeAdmin } from "./use-torch-upgrade-admin";
import type { SectionId } from "./McpSettingsParts";

/**
 * 远程引擎区块(ComfyUI 引擎地址·远程):全景状态条+设备列表(本机行恒在+远端设备行)
 * +探活结果与详情弹窗,内嵌引擎同步子区与 PyTorch/CUDA 升级子区。
 */
export function McpRemoteEngineSection({
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
    activateDevice,
    activeRemoteUrl,
    addingDevice,
    engineOkDialog,
    enginePresetRemove,
    enginePresets,
    remoteActive,
    remoteEngine,
    remoteProbing,
    remoteSaving,
    remoteTest,
    setAddDraft,
    setAddingDevice,
    setEditDraft,
    setEditingDevice,
    setEngineOkDialog,
    setRemoteTest,
    testRemoteConnection,
  } = remoteAdmin;
  const {
    sshStatus,
  } = sshAdmin;
  return (
<McpRow
              sectionId="remote-engine"
              icon={Server}
              title="ComfyUI 引擎地址（远程）"
              pill={remoteEngine?.source === "settings" ? "ready" : "neutral"}
              collapsed={collapsedSections.has("remote-engine")}
              onToggle={toggleSectionCollapsed}
            >
              <div
                className="space-y-3 px-5 py-3"
                data-testid="remote-engine-section"
              >
                {/* R2 全景状态条(1104 engine-failure-guidance):远端引擎/SSH 隧道/远端管理/本地备胎
                四组件一排状态,有红/黄时给一句话建议——用户令:每种情况都要有提示 */}
                <div
                  className="flex flex-wrap items-center gap-2 text-xs"
                  data-testid="engine-status-bar"
                >
                  {remoteActive ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${remoteTest.status === "ok" || remoteEngine ? "border-success/25 bg-success/10 text-success" : "border-destructive/25 bg-destructive/[0.08] text-destructive/90"}`}
                    >
                      {remoteTest.status === "ok" || remoteEngine ? "✅" : "❌"}{" "}
                      远端引擎
                    </span>
                  ) : null}
                  {sshStatus?.configured ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${sshStatus.connected ? "border-success/25 bg-success/10 text-success" : "border-destructive/25 bg-destructive/[0.08] text-destructive/90"}`}
                    >
                      {sshStatus.connected ? "✅" : "❌"} SSH 隧道
                    </span>
                  ) : null}
                  {remoteActive ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${sshStatus?.connected ? "border-success/25 bg-success/10 text-success" : "border-warning/40 bg-warning/[0.06] text-warning"}`}
                    >
                      {sshStatus?.connected ? "✅" : "⚠️"} 远端管理
                    </span>
                  ) : null}
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${useEnginePresetsStore.getState().presets.length > 0 ? "border-success/25 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground"}`}
                  >
                    {remoteActive ? "✅" : "⚠️"} 本地备胎
                    {!remoteActive ? "(当前本机模式)" : ""}
                  </span>
                </div>
                {(sshStatus?.configured && !sshStatus.connected) ||
                (remoteActive && !remoteEngine) ? (
                  <p
                    className="text-xs leading-4 text-warning"
                    data-testid="engine-status-hint"
                  >
                    {remoteActive && !remoteEngine
                      ? "远端引擎不可达——出图会失败,请检查 Windows ComfyUI"
                      : ""}
                    {remoteActive &&
                    !remoteEngine &&
                    sshStatus?.configured &&
                    !sshStatus.connected
                      ? "; "
                      : ""}
                    {sshStatus?.configured && !sshStatus.connected
                      ? "SSH 隧道断开——工作流列表/模型库存不可用,出图不受影响"
                      : ""}
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
                          <Monitor
                            className="size-4 text-muted-foreground"
                            aria-hidden
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span
                              className={`h-3 w-3 shrink-0 rounded-full border-2 ${!remoteActive ? "border-primary bg-primary" : "border-muted-foreground/40 bg-transparent"}`}
                              aria-hidden
                            />
                            <span className="truncate text-sm font-medium">
                              本机引擎({ENGINE_HOST_LABEL})
                            </span>
                          </span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {ENGINE_HOST_LABEL} · 启停/模型在「设置 → 本地配置」
                          </span>
                        </span>
                      </button>
                      {!remoteActive && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                          当前生效
                        </span>
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
                                  {p.label}
                                </span>
                              </span>
                              <span className="block truncate font-mono text-xs text-muted-foreground">
                                {p.url}
                              </span>
                            </span>
                          </button>
                          {isActive && (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                              当前生效
                            </span>
                          )}
                          <span className="flex shrink-0 items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => void testRemoteConnection(p.url)}
                              disabled={remoteProbing}
                              data-testid="engine-device-test"
                              data-url={p.url}
                              title="仅探活不保存"
                            >
                              测试
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                setEditingDevice(p);
                                setEditDraft({ label: p.label, url: p.url });
                              }}
                              data-testid="engine-device-edit"
                              data-url={p.url}
                            >
                              <Pencil className="mr-0.5 h-3 w-3" aria-hidden />
                              编辑
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                              onClick={() => enginePresetRemove(p.url)}
                              aria-label={`删除设备 ${p.label}`}
                              data-testid="engine-device-delete"
                              data-url={p.url}
                              title="删除设备条目(不改动当前生效引擎)"
                            >
                              <Trash2 className="h-3 w-3" aria-hidden />
                            </Button>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {enginePresets.length === 0 && !addingDevice && (
                    <p
                      className="px-1 text-xs leading-5 text-muted-foreground"
                      data-testid="engine-devices-empty"
                    >
                      暂无远端设备——点下方「添加设备」录入其他机器的引擎地址,可配多台随时切换。
                    </p>
                  )}
                </div>
                {/* + 添加设备(ZCode 底部新建连接排范式):名字选填+地址;可先测试再保存生效 */}
                {!addingDevice ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => {
                      setAddingDevice(true);
                      setAddDraft({ label: "", url: "" });
                      setRemoteTest({ status: "idle" });
                    }}
                    disabled={remoteSaving || remoteProbing}
                    data-testid="engine-device-add"
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                    添加设备
                  </Button>
                ) : (
                  <EngineDeviceAddForm remoteAdmin={remoteAdmin} />
                )}
                {/* 编辑设备(名字/地址):地址不变=只改名;地址变=删旧加新(自定义名带入),
                被编辑的正是生效机时无缝续活到新地址 */}
                <EngineDeviceEditDialog remoteAdmin={remoteAdmin} />
                {remoteTest.status === "ok" && (
                  <p
                    className="text-xs text-success"
                    data-testid="remote-engine-ok"
                  >
                    {remoteTest.text}
                  </p>
                )}
                {remoteTest.status === "error" && (
                  <p
                    className="text-xs text-destructive"
                    data-testid="remote-engine-error"
                  >
                    {remoteTest.message}
                  </p>
                )}
                {/* 1102 F4:探活成功详情弹窗(实机数据:版本/显卡来自 probe 实时取数) */}
                <Dialog
                  open={engineOkDialog !== null}
                  onOpenChange={(open) => !open && setEngineOkDialog(null)}
                >
                  <DialogContent
                    className="max-w-sm"
                    data-testid="remote-engine-ok-dialog"
                  >
                    <DialogHeader>
                      <DialogTitle>引擎连接</DialogTitle>
                      <DialogDescription>
                        {engineOkDialog?.headline}
                      </DialogDescription>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                      {engineOkDialog?.note}
                    </p>
                    <DialogFooter>
                      <Button size="sm" onClick={() => setEngineOkDialog(null)}>
                        知道了
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <EngineSyncSection
                  syncAdmin={syncAdmin}
                  remoteAdmin={remoteAdmin}
                  sshAdmin={sshAdmin}
                  torchAdmin={torchAdmin}
                  collapsedSections={collapsedSections}
                  toggleSectionCollapsed={toggleSectionCollapsed}
                />
                <TorchUpgradeSection
                  remoteAdmin={remoteAdmin}
                  syncAdmin={syncAdmin}
                  torchAdmin={torchAdmin}
                  sshAdmin={sshAdmin}
                  collapsedSections={collapsedSections}
                  toggleSectionCollapsed={toggleSectionCollapsed}
                />
                {/* 1107 修:torch 区原在此 div 外=左缘比引擎同步浅 20px(px-5 容器差);搬入同容器 */}
              </div>
            </McpRow>
  );
}
