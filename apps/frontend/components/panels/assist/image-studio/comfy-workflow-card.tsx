// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useMemo, useState } from "react";
import { ChevronDown, Play, RefreshCw } from "lucide-react";
import type { Node, NodeProps } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { LocalImage } from "@/components/ui/local-image";
import { ComfyWidgetField } from "@/components/ui/comfy/comfy-widget-controls";
import { comfyPortCssColor } from "@/components/ui/comfy/comfy-port-colors";
import { CanvasNodeShell, comfyWorkflowNodeDefinition } from "@/features/canvas-nodes";
import {
  runComfyWorkflowNode,
  type ComfyExecuteProgress,
} from "@/lib/assist/image-studio/comfy-execute";
import {
  createComfyWorkflowLibraryClient,
  resolveComfyWorkflowLibraryTransport,
} from "@/lib/assist/image-studio/comfy-workflow-library";
import { selectActiveImageStudioWorkflow, useImageStudioStore } from "@/stores/assist/image-studio-store";
import { toPreviewSrc } from "@/lib/media/preview-src";
import { cn } from "@/lib/utils";
import type { ImageStudioNodeData } from "./image-studio-node-card";
import type { ImageWorkflowComfyWorkflowNode } from "@/types/studio";

/**
 * ComfyUI 工作流节点卡(09-08 二期收官,流X):通用壳(静态三口)+ descriptor
 * 端口明细 + 高级参数折叠(五类控件)+ 出图区(LocalImage+运行按钮+状态)。
 * 运行端到端:上游收集→库取原文→/comfy/execute→输出图回填(mediaRef 模式)。
 */

type ComfyWorkflowReactNode = Node<ImageStudioNodeData>;

/** 卡面活数据(运行回写经 store,选区稳定引用;props data.node 兜底) */
function useLiveComfyNode(nodeId: string, fallback: ImageWorkflowComfyWorkflowNode): ImageWorkflowComfyWorkflowNode {
  const live = useImageStudioStore((state) => {
    for (const workflow of state.workflows) {
      const found = workflow.nodes.find((item) => item.id === nodeId);
      if (found && found.type === "comfy-workflow") return found;
    }
    return undefined;
  });
  return live ?? fallback;
}

