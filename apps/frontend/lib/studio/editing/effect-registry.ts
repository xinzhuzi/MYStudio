import type {
  EditingEffectDefinition,
  EditingEffectId,
} from "@/types/editing";

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
