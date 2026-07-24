import type { SplitScene } from "@/stores/director-store";

/** Trailer scenes are identified by the existing scene-name marker. */
export function filterTrailerScenes(scenes: SplitScene[]): SplitScene[] {
  return scenes.filter((scene) => (scene.sceneName || "").includes("预告片"));
}
