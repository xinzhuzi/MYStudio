// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { ArrowRight } from "lucide-react";
import type { ProductionFlowNodeModel } from "../workflow-node-model";

/**
 * NodePointerCard——画布节点终极瘦身(用户裁定 2026-08-26:「节点图里面
 * 只展示指向性的指针类型」)。纯指针卡 ≈30 DOM:图标+标题+状态+计数+
 * 进入按钮。所有内容走独立阶段面板,画布零内容渲染。
 *
 * 保留节点操作按钮(一键生图/超分/成片,布局裁定 6e10e32 不变)——这些
 * 由 WorkflowProductionNode 在指针卡外部渲染,本组件只管 preview 区。
 */

export function NodePointerCard({
  node,
  onEnter,
}: {
  node: ProductionFlowNodeModel;
  onEnter?: () => void;
}) {
  const summary = node.previewLines.slice(0, 3);
  const metric = node.metrics.slice(0, 2);
  return (
    <div className="nodrag nowheel space-y-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2.5">
      {/* 摘要行:2-3 条关键计数 */}
      {summary.length > 0 ? (
        <div className="space-y-0.5">
          {summary.map((line, index) => (
            <p key={index} className="truncate text-[11px] leading-4 text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {/* 指标行 */}
      {metric.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {metric.map((m, index) => (
            <span
              key={index}
              className="rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-foreground"
            >
              {m}
            </span>
          ))}
        </div>
      ) : null}

      {/* 进入按钮 */}
      {onEnter ? (
        <button
          type="button"
          data-node-pointer-enter={node.id}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/45 bg-primary/10 px-2 py-1.5 text-[11px] font-medium text-primary hover:border-primary/70 hover:bg-primary/20"
          title={`进入 ${node.label} 详细视图`}
          onClick={(event) => {
            event.stopPropagation();
            onEnter();
          }}
        >
          <ArrowRight className="h-3 w-3" />
          进入 {node.label}
        </button>
      ) : null}
    </div>
  );
}
