import { useState } from "react";
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
  RoleVoiceAssignDialog,
} from "@/components/panels/assets/RoleVoiceAssignDialog";
import {
  Boxes,
  ImageIcon,
  Loader2,
  Mic2,
  WandSparkles,
} from "lucide-react";
import { AssetGenerationRow } from "./ScriptAssetGenerationRow";
import {
  ASSET_TYPES,
  typeLabel,
  type AssetGenerationType,
} from "./script-asset-generation-model";
import { useScriptAssetGenerationActions } from "./useScriptAssetGenerationActions";
import { useScriptAssetGenerationData } from "./useScriptAssetGenerationData";

export function ScriptAssetGenerationTab({
  title = "资产生成",
  description = "承接本阶段已提取的角色、场景、道具，推进提示词、图片资产、衍生资产和角色音频样本。",
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
  const {
    activeProjectId,
    currentImageStats,
    currentRows,
    currentStats,
    entityExtractions,
    scriptPlans,
    stats,
    visualManualId,
    voiceStats,
  } = useScriptAssetGenerationData(activeType);

  const {
    isPolishing,
    isGeneratingImages,
    isGeneratingSingle,
    isAutoAssigningAudio,
    progress,
    selectedAsset,
    setSelectedAsset,
    assetDialogOpen,
    setAssetDialogOpen,
    voiceDialogChar,
    setVoiceDialogChar,
    notFoundAsset,
    setNotFoundAsset,
    handlePolishAll,
    handleGenerateImages,
    handleDeriveAssets,
    handleAutoAssignAudio,
    handleOpenAsset,
    handleGenerateSingle,
  } = useScriptAssetGenerationActions({
    activeType,
    visualManualId,
    currentRows,
    activeProjectId,
    scriptPlans,
    productionEpisodeId,
    entityExtractions,
  });

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
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors ${
              activeType === key
                ? "bg-primary/15 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span className="text-xs opacity-70">
              ({stats[key].ready}/{stats[key].total})
            </span>
          </button>
        ))}
        <div className="flex-1" />
        {activeType === "character" && voiceStats.total > 0 ? (
          <span className="text-xs text-primary">
            音频样本 {voiceStats.assigned}/{voiceStats.total}
          </span>
        ) : null}
        {activeType === "character" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isAutoAssigningAudio || voiceStats.total === 0}
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
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isPolishing || !visualManualId || currentStats.todo === 0}
          onClick={handlePolishAll}
        >
          {isPolishing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <WandSparkles className="h-4 w-4" />
          )}
          {isPolishing
             ? `润色中 ${progress.done}/${progress.total}`
            : `全部润色提示词 (${currentStats.todo})`}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={
            isGeneratingImages ||
            isPolishing ||
            !visualManualId ||
            currentImageStats.todo === 0
          }
          onClick={handleGenerateImages}
        >
          {isGeneratingImages ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
          {isGeneratingImages
            ? `生成中 ${progress.done}/${progress.total}`
            : `生成图片 (${currentImageStats.todo})`}
        </Button>
      </div>

      {(isPolishing || isGeneratingImages) && progress.total > 0 ? (
        <div className="h-1.5 bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {currentRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            暂无{typeLabel(activeType)}资产，请先在「{emptyExtractStageLabel}」完成实体提取。
          </p>
        ) : (
          <div className="grid gap-2">
            {currentRows.map((row) => (
              <AssetGenerationRow
                key={`${row.type}-${row.id}-${row.name}`}
                row={row}
                onOpenAsset={handleOpenAsset}
                onVoiceAssign={setVoiceDialogChar}
              />
            ))}
          </div>
        )}
      </div>

      <StudioAssetDetailDialog
        asset={selectedAsset}
        open={assetDialogOpen}
        onOpenChange={(open) => {
          setAssetDialogOpen(open);
          if (!open) setSelectedAsset(null);
        }}
      />
      {voiceDialogChar ? (
        <RoleVoiceAssignDialog
          character={voiceDialogChar}
          open={Boolean(voiceDialogChar)}
          onOpenChange={(open) => {
            if (!open) setVoiceDialogChar(null);
          }}
        />
      ) : null}
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
            <AlertDialogCancel disabled={isGeneratingSingle}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleGenerateSingle} disabled={isGeneratingSingle}>
              {isGeneratingSingle ? "生成中..." : "立即生成"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
