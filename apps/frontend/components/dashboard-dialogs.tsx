/**
 * Dashboard 对话框族——重命名/移动项目(OQ3)/批量删除确认。
 * file-size-reduction P3 拆出,JSX 体逐字保留;state+回调经 props 注入。
 */
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderInput } from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DashboardDialogs(props: any) {
  const { renameDialogOpen, setRenameDialogOpen, renameValue, setRenameValue, handleRename,
    movePhase, moveProgress, moveTarget, handleCancelMove, closeMoveDialog, handleMoveStart, MOVE_PHASE_LABELS, Progress, selectedIds, projects, 
    batchDeleteConfirm, setBatchDeleteConfirm, handleBatchDelete } = props;

  return (
    <>
      {/* ==================== Rename Dialog ==================== */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>重命名项目</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
            placeholder="输入新名称..."
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>取消</Button>
            <Button onClick={handleRename} disabled={!renameValue.trim()}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Move Dialog (OQ3) ==================== */}
      <Dialog
        open={moveTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeMoveDialog();
        }}
      >
        <DialogContent className="sm:max-w-md">
          {movePhase === "confirm" && moveTarget ? (
            <>
              <DialogHeader>
                <DialogTitle>移动项目</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                将「{moveTarget.name}」的项目文件夹移动到其他父目录，
                移动完成后应用将改用新位置打开该项目。
              </p>
              {moveTarget.location && (
                <p
                  className="text-xs font-mono text-muted-foreground truncate"
                  title={moveTarget.location}
                >
                  {moveTarget.location}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={closeMoveDialog}>取消</Button>
                <Button onClick={handleMoveStart}>
                  <FolderInput className="w-4 h-4 mr-2" />
                  选择目标位置…
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>正在移动「{moveTarget?.name}」</DialogTitle>
              </DialogHeader>
              {moveProgress && moveProgress.bytesTotal > 0 ? (
                <div className="space-y-2">
                  <Progress
                    value={Math.min(
                      100,
                      Math.round((moveProgress.bytesDone / moveProgress.bytesTotal) * 100),
                    )}
                  />
                  <p className="text-xs text-muted-foreground">
                    {MOVE_PHASE_LABELS[moveProgress.phase]}{" "}
                    {Math.min(
                      100,
                      Math.round((moveProgress.bytesDone / moveProgress.bytesTotal) * 100),
                    )}%
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {moveProgress ? MOVE_PHASE_LABELS[moveProgress.phase] : "正在准备移动…"}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={handleCancelMove}>
                  取消移动
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ==================== Batch Delete Confirm Dialog ==================== */}
      <Dialog open={batchDeleteConfirm} onOpenChange={setBatchDeleteConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认批量删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            即将删除 <span className="text-foreground font-medium">{selectedIds.size}</span> 个项目，
            此操作不可撤销。确定继续？
          </p>
          {projects.filter((p) => selectedIds.has(p.id) && p.location).length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">以下外部项目的整个文件夹将被一并删除：</p>
              {projects
                .filter((p) => selectedIds.has(p.id) && p.location)
                .map((p) => (
                  <p
                    key={p.id}
                    className="text-xs font-mono text-destructive truncate"
                    title={p.location}
                  >
                    {p.location}
                  </p>
                ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDeleteConfirm(false)}>取消</Button>
            <Button variant="destructive" onClick={handleBatchDelete}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
