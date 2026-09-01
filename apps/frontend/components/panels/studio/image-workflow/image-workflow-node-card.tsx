import { memo, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UpscaleDenoiseModeField, denoiseModeToOpts, type UpscaleDenoiseMode } from "./upscale-denoise-mode";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { CheckCircle2, Image as ImageIcon, Loader2, Save, Scissors, Trash2, WandSparkles, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LocalImage } from "@/components/ui/local-image";
import { ResolutionBadge, probeImagePixelSize } from "@/components/ui/image-resolution-badge";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelector } from "@/components/panels/assist/ModelSelector";
import { UPSCALE_INPUT_MAX_LONG_SIDE } from "@/lib/upscale/client";
import { IMAGE_ASPECT_RATIOS, IMAGE_RESOLUTIONS } from "@/lib/ai/image-size-presets";
import { cn } from "@/lib/utils";
import type {
  ImageWorkflowGeneratedNode,
  ImageWorkflowNode,
  ImageWorkflowPromptNode,
  ImageWorkflowReferenceNode,
  StoryboardItem,
} from "@/types/studio";
import { toPreviewSrc, withThumbVariant } from "@/lib/media/preview-src";

export interface ImageWorkflowNodeData extends Record<string, unknown> {
  node: ImageWorkflowNode;
  promptNode?: ImageWorkflowPromptNode;
  selected: boolean;
  storyboards: StoryboardItem[];
  onUpdate: (nodeId: string, updates: Partial<ImageWorkflowNode>) => void;
  onGenerate: (nodeId: string) => void;
  onUpscale: (nodeId: string, opts?: { denoise?: boolean }) => void | Promise<void>;
  onApplyToStoryboard: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  /** 取材工具入口(09-01 画布取材):裁剪等,有图节点可用 */
  onCrop?: (nodeId: string) => void;
}

export type ImageWorkflowReactNode = Node<ImageWorkflowNodeData>;

/** 取材可用:参考图有 imageUrl;成图有 resultUrl */
function extractableImageUrl(node: ImageWorkflowNode): string | null {
  if (node.type === "reference") return node.imageUrl || null;
  if (node.type === "generated") return node.resultUrl || null;
  return null;
}

const ASPECT_RATIOS = IMAGE_ASPECT_RATIOS;
const RESOLUTION_OPTIONS = IMAGE_RESOLUTIONS;
const QUALITY_OPTIONS: Array<ImageWorkflowGeneratedNode["quality"]> = ["draft", "standard", "hd"];

/**
 * 拖动每帧重建 node wrapper(position/dragging 变化),但卡片内容只依赖
 * data(selected/字段/回调)。data 引用不变即跳过渲染——卡片位置由 React Flow
 * 外层 wrapper 的 transform 驱动,内容无需跟随拖动帧重渲染。
 */
function areNodeCardPropsEqual(
  prev: NodeProps<ImageWorkflowReactNode>,
  next: NodeProps<ImageWorkflowReactNode>,
) {
  return (
    prev.id === next.id &&
    prev.data === next.data &&
    prev.selected === next.selected &&
    prev.dragging === next.dragging &&
    prev.isConnectable === next.isConnectable &&
    prev.positionAbsoluteX === next.positionAbsoluteX &&
    prev.positionAbsoluteY === next.positionAbsoluteY &&
    prev.zIndex === next.zIndex &&
    prev.type === next.type &&
    prev.deletable === next.deletable &&
    prev.selectable === next.selectable &&
    prev.draggable === next.draggable &&
    prev.parentId === next.parentId &&
    prev.width === next.width &&
    prev.height === next.height
  );
}

