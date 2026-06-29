import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload } from "lucide-react";

export function NovelImportDialog({
  open,
  importMode,
  importSourceName,
  novelDraft,
  onOpenChange,
  onImportModeChange,
  onNovelDraftChange,
  onFileChange,
  onConfirmImport,
}: {
  open: boolean;
  importMode: "append" | "replace";
  importSourceName: string;
  novelDraft: string;
  onOpenChange: (open: boolean) => void;
  onImportModeChange: (mode: "append" | "replace") => void;
  onNovelDraftChange: (value: string) => void;
  onFileChange: (file?: File) => void;
  onConfirmImport: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>导入原文</DialogTitle>
          <DialogDescription>
            TXT/Markdown 会拆成章节，并把原文写成文档保存到当前项目存储位置。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label className="flex min-h-20 cursor-pointer items-center justify-between gap-4 rounded-lg border border-dashed border-primary/45 bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Upload className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  选择 TXT/Markdown 文件
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {importSourceName ||
                    "支持 .txt、.md，也可以直接在下方粘贴原文。"}
                </span>
              </span>
            </div>
            <span className="shrink-0 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium">
              选择文件
            </span>
            <input
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              className="sr-only"
              onChange={(event) => onFileChange(event.target.files?.[0])}
            />
          </Label>
          <div className="flex gap-2">
            <Button
              variant={importMode === "append" ? "default" : "secondary"}
              onClick={() => onImportModeChange("append")}
            >
              追加导入
            </Button>
            <Button
              variant={importMode === "replace" ? "default" : "secondary"}
              onClick={() => onImportModeChange("replace")}
            >
              覆盖导入
            </Button>
          </div>
          <Textarea
            value={novelDraft}
            onChange={(event) => onNovelDraftChange(event.target.value)}
            className="min-h-[360px] font-mono text-xs"
            placeholder="粘贴小说原文，或选择 .txt/.md 文件。"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onConfirmImport} disabled={!novelDraft.trim()}>
            确认导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
