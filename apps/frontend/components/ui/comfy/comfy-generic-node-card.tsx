// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ComfyUI 通用节点卡——descriptor 驱动的**展示壳**(三期 通用节点)。
 *
 * /object_info 的节点声明 → 标题区(中文名+英文原名 tooltip)+ 端口列表
 * (左右分栏=输入/输出,类型色点走 comfy-port-colors 的 CSS 变量方案)+
 * 参数区(widget 收进「高级参数」折叠,照 PRD「专业参数不上卡面」裁定)。
 *
 * 纯展示组件:连线(Handle)/选中/拖拽交互留集成期接 React Flow——本壳
 * 只负责把一份节点 descriptor 渲染成与既有节点卡同语言的卡面。
 */

import { useState } from "react";
import { ChevronDown, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { comfyPortCssColor, comfyPortTypeLabel } from "./comfy-port-colors";
import {
  ComfyWidgetField,
  type ComfyWidgetSchema,
  type ComfyWidgetValue,
} from "./comfy-widget-controls";

/** 端口声明(descriptor 原样,side 决定分栏) */
export interface ComfyGenericPortDef {
  id: string;
  label: string;
  /** ComfyUI 端口类型名(IMAGE/MODEL/…;决定色点与 tooltip,大小写不敏感) */
  type: string;
  side: "input" | "output";
}

export interface ComfyGenericNodeCardProps {
  /** 中文名(大白话层标题;策展节点给中文名,全量节点回落英文原名) */
  title: string;
  /** 英文原名(/object_info class_type;进 tooltip 供对照) */
  titleEn?: string;
  /** 徽章文案(license/来源,如「GPL-3.0」「自定义」) */
  badge?: string;
  ports: ComfyGenericPortDef[];
  widgets: ComfyWidgetSchema[];
  /** 各 widget 当前值(键=widget id;缺项走 schema.default) */
  values?: Record<string, ComfyWidgetValue>;
  onWidgetChange?: (widgetId: string, value: ComfyWidgetValue) => void;
  /** 参数区默认展开(缺省折叠) */
  defaultExpanded?: boolean;
  className?: string;
}

/** 单个端口行:类型色点+名称;title 带类型原文与中文语义 */
function ComfyPortRow({ port }: { port: ComfyGenericPortDef }) {
  const typeLabel = comfyPortTypeLabel(port.type);
  const tooltip = `${port.label} · ${port.type}${typeLabel ? `(${typeLabel})` : ""}`;
  return (
    <span
      title={tooltip}
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-[11px] text-foreground/80",
        port.side === "output" && "flex-row-reverse text-right",
      )}
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full border border-background/60"
        style={{ backgroundColor: comfyPortCssColor(port.type) }}
      />
      <span className="truncate">{port.label}</span>
    </span>
  );
}

/** 参数区折叠头(照 UnclothParamGroup 模式:卡面默认收起) */
function ComfyAdvancedParamsDisclosure({
  widgetCount,
  defaultExpanded,
  children,
}: {
  widgetCount: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(Boolean(defaultExpanded));
  return (
    <div className="nodrag nopan rounded-md border border-border bg-background/80">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-medium text-foreground"
      >
        <span>高级参数{widgetCount > 0 ? `(${widgetCount})` : ""}</span>
        <ChevronDown
          className={cn("h-3 w-3 text-muted-foreground transition-transform", expanded ? "" : "-rotate-90")}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="space-y-2 px-2 pb-2">
          {widgetCount === 0 ? (
            <div className="text-[11px] text-muted-foreground">无参数(该节点没有可调选项)</div>
          ) : (
            children
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ComfyGenericNodeCard({
  title,
  titleEn,
  badge,
  ports,
  widgets,
  values,
  onWidgetChange,
  defaultExpanded,
  className,
}: ComfyGenericNodeCardProps) {
  const inputPorts = ports.filter((port) => port.side === "input");
  const outputPorts = ports.filter((port) => port.side === "output");
  const hasAnyPort = inputPorts.length > 0 || outputPorts.length > 0;

  return (
    <div
      data-comfy-generic-node={titleEn ?? title}
      className={cn(
        "[contain:layout_style]",
        "image-workflow-node-card nodrag nopan w-[420px] rounded-xl border border-border bg-card/96 p-3.5 text-card-foreground",
        "shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition-colors duration-200",
        className,
      )}
    >
      {/* 标题区:中文名+徽章;英文原名进 tooltip(查文档/排错对照) */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
            <Workflow className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div
            className="min-w-0 truncate text-sm font-semibold"
            title={titleEn ? `${titleEn}${title && title !== titleEn ? ` · ${title}` : ""}` : title}
          >
            {title}
          </div>
        </div>
        {badge ? (
          <span
            className="shrink-0 rounded-full border border-border bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground"
            title="来源/许可证"
          >
            {badge}
          </span>
        ) : null}
      </div>

      {/* 端口区:左右分栏(输入左/输出右,镜像画布口位);色点=类型语义色 */}
      {hasAnyPort ? (
        <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1">
          <div className="space-y-1" aria-label="输入端口">
            {inputPorts.length > 0 ? (
              inputPorts.map((port) => <ComfyPortRow key={`${port.side}:${port.id}`} port={port} />)
            ) : (
              <span className="text-[11px] text-muted-foreground/60">无输入</span>
            )}
          </div>
          <div className="space-y-1" aria-label="输出端口">
            {outputPorts.length > 0 ? (
              outputPorts.map((port) => <ComfyPortRow key={`${port.side}:${port.id}`} port={port} />)
            ) : (
              <span className="block text-right text-[11px] text-muted-foreground/60">无输出</span>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-2 text-[11px] text-muted-foreground/70">无端口(纯参数节点)</div>
      )}

      {/* 参数区:widget 全收进「高级参数」折叠(默认收起,大白话卡面纪律) */}
      <ComfyAdvancedParamsDisclosure widgetCount={widgets.length} defaultExpanded={defaultExpanded}>
        {widgets.map((schema) => (
          <ComfyWidgetField
            key={schema.id}
            schema={schema}
            value={values && schema.id in values ? values[schema.id] : undefined}
            onChange={(value) => onWidgetChange?.(schema.id, value)}
          />
        ))}
      </ComfyAdvancedParamsDisclosure>
    </div>
  );
}
