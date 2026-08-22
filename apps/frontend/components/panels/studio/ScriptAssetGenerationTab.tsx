import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StudioAssetDetailDialog } from "@/components/panels/assets/StudioAssetDetailDialog";
import {
  Boxes,
  Loader2,
  Mic2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { eventBus } from "@/lib/events/event-bus";
import { AssetGenerationRow } from "./ScriptAssetGenerationRow";
import {
  ASSET_TYPES,
  assetLibraryRowKey,
  summarizeRows,
  toRuntimeAssetType,
  typeLabel,
  type AssetGenerationType,
} from "./script-asset-generation-model";
import { useScriptAssetGenerationActions } from "./useScriptAssetGenerationActions";
import { useScriptAssetGenerationData } from "./useScriptAssetGenerationData";
import { getRoleVoiceSpeakerIds, resolveRoleVoiceBinding } from "./script-asset-voice-binding";
import { useTtsStore } from "@/stores/tts/tts-store";
import type { StudioAssetSummary } from "@/types/studio-assets";

export function ScriptAssetGenerationTab({
  title = "资产生成",
  description = "承接本阶段已提取的角色、场景、道具，推进提示词、图片资产、衍生资产和角色参考音频。",
  emptyExtractStageLabel = "剧本资产管理",
  productionEpisodeId,
  scriptPlanCount,
  hasSeriesBible,
}: {
  title?: string;
  description?: string;
  emptyExtractStageLabel?: string;
  productionEpisodeId: string;
  scriptPlanCount: number;
  hasSeriesBible: boolean;
}) {
  const [activeType, setActiveType] = useState<AssetGenerationType>("character");
  const [storedAssetOverrides, setStoredAssetOverrides] = useState<Record<string, StudioAssetSummary>>({});
  const [isRefreshingMatches, setIsRefreshingMatches] = useState(false);
  const {
    activeProjectId,
    currentRows,
    entityExtractions,
    rows,
    scriptPlans,
    stats,
    visualManualId,
  } = useScriptAssetGenerationData(activeType);
  const currentRowsWithStoredAssets = useMemo(
    () =>
      currentRows.map((row) => {
        if (row.assetLibrary) return row;
        const assetLibrary = storedAssetOverrides[assetLibraryRowKey(row)];
        return assetLibrary
          ? { ...row, assetLibrary, assetLibraryId: assetLibrary.id }
          : row;
      }),
    [currentRows, storedAssetOverrides],
  );
  // 表头语音计数用合并后的行:资产库键绑定的配音经读取侧回退也要计入
  // (data hook 的 voiceStats 基于原始行,看不到 storedAssetOverrides 桥接)
  const activeTtsProjectId = useTtsStore((state) => state.activeProjectId);
  const ttsProjects = useTtsStore((state) => state.projects);
  const ttsVoiceProfiles = useTtsStore((state) => state.voiceProfiles);
  const mergedVoiceStats = useMemo(() => {
    const bindings = activeTtsProjectId
      ? (ttsProjects[activeTtsProjectId]?.bindings ?? {})
      : {};
    let assigned = 0;
    for (const row of rows.character) {
      const merged = currentRowsWithStoredAssets.find(
        (item) => item.type === "character" && item.id === row.id,
      );
      const target = merged ?? row;
      const resolution = resolveRoleVoiceBinding(
        getRoleVoiceSpeakerIds(target),
        bindings,
        ttsVoiceProfiles,
      );
      if (resolution.state === "assigned") assigned += 1;
    }
    return { assigned, total: rows.character.length };
  }, [activeTtsProjectId, currentRowsWithStoredAssets, rows.character, ttsProjects, ttsVoiceProfiles]);
  const displayCurrentStats = useMemo(
    () => summarizeRows(currentRowsWithStoredAssets),
    [currentRowsWithStoredAssets],
  );
  const displayStats = useMemo(
    () => ({
      ...stats,
      [activeType]: displayCurrentStats,
    }),
    [activeType, displayCurrentStats, stats],
  );

  const {
    isAutoAssigningAudio,
    selectedAsset,
    setSelectedAsset,
    selectedRowLinkedSpeakerIds,
    setSelectedRowLinkedSpeakerIds,
    assetDialogOpen,
    setAssetDialogOpen,
    notFoundAsset,
    setNotFoundAsset,
    handleDeriveAssets,
    handleAutoAssignAudio,
    handleOpenAsset,
    handleGenerateSingle,
    handleStoreInAssetLibrary,
    storingAssetKey,
  } = useScriptAssetGenerationActions({
    activeType,
    visualManualId,
    currentRows: currentRowsWithStoredAssets,
    activeProjectId,
    scriptPlans,
    productionEpisodeId,
    entityExtractions,
    onAssetStored: (row, asset) => {
      setStoredAssetOverrides((current) => ({
        ...current,
        [assetLibraryRowKey(row)]: asset,
      }));
    },
  });

  // 重新识别:对当前全部实体行重跑资产库匹配,覆盖/清理本地绑定(资产库手动改名/合并后无需重启)
  const handleRefreshAssetMatches = async (options?: { silent?: boolean }) => {
    const batchMatch = getStudioAssetsBridge()?.batchMatch;
    if (!batchMatch) {
      if (!options?.silent) toast.error("当前环境不支持资产库匹配");
      return;
    }
    setIsRefreshingMatches(true);
    try {
      const nextOverrides: Record<string, StudioAssetSummary> = {};
      const summary: string[] = [];
      for (const type of ASSET_TYPES) {
        const typeRows = rows[type.key];
        if (!typeRows.length) continue;
        const results = await batchMatch({
          type: toRuntimeAssetType(type.key),
          names: typeRows.map((row) => row.name),
        });
        let matched = 0;
        for (const result of results) {
          if (!result.asset) continue;
          matched += 1;
          nextOverrides[assetLibraryRowKey({ type: type.key, name: result.name })] = result.asset;
        }
        summary.push(`${type.label} ${matched}/${typeRows.length}`);
      }
      setStoredAssetOverrides(nextOverrides);
      if (!options?.silent) toast.success(`重新识别完成:${summary.join(" · ") || "无实体行"}`);
      // 用户显式重识别后广播:上方「资产提取」chip 颜色依赖资产中心缓存,
      // 据此同步重拉,让「重新识别」对整个剧本资产管理页生效(静默轮不动资产库,
      // 遵守「渲染提取视图不初始化独立资产库」契约)
      if (!options?.silent) eventBus.emit("asset:rematch");
    } catch (error) {
      if (!options?.silent) toast.error(error instanceof Error ? error.message : "重新识别失败");
    } finally {
      setIsRefreshingMatches(false);
    }
  };

  // 进入页面时静默重跑一次匹配:让「资产库已存在/放入资产库」状态跨页面切换保持正确,
  // 而不是只靠手动点「重新识别」(本地 overrides 不持久,切走再回来必须重算)
  const hasAnyRows = rows.character.length + rows.scene.length + rows.prop.length > 0;
  const initialMatchDoneRef = useRef(false);
  useEffect(() => {
    if (initialMatchDoneRef.current || !hasAnyRows) return;
    initialMatchDoneRef.current = true;
    void handleRefreshAssetMatches({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAnyRows]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background/90">
      <div className="border-b border-border/70 bg-panel/80 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{title}</h3>
              <Badge variant={scriptPlanCount > 0 ? "secondary" : "outline"}>
                导演计划 {scriptPlanCount}
              </Badge>
              <Badge variant={hasSeriesBible ? "secondary" : "outline"}>
                {hasSeriesBible ? "剧集圣经已锁定" : "剧集圣经未锁定"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {description}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={isRefreshingMatches || (rows.character.length + rows.scene.length + rows.prop.length) === 0}
              onClick={() => void handleRefreshAssetMatches()}
            >
              <RefreshCw className={isRefreshingMatches ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              重新识别
            </Button>
            <Button size="sm" variant="secondary" disabled={scriptPlanCount === 0} onClick={handleDeriveAssets}>
              <Boxes className="h-4 w-4" />
              落地衍生资产
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border/70 bg-panel px-3 py-2">
        {ASSET_TYPES.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveType(key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              activeType === key
                ? "bg-primary/15 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span className="text-xs opacity-70">
              ({displayStats[key].ready}/{displayStats[key].total})
            </span>
          </button>
        ))}
        <div className="flex-1" />
        {activeType === "character" && mergedVoiceStats.total > 0 ? (
          <span className="text-xs text-primary">
            参考音频 {mergedVoiceStats.assigned}/{mergedVoiceStats.total}
          </span>
        ) : null}
        {activeType === "character" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isAutoAssigningAudio || mergedVoiceStats.total === 0}
            onClick={() => void handleAutoAssignAudio()}
          >
            {isAutoAssigningAudio ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mic2 className="h-4 w-4" />
            )}
            自动分配音频
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {currentRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            暂无{typeLabel(activeType)}资产，请先在「{emptyExtractStageLabel}」完成实体提取。
          </p>
        ) : (
          <div className="grid gap-2">
            {currentRowsWithStoredAssets.map((row) => (
              <AssetGenerationRow
                key={`${row.type}-${row.id}-${row.name}`}
                row={row}
                onOpenAsset={handleOpenAsset}
                onStoreAsset={handleStoreInAssetLibrary}
                isStoringAssetLibrary={storingAssetKey === assetLibraryRowKey(row)}
              />
            ))}
          </div>
        )}
      </div>

      <StudioAssetDetailDialog
        asset={selectedAsset}
        linkedSpeakerIds={selectedRowLinkedSpeakerIds}
        open={assetDialogOpen}
        onOpenChange={(open) => {
          setAssetDialogOpen(open);
          if (!open) {
            setSelectedAsset(null);
            setSelectedRowLinkedSpeakerIds([]);
            // 详情里的任何修改(提示词/图/信息/配音)在关闭时已落库——静默重跑匹配让行状态即时刷新
            void handleRefreshAssetMatches({ silent: true });
          }
        }}
      />
      <AlertDialog
        open={Boolean(notFoundAsset)}
        onOpenChange={(open) => {
          if (!open) setNotFoundAsset(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>资产未找到</AlertDialogTitle>
            <AlertDialogDescription>
              「{notFoundAsset?.name}」在资产库中不存在。是否立即生成？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleGenerateSingle}>立即生成</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
