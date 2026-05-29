"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useStudioStore } from "@/stores/studio-store";
import type { StudioAssetKind, StudioAssetSummary } from "@/types/studio-assets";
import { Box, CheckSquare, ChevronDown, ChevronRight, Film, Loader2, Map, Music2, Plus, RefreshCw, Search, Square, Trash2, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { StudioAssetCard } from "./StudioAssetCard";
import { StudioAssetDetailDialog } from "./StudioAssetDetailDialog";
import { AddAssetDialog } from "./AddAssetDialog";
import { VirtualGrid } from "./VirtualGrid";

const PAGE_SIZE = 60;

// 全局缓存：避免侧边栏切换时重复加载
const assetCache: Record<string, { items: StudioAssetSummary[]; total: number; timestamp: number }> = {};
const CACHE_TTL = 60_000; // 60秒内不重新请求

function getCacheKey(type: StudioAssetKind, search: string) {
  return `${type}:${search}`;
}

const ASSET_KIND_CONFIG = {
  role: {
    title: "角色库",
    icon: UserCircle,
    empty: "还没有角色素材",
  },
  scene: {
    title: "场景库",
    icon: Map,
    empty: "还没有场景素材",
  },
  tool: {
    title: "道具库",
    icon: Box,
    empty: "还没有道具素材",
  },
  clip: {
    title: "素材库",
    icon: Film,
    empty: "还没有视频或图片素材",
  },
  audio: {
    title: "音频库",
    icon: Music2,
    empty: "还没有音频素材",
  },
} as const;

export function StudioAssetLibrary({ type }: { type: StudioAssetKind }) {
  const config = ASSET_KIND_CONFIG[type];
  const Icon = config.icon;
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [runtimeItems, setRuntimeItems] = useState<StudioAssetSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<StudioAssetSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const requestIdRef = useRef(0);

  const props = usePropsLibraryStore((state) => state.items);
  const materials = useStudioStore((state) => state.materials);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const localItems = useMemo(() => {
    const keyword = search.toLocaleLowerCase("zh-Hans-CN");
    const entries: StudioAssetSummary[] = [];
    if (type === "tool") {
      entries.push(...props.map((item) => ({
        id: `manying-prop:${item.id}`,
        source: "manying-local" as const,
        type,
        name: item.name,
        description: item.prompt,
        setting: item.prompt,
        prompt: item.prompt,
        thumbnailUrl: item.imageUrl,
        previewUrl: item.imageUrl,
        filePath: item.imageUrl,
      })));
    }
    if (type === "clip") {
      entries.push(...materials.filter((item) => item.kind !== "audio").map((item) => ({
        id: `manying-material:${item.id}`,
        source: "manying-local" as const,
        type,
        name: item.name,
        description: item.sourceName,
        setting: item.sourceName,
        thumbnailUrl: item.kind === "image" ? item.localPath : undefined,
        previewUrl: item.localPath,
        filePath: item.localPath,
        sourcePath: item.sourceName,
      })));
    }
    if (type === "audio") {
      entries.push(...materials.filter((item) => item.kind === "audio").map((item) => ({
        id: `manying-material:${item.id}`,
        source: "manying-local" as const,
        type,
        name: item.name,
        description: item.sourceName,
        setting: item.sourceName,
        previewUrl: item.localPath,
        filePath: item.localPath,
        sourcePath: item.sourceName,
      })));
    }
    if (!keyword) return entries;
    return entries.filter((item) => `${item.name} ${item.description ?? ""} ${item.filePath ?? ""}`.toLocaleLowerCase("zh-Hans-CN").includes(keyword));
  }, [materials, props, search, type]);

  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...localItems, ...runtimeItems].filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [localItems, runtimeItems]);

  const runtimeItemsRef = useRef(runtimeItems);
  runtimeItemsRef.current = runtimeItems;

  const loadAssets = useCallback(async (offset: number, mode: "replace" | "append", refresh = false) => {
    if (!window.studioAssets?.list) {
      setError("当前环境不支持读取本地素材，请在 Electron 中打开");
      return;
    }

    // 首次加载时检查缓存
    if (mode === "replace" && offset === 0 && !refresh) {
      const cacheKey = getCacheKey(type, search);
      const cached = assetCache[cacheKey];
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setRuntimeItems(cached.items);
        setTotal(cached.total);
        return;
      }
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setError("");
    if (mode === "replace") setIsLoading(true);
    else setIsLoadingMore(true);

    try {
      const response = await window.studioAssets.list({
        type,
        search,
        offset,
        limit: PAGE_SIZE,
        refresh,
      });
      if (requestIdRef.current !== requestId) return;
      if (!response.items) throw new Error("读取素材失败");
      const newItems = mode === "replace" ? response.items : mergeAssetItems(runtimeItemsRef.current, response.items);
      setRuntimeItems(newItems);
      setTotal(response.total);

      // 更新缓存
      if (mode === "replace") {
        assetCache[getCacheKey(type, search)] = { items: newItems, total: response.total, timestamp: Date.now() };
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "读取素材失败";
      setError(message);
      toast.error(message);
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [search, type]);

  useEffect(() => {
    // 有缓存时不清空，避免闪烁
    const cacheKey = getCacheKey(type, search);
    const cached = assetCache[cacheKey];
    if (!cached || Date.now() - cached.timestamp >= CACHE_TTL) {
      setRuntimeItems([]);
      setTotal(0);
    }
    void loadAssets(0, "replace");
  }, [loadAssets]);

  // 监听素材删除事件，强制刷新
  useEffect(() => {
    let unsub: (() => void) | undefined;
    import("@/lib/event-bus").then(({ eventBus }) => {
      unsub = eventBus.on("asset:deleted", () => {
        delete assetCache[getCacheKey(type, search)];
        setRuntimeItems([]);
        void loadAssets(0, "replace", true);
      });
    });
    return () => unsub?.();
  }, [type, search, loadAssets]);

  const canLoadMore = runtimeItems.length < total;
  const loadedTotal = localItems.length + runtimeItems.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(items.map((i) => i.id)));
  const deselectAll = () => { setSelectedIds(new Set()); setSelectMode(false); };

  const handleBatchDelete = async () => {
    if (!selectedIds.size || !window.studioAssets?.delete) return;
    if (!confirm(`确定删除选中的 ${selectedIds.size} 个素材？此操作不可撤销。`)) return;
    let deleted = 0;
    for (const id of selectedIds) {
      const ok = await window.studioAssets.delete(id);
      if (ok) deleted++;
    }
    toast.success(`已删除 ${deleted} 个素材`);
    setSelectedIds(new Set());
    setSelectMode(false);
    delete assetCache[getCacheKey(type, search)];
    void loadAssets(0, "replace", true);
  };

  const [isAddOpen, setIsAddOpen] = useState(false);

  const handleAdd = () => setIsAddOpen(true);

  return (
    <div className="studio-asset-library flex h-full flex-col">
      <div className="studio-asset-library-header shrink-0 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">{config.title}</h2>
            <Badge variant="outline">{loadedTotal} / {localItems.length + total}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {selectMode ? (
              <>
                <Button variant="outline" size="sm" onClick={selectAll}>
                  <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
                  全选
                </Button>
                <Button variant="destructive" size="sm" onClick={handleBatchDelete} disabled={!selectedIds.size}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  删除({selectedIds.size})
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll}>取消</Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setSelectMode(true)}>
                  <Square className="mr-1.5 h-3.5 w-3.5" />
                  多选
                </Button>
                <Button variant="outline" size="sm" onClick={handleAdd}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  添加
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={() => { delete assetCache[getCacheKey(type, search)]; loadAssets(0, "replace", true); }} disabled={isLoading}>
              <RefreshCw className={isLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            </Button>
          </div>
        </div>
        <div className="mt-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索名称"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
        {error ? (
          <div className="mt-2 truncate text-[11px] text-destructive" title={error}>
            {error}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        <AudioGroupedGrid
          type={type}
          items={items}
          isLoading={isLoading}
          Icon={Icon}
          error={error}
          emptyText={config.empty}
          selectedIds={selectedIds}
          selectMode={selectMode}
          onToggleSelect={toggleSelect}
          onOpen={setSelectedAsset}
          canLoadMore={canLoadMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={() => loadAssets(runtimeItems.length, "append")}
          onRefresh={() => { delete assetCache[getCacheKey(type, search)]; void loadAssets(0, "replace", true); }}
        />
      </div>
      <StudioAssetDetailDialog
        asset={selectedAsset}
        open={Boolean(selectedAsset)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedAsset(null);
          }
        }}
      />
      <AddAssetDialog
        type={type}
        open={isAddOpen}
        onOpenChange={(open) => {
          setIsAddOpen(open);
          if (!open) {
            delete assetCache[getCacheKey(type, search)];
            void loadAssets(0, "replace", true);
          }
        }}
      />
    </div>
  );
}

function mergeAssetItems(current: StudioAssetSummary[], next: StudioAssetSummary[]) {
  const seen = new Set(current.map((item) => item.id));
  return [
    ...current,
    ...next.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  ];
}

const TTS_GENERATED_PATTERN = /^scene-\d+-voice-|^tts-clone-/;

function isLocalMade(asset: StudioAssetSummary): boolean {
  const name = asset.name || "";
  const filePath = asset.filePath || "";
  return TTS_GENERATED_PATTERN.test(name) || TTS_GENERATED_PATTERN.test(filePath);
}

function AudioGroupedGrid({
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
}: {
  type: string;
  items: StudioAssetSummary[];
  isLoading: boolean;
  Icon: React.ElementType;
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
}) {
  const [voiceExpanded, setVoiceExpanded] = useState(true);
  const [localExpanded, setLocalExpanded] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });

  // 批量识别：对 description 为空的音色音频逐个识别
  const handleBatchTranscribe = async (targets: StudioAssetSummary[]) => {
    if (!window.ttsRuntime?.request || !window.studioAssets?.get || !window.studioAssets?.update) {
      toast.error("TTS 后端未就绪");
      return;
    }
    setBatchRunning(true);
    let done = 0;
    let success = 0;
    const pending: { id: string; audioPath: string }[] = [];
    for (const item of targets) {
      const detail = await window.studioAssets.get(item.id).catch(() => null);
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
        const res = await window.ttsRuntime.request({ method: "POST", path: "/transcribe", body: { audio_path: audioPath } }) as { text?: string };
        if (res?.text?.trim()) {
          await window.studioAssets.update({ id, updates: { description: res.text.trim() } });
          success++;
        }
      } catch { /* 单个失败跳过 */ }
      done++;
      setBatchProgress({ done, total: pending.length });
    }
    setBatchRunning(false);
    toast.success(`批量识别完成：${success}/${pending.length} 成功`);
    if (success > 0) onRefresh();
  };

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
            onClick={() => void handleBatchTranscribe(voiceItems.filter((v) => selectedIds.has(v.id)))}
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
