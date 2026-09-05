// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SEGFORMER_PARTS,
  SEGFORMER_PART_LABELS,
  resolveUnclothParams,
} from "@/lib/assist/image-studio/uncloth-defaults";
import type { ImageWorkflowNode, ImageWorkflowUnclothNode } from "@/types/studio";

/**
 * 无衣物节点参数编辑器(09-04 通用化上提):图片工作室与分镜图画布共用
 * 的单源实现——图与文本由连线节点提供,本编辑器只承载两遍采样/蒙版/
 * 分割部位/LoRA/细节加工/Rebalance 全参数组。跨模块共用才上提 ui(分层铁律)。
 */

export function UnclothParamGroup({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="nodrag nopan rounded-md border border-border bg-background/80">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-medium text-foreground"
      >
        {title}
        <ChevronDown
          className={cn("h-3 w-3 text-muted-foreground transition-transform", open ? "" : "-rotate-90")}
          aria-hidden
        />
      </button>
      {open ? <div className="space-y-1.5 px-2 pb-2">{children}</div> : null}
    </div>
  );
}

export function UnclothNodeEditor({
  node,
  onUpdate,
}: {
  node: ImageWorkflowUnclothNode;
  onUpdate: (nodeId: string, updates: Partial<ImageWorkflowNode>) => void;
}) {
  const params = resolveUnclothParams(node);
  const fast = params.mode === "fast";
  const instruct = params.mode === "instruct";
  const patch = (updates: Partial<ImageWorkflowUnclothNode>) => onUpdate(node.id, updates as Partial<ImageWorkflowNode>);

  const numberField = (label: string, value: number, apply: (next: number) => void, step: number, min: number, max: number) => (
    <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="shrink-0">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) apply(next);
        }}
        className="h-7 w-20 rounded-md border border-border bg-card/80 px-1.5 text-xs text-foreground outline-none"
      />
    </label>
  );

  return (
    <div className="space-y-2">
      <div className="nodrag nopan text-[10px] text-muted-foreground">
        复合处理节点:图与文本由连线节点提供,结果只落在成图节点(本卡仅参数)。点组名展开/收起。
      </div>
      <label className="nodrag nopan flex items-center justify-between gap-2 rounded-md border border-border bg-background/80 px-2 py-1.5 text-[11px] text-muted-foreground">
        <span className="shrink-0">档位(快=单遍无校色/精=两遍+色彩对齐)</span>
        <select
          value={params.mode}
          onChange={(e) => patch({ variant: e.target.value === "fast" ? "fast" : "fine" })}
          className="h-7 w-24 rounded-md border border-border bg-card/80 px-1 text-xs text-foreground outline-none"
        >
          <option value="fine">精</option>
          <option value="fast">快</option>
        </select>
      </label>
      {instruct ? (
        <div className="nodrag nopan space-y-1.5 rounded-md border border-border bg-background/80 px-2 pb-2">
          <div className="pt-1.5 text-[10px] text-muted-foreground">
            指令编辑(Krea2Edit,09-05 现行档):一句话描述改动,参考图经连线提供;需本机 ComfyUI 运行中。
          </div>
          <textarea
            value={node.prompt ?? ""}
            onChange={(event) => patch({ prompt: event.target.value })}
            placeholder="例:她身上的衣衫整体褪去,露出洁净无瑕疵的裸露肌肤;脸、发型、姿态与背景保持一致"
            rows={5}
            className="w-full rounded-md border border-border bg-card/80 px-1.5 py-1 text-[11px] text-foreground outline-none"
          />
          {numberField("seed", params.seedUndress, (v) => patch({ seedUndress: v }), 1, 0, 999999999)}
          {numberField("steps", params.steps, (v) => patch({ steps: v }), 1, 1, 32)}
        </div>
      ) : (
      <UnclothParamGroup title={fast ? "采样(快档单遍)" : "两遍采样(常调)"} defaultOpen>
        {numberField(fast ? "denoise" : "脱衣遍 denoise", params.denoiseUndress, (v) => patch({ denoiseUndress: v }), 0.05, 0, 1)}
        {numberField(fast ? "seed" : "脱衣遍 seed", params.seedUndress, (v) => patch({ seedUndress: v }), 1, 0, 999999999)}
        {!fast && numberField("校色遍 denoise", params.denoiseColor, (v) => patch({ denoiseColor: v }), 0.05, 0, 1)}
        {!fast && numberField("校色遍 seed", params.seedColor, (v) => patch({ seedColor: v }), 1, 0, 999999999)}
        {numberField("步数 steps", params.steps, (v) => patch({ steps: v }), 1, 1, 32)}
        {numberField("cfg", params.cfg, (v) => patch({ cfg: v }), 0.5, 0, 20)}
        <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="shrink-0">sampler</span>
          <select value={params.sampler} onChange={(e) => patch({ sampler: e.target.value })}
            className="h-7 w-24 rounded-md border border-border bg-card/80 px-1 text-xs text-foreground outline-none">
            {["euler", "euler_ancestral", "heun", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_3m_sde", "ddim", "uni_pc", "lcm"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="shrink-0">scheduler</span>
          <select value={params.scheduler} onChange={(e) => patch({ scheduler: e.target.value })}
            className="h-7 w-24 rounded-md border border-border bg-card/80 px-1 text-xs text-foreground outline-none">
            {["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform", "beta"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </UnclothParamGroup>
      )}

{!instruct && (
      <UnclothParamGroup title="蒙版(GrowMask / 输入规模)">
        {numberField(fast ? "外扩 expand" : "外扩 expand(脱衣遍)", params.growUndress, (v) => patch({ growUndress: v }), 1, -64, 64)}
        <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <input type="checkbox" checked={params.growUndressInvert}
            onChange={(e) => patch({ growUndressInvert: e.target.checked })} /> 脱衣遍 invert
        </label>
        {!fast && numberField("外扩 expand(校色遍)", params.growColor, (v) => patch({ growColor: v }), 1, -64, 64)}
        {!fast && (
          <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <input type="checkbox" checked={params.growColorInvert}
              onChange={(e) => patch({ growColorInvert: e.target.checked })} /> 校色遍 invert
          </label>
        )}
        <label className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="shrink-0">缩放插值</span>
          <select value={params.upscaleMethod} onChange={(e) => patch({ upscaleMethod: e.target.value })}
            className="h-7 w-24 rounded-md border border-border bg-card/80 px-1 text-[10px] text-foreground outline-none">
            {["lanczos", "nearest-exact", "bilinear", "area", "bicubic"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        {numberField("输入上限 MP", params.megapixels, (v) => patch({ megapixels: v }), 0.1, 0.25, 8)}
        {numberField("除数 division_factor", params.divisionFactor, (v) => patch({ divisionFactor: v }), 1, 1, 64)}
      </UnclothParamGroup>
      )}

      {!instruct && (
      <UnclothParamGroup title={fast ? "分割部位(fashn 单分割)" : "分割部位(双分割并集)"}>
        {fast && (
          <div className="text-[10px] text-muted-foreground">快档只用 fashn 单分割(segformer 关闭)</div>
        )}
        {!fast && (
          <div className="grid grid-cols-3 gap-1">
            {SEGFORMER_PARTS.map((part) => (
              <label key={part} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={params.segformerParts.includes(part)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...params.segformerParts, part]
                      : params.segformerParts.filter((item) => item !== part);
                    patch({ segformerParts: next });
                  }}
                />
                {SEGFORMER_PART_LABELS[part]}
              </label>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
          fashn 部位
          <input
            value={params.fashnParts}
            onChange={(event) => patch({ fashnParts: event.target.value })}
            className="h-7 flex-1 rounded-md border border-border bg-card/80 px-1.5 text-[10px] text-foreground outline-none"
          />
        </label>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <label className="flex items-center gap-1">device
            <select value={params.fashnDevice} onChange={(e) => patch({ fashnDevice: e.target.value })}
              className="h-6 rounded-md border border-border bg-card/80 px-1 text-[10px] text-foreground outline-none">
              {["cpu", "mps"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">dtype
            <select value={params.fashnDtype} onChange={(e) => patch({ fashnDtype: e.target.value })}
              className="h-6 rounded-md border border-border bg-card/80 px-1 text-[10px] text-foreground outline-none">
              {["float32", "float16", "bfloat16"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
      </UnclothParamGroup>
      )}

{!instruct && (
      <UnclothParamGroup title="高级:LoRA 四槽(NSFW V4 / Mystic XXX v3 / 空 / pussy)">
        {params.loras.map((slot, index) => (
          <div key={index} className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <input
              type="checkbox"
              checked={slot.enabled}
              onChange={(event) => {
                const next = params.loras.map((item, i) =>
                  i === index ? { ...item, enabled: event.target.checked } : item,
                );
                patch({ loras: next });
              }}
            />
            {["NSFW V4", "Mystic XXX v3", "(空槽)", "pussy"][index] ?? `槽${index + 1}`}
            <input
              type="number"
              value={slot.strength}
              step={0.05}
              min={0}
              max={2}
              onChange={(event) => {
                const next = params.loras.map((item, i) =>
                  i === index ? { ...item, strength: Number(event.target.value) } : item,
                );
                patch({ loras: next });
              }}
              className="ml-auto h-7 w-16 rounded-md border border-border bg-card/80 px-1 text-[10px] text-foreground outline-none"
            />
          </div>
        ))}
      </UnclothParamGroup>
      )}

      {!fast && !instruct && <UnclothParamGroup title="高级:蒙版细节加工(SegformerUltraV3 真参数)">
        <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={params.maskDetail.processDetail}
            onChange={(event) =>
              patch({ maskDetail: { ...params.maskDetail, processDetail: event.target.checked } })
            }
          />
          启用细节加工(process_detail)
        </label>
        <label className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="shrink-0">detail_method</span>
          <select
            value={params.maskDetail.detailMethod}
            onChange={(e) => patch({ maskDetail: { ...params.maskDetail, detailMethod: e.target.value } })}
            className="h-7 w-24 rounded-md border border-border bg-card/80 px-1 text-[10px] text-foreground outline-none"
          >
            {["GuidedFilter", "PyMatting", "VITMatte", "VITMatte(local)", "PyMatting(local)"].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        {numberField("腐蚀 detail_erode", params.maskDetail.detailErode, (v) => patch({ maskDetail: { ...params.maskDetail, detailErode: v } }), 1, 0, 64)}
        {numberField("膨胀 detail_dilate", params.maskDetail.detailDilate, (v) => patch({ maskDetail: { ...params.maskDetail, detailDilate: v } }), 1, 0, 64)}
        {numberField("黑点 black_point", params.maskDetail.blackPoint, (v) => patch({ maskDetail: { ...params.maskDetail, blackPoint: v } }), 0.01, 0, 0.5)}
        {numberField("白点 white_point", params.maskDetail.whitePoint, (v) => patch({ maskDetail: { ...params.maskDetail, whitePoint: v } }), 0.01, 0.5, 1)}
        {numberField("分割上限 MP", params.maskDetail.maxMegapixels, (v) => patch({ maskDetail: { ...params.maskDetail, maxMegapixels: v } }), 0.5, 0.5, 8)}
      </UnclothParamGroup>}

{!instruct && (
      <UnclothParamGroup title="高级:Rebalance 12 权重(正向破限)">
        <input
          value={params.rebalanceWeights.join(",")}
          onChange={(event) =>
            patch({
              rebalanceWeights: event.target.value
                .split(",")
                .map((item) => Number(item.trim()))
                .filter((item) => Number.isFinite(item)),
            })
          }
          className="h-7 w-full rounded-md border border-border bg-card/80 px-1.5 text-[10px] text-foreground outline-none"
        />
      </UnclothParamGroup>
      )}
    </div>
  );
}
