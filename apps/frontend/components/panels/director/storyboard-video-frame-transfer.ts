import { prepareReferenceImageForTransfer } from "@/lib/ai/image-transfer";
import { uploadToImageHost, isImageHostConfigured } from "@/lib/image-host";
import { readImageAsBase64 } from "@/lib/image-storage";
import { useAPIConfigStore } from "@/stores/api-config-store";

export function normalizeStoryboardVideoFrameUrl(value: unknown): string {
  if (!value) return "";
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

export function isHttpImageUrl(value?: string | null): boolean {
  return typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"));
}

export function isLocalImageSource(value?: string | null): value is string {
  return typeof value === "string" && value.length > 0 && !isHttpImageUrl(value);
}

export function isDiscouragedExternalImageUrl(value?: string | null): boolean {
  if (!isHttpImageUrl(value)) return false;
  try {
    const hostname = new URL(value ?? "").hostname.toLowerCase();
    return hostname === "bmp.ovh" || hostname.endsWith(".bmp.ovh");
  } catch {
    return false;
  }
}

export function shouldRefreshImageViaCurrentHost(localUrl?: string | null): boolean {
  return isLocalImageSource(localUrl) && useAPIConfigStore.getState().isImageHostConfigured();
}

export interface StoryboardVideoFrameTransferOptions {
  localFallback?: string | null;
  frameLabel?: string;
  uploadName: string;
}

export async function convertStoryboardFrameToHttpUrl(
  rawUrl: unknown,
  options: StoryboardVideoFrameTransferOptions,
): Promise<string> {
  const url = normalizeStoryboardVideoFrameUrl(rawUrl);
  const localFallback = normalizeStoryboardVideoFrameUrl(options.localFallback);
  const frameLabel = options.frameLabel || "Frame";
  if (!url) {
    console.warn("[SplitScenes] convertToHttpUrl received invalid url:", rawUrl);
    return "";
  }

  if (isHttpImageUrl(url)) {
    if (shouldRefreshImageViaCurrentHost(localFallback)) {
      console.log(
        `[SplitScenes] ${frameLabel}: refreshing via configured image host instead of reusing existing HTTP URL${isDiscouragedExternalImageUrl(url) ? " (discouraged external host)" : ""}:`,
        url.substring(0, 60),
      );
      return convertStoryboardFrameToHttpUrl(localFallback, options);
    }
    if (isDiscouragedExternalImageUrl(url)) {
      console.warn(`[SplitScenes] ${frameLabel}: using discouraged external URL because no local fallback is available:`, url.substring(0, 60));
    } else {
      console.log("[SplitScenes] Using existing HTTP URL:", url.substring(0, 60));
    }
    return url;
  }

  try {
    if (!isImageHostConfigured()) {
      console.warn("[SplitScenes] Image host not configured. Please configure an image host in settings.");
      throw new Error("图床未配置，请先在设置中启用 Catbox 或其他可用图床");
    }

    let imageData = url;
    if (url.startsWith("local-image://")) {
      const fullBase64 = await readImageAsBase64(url);
      if (!fullBase64) {
        console.warn("[SplitScenes] Failed to read local image:", url);
        return "";
      }
      imageData = fullBase64;
    }

    imageData = await prepareReferenceImageForTransfer(imageData);
    console.log("[SplitScenes] Uploading image to image host...");
    const uploadResult = await uploadToImageHost(imageData, {
      name: options.uploadName,
      expiration: 15552000,
    });
    if (uploadResult.success && uploadResult.url) {
      console.log("[SplitScenes] Uploaded image to image host:", uploadResult.url.substring(0, 60));
      return uploadResult.url;
    }

    console.warn("[SplitScenes] Image upload failed:", uploadResult.error);
    throw new Error(uploadResult.error || "图片上传失败");
  } catch (error) {
    console.warn("[SplitScenes] Failed to upload image:", error);
    throw error;
  }
}
