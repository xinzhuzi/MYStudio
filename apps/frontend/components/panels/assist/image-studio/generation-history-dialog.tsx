// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Clock, Copy, FolderOpen, FileJson, RotateCcw, Search, Trash2 } from "lucide-react";
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
  deleteProjectImageFile,
  generationSourceLabel,
  mediaAiImageLedgerIdentity,
  mergeGenerationRecords,
  readLedgerEntries,
  removeLedgerEntryByFile,
  type GenerationLedgerEntry,
  type GenerationRecord,
} from "@/lib/assist/image-studio/history-records";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useMediaStore } from "@/stores/media/media-store";
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
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const [ledger, setLedger] = useState<GenerationLedgerEntry[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 落盘位置展开态:收起=截断单行;展开=完整虚拟地址+主进程解析的绝对路径
  const [pathExpanded, setPathExpanded] = useState(false);
  const [absolutePath, setAbsolutePath] = useState<string | null>(null);
  const [pathResolving, setPathResolving] = useState(false);

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

  const records = useMemo(
    () => mergeGenerationRecords(imageHistory, ledger, activeProjectId),
    [imageHistory, ledger, activeProjectId],
  );

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

  // 换选中即收起路径并清掉上一条的解析结果(展开时再懒解析)
  const resolvedPathCache = useRef(new Map<string, string>());
  useEffect(() => {
    setPathExpanded(false);
    setAbsolutePath(null);
  }, [selectedId]);

  useEffect(() => {
    const url = selected?.resultUrl;
    if (!pathExpanded || !url) return;
    const cached = resolvedPathCache.current.get(url);
    if (cached !== undefined) {
      setAbsolutePath(cached);
      return;
    }
    const bridge = (window as unknown as {
      projectFiles?: { getAbsolutePath?: (url: string) => Promise<string | null> };
    }).projectFiles;
    if (!bridge?.getAbsolutePath) {
      setAbsolutePath("");
      return;
    }
    let cancelled = false;
    setPathResolving(true);
    void bridge
      .getAbsolutePath(url)
      .then((resolved) => {
        resolvedPathCache.current.set(url, resolved ?? "");
        if (!cancelled) setAbsolutePath(resolved ?? "");
      })
      .catch(() => {
        resolvedPathCache.current.set(url, "");
        if (!cancelled) setAbsolutePath("");
      })
      .finally(() => {
        if (!cancelled) setPathResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pathExpanded, selected?.resultUrl]);

  /** 在访达中揭示该文件(经主进程解析绝对路径,渲染层不拼路径) */
  const revealInFinder = async (url: string) => {
    const electronAPI = (window as unknown as {
      electronAPI?: {
        showItemInFolder?: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
      };
    }).electronAPI;
    const bridge = (window as unknown as {
      projectFiles?: { getAbsolutePath?: (url: string) => Promise<string | null> };
    }).projectFiles;
    if (!electronAPI?.showItemInFolder || !bridge?.getAbsolutePath) {
      toast.error("当前环境不支持打开本地文件");
      return;
    }
    try {
      const resolved = await bridge.getAbsolutePath(url);
      if (!resolved) {
        toast.error("无法解析该地址(可能不在项目存储内)");
        return;
      }
      const result = await electronAPI.showItemInFolder(resolved);
      if (!result.success) toast.error(`打开失败:${result.error ?? "未知错误"}`);
    } catch {
      toast.error("打开本地文件失败");
    }
  };

  /** 单条记录导出 JSON(结构化,与复原同源数据;画布级导入导出走工具栏既有功能) */
  const exportRecordJson = (record: GenerationRecord) => {
    const payload = {
      schemaVersion: 1,
      kind: "mystudio-generation-record",
      exportedAt: new Date().toISOString(),
      record: {
        prompt: record.prompt,
        model: record.model,
        resultUrl: record.resultUrl,
        mediaId: record.mediaId ?? null,
        createdAt: record.createdAt,
        origin: record.origin,
        params: record.params,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const stamp = new Date(record.createdAt);
    const pad = (value: number) => String(value).padStart(2, "0");
    link.download = `生成记录-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("记录 JSON 已导出");
  };

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
      toast.success(
        `已复原到新画布${result.detail?.workflowName ? `「${result.detail.workflowName}」` : ""}:参考图、提示词与成图已重建`,
      );
      onOpenChange(false);
    } else {
      toast.error(`复原失败:${result.reason}`);
    }
  };

  /** 删除记录=相关清理完毕(09-03 用户裁定):本地条目+磁盘 ledger 条目+
   * 物理图文件(含批量组每张)。媒体库条目属产物图域——project-owned 直删
   * 被域门禁拒绝(须走媒体库审查计划),合规尝试,拒留只提示,不绕门禁。 */
  const deleteRecord = async (record: GenerationRecord) => {
    const urls = Array.from(
      new Set([record.resultUrl, ...(record.params.batchUrls ?? [])].filter(Boolean)),
    );
    const identities = new Set(
      urls
        .map((url) => mediaAiImageLedgerIdentity(url))
        .filter((item): item is string => item !== null),
    );
    const failedSteps: string[] = [];
    let filesDeleted = 0;
    if (activeProjectId) {
      for (const url of urls) {
        try {
          if (await deleteProjectImageFile(activeProjectId, url)) filesDeleted += 1;
        } catch {
          failedSteps.push("图文件删除失败");
        }
      }
      for (const file of identities) {
        try {
          await removeLedgerEntryByFile({ projectId: activeProjectId, file });
        } catch {
          failedSteps.push("台账更新失败");
        }
      }
    }
    let mediaKept = 0;
    const mediaStore = useMediaStore.getState();
    for (const url of urls) {
      const item = mediaStore.mediaFiles.find((media) => media.url === url);
      if (!item) continue;
      try {
        await mediaStore.removeMediaFile(item.projectId ?? activeProjectId ?? "", item.id);
      } catch {
        mediaKept += 1;
      }
    }
    if (record.origin === "local") removeHistoryEntry(record.id);
    if (identities.size > 0) {
      setLedger((previous) => previous.filter((item) => !identities.has(item.file)));
    }
    if (selectedId === record.id) setSelectedId(null);
    const keptNote = mediaKept > 0 ? `;${mediaKept} 个媒体库条目请在媒体库中删除` : "";
    if (failedSteps.length > 0) {
      toast.warning(`记录已移除,但部分清理未完成:${[...new Set(failedSteps)].join("、")}${keptNote}`);
    } else {
      toast.success(`已清理完毕:记录+台账+图文件 ${filesDeleted} 张${keptNote}`);
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
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="删除这条记录"
                        title="删除这条记录(含磁盘图文件与台账条目)"
                        className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-destructive group-hover:flex"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteRecord(record);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.stopPropagation();
                            void deleteRecord(record);
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </span>
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
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      aria-label="在访达中显示"
                      title="在访达中显示该文件"
                      onClick={() => void revealInFinder(selected.resultUrl)}
                    >
                      <FolderOpen className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      aria-label={pathExpanded ? "收起完整路径" : "展开完整路径"}
                      title={pathExpanded ? "收起完整路径" : "展开完整路径"}
                      onClick={() => setPathExpanded((expanded) => !expanded)}
                    >
                      {pathExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </Button>
                  </div>
                  {pathExpanded ? (
                    <div className="mt-1.5 space-y-1 rounded-md border border-border bg-background/60 px-2 py-1.5">
                      <div className="text-[11px] leading-4 text-muted-foreground">应用内地址</div>
                      <p className="break-all text-[11px] leading-4 text-foreground select-text">
                        {selected.resultUrl}
                      </p>
                      <div className="pt-0.5 text-[11px] leading-4 text-muted-foreground">磁盘绝对路径</div>
                      {pathResolving ? (
                        <p className="text-[11px] leading-4 text-muted-foreground">解析中…</p>
                      ) : absolutePath ? (
                        <p className="break-all text-[11px] leading-4 text-foreground select-text">
                          {absolutePath}
                        </p>
                      ) : (
                        <p className="text-[11px] leading-4 text-muted-foreground">
                          无法解析(该地址可能不在项目存储内,如远程 URL)
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-muted-foreground"
                title="把这条记录的结构化数据(提示词/参数/参考图地址)存为 JSON 文件"
                onClick={() => exportRecordJson(selected)}
              >
                <FileJson className="mr-1 h-3.5 w-3.5" />
                导出 JSON
              </Button>
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
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-muted-foreground hover:text-destructive"
                title="删除记录并清理磁盘图文件与台账条目"
                onClick={() => void deleteRecord(selected)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                删除记录
              </Button>
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
