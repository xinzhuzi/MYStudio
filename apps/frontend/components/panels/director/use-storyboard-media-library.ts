import { useCallback } from "react";
import { useMediaStore } from "@/stores/media-store";

export function useStoryboardMediaLibrary(projectId?: string) {
  const addMediaFromUrl = useMediaStore((state) => state.addMediaFromUrl);
  const getOrCreateCategoryFolder = useMediaStore((state) => state.getOrCreateCategoryFolder);

  const saveVideo = useCallback((sceneId: number, videoUrl: string, thumbnailUrl?: string, duration?: number) => {
    const mediaId = addMediaFromUrl({
      url: videoUrl,
      name: `分镜 ${sceneId + 1} - AI视频`,
      type: "video",
      source: "ai-video",
      thumbnailUrl,
      duration: duration || 5,
      folderId: getOrCreateCategoryFolder("ai-video"),
      projectId,
    });
    console.log("[StoryboardMediaLibrary] Auto-saved video:", mediaId);
    return mediaId;
  }, [addMediaFromUrl, getOrCreateCategoryFolder, projectId]);

  const saveImage = useCallback((sceneId: number, imageUrl: string) => {
    const mediaId = addMediaFromUrl({
      url: imageUrl,
      name: `分镜 ${sceneId + 1} - AI图片`,
      type: "image",
      source: "ai-image",
      folderId: getOrCreateCategoryFolder("ai-image"),
      projectId,
    });
    console.log("[StoryboardMediaLibrary] Auto-saved image:", mediaId);
    return mediaId;
  }, [addMediaFromUrl, getOrCreateCategoryFolder, projectId]);

  return { saveVideo, saveImage };
}
