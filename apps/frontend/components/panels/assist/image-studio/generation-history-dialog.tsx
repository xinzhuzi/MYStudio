// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import { useEffect, useMemo, useState } from "react";
import { Clock, Copy, RotateCcw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LocalImage } from "@/components/ui/local-image";
import { toPreviewSrc } from "@/lib/media/preview-src";
import { dispatchCanvasCommand } from "@/lib/studio/canvas-commands";
import {
  generationSourceLabel,
  mergeGenerationRecords,
  readLedgerEntries,
  type GenerationLedgerEntry,
  type GenerationRecord,
} from "@/lib/assist/image-studio/history-records";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useProjectStore } from "@/stores/project/project-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * 生成记录弹窗(09-03):master-detail——左列记录卡,右列大图+全量元数据;
 * 主行动作=「复原到画布」,经 ops restore-generation 单条指令重建当时的生成组
 * (参考图×N+提示词(反向)+成图+连线)。旧记录(无输入快照)降级复原:仅提示词+
 * 成图。图片工作室面改用本弹窗;video/cinema 工作室仍用旧侧栏 GenerationHistory。
 */

const SHORT_TIME = { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" } as const;
const FULL_TIME = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
} as const;

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-xs text-foreground select-text" title={value}>
        {value}
      </div>
    </div>
  );
}

