import type { MediaFile, MediaFolder, MediaSource, MediaType } from "@/types/media";

export function getLocalMediaUrlCategory(url?: string | null): string | null {
  if (!url) return null;
  const match = url.match(/^local-(?:image|video):\/\/([^/]+)\//);
  return match ? decodeURIComponent(match[1]) : null;
}

export function getMediaFileStorageMoveCategory(
  media: Pick<MediaFile, "type">,
  folder?: Pick<MediaFolder, "isSystem" | "category"> | null,
): string | null {
  if (!folder?.isSystem || !folder.category) return null;
  if (folder.category === "ai-image" && media.type === "image") return "ai-image";
  if (folder.category === "ai-video" && media.type === "video") return "ai-video";
  if (folder.category === "upload" && (media.type === "image" || media.type === "video")) return "upload";
  return null;
}

export function getMediaStorageCategoryForNewUrl(
  type: MediaType,
  source: MediaSource,
  folder?: Pick<MediaFolder, "isSystem" | "category"> | null,
): string {
  const folderCategory = getMediaFileStorageMoveCategory({ type }, folder);
  if (folderCategory) return folderCategory;
  if (source === "ai-image" && type === "image") return "ai-image";
  if (source === "ai-video" && type === "video") return "ai-video";
  if (source === "upload" && (type === "image" || type === "video")) return "upload";
  return type === "video" ? "videos" : "shots";
}

export function withMovedMediaUrl<T extends MediaFile>(
  media: T,
  folderId: string | null,
  movedUrl?: string | null,
  movedThumbnailUrl?: string | null,
): T {
  return {
    ...media,
    folderId,
    ...(movedUrl ? { url: movedUrl } : {}),
    ...(movedThumbnailUrl ? { thumbnailUrl: movedThumbnailUrl } : {}),
  };
}
