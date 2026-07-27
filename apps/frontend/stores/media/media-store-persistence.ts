import type { MediaFile, MediaFolder } from "@/types/media";

export type MediaPersistedState = {
  folders: MediaFolder[];
  mediaFiles: MediaFile[];
};

export function splitMediaData(state: MediaPersistedState, projectId: string) {
  return {
    projectData: {
      folders: state.folders.filter((folder) => folder.projectId === projectId && !folder.isSystem),
      mediaFiles: state.mediaFiles.filter((mediaFile) => mediaFile.projectId === projectId),
    },
    sharedData: {
      folders: state.folders.filter((folder) => folder.isSystem || (!folder.projectId && !folder.isAutoCreated)),
      mediaFiles: state.mediaFiles.filter((mediaFile) => !mediaFile.projectId),
    },
  };
}

export function mergeMediaData(
  projectData: MediaPersistedState | null,
  sharedData: MediaPersistedState | null,
): MediaPersistedState {
  return {
    folders: [
      ...(sharedData?.folders ?? []),
      ...(projectData?.folders ?? []),
    ],
    mediaFiles: [
      ...(sharedData?.mediaFiles ?? []),
      ...(projectData?.mediaFiles ?? []),
    ],
  };
}

export function normalizeMediaUrl(url: unknown): string | undefined {
  if (!url) return undefined;
  if (Array.isArray(url)) return url[0] || undefined;
  if (typeof url === "string") return url;
  return undefined;
}

export function partializeMediaData(state: MediaPersistedState) {
  return {
    folders: state.folders,
    mediaFiles: state.mediaFiles
      .filter((mediaFile) => !mediaFile.ephemeral)
      .map((mediaFile) => {
        const url = normalizeMediaUrl(mediaFile.url);
        const thumbnailUrl = normalizeMediaUrl(mediaFile.thumbnailUrl);
        const isTransientUrl = (value?: string) =>
          !value || value.startsWith("blob:") || value.startsWith("data:");

        return {
          ...mediaFile,
          file: undefined,
          url: isTransientUrl(url) ? undefined : url,
          thumbnailUrl: isTransientUrl(thumbnailUrl) ? undefined : thumbnailUrl,
        };
      }),
  };
}