export function GenerationHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const imageHistory = useFreedomStore((state) => state.imageHistory);
  const removeHistoryEntry = useFreedomStore((state) => state.removeHistoryEntry);
  const clearHistory = useFreedomStore((state) => state.clearHistory);
  const [ledger, setLedger] = useState<GenerationLedgerEntry[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void readLedgerEntries(useProjectStore.getState().activeProjectId).then((entries) => {
      if (!cancelled) setLedger(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const records = useMemo(() => mergeGenerationRecords(imageHistory, ledger), [imageHistory, ledger]);

  useEffect(() => {
    if (!open) return;
    if (selectedId && records.some((record) => record.id === selectedId)) return;
    setSelectedId(records[0]?.id ?? null);
  }, [open, records, selectedId]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return keyword
      ? records.filter((record) => record.prompt.toLowerCase().includes(keyword))
      : records;
  }, [records, search]);

  const selected: GenerationRecord | undefined = records.find((record) => record.id === selectedId);
  const references = selected?.params.references ?? [];
  const batchUrls = selected?.params.batchUrls ?? [];

  const restore = (record: GenerationRecord) => {
    const result = dispatchCanvasCommand("image-studio", {
      kind: "restore-generation",
      surface: "image-studio",
      prompt: record.prompt,
      negativePrompt: record.params.negativePrompt,
      model: record.model || undefined,
      aspectRatio: record.params.aspectRatio,
      references: record.params.references,
      result: { imageUrl: record.resultUrl, mediaId: record.mediaId },
      batchImageUrls: record.params.batchUrls,
      generatedAt: record.createdAt,
    });
    if (result.ok) {
      toast.success("已复原到画布:参考图、提示词与成图已重建");
      onOpenChange(false);
    } else {
      toast.error(`复原失败:${result.reason}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(760px,88vh)] w-[min(1120px,94vw)] max-w-none gap-0 overflow-hidden p-0"
        data-image-studio-history-dialog
      >
        <DialogHeader className="sr-only">
          <DialogTitle>生成记录</DialogTitle>
          <DialogDescription>查看历史生成,可一键复原到画布</DialogDescription>
        </DialogHeader>

        {/* 左列:记录列表 */}
        <aside className="flex w-[340px] shrink-0 flex-col border-r border-border">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索记录"
                className="h-7 pl-7 text-xs"
              />
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{filtered.length}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 text-xs text-muted-foreground hover:text-destructive"
              title="清空本地索引(磁盘 ledger 镜像保留)"
              onClick={() => clearHistory("image")}
            >
              清空
            </Button>
          </div>
          <ScrollArea className="flex-1">
            {filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center py-16 text-muted-foreground">
                <Clock className="mb-2 h-8 w-8 opacity-40" />
                <p className="text-sm">{records.length === 0 ? "暂无生成记录" : "没有匹配的记录"}</p>
              </div>
            ) : (
              <div className="py-1">
                {filtered.map((record) => {
                  const isSelected = record.id === selectedId;
                  return (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => setSelectedId(record.id)}
                      className={cn(
                        "group flex w-full items-center gap-2.5 rounded-lg border-b border-border/50 px-3 py-2 text-left transition-colors hover:bg-muted/50",
                        isSelected && "bg-muted/60 ring-1 ring-inset ring-primary",
                      )}
                    >
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-background/60">
                        {record.resultUrl ? (
                          <LocalImage
                            src={toPreviewSrc(record.resultUrl)}
                            alt="生成缩略图"
                            className="h-full w-full object-cover"
                            eager
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-xs leading-4 text-foreground">
                          {record.prompt || "无标题"}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className="truncate">{record.model || "—"}</span>
                          <span>·</span>
                          <span className="shrink-0">
                            {new Date(record.createdAt).toLocaleString("zh-CN", SHORT_TIME)}
                          </span>
                          {(record.params.count ?? 0) > 1 ? (
                            <>
                              <span>·</span>
                              <span className="shrink-0">{record.params.count} 张</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      {record.origin === "local" ? (
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="删除这条记录"
                          title="删除这条记录"
                          className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-destructive group-hover:flex"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeHistoryEntry(record.id);
                            if (selectedId === record.id) setSelectedId(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.stopPropagation();
                              removeHistoryEntry(record.id);
                              if (selectedId === record.id) setSelectedId(null);
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </aside>

        {/* 右列:详情 */}
        {selected ? (
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 items-center justify-center bg-background/40 p-4">
              {selected.resultUrl ? (
                <LocalImage
                  src={toPreviewSrc(selected.resultUrl)}
                  alt="生成结果大图"
                  className="max-h-full max-w-full rounded-lg object-contain"
                  eager
                  previewable
                />
              ) : (
                <span className="text-sm text-muted-foreground">该记录没有可预览的图片</span>
              )}
            </div>
            {references.length > 0 ? (
              <div className="flex items-center gap-2 border-t border-border px-4 py-2">
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  参考图 {references.length}
                </span>
                <div className="flex gap-1.5 overflow-x-auto">
                  {references.map((url, index) => (
                    <div
                      key={`${index}_${url}`}
                      className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border"
                      title={`参考图 ${index + 1}`}
                    >
                      <LocalImage
                        src={toPreviewSrc(url)}
                        alt={`参考图 ${index + 1}`}
                        className="h-full w-full object-cover"
                        eager
                        previewable
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="border-t border-border px-4 py-3">
              <div className="space-y-2.5 text-xs">
                <div className="min-w-0">
                  <div className="text-[11px] text-muted-foreground">提示词</div>
                  <p className="mt-0.5 whitespace-pre-wrap break-words leading-5 text-foreground select-text">
                    {selected.prompt || "无"}
                  </p>
                </div>
                {selected.params.negativePrompt ? (
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground">反向提示词</div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words leading-5 text-foreground select-text">
                      {selected.params.negativePrompt}
                    </p>
                  </div>
                ) : null}
                <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                  <MetaItem label="模型" value={selected.model || "—"} />
                  <MetaItem label="画幅" value={selected.params.aspectRatio ?? "—"} />
                  <MetaItem label="分辨率" value={selected.params.resolution ?? "—"} />
                  <MetaItem
                    label="张数"
                    value={
                      batchUrls.length > 1
                        ? `${batchUrls.length} 张(批量组)`
                        : selected.params.count
                          ? `${selected.params.count} 张`
                          : "—"
                    }
                  />
                  <MetaItem label="来源" value={generationSourceLabel(selected.params.source)} />
                  <MetaItem
                    label="生成时间"
                    value={new Date(selected.createdAt).toLocaleString("zh-CN", FULL_TIME)}
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] text-muted-foreground">落盘位置</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Input
                      readOnly
                      value={selected.resultUrl}
                      className="h-7 flex-1 text-[11px]"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      aria-label="复制落盘路径"
                      title="复制落盘路径"
                      onClick={() => {
                        void navigator.clipboard?.writeText(selected.resultUrl);
                        toast.success("落盘路径已复制");
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-muted-foreground"
                onClick={() => {
                  void navigator.clipboard?.writeText(selected.prompt || "");
                  toast.success("提示词已复制");
                }}
              >
                <Copy className="mr-1 h-3.5 w-3.5" />
                复制提示词
              </Button>
              {selected.origin === "local" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    removeHistoryEntry(selected.id);
                    setSelectedId(null);
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  删除记录
                </Button>
              ) : null}
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={!selected.resultUrl}
                title="按这条记录当时的输入重建生成组(参考图+提示词+成图)"
                onClick={() => restore(selected)}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                复原到画布
              </Button>
            </div>
          </section>
        ) : (
          <section className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {records.length === 0 ? "暂无生成记录" : "在左侧选择一条记录查看详情"}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
