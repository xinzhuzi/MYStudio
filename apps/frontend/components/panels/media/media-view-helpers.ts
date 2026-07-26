import type { MediaFile, MediaFolder } from "@/types/media";

export type MediaSortBy = "name" | "type" | "duration" | "size";
export type MediaSortOrder = "asc" | "desc";

export function getVisibleMediaFolders(
  folders: MediaFolder[],
  shareMedia: boolean,
  activeProjectId?: string,
): MediaFolder[] {
  if (shareMedia) return folders;
  if (!activeProjectId) return [];
  return folders.filter(
    (folder) => folder.isSystem || folder.projectId === activeProjectId,
  );
}

export function getVisibleMediaFiles(
  mediaFiles: MediaFile[],
  shareMedia: boolean,
  activeProjectId?: string,
): MediaFile[] {
  if (shareMedia) return mediaFiles;
  if (!activeProjectId) return [];
  return mediaFiles.filter((mediaFile) => mediaFile.projectId === activeProjectId);
}

export function getCurrentMediaFolders(
  folders: MediaFolder[],
  currentFolderId: string | null,
): MediaFolder[] {
  return folders.filter((folder) => folder.parentId === currentFolderId);
}

export function splitCurrentMediaFolders(
  currentFolders: MediaFolder[],
  currentFolderId: string | null,
): { systemFolders: MediaFolder[]; customFolders: MediaFolder[] } {
  if (currentFolderId !== null) {
    return { systemFolders: [], customFolders: currentFolders };
  }

  return {
    systemFolders: currentFolders.filter((folder) => folder.isSystem),
    customFolders: currentFolders.filter((folder) => !folder.isSystem),
  };
}

export function getMediaFolderFileCounts(
  currentFolders: MediaFolder[],
  visibleFolders: MediaFolder[],
  visibleMediaFiles: MediaFile[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  const getAllDescendantIds = (folderId: string): string[] => {
    const children = visibleFolders.filter(
      (folder) => folder.parentId === folderId,
    );
    return [
      folderId,
      ...children.flatMap((child) => getAllDescendantIds(child.id)),
    ];
  };

  for (const folder of currentFolders) {
    const allIds = new Set(getAllDescendantIds(folder.id));
    counts[folder.id] = visibleMediaFiles.filter(
      (mediaFile) =>
        !mediaFile.ephemeral &&
        mediaFile.folderId &&
        allIds.has(mediaFile.folderId),
    ).length;
  }

  return counts;
}

export function getMediaBreadcrumbPath(
  folders: MediaFolder[],
  currentFolderId: string | null,
): MediaFolder[] {
  const path: MediaFolder[] = [];
  let current = currentFolderId;

  while (current) {
    const folder = folders.find((item) => item.id === current);
    if (!folder) break;
    path.unshift(folder);
    current = folder.parentId;
  }

  return path;
}

export function getFilteredMediaItems(
  mediaFiles: MediaFile[],
  currentFolderId: string | null,
  sortBy: MediaSortBy,
  sortOrder: MediaSortOrder,
): MediaFile[] {
  const filtered = mediaFiles.filter(
    (item) =>
      !item.ephemeral && (item.folderId || null) === currentFolderId,
  );

  filtered.sort((a, b) => {
    let valueA: string | number;
    let valueB: string | number;

    switch (sortBy) {
      case "name":
        valueA = a.name.toLowerCase();
        valueB = b.name.toLowerCase();
        break;
      case "type":
        valueA = a.type;
        valueB = b.type;
        break;
      case "duration":
        valueA = a.duration || 0;
        valueB = b.duration || 0;
        break;
      case "size":
        valueA = a.file?.size || 0;
        valueB = b.file?.size || 0;
        break;
    }

    if (valueA < valueB) return sortOrder === "asc" ? -1 : 1;
    if (valueA > valueB) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  return filtered;
}

export function formatMediaDuration(duration: number): string {
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
