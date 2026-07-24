import {
  CircleCheck,
  CircleX,
  Download,
  ExternalLink,
  HardDrive,
  Loader2,
  Play,
  Square,
  Trash2,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import type { TtsModelRow } from "@/types/tts";
import { formatSizeMb } from "./local-tts-formatters";
import type { LocalTtsModelState, ModelProgressEvent } from "./local-tts-model-state";

export function ModelStateIcon({ state }: { state: LocalTtsModelState }) {
  if (state === "downloading") return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
  if (state === "loaded") return <Play className="h-4 w-4 text-emerald-500" />;
  if (state === "downloaded") return <CircleCheck className="h-4 w-4 text-emerald-500" />;
  if (state === "failed") return <CircleX className="h-4 w-4 text-destructive" />;
  return <Download className="h-4 w-4 text-muted-foreground" />;
}

export function ModelStateLabel({ state }: { state: LocalTtsModelState }) {
  if (state === "loaded") return <span className="text-xs font-medium text-emerald-500">已加载</span>;
  if (state === "downloaded") return <span className="text-xs font-medium text-emerald-500">已下载</span>;
  if (state === "failed") return <span className="text-xs font-medium text-destructive">失败</span>;
  if (state === "downloading") return <span className="text-xs font-medium text-blue-500">下载中</span>;
  return <span className="text-xs text-muted-foreground">未下载</span>;
}

export function PendingScanLabel() {
  return <span className="text-xs text-muted-foreground">启动后扫描</span>;
}

export function LocalTtsModelDetailsDialog({
  selectedModel,
  selectedState,
  selectedProgress,
  runtimeRunning,
  onOpenChange,
  onCancel,
  onDownload,
  onUnload,
  onDelete,
}: {
  selectedModel: TtsModelRow | null;
  selectedState: LocalTtsModelState;
  selectedProgress?: ModelProgressEvent;
  runtimeRunning: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: (row: TtsModelRow) => void;
  onDownload: (row: TtsModelRow) => void;
  onUnload: (row: TtsModelRow) => void;
  onDelete: (row: TtsModelRow) => void;
}) {
  return (
    <Dialog open={!!selectedModel} onOpenChange={onOpenChange}>
      <DialogContent className="tts-glass-dialog max-w-2xl border-white/[0.08] bg-background/80 backdrop-blur-2xl shadow-2xl shadow-black/[0.2]">
        {selectedModel && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ModelStateIcon state={selectedState} />
                {selectedModel.displayName}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                  <div className="text-xs text-muted-foreground">HuggingFace Repo</div>
                  <div className="mt-1 flex items-center gap-2 truncate font-mono text-xs">
                    {selectedModel.hfRepoId}
                    <a href={`https://huggingface.co/${selectedModel.hfRepoId}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                  <div className="text-xs text-muted-foreground">磁盘大小</div>
                  <div className="mt-1 flex items-center gap-2 text-sm">
                    <HardDrive className="h-4 w-4 text-muted-foreground" />
                    {formatSizeMb(selectedModel.sizeMb)}
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{selectedModel.description}</p>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                <div className="text-xs text-muted-foreground">模型位置</div>
                <div className="mt-1 break-all font-mono text-xs text-foreground">
                  {selectedModel.modelRepoPath || selectedModel.modelCacheDir || (selectedState === "missing" ? "未下载，未找到本地路径" : "启动后扫描")}
                </div>
                {selectedModel.modelRepoPath && selectedModel.modelCacheDir && (
                  <div className="mt-2 break-all text-xs text-muted-foreground">缓存目录：{selectedModel.modelCacheDir}</div>
                )}
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-muted-foreground">
                License 以 HuggingFace 模型页为准；MYStudio 仅管理本地缓存和运行入口。
              </div>
              {selectedProgress && (
                <div>
                  <Progress value={selectedProgress.progress} className="h-2" />
                  <div className="mt-2 flex justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate">{selectedProgress.filename || selectedProgress.status}</span>
                    <span>{Math.round(selectedProgress.progress)}%</span>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                {selectedState === "downloading" ? (
                  <Button variant="outline" onClick={() => onCancel(selectedModel)}>
                    <Square className="mr-2 h-4 w-4" />
                    取消
                  </Button>
                ) : selectedState === "missing" || selectedState === "failed" ? (
                  runtimeRunning ? (
                    <Button onClick={() => onDownload(selectedModel)}>
                      <Download className="mr-2 h-4 w-4" />
                      {selectedState === "failed" ? "重试下载" : "下载"}
                    </Button>
                  ) : (
                    <div className="flex h-9 items-center px-2">
                      <PendingScanLabel />
                    </div>
                  )
                ) : (
                  <div className="flex h-9 items-center px-2">
                    <ModelStateLabel state={selectedState} />
                  </div>
                )}
                <Button variant="outline" onClick={() => onUnload(selectedModel)}>
                  <Unplug className="mr-2 h-4 w-4" />
                  卸载
                </Button>
                <Button variant="destructive" onClick={() => onDelete(selectedModel)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  删除
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
