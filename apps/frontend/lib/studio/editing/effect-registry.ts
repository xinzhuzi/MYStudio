import type {
  EditingEffectDefinition,
  EditingEffectId,
} from "@/types/editing";
import { CINEMATIC_LUT_IDS } from "../remotion/cinematic-luts";

export const EDITING_EFFECT_IDS = [
  "cut",
  "fade",
  "crossfade",
  "flash",
  "blackout",
  "panZoom",
  "shake",
  "glitch",
  "chromaticAberration",
  "blur",
  "glow",
  "grain",
  "speed",
  "afterimage",
  "speedSilhouette",
  "godRays",
  "onTwos",
  "gradePulse",
  "atmosphere",
  // 存量补注册(08-20 一键成片真跑暴露):grade/ambient 早被 build-composition-props
  // 消费(08-18-haldclut/08-19 环境动画)但从未进注册表——validateTimelineRenderPlan
  // 在应用内队列路径对未注册 id 报「未知效果 ID」拒渲染(standalone 不跑此闸故未早暴)。
  "grade",
  "ambient",
] as const satisfies readonly EditingEffectId[];

const EFFECT_DEFINITIONS: readonly EditingEffectDefinition[] = [
  definition("cut", "transition", "full"),
  definition("fade", "transition", "full", [
    numberParameter("opacity", 1, 0, 1),
  ]),
  definition("crossfade", "transition", "full", [
    enumParameter("curve", "linear", ["linear", "ease-in-out"]),
  ]),
  definition("flash", "transition", "full", [
    numberParameter("intensity", 0.8, 0, 1),
  ]),
  definition("blackout", "transition", "full", [
    numberParameter("hold", 0.15, 0, 1),
  ]),
  definition("panZoom", "motion", "full", [
    numberParameter("scaleFrom", 1, 1, 8),
    numberParameter("scaleTo", 1.06, 1, 8),
    numberParameter("x", 0.5, 0, 1),
    numberParameter("y", 0.5, 0, 1),
  ]),
  definition("shake", "motion", "approximate", [
    numberParameter("intensity", 0.25, 0, 1),
    numberParameter("frequency", 8, 0.1, 30),
  ]),
  definition("glitch", "style", "approximate", [
    numberParameter("intensity", 0.35, 0, 1),
  ]),
  definition("chromaticAberration", "style", "approximate", [
    numberParameter("offset", 3, 0, 24),
  ]),
  definition("blur", "style", "full", [
    numberParameter("radius", 4, 0, 64),
  ]),
  definition("glow", "style", "approximate", [
    numberParameter("intensity", 0.4, 0, 1),
  ]),
  definition("grain", "style", "approximate", [
    numberParameter("amount", 0.12, 0, 1),
  ]),
  definition("speed", "time", "full", [
    numberParameter("rate", 1, 0.25, 4),
  ]),
  definition("afterimage", "style", "approximate", [
    numberParameter("copies", 3, 1, 5),
    numberParameter("offset", 26, 4, 80),
    numberParameter("opacity", 0.5, 0.05, 1),
  ]),
  definition("speedSilhouette", "motion", "approximate", [
    enumParameter("direction", "ltr", ["ltr", "rtl"]),
  ]),
  definition("godRays", "style", "approximate", [
    numberParameter("intensity", 0.6, 0, 1),
    numberParameter("hue", 45, 0, 360),
  ]),
  definition("onTwos", "motion", "full", [
    numberParameter("step", 2, 2, 3),
  ]),
  definition("gradePulse", "style", "approximate", [
    numberParameter("amp", 0.08, 0.01, 0.5),
    numberParameter("freq", 0.3, 0.05, 2),
  ]),
  // 程序化氛围层(08-19 multilayer-composition Child1):template id 由
  // atmosphere-templates 闭集校验(Child2),params 透传渲染端模板参数。
  definition("atmosphere", "style", "full", [
    numberParameter("intensity", 1, 0, 2),
  ]),
  // 成片调色(08-18-haldclut-grade 存量补注册):lutId 闭集见 cinematic-luts.ts。
  definition("grade", "style", "full", [
    enumParameter("lutId", "cn-daiqing", CINEMATIC_LUT_IDS),
    numberParameter("blend", 0.5, 0, 1),
  ]),
  // 环境动画(08-19 存量补注册):sin/cos 周期运动,类型 5 枚举。
  definition("ambient", "motion", "full", [
    enumParameter("type", "float", ["float", "breathe", "sway", "pulse", "flow"]),
    numberParameter("ampX", 0.004, 0, 0.05),
    numberParameter("ampY", 0.006, 0, 0.05),
    numberParameter("ampScale", 0.008, 0, 0.03),
    numberParameter("ampRot", 0.2, 0, 1),
    numberParameter("freq", 0.25, 0.1, 0.8),
    numberParameter("phase", 0, 0, 1),
  ]),
];

const EFFECTS_BY_ID = new Map(
  EFFECT_DEFINITIONS.map((item) => [item.id, item] as const),
);

export function isEditingEffectId(value: unknown): value is EditingEffectId {
  return typeof value === "string" && EFFECTS_BY_ID.has(value as EditingEffectId);
}

export function getEditingEffectDefinition(
  value: unknown,
): EditingEffectDefinition | null {
  return isEditingEffectId(value) ? EFFECTS_BY_ID.get(value) ?? null : null;
}

export function getEditingEffectDefinitions() {
  return EFFECT_DEFINITIONS;
}

function definition(
  id: EditingEffectId,
  category: EditingEffectDefinition["category"],
  preview: EditingEffectDefinition["preview"],
  parameters: EditingEffectDefinition["parameters"] = [],
): EditingEffectDefinition {
  return { id, category, preview, finalRenderer: "ffmpeg", parameters };
}

function numberParameter(
  name: string,
  defaultValue: number,
  min: number,
  max: number,
) {
  return { name, kind: "number", defaultValue, min, max } as const;
}

function enumParameter(
  name: string,
  defaultValue: string,
  values: readonly string[],
) {
  return { name, kind: "enum", defaultValue, values } as const;
}
