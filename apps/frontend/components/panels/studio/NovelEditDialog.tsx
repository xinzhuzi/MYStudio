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
  loading = false,
  loadFailed = false,
}: {
  open: boolean;
  draft: NovelEditDraft;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: NovelEditDraft) => void;
  onSave: () => void;
  /** 1127 正文按需装载中(轻索引条目开编辑时先读正文文件):标题显示装载中、
   *  保存禁用防「空文覆盖」。缺省 false=已带全文的直开路径不受影响。 */
  loading?: boolean;
  /** 1127 保存守卫:正文文件缺失或读取失败时置真——正文框只读、保存禁用、
   *  说明文字如实陈述,防止以空文覆盖唯一真源。缺省 false。 */
  loadFailed?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100vh-48px)] w-[calc(100vw-48px)] max-w-none flex-col gap-4 p-6">
        <DialogHeader>
          <DialogTitle>
            {loading ? "编辑章节（正文装载中…）" : "编辑章节"}
          </DialogTitle>
          <DialogDescription>
            {loadFailed
              ? "正文文件缺失或无法读取，已锁定保存。"
              : loading
                ? "正在从正文文件读回正文，装载完成前请勿保存。"
                : "保存后会同步更新项目存储位置下的章节文档。"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[auto_minmax(0,1fr)_minmax(140px,22%)] gap-3">
          <div className="col-span-2 grid grid-cols-[160px_1fr] gap-3">
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
          </div>
          <Textarea
            className="col-span-2 h-full min-h-0 resize-none font-mono text-xs"
            value={draft.sourceText}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                sourceText: event.target.value,
              })
            }
            readOnly={loadFailed}
            placeholder="章节内容"
          />
          <Textarea
            className="h-full min-h-0 resize-none"
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
            className="h-full min-h-0 resize-none"
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
          <Button onClick={onSave} disabled={loading || loadFailed}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
