import type { SplitScene } from "@/stores/director-store";

export type StoryboardAngle =
  | "Back View"
  | "Over-the-Shoulder (OTS)"
  | "POV"
  | "Low Angle (Heroic)"
  | "High Angle (Vulnerable)"
  | "Dutch Angle (Tilted)";

export type MergedFrameMode = "first" | "last" | "both";
export type MergedFrameTask = { scene: SplitScene; type: "first" | "end" };

export function isStoryboardSceneCompleted(scene: SplitScene): boolean {
  return Boolean(scene.videoUrl || scene.videoStatus === "completed");
}

export function buildMergedFrameTasks(
  scenes: SplitScene[],
  mode: MergedFrameMode,
): MergedFrameTask[] {
  const tasks: MergedFrameTask[] = [];
  for (const scene of scenes) {
    if (isStoryboardSceneCompleted(scene)) continue;
    if ((mode === "first" || mode === "both") && !scene.imageDataUrl) {
      tasks.push({ scene, type: "first" });
    }
    if ((mode === "last" || mode === "both") && scene.needsEndFrame && !scene.endFrameImageUrl) {
      tasks.push({ scene, type: "end" });
    }
  }
  return tasks;
}

export function paginateMergedFrameTasks(
  tasks: MergedFrameTask[],
  pageSize = 9,
): MergedFrameTask[][] {
  const pages: MergedFrameTask[][] = [];
  for (let index = 0; index < tasks.length; index += pageSize) {
    pages.push(tasks.slice(index, index + pageSize));
  }
  return pages;
}

export function calculateMergedGridLayout(sceneCount: number) {
  return sceneCount <= 4
    ? { cols: 2, rows: 2, paddedCount: 4 }
    : { cols: 3, rows: 3, paddedCount: 9 };
}

export function calculateMergedGridAspectRatio(targetAspect: "16:9" | "9:16"): string {
  return targetAspect;
}

export function allocateStoryboardAngles(
  count: number,
  preselected: (string | undefined)[],
): StoryboardAngle[] {
  const result: StoryboardAngle[] = new Array(count);
  const quotas: Record<StoryboardAngle, number> = {
    "Back View": 2,
    "Over-the-Shoulder (OTS)": 3,
    POV: 2,
    "Low Angle (Heroic)": 1,
    "High Angle (Vulnerable)": 1,
    "Dutch Angle (Tilted)": 0,
  };

  for (let index = 0; index < count; index += 1) {
    const requested = (preselected[index] || "").toLowerCase();
    let matched: StoryboardAngle | undefined;
    if (requested.includes("over") && requested.includes("shoulder")) matched = "Over-the-Shoulder (OTS)";
    else if (requested.includes("pov") || requested.includes("point of view")) matched = "POV";
    else if (requested.includes("back")) matched = "Back View";
    else if (requested.includes("low angle")) matched = "Low Angle (Heroic)";
    else if (requested.includes("high angle")) matched = "High Angle (Vulnerable)";
    else if (requested.includes("dutch")) matched = "Dutch Angle (Tilted)";
    if (matched) {
      result[index] = matched;
      quotas[matched] = Math.max(0, quotas[matched] - 1);
    }
  }

  const fillOrder: StoryboardAngle[] = [
    "Over-the-Shoulder (OTS)",
    "POV",
    "Back View",
    "Low Angle (Heroic)",
    "High Angle (Vulnerable)",
    "Dutch Angle (Tilted)",
  ];
  for (let index = 0; index < count; index += 1) {
    if (result[index]) continue;
    for (const angle of fillOrder) {
      if (quotas[angle] > 0) {
        result[index] = angle;
        quotas[angle] -= 1;
        break;
      }
    }
    if (!result[index]) result[index] = "Over-the-Shoulder (OTS)";
  }
  return result;
}

function allowedShotFromSize(shot?: SplitScene["shotSize"] | null): string {
  switch (shot) {
    case "ecu": return "Extreme Close-up (ECU)";
    case "cu":
    case "mcu":
    case "ms":
    case "mls": return "Upper Body Shot (Chest-up)";
    case "ls": return "Full Body Shot";
    case "ws": return "Wide Angle Full Shot";
    default: return "Upper Body Shot (Chest-up)";
  }
}

function buildStoryboardAnchorPhrase(styleTokens?: string[]): string {
  const style = styleTokens?.length ? `Artistic style consistent: ${styleTokens.join(", ")}. ` : "";
  const noTextConstraint = "IMPORTANT: NO TEXT, NO WORDS, NO LETTERS, NO CAPTIONS, NO SPEECH BUBBLES, NO DIALOGUE BOXES, NO SUBTITLES, NO WRITING of any kind.";
  return `${style}Keep character appearance, wardrobe and facial features consistent. Keep lighting and color grading consistent. ${noTextConstraint}`;
}

export function composeStoryboardTilePrompt(
  scene: SplitScene,
  angle: StoryboardAngle,
  aspect: "16:9" | "9:16",
  styleTokens?: string[],
): string {
  const base = scene.imagePromptZh?.trim()
    || scene.imagePrompt?.trim()
    || scene.videoPromptZh?.trim()
    || scene.videoPrompt?.trim()
    || "";
  const vertical = aspect === "9:16" ? "vertical composition, tighter framing, avoid letterboxing, " : "";
  const style = styleTokens?.length ? ` Style: ${styleTokens.join(", ")}` : "";
  const characterCount = scene.characterIds?.length || 0;
  const characterConstraint = characterCount === 0
    ? "NO human figures in this frame, empty scene or environment only."
    : characterCount === 1
      ? "EXACTLY ONE person in frame, single character only, do NOT duplicate the character."
      : `EXACTLY ${characterCount} distinct people in frame, no more no less, each person appears only ONCE.`;

  return `${angle}, ${allowedShotFromSize(scene.shotSize)}, ${vertical}${characterConstraint} ${base}. ${buildStoryboardAnchorPhrase(styleTokens)}.${style}`
    .replace(/\s+/g, " ")
    .trim();
}
