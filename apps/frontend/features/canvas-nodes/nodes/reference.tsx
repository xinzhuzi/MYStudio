// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Image, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LocalImage } from "@/components/ui/local-image";
import { ResolutionBadge } from "@/components/ui/image-resolution-badge";
import { Textarea } from "@/components/ui/textarea";
import { toPreviewSrc, withThumbVariant } from "@/lib/media/preview-src";
import type { ImageWorkflowNode, ImageWorkflowReferenceNode } from "@/types/studio";
import type { CanvasNodeDefinition } from "../node-registry";

/** 参考图节点定义(09-08 P2):输入类常显;编辑器内容由画布侧传(children) */
export const referenceNodeDefinition: CanvasNodeDefinition = {
  typeId: "reference",
  label: "参考图",
  icon: Image,
  iconClassName: "border-success/30 bg-success/10 text-success",
  width: 360,
  defaultExpanded: true,
  handles: [
    {
      kind: "source",
      label: "图",
      position: "Right",
      className: "border-success/40! bg-success/20!",
      title: "输出口:连到成图/无衣物图口作为参考",
    },
  ],
  summary: (node) => {
    const url = typeof node.imageUrl === "string" ? node.imageUrl : "";
    if (!url) return "空参考图(上传或拖图)";
    const tail = url.split("/").pop() ?? url;
    return `已挂图:${tail.slice(0, 36)}`;
  },
};

/**
 * 参考图编辑器(09-09 单源上提,两画布共用;差异经 props 注入):
 * - onPickImage 传入=图片工作室玩法(空态上传按钮+「更换」按钮);
 *   缺省=分镜画布玩法(空态占位框,地址整行输入)
 * - showNotes=分镜画布的「参考说明」备注框
 * - thumb=分镜画布大图走缩略变体(project-file/asset-file 省 4K 解码内存)
 */
export function ReferenceNodeEditor({
  node,
  onUpdate,
  onPickImage,
  showNotes,
  thumb,
  urlPlaceholder = "project-file://、local-image:// 或 https://",
}: {
  node: ImageWorkflowReferenceNode;
  onUpdate: (nodeId: string, updates: Partial<ImageWorkflowNode>) => void;
  onPickImage?: (nodeId: string) => void;
  showNotes?: boolean;
  thumb?: boolean;
  urlPlaceholder?: string;
}) {
  const previewSrc = toPreviewSrc(node.imageUrl);
  return (
    <div className="space-y-2">
      {node.imageUrl ? (
        <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
          <span className="relative flex h-full w-full">
            <LocalImage
              src={thumb ? withThumbVariant(previewSrc) : previewSrc}
              alt={node.title}
              className="h-full w-full object-cover"
              eager
              previewable
            />
            <ResolutionBadge src={previewSrc} />
          </span>
        </div>
      ) : onPickImage ? (
        <button
          type="button"
          onClick={() => onPickImage(node.id)}
          className="nodrag nopan flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 text-muted-foreground transition-colors hover:border-info/50 hover:text-foreground"
        >
          <Upload className="h-5 w-5" />
          <span className="text-xs">上传参考图(图生图)</span>
        </button>
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">暂无图片</div>
      )}
      {onPickImage ? (
        <div className="flex items-center gap-2">
          <input
            value={node.imageUrl.startsWith("data:") ? "" : node.imageUrl}
            onChange={(event) => onUpdate(node.id, { imageUrl: event.target.value } as Partial<ImageWorkflowNode>)}
            placeholder={urlPlaceholder}
            className="nodrag nopan h-9 min-w-0 flex-1 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
          />
          {node.imageUrl ? (
            <Button size="sm" variant="outline" className="h-9 shrink-0" onClick={() => onPickImage(node.id)}>
              <Upload className="mr-1 h-3.5 w-3.5" /> 更换
            </Button>
          ) : null}
        </div>
      ) : (
        <input
          value={node.imageUrl}
          onChange={(event) => onUpdate(node.id, { imageUrl: event.target.value } as Partial<ImageWorkflowNode>)}
          placeholder={urlPlaceholder}
          className="nodrag nopan h-9 w-full rounded-md border border-border bg-background/80 px-2 text-xs text-foreground outline-none"
        />
      )}
      {showNotes ? (
        <Textarea
          value={node.notes ?? ""}
          onChange={(event) => onUpdate(node.id, { notes: event.target.value } as Partial<ImageWorkflowNode>)}
          placeholder="参考说明"
          className="nodrag nopan min-h-[58px] [field-sizing:content] border-border bg-background/80 text-xs text-foreground"
        />
      ) : null}
    </div>
  );
}
