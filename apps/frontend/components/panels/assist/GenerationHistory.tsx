"use client";

import { useState } from 'react';
import { Clock, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFreedomStore, type HistoryEntry } from '@/stores/freedom-store';
import { cn } from '@/lib/utils';

interface GenerationHistoryProps {
  type: 'image' | 'video' | 'cinema';
  onSelect?: (entry: HistoryEntry) => void;
  className?: string;
}

export function GenerationHistory({ type, onSelect, className }: GenerationHistoryProps) {
  const { imageHistory, videoHistory, cinemaHistory, removeHistoryEntry, clearHistory } =
    useFreedomStore();
  const [search, setSearch] = useState('');

  const history =
    type === 'image' ? imageHistory : type === 'video' ? videoHistory : cinemaHistory;

  const filtered = search.trim()
    ? history.filter((e) => e.prompt.toLowerCase().includes(search.toLowerCase()))
    : history;

  if (history.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full text-muted-foreground', className)}>
        <Clock className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">暂无生成记录</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
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
              onClick={() => onSelect?.(entry)}
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
                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); removeHistoryEntry(entry.id); }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
