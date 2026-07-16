import { convertToHttpUrl } from "@/lib/ai/video-generator";
import type {
  AssetRef,
  GenerationRecord,
  SClassAspectRatio,
  SClassDuration,
  SClassResolution,
  ShotGroup,
} from "@/stores/sclass-store";

type ConvertToHttpUrl = typeof convertToHttpUrl;

type MaterializeSClassReferencesInput = {
  imageRefs: AssetRef[];
  videoRefs: AssetRef[];
  audioRefs: AssetRef[];
  prevVideoUrl?: string;
  isExtendOrEdit: boolean;
};

export async function materializeSClassGenerationReferences(
  input: MaterializeSClassReferencesInput,
  convert: ConvertToHttpUrl = convertToHttpUrl,
) {
  const imageWithRoles: Array<{ url: string; role: "first_frame" | "last_frame" }> = [];
  for (let index = 0; index < input.imageRefs.length; index++) {
    const reference = input.imageRefs[index];
    const httpUrl = await convert(reference.localUrl, {
      fallbackHttpUrl: reference.httpUrl,
      uploadName: reference.fileName,
    });
    if (httpUrl) {
      imageWithRoles.push({
        url: httpUrl,
        role: index === 0 ? "first_frame" : "last_frame",
      });
    }
  }

  const videoRefUrls: string[] = [];
  if (!input.isExtendOrEdit && input.prevVideoUrl) {
    const previousVideoUrl = await convert(input.prevVideoUrl).catch(() => "");
    if (previousVideoUrl) videoRefUrls.push(previousVideoUrl);
  }
  for (const reference of input.videoRefs) {
    const httpUrl = reference.httpUrl || await convert(reference.localUrl).catch(() => "");
    if (httpUrl) videoRefUrls.push(httpUrl);
  }

  const audioRefUrls: string[] = [];
  for (const reference of input.audioRefs) {
    const httpUrl = reference.httpUrl || await convert(reference.localUrl).catch(() => "");
    if (httpUrl) audioRefUrls.push(httpUrl);
  }

  return { imageWithRoles, videoRefUrls, audioRefUrls };
}

type CreateSClassGenerationRecordInput = {
  group: ShotGroup;
  prompt: string;
  videoUrl: string;
  assetRefs: AssetRef[];
  aspectRatio: SClassAspectRatio;
  resolution: SClassResolution;
  duration: SClassDuration;
};

export function createSClassGenerationRecord(
  input: CreateSClassGenerationRecordInput,
  now: () => number = Date.now,
): GenerationRecord {
  return {
    id: `gen_${now()}_${input.group.id}`,
    timestamp: now(),
    prompt: input.prompt,
    videoUrl: input.videoUrl,
    status: "completed",
    error: null,
    assetRefs: input.assetRefs,
    config: {
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      duration: input.duration,
    },
  };
}
