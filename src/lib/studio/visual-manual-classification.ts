import type { StudioVisualManualCategory, StudioVisualManualSummary } from "@/types/studio-visual-manual";

export const DAOJIE_VISUAL_MANUAL_ID = "daojie_ink_guofeng";

export const DEFAULT_VISUAL_MANUAL_CATEGORY_LABELS: Record<Exclude<StudioVisualManualCategory, "daojie">, string> = {
  "2d": "2D 风格",
  "3d": "3D 风格",
  real: "真人风格",
  stop_motion: "定格风格",
  other: "其他风格",
};

const DEFAULT_VISUAL_MANUAL_CATEGORY_ORDER: Exclude<StudioVisualManualCategory, "daojie">[] = [
  "2d",
  "3d",
  "real",
  "stop_motion",
  "other",
];

export interface DefaultVisualManualGroup {
  id: Exclude<StudioVisualManualCategory, "daojie">;
  name: string;
  manuals: StudioVisualManualSummary[];
}

export function isDaojieVisualManual(manual: Pick<StudioVisualManualSummary, "stylePath" | "category">) {
  return manual.stylePath === DAOJIE_VISUAL_MANUAL_ID || manual.category === "daojie";
}

export function getDefaultVisualManuals(manuals: readonly StudioVisualManualSummary[]) {
  return manuals.filter((manual) => manual.sourceExists && !isDaojieVisualManual(manual));
}

export function getCustomVisualManuals(manuals: readonly StudioVisualManualSummary[]) {
  return manuals.filter((manual) => isDaojieVisualManual(manual) || !manual.sourceExists);
}

export function groupDefaultVisualManuals(manuals: readonly StudioVisualManualSummary[]): DefaultVisualManualGroup[] {
  const grouped = new Map<Exclude<StudioVisualManualCategory, "daojie">, StudioVisualManualSummary[]>();

  getDefaultVisualManuals(manuals).forEach((manual) => {
    const category = manual.category === "daojie" ? "other" : manual.category;
    const items = grouped.get(category) ?? [];
    items.push(manual);
    grouped.set(category, items);
  });

  return DEFAULT_VISUAL_MANUAL_CATEGORY_ORDER
    .map((id) => ({
      id,
      name: DEFAULT_VISUAL_MANUAL_CATEGORY_LABELS[id],
      manuals: (grouped.get(id) ?? []).sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN")),
    }))
    .filter((group) => group.manuals.length > 0);
}
