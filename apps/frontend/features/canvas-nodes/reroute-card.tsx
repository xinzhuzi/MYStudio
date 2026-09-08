// Copyright © 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { comfyPortCssColor } from "@/components/ui/comfy/comfy-port-colors";

/**
 * Reroute 中转卡(09-09 照 ComfyUI):纯连线整理件的最小形态——窄条卡,
 * 左入右出各一口(任意类型,色点用中性色随上游),双画布共享。
 * 链语义穿透在 graph-build-mutations.collapseTransparentNodes 单源处理,
 * 本卡零业务逻辑;右键删除走画布公共菜单。props 最小化(node+selected),
 * 两画布各自把 RF NodeProps 投影进来。
 */

export interface RerouteCardProps {
  node: { id: string; type: string; title?: string; bypassed?: boolean };
  selected?: boolean;
}

const HANDLE_STYLE = { position: "absolute", top: "50%", transform: "translateY(-50%)" } as const;

export const RerouteCard = memo(function RerouteCard({ node, selected }: RerouteCardProps) {
  const bypassed = node.bypassed === true;
  return (
    <div
      data-canvas-node-kind="reroute"
      className={cn(
        "relative flex h-10 w-[180px] items-center rounded-md border bg-card/96 px-3",
        "shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition-[border-color,opacity]",
        selected ? "border-primary/70" : "border-border",
        bypassed && "opacity-45",
      )}
      title="中转点:一根进,原样一根出(右键删除)"
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ ...HANDLE_STYLE, left: "-6px", backgroundColor: comfyPortCssColor("IMAGE") }}
        className="h-3! w-3!"
        title="中转入口(任意类型)"
      />
      <span className="nodrag nopan min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/85">
        {bypassed ? "中转点(旁路)" : "中转点"}
      </span>
      <Handle
        type="source"
        position={Position.Right}
        style={{ ...HANDLE_STYLE, right: "-6px", backgroundColor: comfyPortCssColor("IMAGE") }}
        className="h-3! w-3!"
        title="中转出口(随上游类型)"
      />
    </div>
  );
});

RerouteCard.displayName = "RerouteCard";

/** React Flow 接线适配:nodeTypes 注册用(NodeProps → 最小 props 投影) */
export const RerouteFlowNode = memo(function RerouteFlowNode(props: {
  data?: { node?: RerouteCardProps["node"] };
  selected?: boolean;
}) {
  const node = props.data?.node;
  if (!node) return null;
  return <RerouteCard node={node} selected={props.selected} />;
});

RerouteFlowNode.displayName = "RerouteFlowNode";
