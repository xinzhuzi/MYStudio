import {
  ArrowLeft,
  Layers,
  Loader2,
  Maximize2,
  Plus,
  Save,
  Trash2,
  Upload,
  WandSparkles,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ImageWorkflowGeneratedNode, ImageWorkflowGraph, StoryboardItem } from "@/types/studio";

/**
 * 图像节点图画布顶部工具条(T2 自 Canvas 抽取,行为零变化):
 * 返回/来源/分层节点对/风格依据chips/合并切换器/新建/上传参考/
 * 生成节点/回写目标/运行生成/写回目标/批量超分/放入资产库/删除连线/适配画布。
 *
 * 2026-08-30 合并裁定:分镜切换只此一个入口——
 * 「本章分镜」组按分镜走查找/装配链(恒当前代),「其他工作流」组按流 id 直切;
 * 无指纹旧流已在持久化层清理,不再分组列出。scoped 单镜模式也常驻本选择器。
 */
export function ImageWorkflowCanvasToolbar({
  onBack,
  sourceLabel,
  sourceStageLabel,
  activeGraph,
  chromeReady,
  styleTraceChips,
  canUseGlobalWorkflowControls,
  imageWorkflows,
  storyboards,
  onSelectStoryboard,
  onSelectorChange,
  onCreateNewFlow,
  onUploadReferenceClick,
  onAddGeneratedNode,
  onAddStoryboardLayeredPair,
  workflowWritebackTargetLabel,
  activeGeneratedNode,
  selectedGenerationBusy,
  onGenerate,
  onApplyToStoryboard,
  upscalableCount,
  upscaleRunning,
  onOpenBatchUpscale,
  onStoreInAssetLibrary,
  showStoreInAssetLibrary,
  selectedEdgeId,
  onDeleteSelectedEdge,
  onFitView,
}: {
  onBack?: () => void;
  sourceLabel: string;
  sourceStageLabel?: string;
  activeGraph: ImageWorkflowGraph;
  chromeReady: boolean;
  styleTraceChips: string[];
  canUseGlobalWorkflowControls: boolean;
  imageWorkflows: ImageWorkflowGraph[];
  /** 本章分镜(已按生产章过滤):「本章分镜」组数据源 */
  storyboards: StoryboardItem[];
  /** 合并切换器选中分镜:全局模式画布内切换,scoped 模式走整条打开链 */
  onSelectStoryboard: (storyboard: StoryboardItem) => void;
  onSelectorChange: (workflowId: string) => void;
  onCreateNewFlow: () => void;
  onUploadReferenceClick: () => void;
  onAddGeneratedNode: () => void;
  onAddStoryboardLayeredPair: () => void;
  workflowWritebackTargetLabel: string;
  activeGeneratedNode?: ImageWorkflowGeneratedNode;
  selectedGenerationBusy: boolean;
  onGenerate: (nodeId: string) => void;
  onApplyToStoryboard: (nodeId: string) => void;
  upscalableCount: number;
  upscaleRunning: boolean;
  onOpenBatchUpscale: () => void;
  onStoreInAssetLibrary: (nodeId: string) => void;
  showStoreInAssetLibrary: boolean;
  selectedEdgeId: string | null;
  onDeleteSelectedEdge: () => void;
  onFitView: () => void;
}) {
  return (
    <div className="absolute left-3 right-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2 text-card-foreground">
      {onBack ? (
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </Button>
      ) : null}
      <div className={cn("flex min-w-[180px] flex-1 items-center text-xs", onBack ? "border-l border-border pl-2" : "")}>
        <span className="shrink-0 text-muted-foreground">来源</span>
        <span className="ml-2 truncate font-medium">
          {sourceStageLabel ? `${sourceStageLabel} / ${sourceLabel}` : sourceLabel}
        </span>
      </div>
      {activeGraph?.target.kind === "storyboard" ? (
        <Button size="sm" data-image-workflow-layered-action variant="outline" onClick={onAddStoryboardLayeredPair}>
          <Layers className="h-3.5 w-3.5" />
          分层节点对
        </Button>
      ) : null}
      {chromeReady && styleTraceChips.length ? (
        <div
          data-image-workflow-style-trace
          className="flex min-w-[220px] flex-1 flex-wrap items-center gap-1 border-l border-border pl-2 text-[10px] leading-4"
        >
          <span className="shrink-0 text-muted-foreground">风格依据</span>
          {styleTraceChips.map((chip) => (
            <span
              key={chip}
              title={`本次生图装配引用:${chip}`}
              className="rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-primary/85"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}
      {(() => {
        // 值域双命名空间:分镜项 `sb:<storyboardId>`(走分镜切换链),
        // 非分镜流项 `<graphId>`(按 id 直切)。当前流是分镜目标但不在本章
        // 列表(跨章流)时补一项以流名兜底显示,选中不动作。
        const activeStoryboardId =
          activeGraph.target.kind === "storyboard" && typeof activeGraph.target.id === "string"
            ? activeGraph.target.id
            : null;
        const selectorValue = activeStoryboardId ? `sb:${activeStoryboardId}` : activeGraph.id;
        const currentStoryboardMissing =
          activeStoryboardId !== null && !storyboards.some((item) => item.id === activeStoryboardId);
        const nonStoryboardGraphs = imageWorkflows.filter((graph) => graph.target.kind !== "storyboard");
        const storyboardOptionLabel = (storyboard: StoryboardItem) =>
          `分镜 ${storyboard.index} · ${(storyboard.videoDesc || storyboard.prompt).slice(0, 18)}`;
        return (
          <select
            data-image-workflow-selector
            data-image-workflow-active-id={activeGraph.id}
            value={selectorValue}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (nextValue === selectorValue) return;
              if (nextValue.startsWith("sb:")) {
                const storyboard = storyboards.find((item) => `sb:${item.id}` === nextValue);
                if (storyboard) onSelectStoryboard(storyboard);
                return;
              }
              onSelectorChange(nextValue);
            }}
            className="h-8 max-w-[260px] rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
            title="切换本章分镜或其他工作流"
            aria-label="切换分镜工作流"
          >
            {/* 首帧只挂当前项,完整列表延后一帧(chromeReady)再补,避免进入画布
                瞬间一次性铺全部 <option> 卡顿(功能不变,展开时已补齐)。 */}
            {chromeReady ? (
              <>
                <optgroup label="本章分镜">
                  {storyboards.map((storyboard) => (
                    <option key={storyboard.id} value={`sb:${storyboard.id}`}>
                      {storyboardOptionLabel(storyboard)}
                    </option>
                  ))}
                  {currentStoryboardMissing ? (
                    <option value={selectorValue}>{activeGraph.name}(其他章节)</option>
                  ) : null}
                </optgroup>
                <optgroup label="其他工作流">
                  {nonStoryboardGraphs.map((graph) => (
                    <option key={graph.id} value={graph.id}>
                      {graph.name}
                    </option>
                  ))}
                </optgroup>
              </>
            ) : (
              <option value={selectorValue}>{activeGraph.name}</option>
            )}
          </select>
        );
      })()}
      {canUseGlobalWorkflowControls ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            data-image-workflow-global-action
            onClick={onCreateNewFlow}
          >
            <Plus className="h-3.5 w-3.5" />
            新建
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-image-workflow-global-action
            onClick={onUploadReferenceClick}
          >
            <Upload className="h-3.5 w-3.5" />
            上传参考
          </Button>
          <Button size="sm" data-image-workflow-global-action onClick={onAddGeneratedNode}>
            <WandSparkles className="h-3.5 w-3.5" />
            生成节点
          </Button>

        </>
      ) : (
        <div className="max-w-[300px] truncate rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs font-medium text-card-foreground">
          {activeGraph.name}
        </div>
      )}
      <div className="flex min-w-[180px] max-w-[320px] items-center gap-1.5 rounded-md border border-info/25 bg-info/10 px-2 py-1 text-[11px] text-info">
        <Save className="h-3.5 w-3.5 shrink-0" />
        <span className="shrink-0 text-info/75">回写目标</span>
        <span className="truncate font-medium">{workflowWritebackTargetLabel}</span>
      </div>
      <Button
        size="sm"
        variant="paid"
        onClick={() => activeGeneratedNode && onGenerate(activeGeneratedNode.id)}
        disabled={!activeGeneratedNode || selectedGenerationBusy}
      >
        {selectedGenerationBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <WandSparkles className="h-3.5 w-3.5" />
        )}
        运行生成
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => activeGeneratedNode && onApplyToStoryboard(activeGeneratedNode.id)}
        disabled={!activeGeneratedNode?.resultUrl}
      >
        <Save className="h-3.5 w-3.5" />
        写回目标
      </Button>
      <Button
        size="sm"
        variant="outline"
        data-image-workflow-batch-upscale
        onClick={onOpenBatchUpscale}
        disabled={upscalableCount === 0 || upscaleRunning}
        title="勾选多个成图节点,本地 ×4 批量超分"
      >
        <ZoomIn className="h-3.5 w-3.5" />
        批量超分
      </Button>
      {showStoreInAssetLibrary ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            activeGeneratedNode && onStoreInAssetLibrary(activeGeneratedNode.id)
          }
          disabled={!activeGeneratedNode?.resultUrl}
        >
          <Save className="h-3.5 w-3.5" />
          放入资产库
        </Button>
      ) : null}
      {selectedEdgeId && canUseGlobalWorkflowControls ? (
        <Button
          size="sm"
          variant="destructive"
          data-image-workflow-global-action
          onClick={onDeleteSelectedEdge}
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除连线
        </Button>
      ) : null}
      <Button
        size="icon"
        variant="ghost"
        aria-label="适配画布"
        onClick={onFitView}
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
