// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ComfyUI 通用节点卡——ComfyUI 节点布局(09-09 用户裁定:照 ComfyUI 的 UI 节点做)。
 *
 * 语义对齐,代码零拷贝(ComfyUI 前端 GPL,License 红线;以下全部为本仓自研):
 * - 端口行:输入沿左缘/输出沿右缘逐行配对,类型色点压在卡片边上(半出半进);
 *   handleRenderer 让集成层把 React Flow Handle 锚进端口行——连线点=视觉点,
 *   不再是「百分比均布的空中点」(旧布局端口列表在卡中部,与边缘点脱节)。
 * - 控件区:widget 一行一个直接在节点体内,默认可见(ComfyUI 肌肉记忆:
 *   在节点上调参;旧版全部藏进「高级参数」折叠=失真)。
 * - 标题条:仅 standalone(传 title)时渲染;画布集成走 CanvasNodeShell 头,
 *   本组件 body-only(端口行+控件行),避免双头。
 *
 * 纯展示组件:Handle 由集成层经 handleRenderer 注入,本组件零画布依赖。
 */

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { comfyPortCssColor, comfyPortTypeLabel } from "./comfy-port-colors";
import {
  ComfyWidgetField,
  type ComfyWidgetSchema,
  type ComfyWidgetValue,
} from "./comfy-widget-controls";

/** 端口声明(descriptor 原样,side 决定行内左右位) */
export interface ComfyGenericPortDef {
  id: string;
  label: string;
  /** ComfyUI 端口类型名(IMAGE/MODEL/…;决定色点与 tooltip,大小写不敏感) */
  type: string;
  side: "input" | "output";
}

export interface ComfyGenericNodeCardProps {
  /** 标题(传入=standalone 模式渲染标题条;画布集成不传=body-only) */
  title?: string;
  /** 英文原名(/object_info class_type;进 tooltip 供对照) */
  titleEn?: string;
  /** 徽章文案(license/来源;仅 standalone 标题条) */
  badge?: string;
  ports: ComfyGenericPortDef[];
  widgets: ComfyWidgetSchema[];
  /** 各 widget 当前值(键=widget id;缺项走 schema.default) */
  values?: Record<string, ComfyWidgetValue>;
  onWidgetChange?: (widgetId: string, value: ComfyWidgetValue) => void;
  /**
   * 端口行连线点注入(集成期专用):每个端口调用一次,返回值渲染在该端口行内
   * 的色点位置(React Flow 按真实 DOM 位置锚边)。纯展示/测试态不传。
   */
  handleRenderer?: (port: ComfyGenericPortDef) => React.ReactNode;
  /** 控件区默认展开(缺省开;standalone 标题条箭头可收) */
  defaultExpanded?: boolean;
  className?: string;
}

/** 边缘色点:压在卡片边上(半出半进);title=类型原文+中文语义 */
function EdgeDot({ side, type }: { side: "input" | "output"; type: string }) {
  return (
    <span
      aria-hidden
      data-comfy-port-dot={type}
      className={cn(
        "absolute top-1/2 z-[1] size-2.5 -translate-y-1/2 rounded-full border border-background/80",
        side === "input" ? "-left-[5px]" : "-right-[5px]",
      )}
      style={{ backgroundColor: comfyPortCssColor(type) }}
    />
  );
}

function portTooltip(label: string, type: string): string {
  const typeLabel = comfyPortTypeLabel(type);
  return `${label} · ${type}${typeLabel ? `(${typeLabel})` : ""}`;
}