function areComfyWorkflowCardPropsEqual(
  prev: NodeProps<ComfyWorkflowReactNode>,
  next: NodeProps<ComfyWorkflowReactNode>,
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

const STAGE_LABELS: Record<string, string> = {
  upload: "上传输入图",
  queue: "提交引擎",
  running: "引擎执行中",
  collect: "取回输出图",
  unknown: "执行中",
};

/** descriptor 端口明细行(类型色点+中文标签;与通用卡同语言) */
function PortList({ node }: { node: ImageWorkflowComfyWorkflowNode }) {
  if (node.descriptor.ports.length === 0) {
    return <div className="text-[11px] text-muted-foreground/70">这个工作流没有外露边界口(内部自足)</div>;
  }
  return (
    <div className="nodrag nopan grid grid-cols-2 gap-x-3 gap-y-1" aria-label="工作流边界口">
      <div className="space-y-1">
        <div className="text-[10px] font-medium text-muted-foreground">输入口(连线注入)</div>
        {node.descriptor.ports.filter((port) => port.type === "prompt-text" || port.type === "image").length === 0 ? (
          <span className="text-[11px] text-muted-foreground/60">无</span>
        ) : null}
        {node.descriptor.ports
          .filter((port) => port.type === "prompt-text" || port.type === "image")
          .map((port) => (
            <span key={port.id} className="flex min-w-0 items-center gap-1.5 text-[11px] text-foreground/80" title={`${port.label}(${port.id})`}>
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full border border-background/60"
                style={{ backgroundColor: comfyPortCssColor(port.type === "prompt-text" ? "STRING" : "IMAGE") }}
              />
              <span className="truncate">{port.label}</span>
            </span>
          ))}
      </div>
      <div className="space-y-1">
        <div className="text-[10px] font-medium text-muted-foreground">输出</div>
        <span className="flex items-center justify-end gap-1.5 text-[11px] text-foreground/80">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full border border-background/60"
            style={{ backgroundColor: comfyPortCssColor("IMAGE") }}
          />
          <span className="truncate">出图(图像)</span>
        </span>
      </div>
    </div>
  );
}

/** 高级参数折叠(descriptor.widgets 全收,默认收起——二期裁定) */
function AdvancedParams({ node }: { node: ImageWorkflowComfyWorkflowNode }) {
  const [expanded, setExpanded] = useState(false);
  const setWidgetValue = useImageStudioStore((state) => state.setComfyNodeWidgetValue);
  const widgets = node.descriptor.widgets;
  const values = node.widgetValues ?? {};
  return (
    <div className="nodrag nopan rounded-md border border-border bg-background/80">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-medium text-foreground"
      >
        <span>高级参数({widgets.length})</span>
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", expanded ? "" : "-rotate-90")} aria-hidden />
      </button>
      {expanded ? (
        <div className="space-y-2 px-2 pb-2">
          {widgets.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">无参数(默认值即可跑)</div>
          ) : (
            widgets.map((widget) => (
              <ComfyWidgetField
                key={widget.id}
                schema={{
                  id: widget.id,
                  label: widget.label,
                  type: widget.type,
                  default: widget.default,
                  ...(widget.options ? { options: widget.options } : {}),
                  ...(widget.range
                    ? { min: widget.range.min, max: widget.range.max, step: widget.range.step }
                    : {}),
                }}
                value={values[widget.id] as number | string | boolean | undefined}
                onChange={(value) => setWidgetValue(node.id, widget.id, value)}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/** 出图区:状态行 + LocalImage + 运行按钮 */
function OutputArea({ node }: { node: ImageWorkflowComfyWorkflowNode }) {
  const running = node.status === "running";
  return (
    <div className="space-y-2">
      {node.status === "failed" && node.statusMessage ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] leading-4 text-destructive" data-comfy-node-error>
          {node.statusMessage}
        </div>
      ) : null}
      {node.resultUrl ? (
        <div className="nodrag nopan aspect-video overflow-hidden rounded-md border border-border bg-muted/30">
          <LocalImage
            src={toPreviewSrc(node.resultUrl)}
            alt={node.title}
            className="h-full w-full object-cover"
            eager
            previewable
          />
        </div>
      ) : (
        <div className="nodrag nopan flex aspect-video items-center justify-center rounded-md border border-dashed border-border bg-muted/20 px-4 text-center text-xs text-muted-foreground">
          {running ? STAGE_LABELS.unknown + "…" : node.status === "failed" ? "上次运行失败" : "还没运行过——连上提示词/参考图后点「运行」"}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-8 flex-1 text-xs"
          disabled={running}
          onClick={() => void runWorkflowNode(node.id)}
          data-comfy-node-run={node.id}
        >
          {running ? <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
          {running ? "运行中…" : node.resultUrl ? "重新运行" : "运行"}
        </Button>
        {node.resultCount && node.resultCount > 1 ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{node.resultCount} 张输出(显示第一张)</span>
        ) : null}
      </div>
    </div>
  );
}

/** 运行编排:状态机置位→执行核→回填(定向到节点所在画布) */
async function runWorkflowNode(nodeId: string): Promise<void> {
  const store = useImageStudioStore.getState();
  const graph = selectActiveImageStudioWorkflow(store);
  if (!graph) return;
  store.setComfyNodeStatus(nodeId, "running");
  try {
    const client = createComfyWorkflowLibraryClient(resolveComfyWorkflowLibraryTransport());
    const result = await runComfyWorkflowNode(graph, nodeId, {
      fetchWorkflowText: (workflowId) => client.content(workflowId),
      onProgress: (progress: ComfyExecuteProgress) => {
        useImageStudioStore.getState().setComfyNodeStatus(
          nodeId,
          "running",
          `${STAGE_LABELS[progress.stage] ?? "执行中"}:${progress.message}`,
        );
      },
    });
    if (result.imageUrl) {
      useImageStudioStore.getState().setComfyNodeResult(nodeId, {
        resultUrl: result.imageUrl,
        resultMediaId: result.mediaId,
        resultCount: result.imageCount,
      });
    }
    if (!result.persisted) {
      // 落盘降级仍回显,但给出可行动提示(下次重启预览会丢)
      useImageStudioStore.getState().setComfyNodeStatus(nodeId, "ready", "输出图未落库(无活动项目?),仅本次会话可预览");
    }
  } catch (error) {
    useImageStudioStore.getState().setComfyNodeStatus(
      nodeId,
      "failed",
      error instanceof Error ? error.message : "运行失败",
    );
  }
}

export const ComfyWorkflowCard = memo(function ComfyWorkflowCard({
  data,
  selected,
}: NodeProps<ComfyWorkflowReactNode>) {
  const fallback = data.node as ImageWorkflowComfyWorkflowNode;
  const node = useLiveComfyNode(fallback.id, fallback);
  const footer = useMemo(() => <AdvancedParams node={node} />, [node]);
  return (
    <CanvasNodeShell
      definition={comfyWorkflowNodeDefinition}
      node={node}
      selected={data.selected || selected}
      dataKindAttr="data-image-studio-node-kind"
      footer={footer}
    >
      <div className="mt-2 space-y-2">
        <PortList node={node} />
        <OutputArea node={node} />
      </div>
    </CanvasNodeShell>
  );
}, areComfyWorkflowCardPropsEqual);

ComfyWorkflowCard.displayName = "ComfyWorkflowCard";
