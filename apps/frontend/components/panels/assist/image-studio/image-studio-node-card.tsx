// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useCanvasDraftValue } from "./image-studio-draft-input";
import { MentionPicker } from "./mention-picker";
import { buildMentionToken, mentionTriggerState, type MentionCandidate } from "@/lib/studio/image-workflow/mention-token";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Sparkles,
  Square,
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
import { effectiveBatchImages } from "./image-studio-batch";
import { toPreviewSrc } from "@/lib/media/preview-src";
import { UPSCALE_INPUT_MAX_LONG_SIDE } from "@/lib/upscale/client";
import { cn } from "@/lib/utils";
import type {
  ImageWorkflowGeneratedNode,
  ImageWorkflowGroupNode,
  ImageWorkflowNode,
  ImageWorkflowPromptNode,
  ImageWorkflowReferenceNode,
  ImageWorkflowStickyNode,
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
  /** 参考图节点在其所连成图参考序列中的编号(1 起;未连线=缺省)——
   *  与生图请求的数组顺序同源(reference-order 单源,AI 按数组序识别) */
  referenceIndex?: number;
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

export const ImageStudioNodeCard = memo(function ImageStudioNodeCard({
  data,
}: NodeProps<ImageStudioReactNode>) {
  const node = data.node;
  const borderClass = data.selected
    ? "border-primary/70 shadow-[0_0_0_1px_hsl(var(--primary)/0.35),0_6px_20px_rgba(0,0,0,0.28)]"
    : node.type === "generated" && node.status === "ready"
      ? "border-success/45"
      : "border-border";
  const meta =
    node.type === "reference"
      ? data.referenceIndex
        ? `参考图 ${data.referenceIndex}`
        : "参考图"
      : node.type === "prompt"
        ? "提示词"
        : node.type === "sticky"
          ? "便利贴"
          : node.type === "group"
            ? `分组${node.memberIds.length ? ` · ${node.memberIds.length} 节点` : ""}`
            : "成图";

  return (
    <div
      data-image-studio-node-kind={node.type}
      className={cn(
        "[contain:layout_style]",
        "image-workflow-node-card group/node rounded-xl border bg-card/96 p-3.5 text-card-foreground",
        "shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition-[border-color,box-shadow] duration-200",
        "hover:border-border/90 hover:shadow-[0_4px_16px_rgba(0,0,0,0.22)]",
        node.type === "reference"
          ? "w-[360px]"
          : node.type === "prompt"
            ? "w-[480px]"
            : node.type === "sticky"
              ? "w-[240px]"
              : node.type === "group"
                ? "w-[480px]"
                : "w-[560px]",
        borderClass,
      )}
    >
      {node.type === "generated" ? (
        <Handle
          type="target"
          position={Position.Left}
          className="!h-3 !w-3 !border-info/40 !bg-info/20"
          title="输入口:上游参考图/提示词连到这里"
        />
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-info/40 !bg-info/20"
        title="输出口:拖出去连下游成图,或拖到空白处快速建节点"
      />
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
              node.type === "reference"
                ? "border-success/30 bg-success/10 text-success"
                : node.type === "prompt"
                  ? "border-info/30 bg-info/10 text-info"
                  : "border-primary/30 bg-primary/10 text-primary",
            )}
          >
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
              title="节点标题(双击画布空白处可新建节点)"
              className="nodrag nopan w-full truncate bg-transparent text-sm font-semibold outline-none"
            />
            {/* 09-02 对比度根修:副标题原 text-muted-foreground 在深色卡上近乎不可见
                (VLM 实拍透明度估 30-40%),升到 foreground/70 保次级层级且可读 */}
            <div
              className={cn(
                "mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em]",
                node.type === "reference"
                  ? "text-success/80"
                  : node.type === "prompt"
                    ? "text-info/80"
                    : "text-primary/80",
              )}
            >
              {meta}
            </div>
          </div>
        </div>
        {/* 09-02 用户终裁:删除只走右键菜单(复制/删除),节点卡不设删除按钮 */}
      </div>
      {node.type === "reference" ? (
        <ReferenceNodeEditor node={node} onPickImage={data.onPickImage} onUpdate={data.onUpdate} />
      ) : node.type === "prompt" ? (
        <PromptNodeEditor node={node} onUpdate={data.onUpdate} />
      ) : node.type === "sticky" ? (
        <StickyNoteEditor node={node} onUpdate={data.onUpdate} />
      ) : node.type === "group" ? (
        <GroupEditor node={node} onUpdate={data.onUpdate} />
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
          className="nodrag nopan h-9 min-w-0 flex-1 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
        />
        {node.imageUrl ? (
          <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => onPickImage(node.id)}>
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
  // 草稿态终局(09-02 光标跳末尾/输入法连环案):编辑期间本地持有值,store
  // 防抖提交——受控写回消失,光标/删除/输入法天然正常(composing 仅服务
  // @浮层的 IME 门控,不再参与 value 控制)。
  const [composing, setComposing] = useState(false);
  const promptInput = useCanvasDraftValue({
    committed: node.prompt,
    commit: (value) => onUpdate(node.id, { prompt: value } as Partial<ImageWorkflowNode>),
  });
  const negativeInput = useCanvasDraftValue({
    committed: node.negativePrompt ?? "",
    commit: (value) => onUpdate(node.id, { negativePrompt: value } as Partial<ImageWorkflowNode>),
  });
  // @引用浮层(09-02-at-mention-refs):候选=同图全部节点;组合期不触发(IME 兼容)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [mention, setMention] = useState<{ x: number; y: number; query: string } | null>(null);
  // 候选量级=画布节点数(数十),浮层打开才渲染计算,不设 memo(避免 deps 复杂表达式)
  const mentionCandidates: MentionCandidate[] = mention
    ? (selectActiveImageStudioWorkflow(useImageStudioStore.getState())?.nodes ?? [])
        .filter((candidate) => candidate.id !== node.id)
        .map((candidate) => ({
          id: candidate.id,
          type: candidate.type,
          title: candidate.title,
          thumbUrl:
            candidate.type === "reference" || candidate.type === "generated"
              ? (candidate.type === "reference" ? candidate.imageUrl : candidate.resultUrl) || undefined
              : undefined,
          summary: candidate.type === "prompt" ? candidate.prompt.slice(0, 24) : undefined,
        }))
    : [];
  const syncMention = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const state = mentionTriggerState(textarea.value, textarea.selectionStart ?? 0);
    if (!state.active || composing) return setMention(null);
    const rect = textarea.getBoundingClientRect();
    setMention({ x: 8, y: rect.height + 4, query: state.query });
  };
  return (
    <div className="relative space-y-3">
      <Textarea
        ref={textareaRef}
        value={promptInput.value}
        onChange={(event) => {
          promptInput.onChange(event.target.value);
          syncMention();
        }}
        onBlur={promptInput.onBlur}
        onKeyUp={syncMention}
        onClick={syncMention}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        placeholder="描述要生成的图片(@ 引用资源)"
        className="nodrag nopan min-h-[96px] [field-sizing:content] border-border bg-background/80 text-sm leading-6 text-foreground"
      />
      {mention ? (
        <MentionPicker
          x={mention.x}
          y={mention.y}
          query={mention.query}
          candidates={mentionCandidates}
          onPick={(candidate) => {
            const textarea = textareaRef.current;
            setMention(null);
            if (!textarea) return;
            const before = textarea.value.slice(0, textarea.selectionStart ?? 0);
            const after = textarea.value.slice(textarea.selectionStart ?? 0);
            const at = before.lastIndexOf("@");
            if (at < 0) return;
            const token = `${buildMentionToken(candidate)} `;
            const next = `${before.slice(0, at)}${token}${after}`;
            promptInput.setValue(next);
          }}
          onClose={() => setMention(null)}
        />
      ) : null}
      <Textarea
        value={negativeInput.value}
        onChange={(event) => negativeInput.onChange(event.target.value)}
        onBlur={negativeInput.onBlur}
        placeholder="反向提示词（可选）"
        className="nodrag nopan min-h-[48px] [field-sizing:content] border-border bg-background/80 text-xs leading-5 text-foreground"
      />
    </div>
  );
}

/**
 * 批量图片组渲染(09-02 用户终裁):图片上左右箭头切图,右下角当前序号;
 * 不做叠卡/展开网格/张数角标。主图切换=翻页即切(setBatchPrimary 同步
 * resultUrl,组外消费零改动)。
 */
function BatchImageArea({
  node,
}: {
  node: ImageWorkflowGeneratedNode;
}) {
  const [viewIndex, setViewIndex] = useState(0);
  // 生效组(不变量见 effectiveBatchImages):超分/单张重生成后旧 batch 不再显示
  const images = effectiveBatchImages(node);
  // 图片数变化(重新生成)时钳回有效范围
  const safeIndex = Math.min(viewIndex, Math.max(0, images.length - 1));
  const current = images[safeIndex] ?? node.resultUrl ?? "";

  if (!node.resultUrl) {
    return (
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
        <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
          {/* 失败原因不进卡(09-03 用户裁定:弹窗呈现);占位保持中性文案 */}
          等待生成
        </div>
      </div>
    );
  }

  const isGroup = images.length > 1;

  return (
    <div className="nodrag nopan relative">
      <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
        <span className="relative flex h-full w-full">
          <LocalImage
            src={toPreviewSrc(current)}
            alt={`${node.title} ${safeIndex + 1}`}
            className="h-full w-full object-cover"
            eager
            previewable
            previewImages={images.length > 1 ? images.map((url) => toPreviewSrc(url)) : undefined}
            previewIndex={images.length > 1 ? safeIndex : undefined}
          />
          <ResolutionBadge src={toPreviewSrc(current)} />
        </span>
      </div>
      {isGroup ? (
        <>
          <button
            type="button"
            aria-label="上一张"
            disabled={safeIndex === 0}
            className="absolute left-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-border/60 bg-card/85 text-card-foreground backdrop-blur-sm transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70 disabled:pointer-events-none disabled:opacity-0"
            onClick={() => setViewIndex(safeIndex - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="下一张"
            disabled={safeIndex === images.length - 1}
            className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-border/60 bg-card/85 text-card-foreground backdrop-blur-sm transition-colors duration-75 hover:bg-accent hover:text-accent-foreground active:bg-accent/70 disabled:pointer-events-none disabled:opacity-0"
            onClick={() => setViewIndex(safeIndex + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {/* 右下角轻序号:当前/总数,当前张即主图(resultUrl 同步) */}
          <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium tabular-nums text-primary-foreground backdrop-blur-sm">
            {safeIndex + 1} / {images.length}
          </span>
        </>
      ) : null}
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
  const [imageLongSide, setImageLongSide] = useState(0);
  // 生效组整组图(保存/下载都以组为单位;超分/单张重生成后旧组回落主图)
  const batchImages = effectiveBatchImages(node);
  const downloadAllImages = () => {
    const total = batchImages.length;
    if (total === 0) return;
    const width = String(total).length;
    // Electron 下载正路=原生另存对话框(媒体库同款):local-image:// 协议
    // 响应无 Content-Disposition,<a download> 对其不可靠(深审 P1-3);
    // 多张=逐张弹原生对话框,defaultPath 预填顺序编号,取消即停后续。
    if (typeof window !== "undefined" && window.electronAPI?.saveFileDialog) {
      const saveViaDialog = window.electronAPI.saveFileDialog;
      void (async () => {
        for (let index = 0; index < total; index += 1) {
          const suffix = total > 1 ? `-${String(index + 1).padStart(width, "0")}` : "";
          const result = await saveViaDialog({
            localPath: batchImages[index],
            defaultPath: `图片${suffix}.png`,
            filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
          });
          if (!result?.success) return;
        }
      })();
      return;
    }
    // 浏览器回退:锚点错峰下载
    batchImages.forEach((url, index) => {
      const anchor = document.createElement("a");
      anchor.href = toPreviewSrc(url);
      anchor.target = "_blank";
      anchor.rel = "noopener";
      // 多张=自动顺序编号文件名;单张=浏览器/协议侧默认命名(与旧行为一致)
      anchor.download = total > 1 ? `图片-${String(index + 1).padStart(width, "0")}.png` : "";
      window.setTimeout(() => anchor.click(), index * 200);
    });
  };
  const alreadyUpscaled =
    (node.resultUrl || "").includes("up4x-") || imageLongSide > UPSCALE_INPUT_MAX_LONG_SIDE;
  const generationPrompt = promptNode ?? node;
  const genPromptInput = useCanvasDraftValue({
    committed: generationPrompt.prompt,
    commit: (value) => onUpdate((promptNode ?? node).id, { prompt: value } as Partial<ImageWorkflowNode>),
  });
  const genNegativeInput = useCanvasDraftValue({
    committed: generationPrompt.negativePrompt ?? "",
    commit: (value) => onUpdate((promptNode ?? node).id, { negativePrompt: value } as Partial<ImageWorkflowNode>),
  });
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
      <BatchImageArea node={node} />
      <div className="nodrag nopan grid grid-cols-[minmax(0,1fr)_64px_64px_64px] gap-1.5" data-image-studio-node-params>
        <ModelSelector
          type="image"
          value={model}
          onChange={(value) => onUpdate(node.id, { model: value, paramsEdited: true } as Partial<ImageWorkflowNode>)}
          className="h-9 w-full"
        />
        <select
          value={node.aspectRatio}
          onChange={(event) => onUpdate(node.id, { aspectRatio: event.target.value, paramsEdited: true } as Partial<ImageWorkflowNode>)}
          className="h-9 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
          aria-label="图片比例"
        >
          {ASPECT_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
        </select>
        <select
          value={node.resolution ?? ""}
          onChange={(event) => onUpdate(node.id, { resolution: event.target.value, paramsEdited: true } as Partial<ImageWorkflowNode>)}
          className="h-9 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
          aria-label="图片分辨率"
        >
          <option value="">自动</option>
          {RESOLUTION_OPTIONS.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
        </select>
        <select
          value={String(extras?.count ?? 1)}
          onChange={(event) => onUpdateExtras(node.id, { ...(extras ?? {}), count: Number(event.target.value) })}
          className="h-9 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
          aria-label="生成张数"
          title="一次生成多张聚为图片组"
        >
          {[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} 张</option>)}
        </select>
      </div>
      {hasMidjourneyParams ? (
        <div className="nodrag nopan grid grid-cols-3 gap-2" data-image-studio-node-extra-params>
          <select
            value={extras?.speed ?? "fast"}
            onChange={(event) => onUpdateExtras(node.id, { ...(extras ?? {}), speed: event.target.value })}
            className="h-9 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
            aria-label="Midjourney 速度"
          >
            <option value="relaxed">Relaxed</option>
            <option value="fast">Fast</option>
            <option value="turbo">Turbo</option>
          </select>
          <label className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-card/80 px-2 text-[11px] text-muted-foreground">
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
          <label className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-card/80 px-2 text-[11px] text-muted-foreground">
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
            className="h-9 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
            aria-label="Ideogram 渲染速度"
          >
            <option value="Turbo">Turbo</option>
            <option value="Balanced">Balanced</option>
            <option value="Quality">Quality</option>
          </select>
          <select
            value={extras?.style ?? "Auto"}
            onChange={(event) => onUpdateExtras(node.id, { ...(extras ?? {}), style: event.target.value })}
            className="h-9 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
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
        <div className="nodrag nopan flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <ImageIcon className="h-3 w-3 text-success/70" aria-hidden />
          已挂 {referenceCount} 张参考图
        </div>
      ) : (
        <span className="sr-only">纯文生图,拖参考图节点连线可挂图</span>
      )}
      {/* 状态零上卡(09-03 用户裁定):生成中/失败提示都不放节点卡——
          生成按钮自身承载状态(生成↔停止切换);失败走画布层弹窗。
          状态行与计时器已撤,顺带消掉 React Flow 容器内每秒重渲。 */}
      {/* 操作行:超分/保存/下载/生成(或停止)一行等宽排布(09-03 用户裁定:
          四钮一行、横向等宽;主次分层靠颜色——生成保留金色,不再靠宽度) */}
      <div className="nodrag nopan flex items-center gap-2">
        <Button
          variant="outline"
          className="h-9 flex-1 rounded-lg"
          onClick={() => onUpscale(node.id)}
          disabled={!node.resultUrl || generating || alreadyUpscaled}
          title={alreadyUpscaled ? "已是 4K 超分结果,无需再放大" : "超分:本地 Real-ESRGAN ×4 放大"}
          aria-label="超分"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          className="h-9 flex-1 rounded-lg"
          onClick={() => onSaveToProps(node.id)}
          disabled={!node.resultUrl}
          title={
            batchImages.length > 1
              ? `保存 ${batchImages.length} 张到道具库(每张自动编号)`
              : "保存到道具库"
          }
          aria-label="保存到道具库"
        >
          <Archive className="h-3.5 w-3.5" />
        </Button>
        {node.resultUrl ? (
          <Button
            variant="outline"
            className="h-9 flex-1 rounded-lg"
            onClick={downloadAllImages}
            title={batchImages.length > 1 ? `下载全部 ${batchImages.length} 张(自动编号)` : "下载图片"}
            aria-label="下载图片"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {generating ? (
          <Button
            variant="destructive"
            className="h-9 flex-1"
            onClick={() => onStop(node.id)}
            title="中断本次生成(已计费的请求可能无法退款)"
          >
            <Square className="mr-1.5 h-3.5 w-3.5" />
            停止
          </Button>
        ) : (
          <Button
            variant="paid"
            className="h-9 flex-1"
            onClick={() => onGenerate(node.id)}
            title="按当前提示词+参考图生成图片(云端按张计费;张数在上方下拉选)"
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            生成
          </Button>
        )}
      </div>
      {!promptNode ? (
        <div className="nodrag nopan space-y-2 rounded-md border border-border bg-background/80 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <WandSparkles className="h-3.5 w-3.5 text-info" />
            提示词(未连线提示词节点,在此填写)
          </div>
          <Textarea
            value={genPromptInput.value}
            onChange={(event) => genPromptInput.onChange(event.target.value)}
            onBlur={genPromptInput.onBlur}
            placeholder="描述要生成的图片"
            className="min-h-[80px] [field-sizing:content] border-border bg-card/80 text-sm leading-6 text-foreground"
          />
          <Textarea
            value={genNegativeInput.value}
            onChange={(event) => genNegativeInput.onChange(event.target.value)}
            onBlur={genNegativeInput.onBlur}
            placeholder="反向提示词（可选）"
            className="min-h-[40px] [field-sizing:content] border-border bg-card/80 text-xs leading-5 text-foreground"
          />
        </div>
      ) : null}
    </div>
  );
}


const STICKY_COLORS: Array<{ value: NonNullable<ImageWorkflowStickyNode["color"]>; label: string; chip: string; card: string }> = [
  { value: "yellow", label: "黄", chip: "bg-yellow-300/90", card: "border-yellow-300/40 bg-yellow-200/12" },
  { value: "green", label: "绿", chip: "bg-green-300/90", card: "border-green-300/40 bg-green-200/12" },
  { value: "blue", label: "蓝", chip: "bg-blue-300/90", card: "border-blue-200/12" },
  { value: "pink", label: "粉", chip: "bg-pink-300/90", card: "border-pink-200/12" },
  { value: "gray", label: "灰", chip: "bg-gray-300/90", card: "border-gray-300/40 bg-gray-200/12" },
];

/** 便利贴编辑器(09-03 wave3):换色+文本;无连线手柄(标注件,不进生成图) */
function StickyNoteEditor({
  node,
  onUpdate,
}: {
  node: ImageWorkflowStickyNode;
  onUpdate: ImageStudioNodeData["onUpdate"];
}) {
  const palette = STICKY_COLORS.find((item) => item.value === node.color) ?? STICKY_COLORS[0];
  return (
    <div className="space-y-1.5">
      <Textarea
        value={node.text}
        onChange={(event) => onUpdate(node.id, { text: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="备注/待办/导演笔记…"
        className="nodrag nopan min-h-[72px] [field-sizing:content] border-transparent bg-transparent text-xs leading-5 text-foreground"
      />
      <div className="flex items-center gap-1">
        {STICKY_COLORS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-label={`便利贴换${item.label}色`}
            title={`换${item.label}色`}
            className={cn(
              "h-4 w-4 rounded-full border transition-transform duration-75 hover:scale-110",
              item.chip,
              node.color === item.value ? "border-foreground/70 scale-110" : "border-transparent",
            )}
            onClick={() => onUpdate(node.id, { color: item.value } as Partial<ImageWorkflowNode>)}
          />
        ))}
      </div>
      <span className="sr-only">{palette.label}</span>
    </div>
  );
}

/** Group 编辑器(09-03 wave3):改标签+成员计数;容器语义,成员拖入吸附在画布层实现 */
function GroupEditor({
  node,
  onUpdate,
}: {
  node: ImageWorkflowGroupNode;
  onUpdate: ImageStudioNodeData["onUpdate"];
}) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <input
        value={node.title}
        onChange={(event) => onUpdate(node.id, { title: event.target.value } as Partial<ImageWorkflowNode>)}
        placeholder="分组名"
        className="nodrag nopan h-8 w-full rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold text-foreground outline-none focus:border-border"
      />
      <p>把节点拖进组内自动入组;移动组会带动成员。</p>
    </div>
  );
}
