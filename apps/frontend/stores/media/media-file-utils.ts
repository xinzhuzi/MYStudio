import { MediaFile, MediaFolder, MediaFolderCategory, MediaType } from "@/types/media";

/**
 * 媒体文件工具族——类型侦测/图像尺寸/视频缩略图/时长/宽高比/删除守卫与系统分类常量(纯函数)。file-size-reduction zustand 专批拆出,体逐字保留。
 */
export const SYSTEM_CATEGORIES: Array<{
  category: MediaFolderCategory;
  name: string;
  icon: string; // lucide icon name for UI reference
}> = [
  { category: 'ai-image', name: 'AI图片', icon: 'Sparkles' },
  { category: 'ai-video', name: 'AI视频', icon: 'Film' },
  { category: 'upload',   name: '上传文件', icon: 'CloudUpload' },
];

// Helper function to determine file type
export const getFileType = (file: File): MediaType | null => {
  const { type } = file;

  if (type.startsWith("image/")) {
    return "image";
  }
  if (type.startsWith("video/")) {
    return "video";
  }
  if (type.startsWith("audio/")) {
    return "audio";
  }

  return null;
};

// Helper function to get image dimensions
export const getImageDimensions = (
  file: File
): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new window.Image();

    const objectUrl = URL.createObjectURL(file);

    img.addEventListener("load", () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      resolve({ width, height });
      img.remove();
      URL.revokeObjectURL(objectUrl);
    });

    img.addEventListener("error", () => {
      reject(new Error("Could not load image"));
      img.remove();
      URL.revokeObjectURL(objectUrl);
    });

    img.src = objectUrl;
  });
};

// Helper function to generate video thumbnail and get dimensions
export const generateVideoThumbnail = (
  file: File
): Promise<{ thumbnailUrl: string; width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video") as HTMLVideoElement;
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      reject(new Error("Could not get canvas context"));
      return;
    }

    video.addEventListener("loadedmetadata", () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Seek to 1 second or 10% of duration, whichever is smaller
      video.currentTime = Math.min(1, video.duration * 0.1);
    });

    const objectUrl = URL.createObjectURL(file);

    video.addEventListener("seeked", () => {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const thumbnailUrl = canvas.toDataURL("image/jpeg", 0.8);
      const width = video.videoWidth;
      const height = video.videoHeight;

      resolve({ thumbnailUrl, width, height });

      video.remove();
      canvas.remove();
      URL.revokeObjectURL(objectUrl);
    });

    video.addEventListener("error", () => {
      reject(new Error("Could not load video"));
      video.remove();
      canvas.remove();
      URL.revokeObjectURL(objectUrl);
    });

    video.src = objectUrl;
    video.load();
  });
};

// Helper function to get media duration
export const getMediaDuration = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const element = document.createElement(
      file.type.startsWith("video/") ? "video" : "audio"
    ) as HTMLVideoElement;

    const objectUrl = URL.createObjectURL(file);

    element.addEventListener("loadedmetadata", () => {
      resolve(element.duration);
      element.remove();
      URL.revokeObjectURL(objectUrl);
    });

    element.addEventListener("error", () => {
      reject(new Error("Could not load media"));
      element.remove();
      URL.revokeObjectURL(objectUrl);
    });

    element.src = objectUrl;
    element.load();
  });
};

export const getMediaAspectRatio = (item: MediaFile): number => {
  if (item.width && item.height) {
    return item.width / item.height;
  }
  return 16 / 9; // Default aspect ratio
};

export function assertProjectMediaDeleteAllowed(
  item: Pick<MediaFile, "projectId" | "ephemeral"> | undefined,
): void {
  if (item?.projectId && !item.ephemeral) {
    throw new Error("project-owned media must be deleted through the artifact plan");
  }
}

