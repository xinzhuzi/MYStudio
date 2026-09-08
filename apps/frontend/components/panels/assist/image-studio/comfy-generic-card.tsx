// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useMemo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { LocalImage } from "@/components/ui/local-image";
import { ComfyGenericNodeCard, type ComfyGenericPortDef } from "@/components/ui/comfy/comfy-generic-node-card";
import type { ComfyWidgetSchema } from "@/components/ui/comfy/comfy-widget-controls";
import { comfyPortCssColor } from "@/components/ui/comfy/comfy-port-colors";
import { CanvasNodeShell, comfyGenericNodeDefinition } from "@/features/canvas-nodes";
import { toPreviewSrc } from "@/lib/media/preview-src";
import { useImageStudioStore } from "@/stores/assist/image-studio-store";
import type { ImageStudioNodeData } from "./image-studio-node-card";
import type { ImageWorkflowComfyGenericNode } from "@/types/studio";

/**
 * ComfyUI 通用节点卡(09-08 三期收官,流X):ComfyGenericNodeCard 全量渲染
 * (端口明细+五类控件高级折叠)+ 动态 React Flow Handle(按 descriptor 端口
 * 沿左右边均布,口色=ComfyUI 语义色)+ 子图运行结果回显区。
 * 出图经「运行子图」(工具菜单)整选区执行,本卡不单独运行。
 */

type ComfyGenericReactNode = Node<ImageStudioNodeData>;

function areComfyGenericCardPropsEqual(
  prev: NodeProps<ComfyGenericReactNode>,
  next: NodeProps<ComfyGenericReactNode>,
) {
  return (
    prev.id === next.id
    && prev.data === next.data
    && prev.selected === next.selected
    && prev.dragging === next.dragging
    && prev.positionAbsoluteX === next.positionAbsoluteX
    && prev.positionAbsoluteY === next.positionAbsoluteY
  );
}

/**
 * 动态口(09-09 照 ComfyUI 节点布局根修):Handle 不再沿边缘百分比均布
 * (旧版连线点与端口名互不对齐),改为经 handleRenderer 锚进端口行——
 * React Flow 按真实 DOM 位置锚边,连线点=视觉色点。输入口 id=输入 key
 * (边 targetHandle),输出口 id=槽位序号(边 sourceHandle)。
 */
function rowHandle(port: ComfyGenericPortDef) {
  const isInput = port.side === "input";
  return (
    <Handle
      type={isInput ? "target" : "source"}
      id={port.id}
      position={isInput ? Position.Left : Position.Right}
      style={{
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        ...(isInput ? { left: "-6px" } : { right: "-6px" }),
        backgroundColor: comfyPortCssColor(port.type),
      }}
      className="h-3! w-3!"
      title={`${port.label}(${port.type})${isInput ? "输入" : "输出"}口`}
    />
  );
}

function ResultArea({ node }: { node: ImageWorkflowComfyGenericNode }) {
  if (node.status === "failed" && node.statusMessage) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] leading-4 text-destructive" data-comfy-node-error>
        {node.statusMessage}
      </div>
    );
  }
  if (!node.resultUrl) return null;
  return (
    <div className="nodrag nopan aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
      <LocalImage
        src={toPreviewSrc(node.resultUrl)}
        alt={node.title}
        className="h-full w-full object-cover"
        eager
        previewable
      />
    </div>
  );
}

export const ComfyGenericCard = memo(function ComfyGenericCard({
  data,
  selected,
}: NodeProps<ComfyGenericReactNode>) {
  const fallback = data.node as ImageWorkflowComfyGenericNode;
  // 卡面活数据(子图运行回写经 store;props data.node 兜底)
  const node = useImageStudioStore((state) => {
    for (const workflow of state.workflows) {
      const found = workflow.nodes.find((item) => item.id === fallback.id);
      if (found && found.type === "comfy-generic") return found;
    }
    return undefined;
  }) ?? fallback;
  const setWidgetValue = useImageStudioStore((state) => state.setComfyNodeWidgetValue);
  const ports = useMemo<ComfyGenericPortDef[]>(
    () => node.descriptor.ports.map((port) => ({ ...port })),
    [node.descriptor.ports],
  );
  const widgets = useMemo<ComfyWidgetSchema[]>(
    () =>
      node.descriptor.widgets.map((widget) => ({
        id: widget.id,
        label: widget.label,
        zhLabel: widget.zhLabel,
        type: widget.type,
        default: widget.default,
        min: widget.min,
        max: widget.max,
        step: widget.step,
        options: widget.options,
        placeholder: widget.placeholder,
      })),
    [node.descriptor.widgets],
  );
  const values = node.widgetValues as Record<string, number | string | boolean> | undefined;
  const body = useMemo(
    () => (
      <div className="mt-2 space-y-2">
        <ComfyGenericNodeCard
          titleEn={node.classType}
          badge={node.classType}
          ports={ports}
          widgets={widgets}
          values={values}
          onWidgetChange={(widgetId, value) => setWidgetValue(node.id, widgetId, value)}
          handleRenderer={rowHandle}
          // 内嵌壳内:去整框降为面板样式(壳已持外框,避免双层卡框)
          className="rounded-lg! border-border/60! bg-background/50! shadow-none!"
        />
        <ResultArea node={node} />
      </div>
    ),
    [node, ports, widgets, values, setWidgetValue],
  );
  return (
    <CanvasNodeShell
      definition={comfyGenericNodeDefinition}
      node={node}
      selected={data.selected || selected}
      dataKindAttr="data-image-studio-node-kind"
      onResizeEnd={(width) => useImageStudioStore.getState().setNodeWidth(node.id, width)}
    >
      {body}
    </CanvasNodeShell>
  );
}, areComfyGenericCardPropsEqual);

ComfyGenericCard.displayName = "ComfyGenericCard";
