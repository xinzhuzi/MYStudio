"use client";

import { useState, type ElementType } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { getTtsRuntimeBridge } from "@/lib/bridge/tts-runtime";
import type { StudioAssetSummary } from "@/types/studio-assets";
import { StudioAssetCard } from "./StudioAssetCard";
import { VirtualGrid } from "./VirtualGrid";

const TTS_GENERATED_PATTERN = /^scene-\d+-voice-|^tts-clone-/;

export function isLocalMade(asset: StudioAssetSummary): boolean {
  const name = asset.name || "";
  const filePath = asset.filePath || "";
  return TTS_GENERATED_PATTERN.test(name) || TTS_GENERATED_PATTERN.test(filePath);
}

export async function raceWithTimeout<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

type AudioGroupedGridProps = {
  type: string;
  items: StudioAssetSummary[];
  isLoading: boolean;
  Icon: ElementType;
  error: string;
  emptyText: string;
  selectedIds: Set<string>;
  selectMode: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (asset: StudioAssetSummary) => void;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
};

export function AudioGroupedGrid({
  type,
  items,
  isLoading,
  Icon,
  error,
  emptyText,
  selectedIds,
  selectMode,
  onToggleSelect,
  onOpen,
  canLoadMore,
  isLoadingMore,
  onLoadMore,
  onRefresh,
}: AudioGroupedGridProps) {
  const [voiceExpanded, setVoiceExpanded] = useState(true);
  const [localExpanded, setLocalExpanded] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });

  // 批量识别：对 description 为空的音色音频逐个识别
  const handleBatchTranscribe = async (targets: StudioAssetSummary[]) => {
    const studioAssets = getStudioAssetsBridge();
    const ttsRuntime = getTtsRuntimeBridge();
    if (!ttsRuntime?.request || !studioAssets?.get || !studioAssets?.update) {
      toast.error("TTS 后端未就绪");
      return;
    }
    setBatchRunning(true);
    let done = 0;
    let success = 0;
    const pending: { id: string; audioPath: string }[] = [];
    for (const item of targets) {
      const detail = await studioAssets.get(item.id).catch(() => null);
      const audioPath = detail?.sourcePath || detail?.filePath;
      if (!detail?.description?.trim() && audioPath) pending.push({ id: item.id, audioPath });
    }
    setBatchProgress({ done: 0, total: pending.length });
    if (pending.length === 0) {
      toast.info("没有需要识别的音频（都已有说话内容）");
      setBatchRunning(false);
      return;
    }
    for (const { id, audioPath } of pending) {
      try {
        const request = ttsRuntime.request({ method: "POST", path: "/transcribe", body: { audio_path: audioPath } }) as Promise<{ text?: string }>;
        const res = await raceWithTimeout(request, 90_000);
        if (res?.text?.trim()) {
          await studioAssets.update({ id, updates: { description: res.text.trim() } });
          success++;
        }
      } catch { /* 单个失败或超时跳过 */ }
      done++;
      setBatchProgress({ done, total: pending.length });
    }
    setBatchRunning(false);
    toast.success(`批量识别完成：${success}/${pending.length} 成功`);
    if (success > 0) onRefresh();
  };

  // 道具类型由 ToolCategoryView 处理（按分类懒加载），此处不再走分组
  // 非音频类型直接渲染
  if (type !== "audio") {
    return (
      <VirtualGrid
        items={items}
        minColumnWidth={172}
        rowHeight={232}
        gap={14}
        getKey={(item) => item.id}
        renderItem={(item) => <StudioAssetCard asset={item} onOpen={onOpen} selected={selectedIds.has(item.id)} selectMode={selectMode} onToggleSelect={onToggleSelect} />}
        empty={
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            {isLoading ? (
              <><Loader2 className="h-8 w-8 animate-spin opacity-50" /><div className="text-sm">正在读取素材</div></>
            ) : (
              <><Icon className="h-14 w-14 opacity-20" /><div className="text-sm">{error || emptyText}</div></>
            )}
          </div>
        }
        footer={canLoadMore ? (
          <div className="flex items-center justify-center px-4 pb-5">
            <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
              {isLoadingMore ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              加载更多
            </Button>
          </div>
        ) : items.length > 0 ? (
          <div className="flex items-center justify-center px-4 pb-5">
            <span className="text-xs text-muted-foreground">已显示全部</span>
          </div>
        ) : null}
      />
    );
  }

  // 音频类型：分组
  const voiceItems = items.filter((item) => !isLocalMade(item));
  const localItems = items.filter((item) => isLocalMade(item));

  if (isLoading && items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin opacity-50" />
        <div className="text-sm">正在读取素材</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* 音色分组 */}
      <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-background border-b border-border">
        <button
          type="button"
          onClick={() => setVoiceExpanded(!voiceExpanded)}
          className="flex items-center gap-2 flex-1 hover:opacity-80"
        >
          {voiceExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          音色
          <Badge variant="outline" className="ml-1">{voiceItems.length}</Badge>
        </button>
        {selectMode && (
          <Button
            variant="outline"
            size="sm"
            disabled={batchRunning || selectedIds.size === 0}
            onClick={() => void handleBatchTranscribe(voiceItems.filter((voice) => selectedIds.has(voice.id)))}
          >
            {batchRunning ? (
              <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{batchProgress.done}/{batchProgress.total}</>
            ) : (
              <>✨ 批量生成说话内容（{selectedIds.size}）</>
            )}
          </Button>
        )}
      </div>
      {voiceExpanded && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(172px,1fr))] gap-3.5 p-3.5">
          {voiceItems.map((item) => (
            <StudioAssetCard key={item.id} asset={item} onOpen={onOpen} selected={selectedIds.has(item.id)} selectMode={selectMode} onToggleSelect={onToggleSelect} />
          ))}
        </div>
      )}

      {/* 本地制作分组 */}
      <button
        type="button"
        onClick={() => setLocalExpanded(!localExpanded)}
        className="sticky top-0 z-10 w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-background border-b border-border hover:bg-muted/40"
      >
        {localExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        本地制作
        <Badge variant="outline" className="ml-1">{localItems.length}</Badge>
      </button>
      {localExpanded && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(172px,1fr))] gap-3.5 p-3.5">
          {localItems.length === 0 ? (
            <div className="col-span-full py-4 text-center text-xs text-muted-foreground">暂无本地制作音频</div>
          ) : localItems.map((item) => (
            <StudioAssetCard key={item.id} asset={item} onOpen={onOpen} selected={selectedIds.has(item.id)} selectMode={selectMode} onToggleSelect={onToggleSelect} />
          ))}
        </div>
      )}

      {/* 加载更多 */}
      {canLoadMore && (
        <div className="flex items-center justify-center px-4 py-4">
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
            {isLoadingMore ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            加载更多
          </Button>
        </div>
      )}
    </div>
  );
}