export const ImageWorkflowNodeCard = memo(function ImageWorkflowNodeCard({ data }: NodeProps<ImageWorkflowReactNode>) {
  const node = data.node;
  const borderClass = data.selected
    ? "border-warning/80 shadow-[0_18px_42px_rgba(251,191,36,0.22)]"
    : node.type === "generated" && node.status === "ready"
      ? "border-success/45"
      : "border-border";
  const nodeKindLabel =
    node.type === "reference" ? "Image" : node.type === "prompt" ? "图片生成" : "生成结果";

  return (
    <div
      data-image-workflow-node-kind={node.type}
      className={cn(
        "[contain:layout_style]",
        "image-workflow-node-card rounded-md border bg-card/96 p-3 text-card-foreground shadow-[0_22px_54px_rgba(0,0,0,0.24)]",
        node.type === "prompt" || node.type === "generated" ? "w-[560px]" : "w-[420px]",
        borderClass,
      )}
    >
      {node.type === "generated" ? (
        <Handle
          type="target"
          position={Position.Left}
          // 08-31-connect-create-menu:target 手柄默认 connectableStart=false,
          // 显式开启才能从成图输入拖出建上游(提示词/参考图)——上游菜单入口
          isConnectableStart
          className="!h-3 !w-3 !border-info/40 !bg-info/20"
        />
      ) : null}
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-info/40 !bg-info/20" />
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/35">
            {node.type === "reference" ? <ImageIcon className="h-4 w-4" /> : <WandSparkles className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <input
              value={node.title}
              onChange={(event) => data.onUpdate(node.id, { title: event.target.value } as Partial<ImageWorkflowNode>)}
              className="nodrag nopan w-full truncate bg-transparent text-sm font-semibold outline-none"
            />
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {nodeKindLabel}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {data.onCrop && node.type !== "prompt" && extractableImageUrl(node) ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label="裁剪取材"
              title="裁剪并生成衍生参考图"
              onClick={() => data.onCrop?.(node.id)}
            >
              <Scissors className="h-4 w-4" />
            </Button>
          ) : null}
          <Button size="icon" variant="ghost" aria-label="删除节点" onClick={() => data.onDelete(node.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {node.type === "reference" ? (
        <ReferenceNodeEditor node={node} onUpdate={data.onUpdate} />
      ) : node.type === "prompt" ? (
        <PromptNodeEditor node={node} onUpdate={data.onUpdate} />
      ) : (
        <GeneratedNodeEditor
          node={node}
          promptNode={data.promptNode}
          onUpdate={data.onUpdate}
          onGenerate={data.onGenerate}
          onUpscale={data.onUpscale}
          onApplyToStoryboard={data.onApplyToStoryboard}
        />
      )}
    </div>
  );
}, areNodeCardPropsEqual);

ImageWorkflowNodeCard.displayName = "ImageWorkflowNodeCard";

function ReferenceNodeEditor({
  node,
  onUpdate,
}: {
  node: ImageWorkflowReferenceNode;
  onUpdate: ImageWorkflowNodeData["onUpdate"];
}) {
  return (
    <div className="space-y-2">
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
        {node.imageUrl ? (
          <span className="relative flex h-full w-full">
            <LocalImage
              src={withThumbVariant(toPreviewSrc(node.imageUrl))}
              alt={node.title}
              className="h-full w-full object-cover"
              eager
              previewable
            />
            <ResolutionBadge src={toPreviewSrc(node.imageUrl)} />
          </span>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">暂无图片</div>
        )}
      </div>
      <input
        value={node.imageUrl}
        onChange={(event) => onUpdate(node.id, { imageUrl: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="project-file://、local-image:// 或 https://"
        className="nodrag nopan h-8 w-full rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
      />
      <Textarea
        value={node.notes ?? ""}
        onChange={(event) => onUpdate(node.id, { notes: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="参考说明"
        className="nodrag nopan min-h-[58px] [field-sizing:content] border-border bg-background/80 text-xs text-foreground"
      />
    </div>
  );
}

function PromptNodeEditor({
  node,
  onUpdate,
}: {
  node: ImageWorkflowPromptNode;
  onUpdate: ImageWorkflowNodeData["onUpdate"];
}) {
  return (
    <div className="space-y-3">
      <Textarea
        value={node.prompt}
        onChange={(event) => onUpdate(node.id, { prompt: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="描述要生成的图片"
        className="nodrag nopan min-h-[120px] [field-sizing:content] border-border bg-background/80 text-sm leading-6 text-foreground"
      />
      {/* 08-30 功能转移裁定:输入节点只管提示词(输入源);模型/画幅/分辨率/
          质量/生成全部在成图节点上。 */}
      <Textarea
        value={node.negativePrompt ?? ""}
        onChange={(event) => onUpdate(node.id, { negativePrompt: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="反向提示词（可选）"
        className="nodrag nopan min-h-[54px] [field-sizing:content] border-border bg-background/80 text-xs leading-5 text-foreground"
      />
    </div>
  );
}

function GeneratedNodeEditor({
  node,
  promptNode,
  onUpdate,
  onGenerate,
  onUpscale,
  onApplyToStoryboard,
}: {
  node: ImageWorkflowGeneratedNode;
  promptNode?: ImageWorkflowPromptNode;
  onUpdate: ImageWorkflowNodeData["onUpdate"];
  onGenerate: ImageWorkflowNodeData["onGenerate"];
  onUpscale: ImageWorkflowNodeData["onUpscale"];
  onApplyToStoryboard: ImageWorkflowNodeData["onApplyToStoryboard"];
}) {
  const [upscaleConfirmOpen, setUpscaleConfirmOpen] = useState(false);
  const [upscaleDenoiseMode, setUpscaleDenoiseMode] = useState<UpscaleDenoiseMode>("off");
  const generating = node.status === "generating" || node.status === "queued";
  const [imageLongSide, setImageLongSide] = useState(0);
  const alreadyUpscaled = (node.resultUrl || "").includes("up4x-")
    || imageLongSide > UPSCALE_INPUT_MAX_LONG_SIDE;
  const generationPrompt = promptNode ?? node;
  const updateGenerationPrompt = (updates: Partial<ImageWorkflowPromptNode | ImageWorkflowGeneratedNode>) => {
    onUpdate((promptNode ?? node).id, updates as Partial<ImageWorkflowNode>);
  };

  useEffect(() => {
    if (!node.resultUrl) {
      setImageLongSide(0);
      return;
    }
    let cancelled = false;
    void probeImagePixelSize(toPreviewSrc(node.resultUrl)).then((size) => {
      if (cancelled || !size) return;
      setImageLongSide(Math.max(size.width, size.height));
    });
    return () => {
      cancelled = true;
    };
  }, [node.resultUrl]);

  return (
    <div className="space-y-3">
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
        {node.resultUrl ? (
          <span className="relative flex h-full w-full">
            <LocalImage
              src={withThumbVariant(toPreviewSrc(node.resultUrl))}
              alt={node.title}
              className="h-full w-full object-cover"
              eager
              previewable
            />
            <ResolutionBadge src={toPreviewSrc(node.resultUrl)} />
          </span>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {node.status === "failed" ? node.errorReason || "生成失败" : "等待生成"}
          </div>
        )}
      </div>
      {/* 08-30 功能转移:生成参数(模型/画幅/分辨率/质量)归属成图节点。
          显示值回落连线提示词节点旧值(存量图零变化);改动即写本节点
          并置 paramsEdited(参数权威转移)。 */}
      <div className="nodrag nopan grid grid-cols-[minmax(0,1fr)_76px_64px_86px] gap-2" data-generated-node-params>
        <ModelSelector
          type="image"
          value={node.model ?? promptNode?.model ?? ""}
          onChange={(model) => onUpdate(node.id, { model, paramsEdited: true } as Partial<ImageWorkflowNode>)}
          className="w-full"
        />
        <select
          value={(node.paramsEdited ? node.aspectRatio : (promptNode?.aspectRatio ?? node.aspectRatio))}
          onChange={(event) => onUpdate(node.id, { aspectRatio: event.target.value, paramsEdited: true } as Partial<ImageWorkflowNode>)}
          className="h-8 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
          aria-label="图片比例"
        >
          {ASPECT_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
        </select>
        <select
          value={node.resolution ?? promptNode?.resolution ?? ""}
          onChange={(event) => onUpdate(node.id, { resolution: event.target.value, paramsEdited: true } as Partial<ImageWorkflowNode>)}
          className="h-8 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
          aria-label="图片分辨率"
        >
          {RESOLUTION_OPTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
        </select>
        <select
          value={(node.paramsEdited ? node.quality : (promptNode?.quality ?? node.quality))}
          onChange={(event) => onUpdate(node.id, { quality: event.target.value as ImageWorkflowGeneratedNode["quality"], paramsEdited: true } as Partial<ImageWorkflowNode>)}
          className="h-8 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
          aria-label="生成质量"
        >
          {QUALITY_OPTIONS.map((quality) => <option key={quality} value={quality}>{quality}</option>)}
        </select>
      </div>
      <div className="nodrag nopan flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {node.status === "ready" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : null}
          {node.status}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => onApplyToStoryboard(node.id)} disabled={!node.resultUrl}>
            <Save className="h-3.5 w-3.5" />
            回写
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!node.resultUrl || generating || alreadyUpscaled) return;
              setUpscaleConfirmOpen(true);
            }}
            disabled={!node.resultUrl || generating || alreadyUpscaled}
            title={alreadyUpscaled
              ? "已是 4K 超分结果，无需再放大"
              : "本地 Real-ESRGAN 原生 ×4 放大(1K→4K)"}
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ZoomIn className="h-3.5 w-3.5" />}
            超分 4K
          </Button>
          <Dialog open={upscaleConfirmOpen} onOpenChange={setUpscaleConfirmOpen}>
            <DialogContent className="max-w-[400px]">
              <DialogHeader>
                <DialogTitle>超分到 4K</DialogTitle>
                <DialogDescription>
                  本地 Real-ESRGAN 原生 ×4 放大，结果替换该节点成图。
                </DialogDescription>
              </DialogHeader>
              <div data-image-node-upscale-denoise>
                <UpscaleDenoiseModeField value={upscaleDenoiseMode} onChange={setUpscaleDenoiseMode} />
              </div>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setUpscaleConfirmOpen(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setUpscaleConfirmOpen(false);
                    void onUpscale(node.id, denoiseModeToOpts(upscaleDenoiseMode));
                  }}
                >
                  <ZoomIn className="mr-1 h-3.5 w-3.5" />
                  开始超分
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="paid" onClick={() => onGenerate(node.id)} disabled={generating}>
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
            生成
          </Button>
        </div>
      </div>
      {!promptNode ? (
        <div
          data-toonflow-generated-prompt-panel
          className="nodrag nopan space-y-3 rounded-md border border-border bg-background/80 p-3"
        >
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <WandSparkles className="h-3.5 w-3.5 text-info" />
            图片生成
          </div>
          <Textarea
            data-toonflow-generated-prompt-textarea
            value={generationPrompt.prompt}
            onChange={(event) => updateGenerationPrompt({ prompt: event.target.value })}
            placeholder="描述要生成的图片"
            className="min-h-[112px] [field-sizing:content] border-border bg-card/80 text-sm leading-6 text-foreground"
          />
          {/* 08-30 功能转移:参数与生成入口统一在节点 footer 参数行/按钮区;
              此内嵌面板只承载无连线时的提示词编辑。 */}
          <Textarea
            value={generationPrompt.negativePrompt ?? ""}
            onChange={(event) => updateGenerationPrompt({ negativePrompt: event.target.value })}
            placeholder="反向提示词（可选）"
            className="min-h-[44px] [field-sizing:content] border-border bg-card/80 text-xs leading-5 text-foreground"
          />
        </div>
      ) : null}
    </div>
  );
}
