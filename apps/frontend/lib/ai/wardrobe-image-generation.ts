import type {
  Character,
  CharacterVariation,
} from "@/stores/library/character-library-store";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { getStyleById } from "@/lib/constants/visual-styles";
import { readImageAsBase64 } from "@/lib/media/image-storage";
import { aiManager } from "./ai-manager";

const WARDROBE_SHEET_ELEMENTS = [
  {
    id: "three-view",
    prompt: "front view, side view, back view, turnaround",
    realisticPrompt:
      "multiple photographic angles: front portrait, side profile, full body shot",
  },
  {
    id: "expressions",
    prompt:
      "expression sheet, multiple facial expressions, happy, sad, angry, surprised",
    realisticPrompt:
      "collage of different facial expressions: smiling, frowning, angry, surprised",
  },
  {
    id: "proportions",
    prompt: "height chart, body proportions, head-to-body ratio reference",
    realisticPrompt: "full body photography, standing straight",
  },
  {
    id: "poses",
    prompt: "pose sheet, various action poses, standing, sitting, running",
    realisticPrompt: "various action poses, action photography collage",
  },
] as const;

export async function generateVariationImage(params: {
  character: Character;
  variation: CharacterVariation;
  featureConfig: NonNullable<ReturnType<typeof aiManager.featureConfig>>;
}): Promise<string> {
  const { character, variation, featureConfig } = params;
  const apiKey = featureConfig.apiKey;
  const model = featureConfig.models?.[0];
  const baseUrl = featureConfig.baseUrl?.replace(/\/+$/, "");

  if (!model || !baseUrl) {
    throw new Error("图片生成服务未正确配置（缺少模型或 Base URL）");
  }

  const stylePreset = character.styleId
    ? getStyleById(character.styleId)
    : null;
  const styleTokens =
    stylePreset?.prompt || "anime style, professional quality";
  const isRealistic = stylePreset?.category === "real";

  const charTraits = character.visualTraits || character.description || "";
  const clothingDesc = variation.visualPrompt || variation.name;
  const hasClothingRefs =
    variation.clothingReferenceImages &&
    variation.clothingReferenceImages.length > 0;
  const characterDescription = `${charTraits}, wearing ${clothingDesc}`;

  const basePrompt = isRealistic
    ? `professional character reference for "${character.name}", ${characterDescription}, real person`
    : `professional character design sheet for "${character.name}", ${characterDescription}`;
  const contentPrompt = WARDROBE_SHEET_ELEMENTS.map((element) =>
    isRealistic ? element.realisticPrompt : element.prompt,
  ).join(", ");
  const whiteBackgroundPrompt =
    "pure solid white background, isolated character on white background, absolutely no background scenery";
  const fusionInstruction = hasClothingRefs
    ? "The FIRST image is the base character — preserve identity exactly. The FOLLOWING image(s) show the target outfit — dress the character in this outfit for ALL views."
    : "";

  const prompt = isRealistic
    ? [
        basePrompt,
        contentPrompt,
        "photographic character reference layout, collage format",
        whiteBackgroundPrompt,
        styleTokens,
        "cinematic lighting, highly detailed skin texture, photorealistic",
        fusionInstruction,
        "IMPORTANT: NO TEXT, NO WORDS, NO WATERMARKS.",
      ]
        .filter(Boolean)
        .join(", ")
    : [
        basePrompt,
        contentPrompt,
        "character reference sheet layout",
        whiteBackgroundPrompt,
        styleTokens,
        "detailed illustration",
        fusionInstruction,
        "IMPORTANT: NO TEXT, NO WORDS, NO WATERMARKS.",
      ]
        .filter(Boolean)
        .join(", ");

  const referenceImages: string[] = [];
  const charBaseImage = character.thumbnailUrl || character.views[0]?.imageUrl;
  if (charBaseImage) {
    const resolved = await resolveImageToBase64(charBaseImage);
    if (resolved) referenceImages.push(resolved);
  }

  if (hasClothingRefs) {
    for (const image of variation.clothingReferenceImages!) {
      const resolved = await resolveImageToBase64(image);
      if (resolved) referenceImages.push(resolved);
    }
  }

  console.log("[Wardrobe] Generating character sheet variation:", {
    variationName: variation.name,
    model,
    isRealistic,
    hasClothingRefs,
    refCount: referenceImages.length,
    promptPreview: prompt.substring(0, 150),
  });

  const imageSettings =
    useAppSettingsStore.getState().imageGenerationSettings;
  const result = await aiManager.imageGrid({
    model,
    prompt,
    apiKey,
    baseUrl,
    aspectRatio: "1:1",
    resolution: imageSettings.defaultResolution,
    referenceImages:
      referenceImages.length > 0 ? referenceImages : undefined,
  });

  if (result.imageUrl) {
    return result.imageUrl;
  }

  if (result.taskId) {
    return pollForVariationImage(result.taskId, apiKey, baseUrl);
  }

  throw new Error("无效的 API 响应");
}

async function resolveImageToBase64(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:image/")) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("local-image://")) {
    try {
      return (await readImageAsBase64(url)) || null;
    } catch {
      console.warn("[Wardrobe] Failed to read local image:", url);
      return null;
    }
  }
  return null;
}

async function pollForVariationImage(
  taskId: string,
  apiKey: string,
  baseUrl: string,
): Promise<string> {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const hasV1 = /\/v\d+$/.test(normalizedBase);
  const taskEndpoint = hasV1
    ? `${normalizedBase}/tasks/${taskId}`
    : `${normalizedBase}/v1/tasks/${taskId}`;

  const maxAttempts = 60;
  const pollInterval = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    try {
      const url = new URL(taskEndpoint);
      url.searchParams.set("_ts", Date.now().toString());

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Cache-Control": "no-cache",
        },
      });

      if (!response.ok) {
        if (response.status === 404) throw new Error("任务不存在");
        continue;
      }

      const data = await response.json();
      const status = (data.status ?? data.data?.status ?? "unknown")
        .toString()
        .toLowerCase();

      if (
        status === "completed" ||
        status === "succeeded" ||
        status === "success"
      ) {
        const images = data.result?.images ?? data.data?.result?.images;
        let imageUrl: string | undefined;
        if (images?.[0]) {
          const raw = images[0].url || images[0];
          imageUrl = Array.isArray(raw) ? raw[0] : raw;
        }
        imageUrl =
          imageUrl || data.output_url || data.result_url || data.url;
        if (imageUrl) return imageUrl;
        throw new Error("任务完成但无图片 URL");
      }

      if (status === "failed" || status === "error") {
        throw new Error(data.error || "图片生成失败");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("失败") ||
          error.message.includes("不存在") ||
          error.message.includes("无图片"))
      ) {
        throw error;
      }
    }
  }

  throw new Error("图片生成超时");
}
