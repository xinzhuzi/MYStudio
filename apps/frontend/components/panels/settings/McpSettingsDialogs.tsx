/**
 * MCP 设置页·顶层弹窗群(1124 超线文件拆分:自 McpSettingsTab 原样搬出;props=域模型对象,块内零改动)。
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { McpTransport } from "@/stores/mcp/mcp-servers-store";
import { X } from "lucide-react";
import type { useMcpServerAdmin } from "./use-mcp-server-admin";
import type { useSshAdmin } from "./use-ssh-admin";
import type { useTorchUpgradeAdmin } from "./use-torch-upgrade-admin";

/**
 * 设置页顶层弹窗群:关闭远端 MYStudio 确认/PyTorch 升级确认与结果/MCP 服务器表单。
 */
export function McpSettingsDialogs({
  mcpAdmin,
  sshAdmin,
  torchAdmin,
}: {
  mcpAdmin: ReturnType<typeof useMcpServerAdmin>;
  sshAdmin: ReturnType<typeof useSshAdmin>;
  torchAdmin: ReturnType<typeof useTorchUpgradeAdmin>;
}) {
  const {
    dialogOpen,
    draft,
    editingId,
    formError,
    setDialogOpen,
    setDraft,
    submit,
  } = mcpAdmin;
  const {
    runMystudioAction,
    setShutdownConfirmOpen,
    shutdownConfirmOpen,
  } = sshAdmin;
  const {
    setTorchConfirm,
    setTorchResultOpen,
    startTorchUpgrade,
    torchChangeRows,
    torchConfirm,
    torchJob,
    torchResultOpen,
  } = torchAdmin;
  return (
    <>
<AlertDialog open={shutdownConfirmOpen} onOpenChange={setShutdownConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>关闭远端 MYStudio</AlertDialogTitle>
            <AlertDialogDescription>将彻底关闭 Windows 上的 MYStudio 与引擎；引擎正在跑的任务会被中断。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction data-testid="shutdown-confirm-ok"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void runMystudioAction("shutting")}>确认关闭</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* torch 升级确认/结果弹窗:顶层渲染(1106 修复)——原先住在 torch-upgrade 分节
          折叠内容里,分节收起时 Radix Collapsible 不挂载内容,同步面板点「更新」
          setTorchConfirm(true) 后弹窗组件不存在=点击无任何反应(实弹踩雷)。 */}
      <AlertDialog open={torchConfirm} onOpenChange={setTorchConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认升级引擎？</AlertDialogTitle>
            <AlertDialogDescription>
              引擎将停机约 15–60 分钟；失败将自动回滚旧版；磁盘需要至少 15 GiB
              可用空间。SSH 中断导致安装状态不明时需要人工介入。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* 1107 用户令:确认前把会动的件列全——点了是真升级还是跳过,此处定案 */}
          {torchChangeRows && (
            <div
              className="space-y-0.5 rounded-lg border border-border/60 p-2 font-mono text-xs"
              data-testid="torch-confirm-change-list"
            >
              {torchChangeRows.rows.map((row) => (
                <p
                  key={row.pkg}
                  className="flex flex-wrap items-center gap-x-2"
                >
                  <span className="w-24 shrink-0">{row.pkg}</span>
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
              <p className="pt-1 font-sans">
                {torchChangeRows.actionable && torchChangeRows.unverified ? (
                  <span className="text-muted-foreground">
                    有件未能读取现装版本——不冒充缺件;确认后 pip 幂等核对,已达标件零下载。
                  </span>
                ) : torchChangeRows.actionable ? (
                  <span className="text-warning">
                    真升级:有未达标件将安装(其余零下载)。
                  </span>
                ) : (
                  <span className="text-success">
                    三件套均已达标,确认后将直接跳过,不动环境。
                  </span>
                )}
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void startTorchUpgrade()}>
              确认升级
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={torchResultOpen} onOpenChange={setTorchResultOpen}>
        <DialogContent data-testid="torch-upgrade-result-dialog">
          <DialogHeader>
            <DialogTitle>
              {torchJob?.status === "complete" ? "升级完成" : "升级失败"}
            </DialogTitle>
            <DialogDescription>
              {torchJob?.message ?? torchJob?.error}
            </DialogDescription>
          </DialogHeader>
          {torchJob?.result && (
            <p className="text-sm font-mono">
              {String(torchJob.result.from ?? "未知")} →{" "}
              {String(torchJob.result.to ?? "未知")}
            </p>
          )}
          {torchJob?.status === "complete" && (
            <p className="text-sm">引擎已重启</p>
          )}
          {typeof torchJob?.result?.pipError === "string" && (
            <p className="text-xs text-warning">
              ⚠️ {torchJob.result.pipError}
            </p>
          )}
          {torchJob?.tail?.length ? (
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap text-xs">
              {torchJob.tail.join("\n")}
            </pre>
          ) : null}
          <DialogFooter>
            <Button size="sm" onClick={() => setTorchResultOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="例如：本地文件服务"
              />
            </div>
            <div className="space-y-1.5">
              <Label>连接方式</Label>
              <Select
                value={draft.transport}
                onValueChange={(value) =>
                  setDraft({ ...draft, transport: value as McpTransport })
                }
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
                    onChange={(event) =>
                      setDraft({ ...draft, command: event.target.value })
                    }
                    placeholder="例如：npx"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-args">命令参数（空格分隔）</Label>
                  <Input
                    id="mcp-args"
                    value={draft.args}
                    onChange={(event) =>
                      setDraft({ ...draft, args: event.target.value })
                    }
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
                  onChange={(event) =>
                    setDraft({ ...draft, url: event.target.value })
                  }
                  placeholder="例如：http://127.0.0.1:3000/mcp"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="mcp-env">
                环境变量（每行一条，格式 键=值，可选）
              </Label>
              <Textarea
                id="mcp-env"
                value={draft.env}
                onChange={(event) =>
                  setDraft({ ...draft, env: event.target.value })
                }
                placeholder={"API_KEY=xxx\nDEBUG=true"}
                rows={3}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <Switch
                checked={draft.enabled}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, enabled: checked === true })
                }
              />
              启用这个服务器
            </label>
            {formError ? (
              <p
                className="text-xs text-destructive"
                data-testid="mcp-form-error"
              >
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
