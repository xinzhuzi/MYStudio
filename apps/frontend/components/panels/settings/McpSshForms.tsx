/**
 * MCP 设置页·SSH 连接表单与弹窗(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。
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
import type { useSshAdmin } from "./use-ssh-admin";

/**
 * 添加 SSH 连接表单(只入列表不落章,点行才连接)。
 */
export function SshConnectionAddForm({
  sshAdmin,
}: {
  sshAdmin: ReturnType<typeof useSshAdmin>;
}) {
  const {
    setAddingSsh,
    setSshAddDraft,
    sshAddDraft,
    sshTesting,
    submitAddSsh,
    testSshConnection,
  } = sshAdmin;
  return (
<div
                    className="space-y-2.5 rounded-xl border border-border p-3"
                    data-testid="ssh-connection-add-form"
                  >
                    <div className="grid gap-2.5">
                      <div className="space-y-1.5">
                        <Label htmlFor="ssh-connection-name">名字(选填)</Label>
                        <Input
                          id="ssh-connection-name"
                          value={sshAddDraft.label}
                          onChange={(e) =>
                            setSshAddDraft((prev) => ({
                              ...prev,
                              label: e.target.value,
                            }))
                          }
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
                          onChange={(e) =>
                            setSshAddDraft((prev) => ({
                              ...prev,
                              host: e.target.value,
                            }))
                          }
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
                            onChange={(e) =>
                              setSshAddDraft((prev) => ({
                                ...prev,
                                port: e.target.value,
                              }))
                            }
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
                            onChange={(e) =>
                              setSshAddDraft((prev) => ({
                                ...prev,
                                user: e.target.value,
                              }))
                            }
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
                          onChange={(e) =>
                            setSshAddDraft((prev) => ({
                              ...prev,
                              keyPath: e.target.value,
                            }))
                          }
                          placeholder="留空=自动探测 ~/.ssh/id_ed25519 → id_ecdsa → id_rsa"
                          data-testid="ssh-connection-add-key"
                          spellCheck={false}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label
                          htmlFor="ssh-connection-password"
                          className="text-xs"
                        >
                          密码(可选;空=走密钥认证)
                        </Label>
                        <Input
                          id="ssh-connection-password"
                          type="password"
                          value={sshAddDraft.password}
                          onChange={(e) =>
                            setSshAddDraft((prev) => ({
                              ...prev,
                              password: e.target.value,
                            }))
                          }
                          placeholder="留空=用密钥连接(自动探测 ~/.ssh/id_ed25519)"
                          data-testid="ssh-connection-add-password"
                          spellCheck={false}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void testSshConnection()}
                        disabled={sshTesting}
                        data-testid="ssh-connection-add-test"
                        title="仅探活(后端契约=测当前连接,非表单草稿)"
                      >
                        {sshTesting ? "测试中…" : "测试连接"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={submitAddSsh}
                        disabled={!sshAddDraft.host.trim()}
                        data-testid="ssh-connection-add-save"
                      >
                        保存
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAddingSsh(false)}
                        data-testid="ssh-connection-add-cancel"
                      >
                        取消
                      </Button>
                    </div>
                  </div>
  );
}

/**
 * 编辑 SSH 连接弹窗(改所有字段保 id;密码留空=不改)。
 */
export function SshConnectionEditDialog({
  sshAdmin,
}: {
  sshAdmin: ReturnType<typeof useSshAdmin>;
}) {
  const {
    setSshEditDraft,
    setSshEditing,
    sshEditDraft,
    sshEditing,
    submitEditSsh,
  } = sshAdmin;
  return (
<Dialog
                  open={sshEditing !== null}
                  onOpenChange={(open) => !open && setSshEditing(null)}
                >
                  <DialogContent
                    className="max-w-sm"
                    data-testid="ssh-connection-edit-dialog"
                  >
                    <DialogHeader>
                      <DialogTitle>编辑 SSH 连接</DialogTitle>
                      <DialogDescription>
                        改名或换主机;改完点该行重新连接即生效。
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2.5">
                      <div className="space-y-1.5">
                        <Label htmlFor="ssh-connection-edit-name">名字</Label>
                        <Input
                          id="ssh-connection-edit-name"
                          value={sshEditDraft.label}
                          onChange={(e) =>
                            setSshEditDraft((prev) => ({
                              ...prev,
                              label: e.target.value,
                            }))
                          }
                          data-testid="ssh-connection-edit-name"
                          spellCheck={false}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ssh-connection-edit-host">主机</Label>
                        <Input
                          id="ssh-connection-edit-host"
                          value={sshEditDraft.host}
                          onChange={(e) =>
                            setSshEditDraft((prev) => ({
                              ...prev,
                              host: e.target.value,
                            }))
                          }
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
                            onChange={(e) =>
                              setSshEditDraft((prev) => ({
                                ...prev,
                                port: e.target.value,
                              }))
                            }
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
                            onChange={(e) =>
                              setSshEditDraft((prev) => ({
                                ...prev,
                                user: e.target.value,
                              }))
                            }
                            data-testid="ssh-connection-edit-user"
                            spellCheck={false}
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ssh-connection-edit-key">
                          密钥路径
                        </Label>
                        <Input
                          id="ssh-connection-edit-key"
                          value={sshEditDraft.keyPath}
                          onChange={(e) =>
                            setSshEditDraft((prev) => ({
                              ...prev,
                              keyPath: e.target.value,
                            }))
                          }
                          data-testid="ssh-connection-edit-key"
                          spellCheck={false}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ssh-conn-password" className="text-xs">
                          密码(留空=不改)
                        </Label>
                        <Input
                          id="ssh-conn-password"
                          type="password"
                          value={sshEditDraft.password}
                          onChange={(e) =>
                            setSshEditDraft((prev) => ({
                              ...prev,
                              password: e.target.value,
                            }))
                          }
                          placeholder="留空=保持原密码;输入新值=更换"
                          data-testid="ssh-conn-password"
                          spellCheck={false}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSshEditing(null)}
                      >
                        取消
                      </Button>
                      <Button
                        size="sm"
                        onClick={submitEditSsh}
                        data-testid="ssh-connection-edit-save"
                      >
                        保存
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
  );
}