export function ComfyGenericNodeCard({
  title,
  titleEn,
  badge,
  ports,
  widgets,
  values,
  onWidgetChange,
  handleRenderer,
  defaultExpanded = true,
  className,
}: ComfyGenericNodeCardProps) {
  const inputPorts = ports.filter((port) => port.side === "input");
  const outputPorts = ports.filter((port) => port.side === "output");
  const hasAnyPort = inputPorts.length > 0 || outputPorts.length > 0;
  const [widgetsOpen, setWidgetsOpen] = useState(defaultExpanded);
  // 端口行配对:输入/输出各按序取第 i 个同行(左右缘对齐;单侧空位让位)
  const rowCount = Math.max(inputPorts.length, outputPorts.length);

  return (
    <div
      data-comfy-generic-node={titleEn ?? title}
      className={cn(
        "[contain:layout_style]",
        "nodrag nopan w-full rounded-lg border border-border bg-card/96 text-card-foreground",
        "shadow-[0_1px_2px_rgba(0,0,0,0.18)]",
        className,
      )}
    >
      {/* 标题条(仅 standalone;画布集成走外层壳头,避免双头) */}
      {title ? (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-2.5 py-1.5">
          <div
            className="flex min-w-0 items-center gap-2"
            title={titleEn ? `${titleEn}${title !== titleEn ? ` · ${title}` : ""}` : title}
          >
            <span aria-hidden className="h-3.5 w-1 shrink-0 rounded-full bg-primary/80" />
            <span className="min-w-0 truncate text-xs font-semibold">{title}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {badge ? (
              <span
                className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground"
                title="来源/许可证"
              >
                {badge}
              </span>
            ) : null}
            {widgets.length > 0 ? (
              <button
                type="button"
                aria-label={widgetsOpen ? "收起节点参数" : "展开节点参数"}
                onClick={() => setWidgetsOpen((value) => !value)}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
              >
                <ChevronDown
                  className={cn("h-3 w-3 transition-transform", widgetsOpen ? "" : "-rotate-90")}
                  aria-hidden
                />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 端口行区:行=整宽(相对定位系),色点压边;输入名靠左/输出名靠右 */}
      {hasAnyPort ? (
        <div className="space-y-0.5 py-1.5" data-comfy-port-rows>
          {Array.from({ length: rowCount }, (_, index) => {
            const input = inputPorts[index];
            const output = outputPorts[index];
            return (
              <div key={input?.id ?? `out:${output?.id ?? index}`} className="relative flex min-h-5 items-center">
                {input ? (
                  <>
                    {handleRenderer ? handleRenderer(input) : null}
                    <EdgeDot side="input" type={input.type} />
                    <span
                      className="min-w-0 flex-1 truncate pl-2.5 text-[11px] leading-5 text-foreground/85"
                      title={portTooltip(input.label, input.type)}
                    >
                      {input.label}
                    </span>
                  </>
                ) : (
                  <span className="flex-1" />
                )}
                {output ? (
                  <>
                    <span
                      className="min-w-0 flex-1 truncate pr-2.5 text-right text-[11px] leading-5 text-foreground/85"
                      title={portTooltip(output.label, output.type)}
                    >
                      {output.label}
                    </span>
                    <EdgeDot side="output" type={output.type} />
                    {handleRenderer ? handleRenderer(output) : null}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-2.5 py-1.5 text-[11px] text-muted-foreground/70">无端口(纯参数节点)</div>
      )}

      {/* 控件区:一行一个直接在节点体内(照 ComfyUI;standalone 标题条箭头可收) */}
      {widgets.length === 0 ? (
        <div className="border-t border-border/70 px-2.5 py-1.5 text-[11px] text-muted-foreground/70">
          无参数(该节点没有可调选项)
        </div>
      ) : widgetsOpen ? (
        <div className="space-y-1.5 border-t border-border/70 px-2.5 py-2" data-comfy-widget-rows>
          {widgets.map((schema) => (
            <ComfyWidgetField
              key={schema.id}
              schema={schema}
              value={values && schema.id in values ? values[schema.id] : undefined}
              onChange={(value) => onWidgetChange?.(schema.id, value)}
            />
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setWidgetsOpen(true)}
          className="w-full border-t border-border/70 px-2.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          参数({widgets.length})已收起,点击展开
        </button>
      )}
    </div>
  );
}
