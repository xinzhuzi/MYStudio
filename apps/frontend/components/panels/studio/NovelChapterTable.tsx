import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { NovelChapter } from "@/types/studio";
import { AlertTriangle, Edit3, Trash2 } from "lucide-react";

export function NovelChapterTable({
  chapters,
  selectedIds,
  allVisibleSelected,
  emptyState,
  onDelete,
  onEdit,
  onToggleAllVisible,
  onToggleChapter,
}: {
  chapters: NovelChapter[];
  selectedIds: Set<string>;
  allVisibleSelected: boolean;
  emptyState: ReactNode;
  onDelete: (chapter: NovelChapter) => void;
  onEdit: (chapter: NovelChapter) => void;
  onToggleAllVisible: (checked: boolean) => void;
  onToggleChapter: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-panel/40">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-12">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(checked) =>
                  onToggleAllVisible(checked === true)
                }
              />
            </TableHead>
            <TableHead className="w-16">序号</TableHead>
            <TableHead className="w-28">卷</TableHead>
            <TableHead className="w-[220px]">章节名称</TableHead>
            <TableHead>章节内容</TableHead>
            <TableHead className="w-[240px]">事件摘要</TableHead>
            <TableHead className="w-[180px]">事件状态</TableHead>
            <TableHead className="w-[260px] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {chapters.map((chapter) => (
            <TableRow
              key={chapter.id}
              data-state={selectedIds.has(chapter.id) ? "selected" : undefined}
            >
              <TableCell>
                <Checkbox
                  checked={selectedIds.has(chapter.id)}
                  onCheckedChange={(checked) =>
                    onToggleChapter(chapter.id, checked === true)
                  }
                />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {chapter.index}
              </TableCell>
              <TableCell className="text-xs">
                {chapter.volume ?? "正文卷"}
              </TableCell>
              <TableCell>
                <div className="line-clamp-2 font-medium">{chapter.title}</div>
              </TableCell>
              <TableCell>
                <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {chapter.sourceText}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-start gap-1">
                  <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {chapter.eventSummary || "未填写"}
                  </div>
                  {chapter.eventNameWarnings?.length ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="查看人物名校验警告"
                          className="h-5 w-5 shrink-0 p-0 text-warning hover:text-warning"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent side="top" align="end" className="w-72 p-3 text-xs">
                        <div className="flex items-center gap-1.5 font-medium text-warning">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          疑似圣经人物误写
                        </div>
                        <div className="mt-1.5 leading-5 text-muted-foreground">
                          以下名字与原著圣经登记名仅差一字，可能是 AI 误写：
                        </div>
                        <ul className="mt-1.5 space-y-0.5">
                          {chapter.eventNameWarnings.map((name) => (
                            <li key={name} className="rounded bg-warning/10 px-1.5 py-0.5 text-warning">
                              {name}
                            </li>
                          ))}
                        </ul>
                        <div className="mt-1.5 leading-5 text-muted-foreground">
                          若为笔误请修正事件摘要；若确为新角色（NPC/新配角）可忽略，
                          常驻配角建议在圣经补登记。
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {chapter.eventState || "未填写"}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="text" onClick={() => onEdit(chapter)}>
                    <Edit3 className="h-4 w-4" />
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="text"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(chapter)}
                  >
                    <Trash2 className="h-4 w-4" />
                    删除
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {!chapters.length && (
            <TableRow>
              <TableCell
                colSpan={8}
                className="h-40 text-center text-sm text-muted-foreground"
              >
                {emptyState}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
