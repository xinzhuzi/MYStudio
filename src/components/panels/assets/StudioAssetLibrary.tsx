"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePropsLibraryStore } from "@/stores/props-library-store";
import { useStudioStore } from "@/stores/studio-store";
import type { StudioAssetKind, StudioAssetSummary } from "@/types/studio-assets";
import { Box, Film, Loader2, Map, Music2, RefreshCw, Search, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { StudioAssetCard } from "./StudioAssetCard";
import { StudioAssetDetailDialog } from "./StudioAssetDetailDialog";
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

  const canLoadMore = runtimeItems.length < total;
  const loadedTotal = localItems.length + runtimeItems.length;

  return (
    <div className="studio-asset-library flex h-full flex-col">
      <div className="studio-asset-library-header shrink-0 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">{config.title}</h2>
            <Badge variant="outline">{loadedTotal} / {localItems.length + total}</Badge>
          </div>
          <div className="flex min-w-[260px] max-w-[420px] flex-1 items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="搜索名称、描述、路径"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => { delete assetCache[getCacheKey(type, search)]; loadAssets(0, "replace", true); }} disabled={isLoading}>
              <RefreshCw className={isLoading ? "mr-2 h-3.5 w-3.5 animate-spin" : "mr-2 h-3.5 w-3.5"} />
              刷新
            </Button>
          </div>
        </div>
        {error ? (
          <div className="mt-2 truncate text-[11px] text-destructive" title={error}>
            {error}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        <VirtualGrid
          items={items}
          minColumnWidth={172}
          rowHeight={232}
          gap={14}
          getKey={(item) => item.id}
          renderItem={(item) => <StudioAssetCard asset={item} onOpen={setSelectedAsset} />}
          empty={
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              {isLoading ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin opacity-50" />
                  <div className="text-sm">正在读取素材</div>
                </>
              ) : (
                <>
                  <Icon className="h-14 w-14 opacity-20" />
                  <div className="text-sm">{error || config.empty}</div>
                </>
              )}
            </div>
          }
          footer={
            items.length > 0 ? (
              <div className="flex items-center justify-center px-4 pb-5">
                {canLoadMore ? (
                  <Button variant="outline" size="sm" onClick={() => loadAssets(runtimeItems.length, "append")} disabled={isLoadingMore}>
                    {isLoadingMore ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    加载更多
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">已显示全部</span>
                )}
              </div>
            ) : null
          }
        />
      </div>
      <StudioAssetDetailDialog
        asset={selectedAsset}
        open={Boolean(selectedAsset)}
        onOpenChange={(open) => {
          if (!open) setSelectedAsset(null);
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
