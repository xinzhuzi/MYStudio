import {
  ArrowLeft,
  Layers,
  LayoutGrid,
  MoreHorizontal,
  Palette,
  Plus,
  Save,
  Shirt,
  Trash2,
  Upload,
  WandSparkles,
  ZoomIn,
  Zap,
} from "lucide-react";
import { UNCLOOTH_ARCHIVED } from "@/lib/assist/image-studio/uncloth-defaults";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { ImageWorkflowGeneratedNode, ImageWorkflowGraph } from "@/types/studio";

/**
 * 图像节点图画布顶部工具条(T2 自 Canvas 抽取,行为零变化):
 * 返回/来源/分层节点对/风格依据chips/合并切换器/新建/上传参考/
 * 生成节点(全局)/更多菜单(写回目标·批量超分·分层节点对·放入资产库)。
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
  canUseGlobalWorkflowControls,
  onCreateNewFlow,
  onUploadReferenceClick,
  onAddGeneratedNode,
  onAddUnclothNode,
  onAddUnclothFastNode,
  onAddUnclothInstructNode,
  onAddStoryboardLayeredPair,
  activeGeneratedNode,
  workflowWritebackTargetLabel,
  onApplyToStoryboard,
  upscalableCount,
  upscaleRunning,
  onOpenBatchUpscale,
  onStoreInAssetLibrary,
  showStoreInAssetLibrary,
  selectedEdgeId,
  onDeleteSelectedEdge,
  onTidyLayout,
}: {
  onBack?: () => void;
  activeGraph: ImageWorkflowGraph;
  chromeReady: boolean;
  styleTraceChips: string[];
  canUseGlobalWorkflowControls: boolean;
  onCreateNewFlow: () => void;
  onUploadReferenceClick: () => void;
  onAddGeneratedNode: () => void;
  onAddUnclothNode: () => void;
  onAddUnclothFastNode?: () => void;
  onAddUnclothInstructNode?: () => void;
  onAddStoryboardLayeredPair: () => void;
  activeGeneratedNode?: ImageWorkflowGeneratedNode;
  workflowWritebackTargetLabel: string;
  onApplyToStoryboard: (nodeId: string) => void;
  upscalableCount: number;
  upscaleRunning: boolean;
  onOpenBatchUpscale: () => void;
  onStoreInAssetLibrary: (nodeId: string) => void;
  showStoreInAssetLibrary: boolean;
  selectedEdgeId: string | null;
  onDeleteSelectedEdge: () => void;
  onTidyLayout: () => void;
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
        size="sm"
        variant="outline"
        data-image-workflow-tidy-layout
        onClick={onTidyLayout}
        title="按「参考 → 提示词 → 成图」三列重排全部节点,消除重叠;只改位置,不动连线与内容"
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        整理布局
      </Button>
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
          <DropdownMenuItem
            onClick={onAddUnclothInstructNode}
            title="无衣物·指令编辑(现行,Krea2Edit 一句话指令改图;需本机 ComfyUI 运行中)"
          >
            <WandSparkles className="h-3.5 w-3.5" />
            无衣物·指令(现行)
          </DropdownMenuItem>
          {/* 09-05 masked SDEdit 双档封存(UNCLOOTH_ARCHIVED),启用见 uncloth-defaults.ts */}
          {!UNCLOOTH_ARCHIVED && (
          <>
          <DropdownMenuItem
            data-image-workflow-uncloth-action
            onClick={onAddUnclothNode}
            title="衣物区域局部重绘节点(双分割+两遍采样);连输入图与提示词,输出连成图"
          >
            <Shirt className="h-3.5 w-3.5" />
            无衣物·精(双分割+两遍+色彩对齐)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onAddUnclothFastNode}
            title="衣物区域局部重绘·快(fashn 单分割+单遍采样,约 1/3 耗时,无色彩对齐)"
          >
            <Zap className="h-3.5 w-3.5" />
            无衣物·快(单遍)
          </DropdownMenuItem>
          </>
          )}
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
