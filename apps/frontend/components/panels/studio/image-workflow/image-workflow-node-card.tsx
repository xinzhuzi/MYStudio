import { memo, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { CheckCircle2, Image as ImageIcon, Loader2, Save, Trash2, WandSparkles, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LocalImage } from "@/components/ui/local-image";
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

export interface ImageWorkflowNodeData extends Record<string, unknown> {
  node: ImageWorkflowNode;
  promptNode?: ImageWorkflowPromptNode;
  selected: boolean;
  storyboards: StoryboardItem[];
  onUpdate: (nodeId: string, updates: Partial<ImageWorkflowNode>) => void;
  onGenerate: (nodeId: string) => void;
  onUpscale: (nodeId: string) => void | Promise<void>;
  onApplyToStoryboard: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
}

export type ImageWorkflowReactNode = Node<ImageWorkflowNodeData>;

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
        <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-info/40 !bg-info/20" />
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
        <Button size="icon" variant="ghost" aria-label="删除节点" onClick={() => data.onDelete(node.id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {node.type === "reference" ? (
        <ReferenceNodeEditor node={node} onUpdate={data.onUpdate} />
      ) : node.type === "prompt" ? (
        <PromptNodeEditor node={node} onUpdate={data.onUpdate} onGenerate={data.onGenerate} />
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
          <LocalImage src={node.imageUrl} alt={node.title} className="h-full w-full object-cover" resolutionBadge />
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
        className="nodrag nopan min-h-[58px] border-border bg-background/80 text-xs text-foreground"
      />
    </div>
  );
}

function PromptNodeEditor({
  node,
  onUpdate,
  onGenerate,
}: {
  node: ImageWorkflowPromptNode;
  onUpdate: ImageWorkflowNodeData["onUpdate"];
  onGenerate: ImageWorkflowNodeData["onGenerate"];
}) {
  return (
    <div className="space-y-3">
      <Textarea
        value={node.prompt}
        onChange={(event) => onUpdate(node.id, { prompt: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="描述要生成的图片"
        className="nodrag nopan min-h-[160px] resize-y border-border bg-background/80 text-sm leading-6 text-foreground"
      />
      <div className="nodrag nopan grid grid-cols-[minmax(0,1fr)_88px_88px_92px] gap-2">
        <ModelSelector
          type="image"
          value={node.model ?? ""}
          onChange={(model) => onUpdate(node.id, { model } as Partial<ImageWorkflowNode>)}
          className="w-full"
        />
        <select
          value={node.aspectRatio}
          onChange={(event) => onUpdate(node.id, { aspectRatio: event.target.value } as Partial<ImageWorkflowNode>)}
          className="h-9 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
          aria-label="图片比例"
        >
          {ASPECT_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
        </select>
        <select
          value={node.resolution ?? ""}
          onChange={(event) => onUpdate(node.id, { resolution: event.target.value } as Partial<ImageWorkflowNode>)}
          className="h-9 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
          aria-label="图片分辨率"
        >
          {RESOLUTION_OPTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
        </select>
        <Button size="sm" variant="paid" onClick={() => onGenerate(node.id)}>
          <WandSparkles className="h-3.5 w-3.5" />
          生成
        </Button>
      </div>
      <div className="nodrag nopan grid grid-cols-[1fr_96px] gap-2">
        <Textarea
          value={node.negativePrompt ?? ""}
          onChange={(event) => onUpdate(node.id, { negativePrompt: event.target.value } as Partial<ImageWorkflowNode>)}
          placeholder="反向提示词（可选）"
          className="min-h-[54px] border-border bg-background/80 text-xs leading-5 text-foreground"
        />
        <select
          value={node.quality}
          onChange={(event) => onUpdate(node.id, { quality: event.target.value as ImageWorkflowPromptNode["quality"] } as Partial<ImageWorkflowNode>)}
          className="h-9 self-end rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
          aria-label="生成质量"
        >
          {QUALITY_OPTIONS.map((quality) => <option key={quality} value={quality}>{quality}</option>)}
        </select>
      </div>
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
  const generating = node.status === "generating" || node.status === "queued";
  const [imageLongSide, setImageLongSide] = useState(0);
  const alreadyUpscaled = (node.resultUrl || "").includes("up4x-")
    || imageLongSide > UPSCALE_INPUT_MAX_LONG_SIDE;
  const generationPrompt = promptNode ?? node;
  const updateGenerationPrompt = (updates: Partial<ImageWorkflowPromptNode | ImageWorkflowGeneratedNode>) => {
    onUpdate((promptNode ?? node).id, updates as Partial<ImageWorkflowNode>);
  };

  return (
    <div className="space-y-3">
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
        {node.resultUrl ? (
          <LocalImage
            src={node.resultUrl}
            alt={node.title}
            className="h-full w-full object-cover"
            resolutionBadge
            onLoad={(event) => {
              const image = event.currentTarget;
              setImageLongSide(Math.max(image.naturalWidth, image.naturalHeight));
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {node.status === "failed" ? node.errorReason || "生成失败" : "等待生成"}
          </div>
        )}
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
            onClick={() => void onUpscale(node.id)}
            disabled={!node.resultUrl || generating || alreadyUpscaled}
            title={alreadyUpscaled
              ? "已是 4K 超分结果，无需再放大"
              : "本地 Real-ESRGAN 原生 ×4 放大(1K→4K)"}
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ZoomIn className="h-3.5 w-3.5" />}
            超分 4K
          </Button>
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
            className="min-h-[148px] resize-y border-border bg-card/80 text-sm leading-6 text-foreground"
          />
          <div className="grid grid-cols-[minmax(0,1fr)_104px_104px] gap-2">
            <ModelSelector
              type="image"
              value={generationPrompt.model ?? ""}
              onChange={(model) => updateGenerationPrompt({ model })}
              className="w-full"
            />
            <select
              value={generationPrompt.aspectRatio}
              onChange={(event) => updateGenerationPrompt({ aspectRatio: event.target.value })}
              className="h-9 rounded-md border border-border bg-card/80 px-2 text-xs text-foreground outline-none"
              aria-label="图片比例"
            >
              {ASPECT_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
            </select>
            <select
              value={generationPrompt.resolution ?? ""}
              onChange={(event) => updateGenerationPrompt({ resolution: event.target.value })}
              className="h-9 rounded-md border border-border bg-card/80 px-2 text-xs text-foreground outline-none"
              aria-label="图片分辨率"
            >
              {RESOLUTION_OPTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_104px_40px_40px] gap-2">
            <Textarea
              value={generationPrompt.negativePrompt ?? ""}
              onChange={(event) => updateGenerationPrompt({ negativePrompt: event.target.value })}
              placeholder="反向提示词（可选）"
              className="min-h-[44px] border-border bg-card/80 text-xs leading-5 text-foreground"
            />
            <select
              value={generationPrompt.quality}
              onChange={(event) => updateGenerationPrompt({ quality: event.target.value as ImageWorkflowPromptNode["quality"] })}
              className="h-9 self-end rounded-md border border-border bg-card/80 px-2 text-xs text-foreground outline-none"
              aria-label="生成质量"
            >
              {QUALITY_OPTIONS.map((quality) => <option key={quality} value={quality}>{quality}</option>)}
            </select>
            <Button
              size="icon"
              onClick={() => onGenerate(node.id)}
              disabled={generating}
              aria-label="运行生成"
              className="self-end"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="secondary"
              onClick={() => onApplyToStoryboard(node.id)}
              disabled={!node.resultUrl}
              aria-label="写回目标"
              className="self-end"
            >
              <Save className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
