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
import { Textarea } from "@/components/ui/textarea";

export type NovelEditDraft = {
  volume: string;
  title: string;
  sourceText: string;
  eventSummary: string;
  eventState: string;
};

export function NovelEditDialog({
  open,
  draft,
  onOpenChange,
  onDraftChange,
  onSave,
}: {
  open: boolean;
  draft: NovelEditDraft;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: NovelEditDraft) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>编辑章节</DialogTitle>
          <DialogDescription>
            保存后会同步更新项目存储位置下的章节文档。
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[160px_1fr] gap-3">
          <Input
            value={draft.volume}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                volume: event.target.value,
              })
            }
            placeholder="卷"
          />
          <Input
            value={draft.title}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                title: event.target.value,
              })
            }
            placeholder="章节名称"
          />
          <Textarea
            className="col-span-2 min-h-[260px] font-mono text-xs"
            value={draft.sourceText}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                sourceText: event.target.value,
              })
            }
            placeholder="章节内容"
          />
          <Textarea
            className="min-h-[120px]"
            value={draft.eventSummary}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                eventSummary: event.target.value,
              })
            }
            placeholder="事件摘要"
          />
          <Textarea
            className="min-h-[120px]"
            value={draft.eventState}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                eventState: event.target.value,
              })
            }
            placeholder="事件状态"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
