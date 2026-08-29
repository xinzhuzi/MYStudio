/**
 * 分层定位(2026-08-29 迁自 lib/assist/freedom-*,Trellis 08-28-freedom-image-engine-rename 批次 A):
 * 渠道/引擎层——与 image-generator/mikoto-async 同层,服务于所有生图消费方
 * (自由面板/分镜批量/资产生成),不隶属任何单一面板。行为零变更,纯迁移。
 */
import { useMediaStore } from "@/stores/media/media-store";
import { useProjectStore } from "@/stores/project/project-store";

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
