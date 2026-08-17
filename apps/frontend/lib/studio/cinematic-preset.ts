import type { StoryboardItem } from "@/types/studio";
import type { CinematicCameraPreset as CompositionCinematicCameraPreset } from "@/electron/rendering/plugins/remotion/composition/composition-props";

export const CINEMATIC_CAMERA_PRESETS = [
  "cinematic-dolly-in",
  "cinematic-dolly-out",
  "cinematic-crane-up",
  "cinematic-crane-down",
  "cinematic-orbit",
  "cinematic-parallax-lr",
  "cinematic-parallax-ud",
  "cinematic-ken-burns-3d",
  "cinematic-handheld",
  "cinematic-dutch-roll",
  "cinematic-vertigo",
  "cinematic-spiral",
  "cinematic-arc-left",
  "cinematic-arc-right",
  "cinematic-reveal-tilt-up",
  "cinematic-drift",
  "cinematic-fall",
  "cinematic-zoom-in",
  "cinematic-zoom-out",
  "cinematic-tilt-down",
  "cinematic-pan-left",
  "cinematic-pan-right",
  "cinematic-whip-pan",
  "cinematic-pedestal-up",
  "cinematic-pedestal-down",
  "cinematic-tracking-left",
  "cinematic-tracking-right",
  "cinematic-fly-through",
  "cinematic-pull-back-reveal",
  "cinematic-crash-zoom",
  "cinematic-slow-push",
  "cinematic-rise-and-pull",
  "cinematic-descend-and-push",
  "cinematic-impact",
  "cinematic-breathing",
] as const satisfies readonly CompositionCinematicCameraPreset[];

export type CinematicCameraPreset = (typeof CINEMATIC_CAMERA_PRESETS)[number];

export interface StoryboardCinematicConfig {
  preset: CinematicCameraPreset;
  parallaxStrength: number;
  dofAperture: number;
}

export type CinematicStoryboardItem = StoryboardItem & {
  cinematic?: StoryboardCinematicConfig;
};

export const DEFAULT_CINEMATIC_PARALLAX_STRENGTH = 0.35;
export const DEFAULT_CINEMATIC_DOF_APERTURE = 2.8;

const CINEMATIC_PRESET_LABELS: Record<CinematicCameraPreset, string> = {
  "cinematic-dolly-in": "推进 Dolly In",
  "cinematic-dolly-out": "拉远 Dolly Out",
  "cinematic-crane-up": "升降 Crane Up",
  "cinematic-crane-down": "下降 Crane Down",
  "cinematic-orbit": "环绕 Orbit",
  "cinematic-parallax-lr": "横向视差 Parallax LR",
  "cinematic-parallax-ud": "纵向视差 Parallax UD",
  "cinematic-ken-burns-3d": "三维 Ken Burns",
  "cinematic-handheld": "手持 Handheld",
  "cinematic-dutch-roll": "荷兰滚 Dutch Roll",
  "cinematic-vertigo": "眩晕 Vertigo",
  "cinematic-spiral": "螺旋 Spiral",
  "cinematic-arc-left": "左弧 Arc Left",
  "cinematic-arc-right": "右弧 Arc Right",
  "cinematic-reveal-tilt-up": "仰摇揭示 Reveal Tilt Up",
  "cinematic-drift": "漂移 Drift",
  "cinematic-fall": "坠落 Fall",
  "cinematic-zoom-in": "变焦推进 Zoom In",
  "cinematic-zoom-out": "变焦拉远 Zoom Out",
  "cinematic-tilt-down": "俯摇 Tilt Down",
  "cinematic-pan-left": "左摇 Pan Left",
  "cinematic-pan-right": "右摇 Pan Right",
  "cinematic-whip-pan": "甩镜 Whip Pan",
  "cinematic-pedestal-up": "垂直上升 Pedestal Up",
  "cinematic-pedestal-down": "垂直下降 Pedestal Down",
  "cinematic-tracking-left": "左向跟拍 Tracking Left",
  "cinematic-tracking-right": "右向跟拍 Tracking Right",
  "cinematic-fly-through": "穿越 Fly Through",
  "cinematic-pull-back-reveal": "拉远揭示 Pull Back Reveal",
  "cinematic-crash-zoom": "急推 Crash Zoom",
  "cinematic-slow-push": "慢推 Slow Push",
  "cinematic-rise-and-pull": "升起拉远 Rise And Pull",
  "cinematic-descend-and-push": "下降推进 Descend And Push",
  "cinematic-impact": "冲击 Impact",
  "cinematic-breathing": "呼吸感 Breathing",
};

export function isCinematicCameraPreset(value: unknown): value is CinematicCameraPreset {
  return typeof value === "string"
    && (CINEMATIC_CAMERA_PRESETS as readonly string[]).includes(value);
}

export function validateStoryboardCinematic(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return "cinematic 必须是对象";
  if (!isCinematicCameraPreset(value.preset)) {
    return `cinematic.preset 非法：${String(value.preset ?? "缺失")}`;
  }
  if (typeof value.parallaxStrength !== "number"
    || !Number.isFinite(value.parallaxStrength)
    || value.parallaxStrength < 0
    || value.parallaxStrength > 1) {
    return "cinematic.parallaxStrength 必须是 0 到 1 之间的有限数字";
  }
  if (typeof value.dofAperture !== "number"
    || !Number.isFinite(value.dofAperture)
    || value.dofAperture < 0) {
    return "cinematic.dofAperture 必须是非负有限数字";
  }
  return undefined;
}

export function getStoryboardCinematic(item: StoryboardItem): StoryboardCinematicConfig | undefined {
  const value = (item as CinematicStoryboardItem).cinematic;
  return validateStoryboardCinematic(value) === undefined ? value : undefined;
}

export function getCinematicPresetLabel(value: unknown): string | undefined {
  return isCinematicCameraPreset(value) ? CINEMATIC_PRESET_LABELS[value] : undefined;
}

export function getCinematicPresetShortLabel(value: unknown): string | undefined {
  if (!isCinematicCameraPreset(value)) return undefined;
  return value.replace(/^cinematic-/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
