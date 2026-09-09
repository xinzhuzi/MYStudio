// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { comfySidecarJson } from "@/lib/assist/image-studio/comfy-execute";
import {
  objectInfoDetailReplyToDescriptor,
  searchCuratedEffects,
  type ComfyEffectNodeDescriptor,
} from "@/lib/assist/image-studio/comfy-effect-catalog";
import { fetchEngineClassTypes } from "./use-comfy-subgraph-run";

/**
 * 效果节点放置弹窗(工具菜单「效果节点…」入口)。
 * 09-09 用户裁定:原「高级开关」退役,全量生态节点常开——策展效果包(内置
 * 10 个常用 classType 中文映射)+引擎全量英文 classType(object_info 拉取,
 * 选中时按需取单类 schema)恒同显。落卡回调 onPick 由画布接线(创建
 * comfy-generic 节点)。
 */
export function ComfyEffectNodesDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (entry: { classType: string; title: string; descriptor: ComfyEffectNodeDescriptor }) => void;
}) {
  const [query, setQuery] = useState("");
  const [allClassTypes, setAllClassTypes] = useState<string[] | null>(null);
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  // 09-09 用户裁定:开关退役,全量生态节点常开——弹窗打开即拉一次清单(不轮询)
  useEffect(() => {
    if (!open || allClassTypes !== null) return;
    let cancelled = false;
    fetchEngineClassTypes()
      .then((list) => {
        if (!cancelled) setAllClassTypes(list);
      })
      .catch((error) => {
        if (!cancelled) {
          setAdvancedError(error instanceof Error ? error.message : "节点清单读取失败");
          setAllClassTypes([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, allClassTypes]);

  const curated = useMemo(() => searchCuratedEffects(query), [query]);
  const advancedMatches = useMemo(() => {
    if (!allClassTypes) return [];
    const needle = query.trim().toLowerCase();
    const curatedSet = new Set(curated.map((entry) => entry.classType));
    const filtered = needle
      ? allClassTypes.filter((classType) => classType.toLowerCase().includes(needle))
      : allClassTypes;
    return filtered.filter((classType) => !curatedSet.has(classType)).slice(0, 200);
  }, [allClassTypes, query, curated]);

  const pickCurated = (classType: string, title: string, descriptor: ComfyEffectNodeDescriptor) => {
    onPick({ classType, title, descriptor });
    onOpenChange(false);
    setQuery("");
  };

  const pickAdvanced = async (classType: string) => {
    setLoadingDetail(classType);
    try {
      const reply = await comfySidecarJson<{ detail?: Record<string, unknown> | null; error?: string | null }>(
        "GET",
        "/comfy/engine/object-info",
        { query: { class: classType }, timeoutMs: 30_000 },
      );
      const parsed = objectInfoDetailReplyToDescriptor(reply, classType);
      if (!parsed.ok) {
        setAdvancedError(parsed.error);
        return;
      }
      onPick({ classType, title: classType, descriptor: parsed.descriptor });
      onOpenChange(false);
      setQuery("");
    } catch (error) {
      setAdvancedError(error instanceof Error ? error.message : "节点声明读取失败");
    } finally {
      setLoadingDetail(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            效果节点
          </DialogTitle>
          <DialogDescription>
            {"策展效果 + 全量生态节点(英文原名直放)"}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜中文名/关键词/英文 classType…"
            className="h-8 pl-7 text-xs"
            aria-label="搜索效果节点"
            data-comfy-effect-search
          />
        </div>
        <div className="max-h-[320px] space-y-1 overflow-y-auto" data-comfy-effect-list>
          {curated.length === 0 && advancedMatches.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">没有匹配的效果节点</div>
          ) : null}
          {curated.map((entry) => (
            <button
              key={entry.classType}
              type="button"
              onClick={() => pickCurated(entry.classType, entry.zhName, entry.descriptor)}
              className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-card/60 px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
              data-comfy-effect-item={entry.classType}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-foreground">
                  {entry.zhName}
                  <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">{entry.classType}</span>
                </div>
                <div className="truncate text-[11px] text-muted-foreground">{entry.description}</div>
              </div>
              <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">策展</Badge>
            </button>
          ))}
          <>
              {advancedError ? (
                <div className="px-2 py-1.5 text-[11px] text-destructive" data-comfy-effect-advanced-error>{advancedError}</div>
              ) : null}
              {allClassTypes === null ? (
                <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  正在读取引擎节点清单…
                </div>
              ) : null}
              {advancedMatches.map((classType) => (
                <button
                  key={classType}
                  type="button"
                  disabled={loadingDetail !== null}
                  onClick={() => void pickAdvanced(classType)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2 py-1.5 text-left transition-colors hover:bg-accent/60",
                    loadingDetail !== null && loadingDetail !== classType && "opacity-50",
                  )}
                  data-comfy-effect-item={classType}
                >
                  <div className="min-w-0 flex-1 truncate text-xs text-foreground/90">{classType}</div>
                  {loadingDetail === classType ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                  ) : (
                    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">全量</Badge>
                  )}
                </button>
              ))}
          </>
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
