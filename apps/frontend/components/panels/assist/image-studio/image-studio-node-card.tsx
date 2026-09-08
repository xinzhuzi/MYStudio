// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
import {
  selectActiveImageStudioWorkflow,
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";
import type { MentionCandidate } from "@/lib/studio/image-workflow/mention-token";
import {
  Archive,
  Download,
  Sparkles,
  Square,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UnclothNodeEditor } from "@/components/ui/uncloth-node-editor";
import {
  BatchImageArea,
  CANVAS_NODE_DEFINITIONS,
  CanvasNodeShell,
  GeneratedNodeEditor as GeneratedNodeEditorShell,
  PromptNodeEditor,
  ReferenceNodeEditor,
} from "@/features/canvas-nodes";
import { NsfwNodeEditor } from "@/components/ui/nsfw-node-editor";
import { ModelSelector } from "@/components/panels/assist/ModelSelector";
import { IMAGE_ASPECT_RATIOS, IMAGE_RESOLUTIONS } from "@/lib/ai/image-size-presets";
import { referenceCapacityForModel } from "./image-studio-node-registry";
import { effectiveBatchImages } from "./image-studio-batch";
import { toPreviewSrc } from "@/lib/media/preview-src";
import { cn } from "@/lib/utils";
import type {
  ImageWorkflowGeneratedNode,
  ImageWorkflowGroupNode,
  ImageWorkflowNode,
  ImageWorkflowPromptNode,
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
  /** 成图节点的无衣物链上游(09-04):提示词经链传入,不显示兜底输入框 */
  hasUnclothUpstream?: boolean;
  /** 成图节点的 NSFW破限链上游(09-07):提示词经破限节点传入,不显示兜底输入框 */
  hasNsfwUpstream?: boolean;
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
  // 09-08 框架化(P1 试点):声明式定义的节点类型整卡走通用壳——折叠+摘要
  // 为框架底层能力;未迁移类型(reference/prompt/uncloth/generated/group)暂走下方旧路径
  const shellDefinition = CANVAS_NODE_DEFINITIONS[node.type];
  if (shellDefinition) {
    return (
      <CanvasNodeShell
        definition={shellDefinition}
        node={node}
        selected={data.selected}
        titleOverride={node.type === "reference" && data.referenceIndex ? `参考图 ${data.referenceIndex}` : undefined}
        dataKindAttr="data-image-studio-node-kind"
        onResizeEnd={(width) => useImageStudioStore.getState().setNodeWidth(node.id, width)}
        footer={
          node.type === "nsfw" ? <NsfwNodeEditor node={node} />
          : node.type === "uncloth" ? <UnclothNodeEditor node={node} onUpdate={data.onUpdate} />
          : undefined
        }
      >
        {node.type === "sticky" ? <StickyNoteEditor node={node} onUpdate={data.onUpdate} /> : null}
        {node.type === "group" ? <GroupEditor node={node} onUpdate={data.onUpdate} /> : null}
        {node.type === "reference" ? (
          <ReferenceNodeEditor
            node={node}
            onPickImage={data.onPickImage}
            onUpdate={data.onUpdate}
            urlPlaceholder="或粘贴图片地址 local-image:// / https://"
          />
        ) : null}
        {node.type === "prompt" ? (
          <PromptNodeEditor
            node={node}
            onUpdate={data.onUpdate}
            getMentionCandidates={() => assistMentionCandidates(node.id)}
            promptPlaceholder="描述要生成的图片(@ 引用资源)"
            promptMinClass="min-h-[96px]"
            negativeMinClass="min-h-[48px]"
          />
        ) : null}
        {node.type === "generated" ? (
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
        ) : null}
      </CanvasNodeShell>
    );
  }

  return null; // 09-08 P3:全部节点类型已声明化,此路径不可达
}, areNodeCardPropsEqual);

ImageStudioNodeCard.displayName = "ImageStudioNodeCard";

