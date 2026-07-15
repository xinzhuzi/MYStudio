import type { SplitScene } from "@/stores/director-store";

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
