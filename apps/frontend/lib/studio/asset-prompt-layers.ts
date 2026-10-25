// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import type { AssetImageKind } from "@/types/studio-assets";

/**
 * 出图提示词分层装载器(10-25 出图提示词分层面板役 Phase A·A-4,PRD §4.1 A-4)。
 *
 * 真源=十型真源 qi21_bases.json(88KB,import.meta.glob 静态内联,沿 skill-files.ts
 * 装载范式);本件只做只读装载与视图化映射,不改写任何型文——型层/底座文案改动走
 * 既有型文四副本纪律(PRD §五边界)。
 *
 * 型名→bases 条目对齐键=zh 名(与 base_type 实发值同串:asset-type-shot.ts 以
 * AssetImageKind 枚举成员[=中文]注入 extraParams.base_type,bases.types[].zh 直接
 * 对齐,前端按名查表零映射;型谱 13 名 13/13 全对齐,bases 14 型多出的「分镜剧情图」
 * 属分镜域不在资产谱)。「查无该型」为防御位非预期路径(§4.4:该型无独立型文,
 * 共用底座)。
 *
 * 字段锚纪律:positive_text/negative_text/aspect_ratio/rgba_default 四字段被改名
 * 由 asset-prompt-layers.test.ts 钉红(装载器测试钉字段,PRD §九风险对策)。
 */

/** steps_hint 档(fast/quality 两档步数;自由型无此字段=null)。 */
export interface PromptStepsHint {
  fast: number;
  quality: number;
}

/** 风格底座层(L4:正 209 字/负 196 字,全部型共用)。 */
export interface PromptStyleBaseLayer {
  positiveText: string;
  negativeText: string;
}

/** 型层(L2/L3/L6:正向/负面/画幅/透明/步数档/purpose 一句)。 */
export interface PromptTypeLayer {
  /** 型名(zh 显示名,=AssetImageKind 枚举成员,亦为 base_type 注入名)。 */
  kind: string;
  /** purpose 一句(画幅/版式/职责说明,占位元语言归本字段不入正文)。 */
  purpose: string;
  /** 画幅全值(如「3:4 (Portrait Standard)」)。 */
  aspectRatio: string;
  /** 画幅短值(如「3:4」,摘要行/徽标用)。 */
  aspectRatioShort: string;
  /** 透明默认(RGBA 真源;true=型层注入直出真 Alpha)。 */
  rgbaDefault: boolean;
  /** 步数档(null=该型未给)。 */
  stepsHint: PromptStepsHint | null;
  /** 型层正向全文(千字级;自由型恒空)。 */
  positiveText: string;
  /** 型层负面全文。 */
  negativeText: string;
}

/** getPromptLayers 返回:{ base, type } 结构化分层(PRD §4.1 A-4)。 */
export interface PromptLayers {
  base: PromptStyleBaseLayer;
  type: PromptTypeLayer;
}

/** qi21_bases.json 原始形态(仅装载所需字段的窄视图;字段改名由测试锚钉红)。 */
interface Qi21BasesTypeEntry {
  zh: string;
  aspect_ratio: string;
  rgba_default: boolean;
  positive_text: string;
  negative_text: string;
  purpose: string;
  steps_hint?: { fast: number; quality: number } | null;
}

interface Qi21BasesDoc {
  art_style_base?: { positive_text?: string; negative_text?: string };
  types?: Qi21BasesTypeEntry[];
}

const basesModules = import.meta.glob(
  "../../assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
  { eager: true, import: "default" },
) as Record<string, Qi21BasesDoc>;

const basesDoc = Object.values(basesModules)[0];
const TYPE_ENTRIES: readonly Qi21BasesTypeEntry[] = Array.isArray(basesDoc?.types) ? basesDoc.types : [];
const TYPE_BY_ZH = new Map<string, Qi21BasesTypeEntry>(TYPE_ENTRIES.map((entry) => [entry.zh, entry]));

function toPromptTypeLayer(entry: Qi21BasesTypeEntry): PromptTypeLayer {
  const aspectRatio = typeof entry.aspect_ratio === "string" ? entry.aspect_ratio : "";
  const steps = entry.steps_hint;
  return {
    kind: entry.zh,
    purpose: typeof entry.purpose === "string" ? entry.purpose : "",
    aspectRatio,
    aspectRatioShort: aspectRatio.split(/\s+/)[0] || aspectRatio,
    rgbaDefault: entry.rgba_default === true,
    stepsHint:
      steps && typeof steps.fast === "number" && typeof steps.quality === "number"
        ? { fast: steps.fast, quality: steps.quality }
        : null,
    positiveText: typeof entry.positive_text === "string" ? entry.positive_text : "",
    negativeText: typeof entry.negative_text === "string" ? entry.negative_text : "",
  };
}

/** 风格底座层(全部型共用;真源缺失时为空串,面板按空文降级呈现)。 */
export function getPromptStyleBaseLayer(): PromptStyleBaseLayer {
  const base = basesDoc?.art_style_base;
  return {
    positiveText: typeof base?.positive_text === "string" ? base.positive_text : "",
    negativeText: typeof base?.negative_text === "string" ? base.negative_text : "",
  };
}

/**
 * 型名查分层(zh 名对齐键;查无该型返回 null=防御位,调用方按 §4.4 降级
 * 「该型无独立型文(共用底座)」,禁编造)。
 */
export function getPromptLayers(kind: AssetImageKind | string): PromptLayers | null {
  const entry = TYPE_BY_ZH.get(kind);
  if (!entry) return null;
  return { base: getPromptStyleBaseLayer(), type: toPromptTypeLayer(entry) };
}

/** bases 全型名清单(zh 名,供枚举/对齐测试;真源缺席时为空数组)。 */
export function listPromptLayerKinds(): string[] {
  return TYPE_ENTRIES.map((entry) => entry.zh);
}

/**
 * 「提示词构成」折叠组收起态摘要行(聚焦态,PRD §4.1 A-2 收起摘要):
 * 「{型名} {画幅}{·rgba} · 底座正{N}字/负{M}字 · 型负{K}字」。
 * 查无该型(防御位)降级为「{型名} · 该型无独立型文 · 底座正{N}字/负{M}字」;
 * 空型名返回 null(通用态摘要由调用方自render「点击任一生成按钮查看该型构成」)。
 */
export function buildPromptLayerSummary(kind: AssetImageKind | string): string | null {
  if (!kind) return null;
  const base = getPromptStyleBaseLayer();
  const baseSegment = `底座正${base.positiveText.length}字/负${base.negativeText.length}字`;
  const entry = TYPE_BY_ZH.get(kind);
  if (!entry) {
    return `${kind} · 该型无独立型文 · ${baseSegment}`;
  }
  const layer = toPromptTypeLayer(entry);
  const rgbaSuffix = layer.rgbaDefault ? "·rgba" : "";
  return `${layer.kind} ${layer.aspectRatioShort}${rgbaSuffix} · ${baseSegment} · 型负${layer.negativeText.length}字`;
}
