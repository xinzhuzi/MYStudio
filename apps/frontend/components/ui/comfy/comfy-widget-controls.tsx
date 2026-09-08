// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ComfyUI 通用节点五类控件(三期 通用节点,B 节需求):
 * /object_info 的 widget 配方(INT/FLOAT/COMBO/STRING/BOOLEAN)→ 自研控件,
 * props 全由 schema 驱动,与 ComfyUI 前端代码无关(License 红线:数据非代码)。
 *
 * 契约:受控 + 非受控两用——传 value 即受控;不传则内部态起步于
 * defaultValue / schema.default。onChange 只吐**已规整**的值(数值钳制到
 * [min,max] 并吸附 step;COMBO 必属选项;BOOLEAN 缺省 false)。
 *
 * 节点内嵌画布的纪律照既有节点编辑器:交互元素挂 nodrag nopan,
 * 连线/选中交互由集成期包 React Flow(本组件零画布依赖)。
 */

import { useCallback, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { Slider } from "../slider";
import { Switch } from "../switch";

/** 五类控件的值域联合 */
export type ComfyWidgetValue = number | string | boolean;

/** /object_info widget 的五类类型名 */
export type ComfyWidgetType = "INT" | "FLOAT" | "COMBO" | "STRING" | "BOOLEAN";

export interface ComfyWidgetSchemaBase {
  /** widget 标识(节点内唯一;对应 /object_info 字段名) */
  id: string;
  /** 英文原名(/object_info 字段原文) */
  label: string;
  /** 中文名(大白话层优先展示) */
  zhLabel?: string;
  /** 缺省值(/object_info 的 default) */
  default?: ComfyWidgetValue;
}

export interface ComfyNumberWidgetSchema extends ComfyWidgetSchemaBase {
  type: "INT" | "FLOAT";
  min?: number;
  max?: number;
  /** 步进(≤0 或缺省时按类型给 1 / 0.1) */
  step?: number;
}

export interface ComfyComboWidgetSchema extends ComfyWidgetSchemaBase {
  type: "COMBO";
  /** 候选项;空/缺失走空态防御(禁用+占位) */
  options?: string[];
}

export interface ComfyStringWidgetSchema extends ComfyWidgetSchemaBase {
  type: "STRING";
  placeholder?: string;
}

export interface ComfyBooleanWidgetSchema extends ComfyWidgetSchemaBase {
  type: "BOOLEAN";
}

export type ComfyWidgetSchema =
  | ComfyNumberWidgetSchema
  | ComfyComboWidgetSchema
  | ComfyStringWidgetSchema
  | ComfyBooleanWidgetSchema;

/** 数值钳制:先夹 [min,max],再吸附 step 网格(以 min 为原点),INT 取整 */
export function clampComfyNumber(
  value: number,
  opts: { min?: number; max?: number; step?: number; integer?: boolean },
): number {
  const { min, max, step, integer } = opts;
  if (!Number.isFinite(value)) return min ?? 0;
  let next = value;
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  if (step !== undefined && step > 0) {
    const origin = min ?? 0;
    // step 小数位数(吸附后消除浮点尾差,如 0.30000000000000004)
    const decimals = (String(step).split(".")[1] ?? "").length;
    next = origin + Math.round((next - origin) / step) * step;
    if (decimals > 0) next = Number(next.toFixed(decimals));
    // 吸附可能因舍入越界(如 max 不在网格上),再夹一次
    if (min !== undefined && next < min) next = min;
    if (max !== undefined && next > max) next = max;
  }
  if (integer) next = Math.round(next);
  return next;
}

/** schema 缺省值规整:类型不对/缺失时给类型安全兜底(BOOLEAN false / STRING "" / COMBO 首项) */
export function resolveComfyWidgetDefault(schema: ComfyWidgetSchema): ComfyWidgetValue {
  switch (schema.type) {
    case "BOOLEAN":
      return typeof schema.default === "boolean" ? schema.default : false;
    case "STRING":
      return typeof schema.default === "string" ? schema.default : "";
    case "COMBO": {
      const options = (schema.options ?? []).filter((item): item is string => typeof item === "string");
      const def = schema.default;
      return typeof def === "string" && options.includes(def) ? def : (options[0] ?? "");
    }
    case "INT":
    case "FLOAT":
      return clampComfyNumber(
        typeof schema.default === "number" ? schema.default : (schema.min ?? 0),
        { min: schema.min, max: schema.max, step: schema.step, integer: schema.type === "INT" },
      );
    default: {
      // 未知/扩展类型(第三方插件 widget 形状不可穷举):原样保值,展示层兜底渲染
      const def = (schema as { default?: ComfyWidgetValue }).default;
      return def ?? "";
    }
  }
}

/** 控件标签:中文名优先(zhLabel),缺省回落英文原名,再回落 id */
export function comfyWidgetLabel(schema: ComfyWidgetSchema): string {
  return schema.zhLabel || schema.label || schema.id;
}

/** 受控/非受控两用的值通道(传 value=受控;否则内部态起步于默认值) */
function useComfyWidgetValue(options: {
  schema: ComfyWidgetSchema;
  value: ComfyWidgetValue | undefined;
  defaultValue: ComfyWidgetValue | undefined;
  onChange?: (value: ComfyWidgetValue) => void;
}) {
  const { schema, value, defaultValue, onChange } = options;
  const isControlled = value !== undefined;
  const [uncontrolled, setUncontrolled] = useState<ComfyWidgetValue>(() =>
    defaultValue !== undefined ? defaultValue : resolveComfyWidgetDefault(schema),
  );
  const current = isControlled ? value : (uncontrolled as ComfyWidgetValue);
  const commit = useCallback(
    (next: ComfyWidgetValue) => {
      if (!isControlled) setUncontrolled(next);
      onChange?.(next);
    },
    [isControlled, onChange],
  );
  return { current, commit };
}

export interface ComfyWidgetFieldProps {
  /** widget 配方(类型驱动渲染) */
  schema: ComfyWidgetSchema;
  /** 受控值(不传=非受控) */
  value?: ComfyWidgetValue;
  /** 非受控初值(优先于 schema.default) */
  defaultValue?: ComfyWidgetValue;
  onChange?: (value: ComfyWidgetValue) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * 单个 widget 字段:标签行 + 对应控件。schema.type 未知/扩展时兜底渲染
 * 禁用输入框(空态防御:第三方插件 widget 形状不可穷举)。
 */
export function ComfyWidgetField({
  schema,
  value,
  defaultValue,
  onChange,
  disabled,
  className,
}: ComfyWidgetFieldProps) {
  const { current, commit } = useComfyWidgetValue({ schema, value, defaultValue, onChange });
  const reactId = useId();
  const controlDomId = `comfy-widget-${reactId}`;
  const label = comfyWidgetLabel(schema);
  // 英文原名放 title(tooltip):中文标签 + 原文对照,查文档/排错时不迷路
  const labelTitle = schema.zhLabel && schema.label ? `${schema.label}(${schema.id})` : schema.id;

  return (
    <div className={cn("nodrag nopan space-y-1", className)} data-comfy-widget-id={schema.id}>
      {schema.type === "BOOLEAN" ? (
        <label
          className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
          title={labelTitle}
        >
          <span className="shrink-0">{label}</span>
          <Switch
            id={controlDomId}
            checked={current === true}
            onCheckedChange={(checked) => commit(checked)}
            disabled={disabled}
            aria-label={label}
          />
        </label>
      ) : schema.type === "INT" || schema.type === "FLOAT" ? (
        <ComfyNumberControl
          schema={schema}
          current={current}
          commit={commit}
          disabled={disabled}
          label={label}
          labelTitle={labelTitle}
          controlDomId={controlDomId}
        />
      ) : schema.type === "COMBO" ? (
        <ComfyComboControl
          schema={schema}
          current={current}
          commit={commit}
          disabled={disabled}
          label={label}
          labelTitle={labelTitle}
          controlDomId={controlDomId}
        />
      ) : schema.type === "STRING" ? (
        <ComfyStringControl
          schema={schema}
          current={current}
          commit={commit}
          disabled={disabled}
          label={label}
          labelTitle={labelTitle}
          controlDomId={controlDomId}
        />
      ) : (
        // 兜底:未知 widget 类型,禁用输入框展示原值(不丢数据,不崩卡)
        <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="shrink-0 truncate" title={labelTitle}>{label}</span>
          <input
            value={current === undefined || current === null ? "" : String(current)}
            disabled
            title={`暂不支持的控件类型:${(schema as { type?: string }).type ?? "未知"}`}
            className="h-7 w-32 rounded-md border border-border bg-card/80 px-1.5 text-xs text-muted-foreground outline-none"
          />
        </label>
      )}
    </div>
  );
}

/** INT/FLOAT:标签行(右侧数值步进框)+ 下方滑杆;输入以草稿态持有,失焦/回车才钳制提交 */
function ComfyNumberControl({
  schema,
  current,
  commit,
  disabled,
  label,
  labelTitle,
  controlDomId,
}: {
  schema: ComfyNumberWidgetSchema;
  current: ComfyWidgetValue;
  commit: (next: ComfyWidgetValue) => void;
  disabled?: boolean;
  label: string;
  labelTitle: string;
  controlDomId: string;
}) {
  // 范围防御:缺省 min=0/max=100;倒挂时抬 max;步进非法按类型给 1 / 0.1
  const min = schema.min ?? 0;
  const max = Math.max(schema.max ?? 100, min);
  const step = schema.step !== undefined && schema.step > 0 ? schema.step : schema.type === "INT" ? 1 : 0.1;
  const clamp = useCallback(
    (value: number) => clampComfyNumber(value, { min, max, step, integer: schema.type === "INT" }),
    [min, max, step, schema.type],
  );
  // 值防御:类型不对(上游脏数据)回落钳制后的默认
  const numeric =
    typeof current === "number" && Number.isFinite(current) ? clamp(current) : clamp(min);
  // 聚焦输入草稿:敲一半的值(如 "0." / 空串)不上 store,失焦/回车才规整提交
  const [draft, setDraft] = useState<string | null>(null);
  const commitDraft = () => {
    if (draft === null) return;
    setDraft(null);
    const trimmed = draft.trim();
    if (trimmed === "") return; // 清空=放弃修改,回落当前值
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) commit(clamp(parsed));
  };

  return (
    <>
      <label
        className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
        title={labelTitle}
      >
        <span className="shrink-0 truncate">{label}</span>
        <input
          id={controlDomId}
          type="number"
          inputMode="decimal"
          value={draft ?? String(numeric)}
          min={min}
          max={max}
          step={step}
          aria-label={label}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitDraft();
          }}
          className="h-7 w-20 shrink-0 rounded-md border border-border bg-card/80 px-1.5 text-xs tabular-nums text-foreground outline-none"
        />
      </label>
      <Slider
        // 与数值输入框区分名(label 已挂在输入框上,滑杆加后缀避免重名)
        aria-label={`${label}(滑杆)`}
        value={[numeric]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(values) => {
          const next = values[0];
          if (typeof next === "number" && Number.isFinite(next)) commit(clamp(next));
        }}
      />
    </>
  );
}

