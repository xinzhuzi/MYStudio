import {
  ArrowLeft,
  Layers,
  Loader2,
  MoreHorizontal,
  Palette,
  Plus,
  Save,
  Trash2,
  Upload,
  WandSparkles,
  ZoomIn,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ImageWorkflowSwitcher } from "./image-workflow-switcher";
import type { ImageWorkflowScope } from "./image-workflow-scope";
import type { ImageWorkflowGeneratedNode, ImageWorkflowGraph, StoryboardItem } from "@/types/studio";

/**
 * 图像节点图画布顶部工具条(T2 自 Canvas 抽取,行为零变化):
 * 返回/来源/分层节点对/风格依据chips/合并切换器/新建/上传参考/
 * 生成节点/回写目标/运行生成/写回目标/批量超分/放入资产库/删除连线/适配画布。
 *
 * 2026-08-30 合并裁定:分镜切换只此一个入口——
 * 「本章分镜」组按分镜走查找/装配链(恒当前代),「资产工作流」「自由工作流」组按模块分组、按流 id 直切;
 * 无指纹旧流已在持久化层清理,不再分组列出。scoped 单镜模式也常驻本选择器。
 */
export function ImageWorkflowCanvasToolbar({
  onBack,
  activeGraph,
  chromeReady,
  styleTraceChips,
  scope,
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
}: {
  onBack?: () => void;
  activeGraph: ImageWorkflowGraph;
  chromeReady: boolean;
  styleTraceChips: string[];
  /** 作用域(08-30 强隔离裁定):storyboard=分镜域只列本章分镜;library=资产/自由域 */
  scope: ImageWorkflowScope;
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
}) {
  return (
    <div className="absolute left-3 right-3 top-3 z-20 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2 text-card-foreground">
      {onBack ? (
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          返回
        </Button>
      ) : null}
      {chromeReady && styleTraceChips.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" data-image-workflow-style-trace title="本次生图装配引用清单">
              <Palette className="h-3.5 w-3.5" />
              风格依据 {styleTraceChips.length} 项
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-w-[340px]">
            <DropdownMenuLabel>风格依据(建流装配溯源)</DropdownMenuLabel>
            {styleTraceChips.map((chip) => (
              <DropdownMenuItem key={chip} className="whitespace-normal break-all text-xs" data-image-workflow-style-trace-item>
                {chip}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <ImageWorkflowSwitcher
        scope={scope}
        activeGraph={activeGraph}
        storyboards={storyboards}
        imageWorkflows={imageWorkflows}
        chromeReady={chromeReady}
        onSelectStoryboard={onSelectStoryboard}
        onSelectWorkflow={onSelectorChange}
      />
      {canUseGlobalWorkflowControls ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            data-image-workflow-global-action
            onClick={onCreateNewFlow}
          >
            <Plus className="h-3.5 w-3.5" />
            新建自由工作流
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
      ) : null}
      <div className="min-w-4 flex-1" />
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" data-image-workflow-more aria-label="更多操作">
            <MoreHorizontal className="h-4 w-4" />
            更多
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-[340px]">
          <DropdownMenuItem
            onClick={() => activeGeneratedNode && onApplyToStoryboard(activeGeneratedNode.id)}
            disabled={!activeGeneratedNode?.resultUrl}
            title={workflowWritebackTargetLabel}
          >
            <Save className="h-3.5 w-3.5" />
            写回目标 · {workflowWritebackTargetLabel}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-image-workflow-batch-upscale
            onClick={onOpenBatchUpscale}
            disabled={upscalableCount === 0 || upscaleRunning}
            title="勾选多个成图节点,本地 ×4 批量超分"
          >
            <ZoomIn className="h-3.5 w-3.5" />
            批量超分{upscalableCount > 0 ? `(${upscalableCount})` : ""}
          </DropdownMenuItem>
          {activeGraph.target.kind === "storyboard" ? (
            <DropdownMenuItem data-image-workflow-layered-action onClick={onAddStoryboardLayeredPair}>
              <Layers className="h-3.5 w-3.5" />
              分层节点对
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
