/**
 * 程序化氛围/遮挡模板闭集(08-19 multilayer-composition Child2)。
 *
 * 单源权威:决策端(ATMOSPHERE_GUIDE 喂 AI)、渲染端(atmosphere-layers.tsx
 * 实例化)、校验闸(composition-props-validation 模板 id 闭集)三方共同 import
 * 本清单——枚举镜像纪律的单一权威清单模式(同 cinematic-luts.ts)。
 *
 * description=语义标注,格式「模板名:视觉描述——场景短语,情绪短语」(AI 选层
 * 的参考语义,同 cn-* LUT 卡喂法)。全部程序化渲染,零外部素材零许可负担。
 */

/** 渲染端组件族:fog=雾带(CSS 渐变+blur) particles=粒子场(seeded)。 */
export type AtmosphereTemplateKind = "fog" | "particles";

export type AtmosphereTemplateId =
  | "atmo:fog-band"
  | "atmo:mist-veil"
  | "atmo:foliage-sway"
  | "atmo:light-dust"
  | "atmo:petals"
  | "atmo:embers"
  | "atmo:snow"
  | "atmo:fireflies";

export interface AtmosphereTemplateDefn {
  id: AtmosphereTemplateId;
  /** 语义标注(情绪+场景),AI 选层参考。 */
  description: string;
  kind: AtmosphereTemplateKind;
  /** 渲染参数缺省(数值;决策层 intensity 0..2 缩放 opacity/count)。 */
  defaults: Record<string, number>;
}

export const ATMOSPHERE_TEMPLATES: readonly AtmosphereTemplateDefn[] = [
  {
    id: "atmo:fog-band",
    description: "冷雾带:半透明冷白雾横贯画面缓缓漂移——山崖/水岸/晨林/仙阵,情绪空灵清冷",
    kind: "fog",
    defaults: { y: 0.55, height: 0.3, speed: 1.5, blur: 26, opacity: 0.2 },
  },
  {
    id: "atmo:mist-veil",
    description: "薄纱雾:高而柔的大面积薄雾笼罩——梦境/回忆/秘境/离愁,情绪朦胧惆怅",
    kind: "fog",
    defaults: { y: 0.35, height: 0.5, speed: 0.8, blur: 40, opacity: 0.12 },
  },
  {
    id: "atmo:foliage-sway",
    description: "枝叶飘落:大叶片前景飘落摇曳遮挡——秋林/庭院/山径/别离,情绪萧瑟眷恋",
    kind: "particles",
    defaults: { count: 10, seed: 71001, r: 96, g: 138, b: 78, sizeMin: 20, sizeMax: 44, dir: -1, riseSpeed: 6, driftSpeed: 8, sway: 3, swayFreq: 0.4, blink: 0, glow: 0.25, shape: 1, opacity: 0.85 },
  },
  {
    id: "atmo:light-dust",
    description: "光尘上飘:暖白微光尘埃向上飘散闪烁——暖光内景/灵光/记忆,情绪温柔希望",
    kind: "particles",
    defaults: { count: 48, seed: 20260819, r: 255, g: 246, b: 218, sizeMin: 2, sizeMax: 6, dir: 1, riseSpeed: 14, driftSpeed: 16, sway: 0, swayFreq: 0, blink: 0.65, glow: 0.9, shape: 0, opacity: 0.7 },
  },
  {
    id: "atmo:petals",
    description: "花瓣飘落:粉白花瓣旋转飘落——春景/花树/相逢/誓约,情绪浪漫柔美",
    kind: "particles",
    defaults: { count: 22, seed: 72002, r: 255, g: 190, b: 205, sizeMin: 6, sizeMax: 14, dir: -1, riseSpeed: 5, driftSpeed: 10, sway: 4, swayFreq: 0.5, blink: 0, glow: 0.1, shape: 1, opacity: 0.8 },
  },
  {
    id: "atmo:embers",
    description: "火星升腾:橙红火星上飘明灭——火场/战阵/怒意/劫火,情绪炽烈危急",
    kind: "particles",
    defaults: { count: 36, seed: 73003, r: 255, g: 140, b: 60, sizeMin: 2, sizeMax: 5, dir: 1, riseSpeed: 26, driftSpeed: 10, sway: 2, swayFreq: 0.6, blink: 0.8, glow: 1, shape: 0, opacity: 0.8 },
  },
  {
    id: "atmo:snow",
    description: "落雪:细雪缓降——冬夜/荒原/孤旅/诀别,情绪孤寂苍凉",
    kind: "particles",
    defaults: { count: 64, seed: 74004, r: 240, g: 246, b: 252, sizeMin: 2, sizeMax: 5, dir: -1, riseSpeed: 4, driftSpeed: 6, sway: 1.5, swayFreq: 0.3, blink: 0, glow: 0.15, shape: 0, opacity: 0.75 },
  },
  {
    id: "atmo:fireflies",
    description: "萤火明灭:黄绿光点悬停闪烁——夏夜/竹林的萤火虫,情绪静谧治愈",
    kind: "particles",
    defaults: { count: 16, seed: 75005, r: 208, g: 255, b: 140, sizeMin: 3, sizeMax: 6, dir: 1, riseSpeed: 2, driftSpeed: 5, sway: 2, swayFreq: 0.35, blink: 0.9, glow: 1, shape: 0, opacity: 0.85 },
  },
];

const TEMPLATE_IDS = new Set<string>(ATMOSPHERE_TEMPLATES.map((template) => template.id));

export function isAtmosphereTemplateId(value: unknown): value is AtmosphereTemplateId {
  return typeof value === "string" && TEMPLATE_IDS.has(value);
}

export function getAtmosphereTemplate(id: AtmosphereTemplateId): AtmosphereTemplateDefn {
  return ATMOSPHERE_TEMPLATES.find((template) => template.id === id)!;
}

/**
 * 相邻镜防同相:模板 id 哈希派生 0..1 相位偏移(替代 phase 恒 0 的前科;
 * 同模板相邻镜也不做同步呼吸)。
 */
export function atmosphereTemplatePhase(id: AtmosphereTemplateId): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return (hash % 100) / 100;
}
