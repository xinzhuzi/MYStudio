import { useMediaStore } from "@/stores/media-store";
import { useProjectStore } from "@/stores/project-store";

export type FreedomMediaSource = "ai-image" | "ai-video";

export function saveFreedomImage(url: string, prompt: string): string | undefined {
  return saveToMediaLibrary(url, prompt, "ai-image");
}

export function saveToMediaLibrary(
  url: string,
  prompt: string,
  source: FreedomMediaSource,
): string | undefined {
  try {
    const mediaStore = useMediaStore.getState();
    const projectId = useProjectStore.getState().activeProjectId;
    const name = prompt.slice(0, 30).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_") || "freedom";
    const type = source === "ai-image" ? "image" : "video";
    return mediaStore.addMediaFromUrl({
      url,
      name: `${name}_${Date.now()}`,
      type,
      source,
      projectId: projectId || undefined,
    });
  } catch (error) {
    console.warn("[Freedom] Failed to save to media library:", error);
    return undefined;
  }
}
