import type { PolishResult } from "@/lib/ai/prompt-polisher";
import { getImageStorageBridge } from "@/lib/bridge/image-storage";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";

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

  // 写回资产库失败禁静默(1010 保存段静默死勘误延伸):任何失败/异常都落诊断
  // error 事件留痕;返回 false 交由调用方给出可见提示(已生成但未写回主图)
  const operationId = createOperationId("asset-save-to-library");
  let sourceFilePath: string | null = null;
  try {
    sourceFilePath = await materializeGeneratedImageForAssetLibrary(assetId, imagePath);
  } catch (error) {
    void logEvent({
      level: "error",
      category: "asset",
      operationId,
      message: "Generated asset image materialization failed",
      context: { assetId, imagePathKind: describeImagePathKind(imagePath) },
      error,
    });
    await persistGeneratedAssetPromptToLibrary(assetId, polishResult);
    return false;
  }
  if (!sourceFilePath) {
    void logEvent({
      level: "error",
      category: "asset",
      operationId,
      message: "Generated asset image materialization returned no local file",
      context: { assetId, imagePathKind: describeImagePathKind(imagePath) },
    });
    await persistGeneratedAssetPromptToLibrary(assetId, polishResult);
    return false;
  }

  let imageSaved = false;
  const studioAssets = getStudioAssetsBridge();
  if (sourceFilePath && studioAssets) {
    try {
      const result = await studioAssets.replaceImage({ assetId, sourceFilePath });
      imageSaved = Boolean(result);
    } catch (error) {
      void logEvent({
        level: "error",
        category: "asset",
        operationId,
        message: "Generated asset image library write-back failed",
        context: { assetId },
        error,
      });
      imageSaved = false;
    }
  }
  if (!imageSaved) {
    void logEvent({
      level: "error",
      category: "asset",
      operationId,
      message: "Generated asset image was not written back to library",
      context: { assetId, sourceFilePath },
    });
  }

  await persistGeneratedAssetPromptToLibrary(assetId, polishResult);

  return imageSaved;
}

function describeImagePathKind(imagePath: string) {
  return imagePath.includes("://") ? imagePath.split("://")[0] : "path";
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
