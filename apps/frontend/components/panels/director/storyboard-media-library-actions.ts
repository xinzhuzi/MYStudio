import { toast } from "sonner";
import type { SplitScene } from "@/stores/director-store";
import type { MediaType } from "@/types/media";

type AddMediaFromUrl = (options: {
  url: string;
  name: string;
  type: MediaType;
  source: "upload" | "ai-image" | "ai-video";
  thumbnailUrl?: string;
  duration?: number;
  folderId?: string | null;
  projectId?: string;
}) => string;

export type SaveStoryboardSceneToLibraryOptions = {
  scene: SplitScene;
  type: "image" | "video";
  projectId?: string;
  addMediaFromUrl: AddMediaFromUrl;
  getImageFolderId: () => string;
  getVideoFolderId: () => string;
};

/**
 * Persists a storyboard scene's generated image/video using the same system
 * folders and user-facing error semantics in both Director workflows.
 */
export function saveStoryboardSceneToLibrary({
  scene,
  type,
  projectId,
  addMediaFromUrl,
  getImageFolderId,
  getVideoFolderId,
}: SaveStoryboardSceneToLibraryOptions): void {
  try {
    if (type === "video") {
      if (!scene.videoUrl) {
        toast.error("没有可保存的视频");
        return;
      }
      addMediaFromUrl({
        url: scene.videoUrl,
        name: `分镜 ${scene.id + 1} - AI视频`,
        type: "video",
        source: "ai-video",
        thumbnailUrl: scene.imageDataUrl,
        duration: scene.duration || 5,
        folderId: getVideoFolderId(),
        projectId,
      });
      toast.success(`分镜 ${scene.id + 1} 视频已保存到素材库`);
      return;
    }

    if (!scene.imageDataUrl) {
      toast.error("没有可保存的图片");
      return;
    }
    addMediaFromUrl({
      url: scene.imageDataUrl,
      name: `分镜 ${scene.id + 1} - AI图片`,
      type: "image",
      source: "ai-image",
      folderId: getImageFolderId(),
      projectId,
    });
    toast.success(`分镜 ${scene.id + 1} 图片已保存到素材库`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    toast.error(`保存失败: ${message}`);
  }
}
