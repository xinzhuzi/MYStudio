/**
 * MCP 设置页·远程设备表单与弹窗(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。
 */
import { Button } from "@/components/ui/button";
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
import { normalizeEngineUrl } from "@/stores/settings/engine-presets-store";
import type { useRemoteEngineAdmin } from "./use-remote-engine-admin";

/**
 * 添加设备表单(名字选填+地址;可先测试再保存生效)。
 */
export function EngineDeviceAddForm({
  remoteAdmin,
}: {
  remoteAdmin: ReturnType<typeof useRemoteEngineAdmin>;
}) {
  const {
    addDraft,
    remoteProbing,
    remoteSaving,
    setAddDraft,
    setAddingDevice,
    submitAddDevice,
    testRemoteConnection,
  } = remoteAdmin;
  return (
<div
                    className="space-y-2.5 rounded-xl border border-border p-3"
                    data-testid="engine-device-add-form"
                  >
                    <div className="grid gap-2.5">
                      <div className="space-y-1.5">
                        <Label htmlFor="engine-device-name">设备名(选填)</Label>
                        <Input
                          id="engine-device-name"
                          value={addDraft.label}
                          onChange={(e) =>
                            setAddDraft((prev) => ({
                              ...prev,
                              label: e.target.value,
                            }))
                          }
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
                          onChange={(e) =>
                            setAddDraft((prev) => ({
                              ...prev,
                              url: e.target.value,
                            }))
                          }
                          placeholder="http://192.168.x.x:17000(全角：／自动归一)"
                          data-testid="engine-device-add-url"
                          spellCheck={false}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void testRemoteConnection(
                            normalizeEngineUrl(addDraft.url),
                          )
                        }
                        disabled={
                          remoteProbing || remoteSaving || !addDraft.url.trim()
                        }
                        data-testid="engine-device-add-test"
                      >
                        {remoteProbing ? "测试中…" : "测试连接"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={submitAddDevice}
                        disabled={remoteSaving || !addDraft.url.trim()}
                        data-testid="engine-device-add-save"
                      >
                        {remoteSaving ? "保存中…" : "保存并生效"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAddingDevice(false)}
                        disabled={remoteSaving}
                        data-testid="engine-device-add-cancel"
                      >
                        取消
                      </Button>
                    </div>
                  </div>
  );
}

/**
 * 编辑设备弹窗(改名或换地址;生效中的设备换地址自动切到新地址)。
 */
export function EngineDeviceEditDialog({
  remoteAdmin,
}: {
  remoteAdmin: ReturnType<typeof useRemoteEngineAdmin>;
}) {
  const {
    editDraft,
    editingDevice,
    setEditDraft,
    setEditingDevice,
    submitEditDevice,
  } = remoteAdmin;
  return (
<Dialog
                  open={editingDevice !== null}
                  onOpenChange={(open) => !open && setEditingDevice(null)}
                >
                  <DialogContent
                    className="max-w-sm"
                    data-testid="engine-device-edit-dialog"
                  >
                    <DialogHeader>
                      <DialogTitle>编辑设备</DialogTitle>
                      <DialogDescription>
                        改名或换地址;正在生效的设备换地址会自动切到新地址。
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2.5">
                      <div className="space-y-1.5">
                        <Label htmlFor="engine-device-edit-name">设备名</Label>
                        <Input
                          id="engine-device-edit-name"
                          value={editDraft.label}
                          onChange={(e) =>
                            setEditDraft((prev) => ({
                              ...prev,
                              label: e.target.value,
                            }))
                          }
                          data-testid="engine-device-edit-name"
                          spellCheck={false}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="engine-device-edit-url">引擎地址</Label>
                        <Input
                          id="engine-device-edit-url"
                          value={editDraft.url}
                          onChange={(e) =>
                            setEditDraft((prev) => ({
                              ...prev,
                              url: e.target.value,
                            }))
                          }
                          data-testid="engine-device-edit-url"
                          spellCheck={false}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingDevice(null)}
                      >
                        取消
                      </Button>
                      <Button
                        size="sm"
                        onClick={submitEditDevice}
                        data-testid="engine-device-edit-save"
                      >
                        保存
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
  );
}