/** React Flow nodeTypes 注册(单一注册点,未来统一注册表从这里吸收) */
export const imageStudioNodeTypes = { imageStudio: ImageStudioNodeCard };

/** @引用候选(图片工作室侧):当前画布全部节点(自身除外);浮层打开时才调用 */
function assistMentionCandidates(excludeId: string): MentionCandidate[] {
  return (selectActiveImageStudioWorkflow(useImageStudioStore.getState())?.nodes ?? [])
    .filter((candidate) => candidate.id !== excludeId)
    .map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      title: candidate.title,
      thumbUrl:
        candidate.type === "reference" || candidate.type === "generated"
          ? (candidate.type === "reference" ? candidate.imageUrl : candidate.resultUrl) || undefined
          : undefined,
      summary: candidate.type === "prompt" ? candidate.prompt.slice(0, 24) : undefined,
    }));
}

/**
 * 成图编辑器(图片工作室版,09-09 编辑器上提后=共享骨架+画布差异注入):
 * 图区=批量组;参数行=四列(含张数)+专属参数(MJ/Ideogram);操作行=
 * 超分/保存道具/下载/生成↔停止(带参考角标)。共享件在 features/canvas-nodes。
 */
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
  const model = node.model ?? promptNode?.model ?? "";
  const hasMidjourneyParams = /midjourney|^mj_|^niji-/i.test(model);
  const hasIdeogramParams = model.includes("ideogram");
  const referenceCapacity = referenceCapacityForModel(model);
  const referenceOverCapacity =
    referenceCapacity !== undefined && referenceCount > referenceCapacity;

  return (
    <GeneratedNodeEditorShell
      node={node}
      imageArea={<BatchImageArea node={node} images={batchImages} />}
      paramsRow={
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
      }
      // 操作行:超分/保存/下载/生成(或停止)一行等宽排布(09-03 用户裁定:
      // 四钮一行、横向等宽;主次分层靠颜色——生成保留金色,不再靠宽度)
      actionsRow={({ generating, alreadyUpscaled }) => (
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
              className="relative h-9 flex-1"
              onClick={() => onGenerate(node.id)}
              title={
                referenceCount > 0
                  ? `图生图:已挂 ${referenceCount}${referenceCapacity ? `/${referenceCapacity}` : ""} 张参考图,点击生成`
                  : "按当前提示词生成图片(拖参考图节点连线可挂图)"
              }
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              生成
              {/* 参考图状态角标(09-03 用户裁定:不进文案不占布局——右上角
                  外沿浮空徽章,按钮宽度恒定);超容量转警示色 */}
              {referenceCount > 0 ? (
                <span
                  aria-label={`已挂 ${referenceCount} 张参考图`}
                  className={cn(
                    "absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-semibold leading-none",
                    referenceOverCapacity ? "bg-warning text-warning-foreground" : "bg-primary-foreground/95 text-primary",
                  )}
                >
                  {referenceCount}
                </span>
              ) : null}
            </Button>
          )}
        </div>
        )}
    >
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
      {/* 参考图状态收进生成按钮(09-03 用户裁定:独立计数行撤,按钮放宽
          带文案);仅超容量异常态保留行内警告(正常态零占行) */}
      {referenceOverCapacity ? (
        <div className="nodrag nopan text-[11px] text-warning">
          已挂 {referenceCount} 张参考图,当前引擎建议不超过 {referenceCapacity} 张,可能生成失败
        </div>
      ) : (
        <span className="sr-only">
          {referenceCount > 0 ? `图生图:已挂 ${referenceCount} 张参考图` : "纯文生图,拖参考图节点连线可挂图"}
        </span>
      )}
      {/* 状态零上卡(09-03 用户裁定):生成中/失败提示都不放节点卡——
          生成按钮自身承载状态(生成↔停止切换);失败走画布层弹窗。
          状态行与计时器已撤,顺带消掉 React Flow 容器内每秒重渲。 */}
    </GeneratedNodeEditorShell>
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
