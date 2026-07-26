import type { PolishResult } from "@/lib/ai/prompt-polisher";
import { getImageStorageBridge } from "@/lib/bridge/image-storage";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";

export async function persistGeneratedAssetPromptToLibrary(
  assetId: string,
  polishResult?: PolishResult,
) {
  const prompt = polishResult?.status === "success" ? polishResult.prompt?.trim() : "";
  if (typeof window === "undefined" || !getStudioAssetsBridge()?.update || !prompt) {
    return false;
  }

  try {
    const result = await getStudioAssetsBridge()!.update({
      id: assetId,
      updates: { prompt },
    });
    return Boolean(result);
  } catch (error) {
    console.warn("[Asset] Persist generated prompt failed:", error);
    return false;
  }
}

export async function saveGeneratedAssetImageToLibrary(
  assetId: string,
  imagePath?: string,
  polishResult?: PolishResult,
) {
  if (typeof window === "undefined" || !getStudioAssetsBridge() || !imagePath) {
    return false;
  }

  const sourceFilePath = await materializeGeneratedImageForAssetLibrary(assetId, imagePath);
  let imageSaved = false;
  const studioAssets = getStudioAssetsBridge();
  if (sourceFilePath && studioAssets) {
    const result = await studioAssets.replaceImage({ assetId, sourceFilePath });
    imageSaved = Boolean(result);
  }

  await persistGeneratedAssetPromptToLibrary(assetId, polishResult);

  return imageSaved;
}

async function materializeGeneratedImageForAssetLibrary(assetId: string, imagePath: string) {
  if (imagePath.startsWith("local-image://")) {
    return getImageStorageBridge()?.getAbsolutePath?.(imagePath) ?? null;
  }

  if (imagePath.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(imagePath).pathname);
    } catch {
      return null;
    }
  }

  if (imagePath.startsWith("/")) {
    return imagePath;
  }

  if ((imagePath.startsWith("http://") || imagePath.startsWith("https://") || imagePath.startsWith("data:")) && getStudioAssetsBridge()?.saveMaterial) {
    const response = await fetch(imagePath);
    const blob = await response.blob();
    const bytes = await blob.arrayBuffer();
    const result = await getStudioAssetsBridge()!.saveMaterial({
      name: `${assetId}_generated_${Date.now()}.png`,
      bytes,
    });
    return result.success ? result.filePath ?? result.localPath ?? null : null;
  }

  return null;
}
