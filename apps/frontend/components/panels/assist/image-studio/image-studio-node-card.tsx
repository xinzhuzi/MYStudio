// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useEffect, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  Archive,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Square,
  Trash2,
  Type,
  Upload,
  WandSparkles,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LocalImage } from "@/components/ui/local-image";
import { ResolutionBadge, probeImagePixelSize } from "@/components/ui/image-resolution-badge";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelector } from "@/components/panels/assist/ModelSelector";
import { IMAGE_ASPECT_RATIOS, IMAGE_RESOLUTIONS } from "@/lib/ai/image-size-presets";
import { referenceCapacityForModel } from "./image-studio-node-registry";
import { toPreviewSrc } from "@/lib/media/preview-src";
import { UPSCALE_INPUT_MAX_LONG_SIDE } from "@/lib/upscale/client";
import { cn } from "@/lib/utils";
import type {
  ImageWorkflowGeneratedNode,
  ImageWorkflowNode,
  ImageWorkflowPromptNode,
  ImageWorkflowReferenceNode,
} from "@/types/studio";

/**
 * 图片工作室节点卡(自由画布)。
 *
 * 结构 fork 自分镜 image-workflow-node-card(memo+自定义比较+nodrag/nowheel
 * 纪律),差异:动作条=道具库/下载(assist 域)而非回写分镜;参考图卡=上传
 * 优先;增加模型专属参数(MJ/Ideogram)与参考图能力提示。
 */
export interface ImageStudioNodeData extends Record<string, unknown> {
  node: ImageWorkflowNode;
  promptNode?: ImageWorkflowPromptNode;
  selected: boolean;
  /** 该成图节点已挂参考图数(参考图节点+上游成图结果) */
  referenceCount: number;
  /** 模型专属附加参数(MJ/Ideogram;types/studio 节点模型冻结,存于画布 store) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extras?: Record<string, any>;
  onUpdate: (nodeId: string, updates: Partial<ImageWorkflowNode>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdateExtras: (nodeId: string, extras: Record<string, any>) => void;
  /** 参考图节点:上传/更换图片(宿主打开文件选择器) */
  onPickImage: (nodeId: string) => void;
  onGenerate: (nodeId: string) => void;
  onStop: (nodeId: string) => void;
  onUpscale: (nodeId: string) => void;
  onSaveToProps: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
}

export type ImageStudioReactNode = Node<ImageStudioNodeData>;

const ASPECT_RATIOS = IMAGE_ASPECT_RATIOS;
const RESOLUTION_OPTIONS = IMAGE_RESOLUTIONS;
const QUALITY_OPTIONS: Array<ImageWorkflowGeneratedNode["quality"]> = ["draft", "standard", "hd"];

const STATUS_LABELS: Record<ImageWorkflowGeneratedNode["status"], string> = {
  idle: "待生成",
  queued: "排队中",
  generating: "生成中",
  ready: "已完成",
  failed: "失败",
};

/**
 * 拖动每帧重建 node wrapper(position/dragging 变化),卡片内容只依赖
 * data(selected/字段/回调)——与分镜画布同款 memo 纪律。
 */
function areNodeCardPropsEqual(
  prev: NodeProps<ImageStudioReactNode>,
  next: NodeProps<ImageStudioReactNode>,
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

/** 生成中已用秒数:HTTP 生图接口没有进度事件,以起表时间做可感知进度。 */
function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return elapsed;
}

function formatElapsedSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}分${seconds.toString().padStart(2, "0")}秒` : `${seconds}秒`;
}

export const ImageStudioNodeCard = memo(function ImageStudioNodeCard({
  data,
}: NodeProps<ImageStudioReactNode>) {
  const node = data.node;
  const borderClass = data.selected
    ? "border-warning/80 shadow-[0_18px_42px_rgba(251,191,36,0.22)]"
    : node.type === "generated" && node.status === "ready"
      ? "border-success/45"
      : "border-border";
  const meta =
    node.type === "reference" ? "参考图" : node.type === "prompt" ? "提示词" : "成图";

  return (
    <div
      data-image-studio-node-kind={node.type}
      className={cn(
        "[contain:layout_style]",
        "image-workflow-node-card rounded-md border bg-card/96 p-3 text-card-foreground shadow-[0_22px_54px_rgba(0,0,0,0.24)]",
        node.type === "reference" ? "w-[360px]" : node.type === "prompt" ? "w-[480px]" : "w-[560px]",
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
            {node.type === "reference" ? (
              <ImageIcon className="h-4 w-4" />
            ) : node.type === "prompt" ? (
              <Type className="h-4 w-4" />
            ) : (
              <WandSparkles className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0">
            <input
              value={node.title}
              onChange={(event) => data.onUpdate(node.id, { title: event.target.value } as Partial<ImageWorkflowNode>)}
              className="nodrag nopan w-full truncate bg-transparent text-sm font-semibold outline-none"
            />
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {meta}
            </div>
          </div>
        </div>
        <Button size="icon" variant="ghost" aria-label="删除节点" onClick={() => data.onDelete(node.id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {node.type === "reference" ? (
        <ReferenceNodeEditor node={node} onPickImage={data.onPickImage} onUpdate={data.onUpdate} />
      ) : node.type === "prompt" ? (
        <PromptNodeEditor node={node} onUpdate={data.onUpdate} />
      ) : (
        <GeneratedNodeEditor
          node={node}
          promptNode={data.promptNode}
          referenceCount={data.referenceCount}
          extras={data.extras}
          onUpdate={data.onUpdate}
          onUpdateExtras={data.onUpdateExtras}
          onGenerate={data.onGenerate}
          onStop={data.onStop}
          onUpscale={data.onUpscale}
          onSaveToProps={data.onSaveToProps}
        />
      )}
    </div>
  );
}, areNodeCardPropsEqual);

ImageStudioNodeCard.displayName = "ImageStudioNodeCard";

/** React Flow nodeTypes 注册(单一注册点,未来统一注册表从这里吸收) */
export const imageStudioNodeTypes = { imageStudio: ImageStudioNodeCard };

function ReferenceNodeEditor({
  node,
  onPickImage,
  onUpdate,
}: {
  node: ImageWorkflowReferenceNode;
  onPickImage: ImageStudioNodeData["onPickImage"];
  onUpdate: ImageStudioNodeData["onUpdate"];
}) {
  return (
    <div className="space-y-2">
      {node.imageUrl ? (
        <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
          <span className="relative flex h-full w-full">
            <LocalImage
              src={toPreviewSrc(node.imageUrl)}
              alt={node.title}
              className="h-full w-full object-cover"
              eager
              previewable
            />
            <ResolutionBadge src={toPreviewSrc(node.imageUrl)} />
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onPickImage(node.id)}
          className="nodrag nopan flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 text-muted-foreground transition-colors hover:border-info/50 hover:text-foreground"
        >
          <Upload className="h-5 w-5" />
          <span className="text-xs">上传参考图(图生图)</span>
        </button>
      )}
      <div className="flex items-center gap-2">
        <input
          value={node.imageUrl.startsWith("data:") ? "" : node.imageUrl}
          onChange={(event) => onUpdate(node.id, { imageUrl: event.target.value } as Partial<ImageWorkflowNode>)}
          placeholder="或粘贴图片地址 local-image:// / https://"
          className="nodrag nopan h-8 min-w-0 flex-1 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
        />
        {node.imageUrl ? (
          <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => onPickImage(node.id)}>
            <Upload className="mr-1 h-3.5 w-3.5" /> 更换
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PromptNodeEditor({
  node,
  onUpdate,
}: {
  node: ImageWorkflowPromptNode;
  onUpdate: ImageStudioNodeData["onUpdate"];
}) {
  return (
    <div className="space-y-3">
      <Textarea
        value={node.prompt}
        onChange={(event) => onUpdate(node.id, { prompt: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="描述要生成的图片"
        className="nodrag nopan min-h-[96px] [field-sizing:content] border-border bg-background/80 text-sm leading-6 text-foreground"
      />
      <Textarea
        value={node.negativePrompt ?? ""}
        onChange={(event) => onUpdate(node.id, { negativePrompt: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="反向提示词（可选）"
        className="nodrag nopan min-h-[48px] [field-sizing:content] border-border bg-background/80 text-xs leading-5 text-foreground"
      />
    </div>
  );
}

function GeneratedNodeEditor({
  node,
  promptNode,
  referenceCount,
  extras,
  onUpdate,
  onUpdateExtras,
  onGenerate,
  onStop,
  onUpscale,
  onSaveToProps,
}: {
  node: ImageWorkflowGeneratedNode;
  promptNode?: ImageWorkflowPromptNode;
  referenceCount: number;
  extras?: ImageStudioNodeData["extras"];
  onUpdate: ImageStudioNodeData["onUpdate"];
  onUpdateExtras: ImageStudioNodeData["onUpdateExtras"];
  onGenerate: ImageStudioNodeData["onGenerate"];
  onStop: ImageStudioNodeData["onStop"];
  onUpscale: ImageStudioNodeData["onUpscale"];
  onSaveToProps: ImageStudioNodeData["onSaveToProps"];
}) {
  const generating = node.status === "generating" || node.status === "queued";
  const elapsedSeconds = useElapsedSeconds(generating);
  const [imageLongSide, setImageLongSide] = useState(0);
  const alreadyUpscaled =
    (node.resultUrl || "").includes("up4x-") || imageLongSide > UPSCALE_INPUT_MAX_LONG_SIDE;
  const generationPrompt = promptNode ?? node;
  const updateGenerationPrompt = (
    updates: Partial<ImageWorkflowPromptNode | ImageWorkflowGeneratedNode>,
  ) => {
    onUpdate((promptNode ?? node).id, updates as Partial<ImageWorkflowNode>);
  };
  const model = node.model ?? promptNode?.model ?? "";
  const hasMidjourneyParams = /midjourney|^mj_|^niji-/i.test(model);
  const hasIdeogramParams = model.includes("ideogram");
  const referenceCapacity = referenceCapacityForModel(model);
  const referenceOverCapacity =
    referenceCapacity !== undefined && referenceCount > referenceCapacity;

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
              src={toPreviewSrc(node.resultUrl)}
              alt={node.title}
              className="h-full w-full object-cover"
              eager
              previewable
            />
            <ResolutionBadge src={toPreviewSrc(node.resultUrl)} />
          </span>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {node.status === "failed" ? node.errorReason || "生成失败" : "等待生成"}
          </div>
        )}
      </div>
      <div className="nodrag nopan grid grid-cols-[minmax(0,1fr)_76px_64px_86px] gap-2" data-image-studio-node-params>
        <ModelSelector
          type="image"
          value={model}
          onChange={(value) => onUpdate(node.id, { model: value, paramsEdited: true } as Partial<ImageWorkflowNode>)}
          className="w-full"
        />
        <select
          value={node.aspectRatio}
          onChange={(event) => onUpdate(node.id, { aspectRatio: event.target.value, paramsEdited: true } as Partial<ImageWorkflowNode>)}
          className="h-8 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
          aria-label="图片比例"
        >
          {ASPECT_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
        </select>
        <select
          value={node.resolution ?? ""}
          onChange={(event) => onUpdate(node.id, { resolution: event.target.value, paramsEdited: true } as Partial<ImageWorkflowNode>)}
          className="h-8 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
          aria-label="图片分辨率"
        >
          <option value="">自动</option>
          {RESOLUTION_OPTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
        </select>
        <select
          value={node.quality}
          onChange={(event) => onUpdate(node.id, { quality: event.target.value as ImageWorkflowGeneratedNode["quality"], paramsEdited: true } as Partial<ImageWorkflowNode>)}
          className="h-8 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
          aria-label="生成质量"
        >
          {QUALITY_OPTIONS.map((quality) => <option key={quality} value={quality}>{quality}</option>)}
        </select>
      </div>
      {hasMidjourneyParams ? (
        <div className="nodrag nopan grid grid-cols-3 gap-2" data-image-studio-node-extra-params>
          <select
            value={extras?.speed ?? "fast"}
            onChange={(event) => onUpdateExtras(node.id, { ...(extras ?? {}), speed: event.target.value })}
            className="h-8 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
            aria-label="Midjourney 速度"
          >
            <option value="relaxed">Relaxed</option>
            <option value="fast">Fast</option>
            <option value="turbo">Turbo</option>
          </select>
          <label className="flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-2 text-[11px] text-muted-foreground">
            风格化
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={extras?.stylization ?? 1}
              onChange={(event) => onUpdateExtras(node.id, { ...(extras ?? {}), stylization: Number(event.target.value) })}
              className="min-w-0 flex-1 accent-[hsl(var(--primary))]"
            />
          </label>
          <label className="flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-2 text-[11px] text-muted-foreground">
            怪异度
            <input
              type="range"
              min={0}
              max={3000}
              step={1}
              value={extras?.weirdness ?? 1}
              onChange={(event) => onUpdateExtras(node.id, { ...(extras ?? {}), weirdness: Number(event.target.value) })}
              className="min-w-0 flex-1 accent-[hsl(var(--primary))]"
            />
          </label>
        </div>
      ) : null}
      {hasIdeogramParams ? (
        <div className="nodrag nopan grid grid-cols-2 gap-2" data-image-studio-node-extra-params>
          <select
            value={extras?.render_speed ?? "Balanced"}
            onChange={(event) => onUpdateExtras(node.id, { ...(extras ?? {}), render_speed: event.target.value })}
            className="h-8 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
            aria-label="Ideogram 渲染速度"
          >
            <option value="Turbo">Turbo</option>
            <option value="Balanced">Balanced</option>
            <option value="Quality">Quality</option>
          </select>
          <select
            value={extras?.style ?? "Auto"}
            onChange={(event) => onUpdateExtras(node.id, { ...(extras ?? {}), style: event.target.value })}
            className="h-8 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
            aria-label="Ideogram 风格"
          >
            <option value="Auto">Auto</option>
            <option value="General">General</option>
            <option value="Realistic">Realistic</option>
            <option value="Design">Design</option>
          </select>
        </div>
      ) : null}
      {referenceCount > 0 && referenceCapacity !== undefined ? (
        <div
          className={cn(
            "nodrag nopan text-[11px]",
            referenceOverCapacity ? "text-warning" : "text-muted-foreground",
          )}
        >
          {referenceOverCapacity
            ? `已挂 ${referenceCount} 张参考图,当前引擎建议不超过 ${referenceCapacity} 张,可能生成失败`
            : `图生图:已挂 ${referenceCount}/${referenceCapacity} 张参考图`}
        </div>
      ) : referenceCount > 0 ? (
        <div className="nodrag nopan text-[11px] text-muted-foreground">
          图生图:已挂 {referenceCount} 张参考图
        </div>
      ) : (
        <div className="nodrag nopan text-[11px] text-muted-foreground">文生图:无参考图连线</div>
      )}
      <div className="nodrag nopan flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {node.status === "ready" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : null}
          {generating ? `${STATUS_LABELS[node.status]} · 已用 ${formatElapsedSeconds(elapsedSeconds)}` : STATUS_LABELS[node.status]}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onUpscale(node.id)}
            disabled={!node.resultUrl || generating || alreadyUpscaled}
            title={alreadyUpscaled ? "已是 4K 超分结果,无需再放大" : "本地 Real-ESRGAN 原生 ×4 放大"}
          >
            <ZoomIn className="h-3.5 w-3.5" />
            超分
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7"
            onClick={() => onSaveToProps(node.id)}
            disabled={!node.resultUrl}
            title="保存到道具库"
          >
            <Archive className="h-3.5 w-3.5" />
          </Button>
          {node.resultUrl ? (
            <Button size="icon" variant="outline" className="h-7 w-7" asChild title="下载图片">
              <a href={toPreviewSrc(node.resultUrl)} download target="_blank" rel="noopener">
                <Download className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null}
          {generating ? (
            <Button size="sm" variant="destructive" onClick={() => onStop(node.id)}>
              <Square className="mr-1 h-3.5 w-3.5" />
              停止
            </Button>
          ) : (
            <Button size="sm" variant="paid" onClick={() => onGenerate(node.id)}>
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              生成
            </Button>
          )}
        </div>
      </div>
      {!promptNode ? (
        <div className="nodrag nopan space-y-2 rounded-md border border-border bg-background/80 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <WandSparkles className="h-3.5 w-3.5 text-info" />
            提示词(未连线提示词节点,在此填写)
          </div>
          <Textarea
            value={generationPrompt.prompt}
            onChange={(event) => updateGenerationPrompt({ prompt: event.target.value })}
            placeholder="描述要生成的图片"
            className="min-h-[80px] [field-sizing:content] border-border bg-card/80 text-sm leading-6 text-foreground"
          />
          <Textarea
            value={generationPrompt.negativePrompt ?? ""}
            onChange={(event) => updateGenerationPrompt({ negativePrompt: event.target.value })}
            placeholder="反向提示词（可选）"
            className="min-h-[40px] [field-sizing:content] border-border bg-card/80 text-xs leading-5 text-foreground"
          />
        </div>
      ) : null}
      {generating && !node.resultUrl ? (
        <div className="nodrag nopan flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在生成 · 已用 {formatElapsedSeconds(elapsedSeconds)}
          <span className="text-[10px] opacity-70">(云端通常几十秒,本地大模型可能需要数分钟)</span>
        </div>
      ) : null}
    </div>
  );
}
