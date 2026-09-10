/**
 * Dashboard 对话框族——重命名/移动项目(OQ3)/批量删除确认。
 * file-size-reduction P3 拆出,JSX 体逐字保留;state+回调经 props 注入。
 */
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FolderInput } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Progress as ProgressBar } from "@/components/ui/progress";
import type { Project } from "@/stores/project/project-store";
import type { ProjectFolderMoveProgressEvent } from "@/types/electron";

/** 注入的 state+回调契约(Dashboard.tsx 构造;原 props: any 是隐式 any 源头) */
export interface DashboardDialogsProps {
  renameDialogOpen: boolean;
  setRenameDialogOpen: Dispatch<SetStateAction<boolean>>;
  renameValue: string;
  setRenameValue: Dispatch<SetStateAction<string>>;
  handleRename: () => Promise<void>;
  movePhase: "confirm" | "moving";
  moveProgress: ProjectFolderMoveProgressEvent | null;
  moveTarget: Project | null;
  handleCancelMove: () => Promise<void>;
  closeMoveDialog: () => void;
  handleMoveStart: () => Promise<void>;
  MOVE_PHASE_LABELS: Record<ProjectFolderMoveProgressEvent["phase"], string>;
  Progress: typeof ProgressBar;
  selectedIds: Set<string>;
  projects: Project[];
  batchDeleteConfirm: boolean;
  setBatchDeleteConfirm: Dispatch<SetStateAction<boolean>>;
  handleBatchDelete: () => Promise<void>;
}

export function DashboardDialogs(props: DashboardDialogsProps) {
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
