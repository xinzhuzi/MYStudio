// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { Flame, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ImageWorkflowNsfwNode } from "@/types/studio";

/**
 * NSFW破限节点编辑器(09-07-nsfw-pro-node):图片工作室与分镜图画布共用
 * 的单源实现。一期只读——连线 提示词→本节点→成图 即走「Krea2-NSFW专业流」
 * 固定参数(强度调节二期经节点四槽 loras 透传)。跨模块共用才上提 ui(分层铁律)。
 *
 * 参数单源在后端 krea2.py PRO_* 常量(ComfyUI 原版工作流逐节点对拍);
 * 此处展示值与之同步维护。
 */

/** 专业流固定参数(与 krea2.py PRO_LORA_STACK/PRO_REBALANCE_WEIGHTS 同源对拍) */
const NSFW_PRO_STACK_ROWS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "破限 LoRA", value: "Mystic XXX v3 × 1.0" },
  { label: "破限 LoRA", value: "pussy × 0.3" },
  { label: "提示词重平衡", value: "12 层 · 第 9 层 ×5" },
  { label: "采样", value: "8 步 · 无引导(cfg=1)" },
  { label: "分辨率", value: "1MP 档(1:1=1024²)" },
];

export function NsfwNodeEditor({
  node,
  className,
}: {
  node: ImageWorkflowNsfwNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)} aria-label={`${node.title} 专业流参数`}>
      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] leading-relaxed text-foreground">
        <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
        <span>
          提示词从左边连入,输出口连到成图——生成时自动走
          <span className="font-semibold"> Krea2 专业流</span>
          (挂破限 LoRA 与重平衡)。仅本地 Krea2 / ComfyUI桥 生效。
        </span>
      </div>
      <div className="rounded-md border border-border bg-background/80 px-2 py-1.5">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          专业流参数(固定)
        </div>
        <dl className="space-y-1">
          {NSFW_PRO_STACK_ROWS.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-2 text-[11px]">
              <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
              <dd className="truncate font-mono text-foreground/90">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex items-start gap-1.5 px-1 text-[10px] leading-relaxed text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        <span>
          节点无参数可调;要调节 LoRA 强度请在设置页开「专业流增强」或等二期。
          成图模型不是 Krea2 时生成会被拦截并指路。
        </span>
      </div>
    </section>
  );
}
