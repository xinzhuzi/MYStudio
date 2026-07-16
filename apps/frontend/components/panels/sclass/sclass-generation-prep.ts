import type { Character } from "@/stores/character-library-store";
import type { SplitScene } from "@/stores/director-store";
import type { Scene } from "@/stores/scene-store";
import type {
  AssetRef,
  SClassAspectRatio,
  SClassDuration,
  ShotGroup,
} from "@/stores/sclass-store";
import {
  buildGroupPrompt,
  mergeToGridImage,
  SEEDANCE_LIMITS,
  type BuildGroupPromptOptions,
  type GroupPromptResult,
} from "./sclass-prompt-builder";

type PrepareSClassGroupGenerationInput = {
  group: ShotGroup;
  scenes: SplitScene[];
  characters: Character[];
  sceneLibrary: Scene[];
  styleTokens?: string[];
  aspectRatio: SClassAspectRatio;
  defaultDuration: SClassDuration;
  cachedGridUrl?: string | null;
  cachedSceneIds?: number[] | null;
};

type PrepareSClassGroupGenerationDependencies = {
  mergeGridImage?: typeof mergeToGridImage;
  buildPrompt?: (options: BuildGroupPromptOptions) => GroupPromptResult;
};

export type SClassGroupGenerationPreparation = {
  isExtendOrEdit: boolean;
  enableAudio: boolean;
  enableLipSync: boolean;
  allStaticCamera: boolean;
  gridImageRef: AssetRef | null;
  promptResult: GroupPromptResult;
  prompt: string;
  duration: SClassDuration;
};

export function deriveSClassGroupGenerationFlags(
  group: ShotGroup,
  scenes: SplitScene[],
) {
  const isExtendOrEdit = group.generationType === "extend" || group.generationType === "edit";
  const hasAnyDialogue = scenes.some(
    (scene) => scene.audioDialogueEnabled !== false && scene.dialogue?.trim(),
  );
  const hasAnyAmbient = scenes.some((scene) => scene.audioAmbientEnabled !== false);
  const hasAnySfx = scenes.some((scene) => scene.audioSfxEnabled !== false);
  const allStaticCamera = scenes.every((scene) => {
    const cameraMovement = (scene.cameraMovement || "").toLowerCase().trim();
    return !cameraMovement
      || cameraMovement === "static"
      || cameraMovement === "固定"
      || cameraMovement === "静止";
  });

  return {
    isExtendOrEdit,
    enableAudio: Boolean(hasAnyDialogue || hasAnyAmbient || hasAnySfx),
    enableLipSync: Boolean(hasAnyDialogue),
    allStaticCamera,
  };
}

function canReuseCachedGrid(
  sceneIds: number[],
  cachedGridUrl?: string | null,
  cachedSceneIds?: number[] | null,
): cachedGridUrl is string {
  return Boolean(
    cachedGridUrl
      && cachedSceneIds
      && sceneIds.length === cachedSceneIds.length
      && sceneIds.every((sceneId, index) => sceneId === cachedSceneIds[index]),
  );
}

function createGridImageRef(gridDataUrl: string): AssetRef {
  return {
    id: "grid_image",
    type: "image",
    tag: "@图片1",
    localUrl: gridDataUrl,
    httpUrl: gridDataUrl.startsWith("http") ? gridDataUrl : null,
    fileName: "grid_image.png",
    fileSize: 0,
    duration: null,
    purpose: "grid_image",
  };
}

export async function prepareSClassGroupGeneration(
  input: PrepareSClassGroupGenerationInput,
  dependencies: PrepareSClassGroupGenerationDependencies = {},
): Promise<SClassGroupGenerationPreparation> {
  const {
    group,
    scenes,
    characters,
    sceneLibrary,
    styleTokens,
    aspectRatio,
    defaultDuration,
    cachedGridUrl,
    cachedSceneIds,
  } = input;
  const flags = deriveSClassGroupGenerationFlags(group, scenes);
  const mergeGridImage = dependencies.mergeGridImage || mergeToGridImage;
  const promptBuilder = dependencies.buildPrompt || buildGroupPrompt;
  let gridImageRef: AssetRef | null = null;

  if (!flags.isExtendOrEdit) {
    const firstFrameUrls = scenes
      .map((scene) => scene.imageDataUrl || scene.imageHttpUrl || "")
      .filter(Boolean);

    if (firstFrameUrls.length > 0) {
      const gridDataUrl = canReuseCachedGrid(group.sceneIds, cachedGridUrl, cachedSceneIds)
        ? cachedGridUrl
        : await mergeGridImage(firstFrameUrls, aspectRatio);
      gridImageRef = createGridImageRef(gridDataUrl);
    }
  }

  const promptResult = promptBuilder({
    group,
    scenes,
    characters,
    sceneLibrary,
    styleTokens,
    aspectRatio,
    enableLipSync: flags.enableLipSync,
    gridImageRef,
  });
  const prompt = promptResult.prompt || `Multi-shot video: ${group.name}`;
  const duration = Math.max(
    SEEDANCE_LIMITS.minDuration,
    Math.min(SEEDANCE_LIMITS.maxDuration, group.totalDuration || defaultDuration),
  ) as SClassDuration;

  return { ...flags, gridImageRef, promptResult, prompt, duration };
}