/** COMBO:下拉(原生 select=键盘可达,画布内嵌不弹 portal,照节点卡先例) */
function ComfyComboControl({
  schema,
  current,
  commit,
  disabled,
  label,
  labelTitle,
  controlDomId,
}: {
  schema: ComfyComboWidgetSchema;
  current: ComfyWidgetValue;
  commit: (next: ComfyWidgetValue) => void;
  disabled?: boolean;
  label: string;
  labelTitle: string;
  controlDomId: string;
}) {
  // 空选项防御:过滤非字符串后为空 → 禁用+占位文案,不崩渲染
  const options = (schema.options ?? []).filter((item): item is string => typeof item === "string");
  const value = typeof current === "string" ? current : String(current ?? "");
  // 当前值不在候选里(如插件更新后选项变了)→ 补一项保持显示真实值,不静默跳变
  const effectiveOptions = options.length > 0 && value !== "" && !options.includes(value)
    ? [value, ...options]
    : options;

  return (
    <label
      className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"
      title={labelTitle}
    >
      <span className="shrink-0 truncate">{label}</span>
      {effectiveOptions.length === 0 ? (
        <span
          className="flex h-7 items-center rounded-md border border-border bg-card/60 px-2 text-xs text-muted-foreground/70"
          title="该参数当前没有可选项"
        >
          暂无可选项
        </span>
      ) : (
        <select
          id={controlDomId}
          value={value}
          aria-label={label}
          disabled={disabled}
          onChange={(event) => commit(event.target.value)}
          className="h-7 max-w-[60%] shrink-0 rounded-md border border-border bg-card/80 px-1 text-xs text-foreground outline-none"
        >
          {effectiveOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      )}
    </label>
  );
}

/** STRING:多行输入框(提示词铁律:field-sizing 随内容长高) */
function ComfyStringControl({
  schema,
  current,
  commit,
  disabled,
  label,
  labelTitle,
  controlDomId,
}: {
  schema: ComfyStringWidgetSchema;
  current: ComfyWidgetValue;
  commit: (next: ComfyWidgetValue) => void;
  disabled?: boolean;
  label: string;
  labelTitle: string;
  controlDomId: string;
}) {
  const value = typeof current === "string" ? current : String(current ?? "");
  return (
    <div className="space-y-1">
      <label className="block text-[11px] text-muted-foreground" title={labelTitle} htmlFor={controlDomId}>
        {label}
      </label>
      <textarea
        id={controlDomId}
        value={value}
        aria-label={label}
        placeholder={schema.placeholder ?? ""}
        disabled={disabled}
        onChange={(event) => commit(event.target.value)}
        rows={2}
        className="nodrag nopan min-h-[48px] w-full rounded-md border border-border bg-card/80 px-1.5 py-1 text-[11px] leading-5 text-foreground outline-none [field-sizing:content]"
      />
    </div>
  );
}
