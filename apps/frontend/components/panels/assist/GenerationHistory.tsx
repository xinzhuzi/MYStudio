"use client";

import { useEffect, useState } from 'react';
import { Clock, Copy, Search, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFreedomStore, type HistoryEntry } from '@/stores/assist/freedom-store';
import { useProjectStore } from '@/stores/project/project-store';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { LocalImage } from '@/components/ui/local-image';
import { toPreviewSrc } from '@/lib/media/preview-src';

interface GenerationHistoryProps {
  type: 'image' | 'video' | 'cinema';
  /** 显式「送入画布」(09-02 治理:点击条目不再插节点,只有此按钮才送入) */
  onSendToCanvas?: (entry: HistoryEntry) => void;
  className?: string;
}

export function GenerationHistory({ type, onSendToCanvas, className }: GenerationHistoryProps) {
  const { imageHistory, videoHistory, cinemaHistory, removeHistoryEntry, clearHistory } =
    useFreedomStore();
  const [search, setSearch] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<Array<{ ts: number; prompt: string; model: string; file: string }>>([]);

  // 磁盘 ledger 优先源(09-02 治理):读项目内最近两月 ledger.json,与
  // localStorage 记录按时间合并去重;桥不可用/无项目时回落 localStorage-only。
  useEffect(() => {
    if (type !== 'image') return;
    const bridge = (window as unknown as {
      projectFiles?: {
        readText: (payload: { projectId: string; relativePath: string }) =>
          Promise<{ text?: string } | string>;
      };
    }).projectFiles;
    const projectId = useProjectStore.getState().activeProjectId;
    if (!bridge?.readText || !projectId) return;
    let cancelled = false;
    const months = [0, 1].map((offset) => {
      const d = new Date();
      d.setMonth(d.getMonth() - offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    void (async () => {
      const collected: typeof ledgerEntries = [];
      for (const month of months) {
        try {
          const result = await bridge.readText({
            projectId,
            relativePath: `media/ai-image/${month}/ledger.json`,
          });
          const text = typeof result === 'string' ? result : result?.text;
          if (!text) continue;
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) collected.push(...parsed);
        } catch {
          // 无该月 ledger 或坏文件:跳过
        }
      }
      if (!cancelled) setLedgerEntries(collected);
    })();
    return () => {
      cancelled = true;
    };
  }, [type]);

  const history =
    type === 'image' ? imageHistory : type === 'video' ? videoHistory : cinemaHistory;

  // ledger 条目转展示形态;与 localStorage 记录按 createdAt+prompt 去重
  const ledgerAsEntries: HistoryEntry[] = ledgerEntries.map((item) => ({
    id: `disk_${item.ts}_${item.file}`,
    type: 'image',
    prompt: item.prompt,
    model: item.model,
    resultUrl: item.file,
    params: {},
    createdAt: item.ts,
  }));
  const localKeys = new Set(history.map((e) => `${e.createdAt}_${e.prompt}`));
  const merged = [
    ...history,
    ...ledgerAsEntries.filter((e) => !localKeys.has(`${e.createdAt}_${e.prompt}`)),
  ].sort((a, b) => b.createdAt - a.createdAt);

  const filtered = search.trim()
    ? merged.filter((e) => e.prompt.toLowerCase().includes(search.toLowerCase()))
    : merged;

  if (merged.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full text-muted-foreground', className)}>
        <Clock className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">暂无生成记录</p>
      </div>
    );
  }

  return (
    <div className={cn('relative flex flex-col h-full', className)}>
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索记录"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{filtered.length}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 text-xs text-muted-foreground hover:text-destructive"
          onClick={() => clearHistory(type)}
        >
          清空
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {filtered.map((entry) => (
            <div
              key={entry.id}
              className="group flex h-[60px] items-center gap-3 border-b border-border/50 px-3 cursor-pointer hover:bg-muted/50 transition-colors"
              title={entry.resultUrl ? '点击查看大图' : undefined}
              onClick={() => {
                if (!entry.resultUrl) return;
                // 查看大图:复用 LocalImage 全屏预览(点开即看,不碰画布)
                setPreviewUrl(entry.resultUrl);
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-foreground">{entry.prompt || '无标题'}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{entry.model}</span>
                  <span>·</span>
                  <span>{new Date(entry.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="复制提示词"
                title="复制提示词"
                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-accent-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  void navigator.clipboard?.writeText(entry.prompt || '');
                  toast.success('提示词已复制');
                }}
              >
                <Copy className="h-3 w-3" />
              </Button>
              {onSendToCanvas ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="送入画布"
                  title="作为新组送入当前画布"
                  className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-accent-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSendToCanvas(entry);
                  }}
                >
                  <Sparkles className="h-3 w-3" />
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); removeHistoryEntry(entry.id); }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
      {previewUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="max-h-[86vh] max-w-[86vw]" onClick={(e) => e.stopPropagation()}>
            <LocalImage
              src={toPreviewSrc(previewUrl)}
              alt="生成结果"
              className="max-h-[86vh] max-w-[86vw] rounded-lg object-contain"
              eager
              previewable
            />
            <div className="mt-2 flex justify-center">
              <Button variant="ghost" size="sm" className="text-primary-foreground" onClick={() => setPreviewUrl(null)}>
                关闭
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
