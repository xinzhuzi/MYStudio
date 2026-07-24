import type { SplitScene } from './director-store-types';

type LegacySplitSceneFields = {
  sceneName?: string;
  sceneLocation?: string;
  imageHttpUrl?: string | null;
  imagePrompt?: string;
  imagePromptZh?: string;
  needsEndFrame?: boolean;
  endFrameHttpUrl?: string | null;
  endFramePrompt?: string;
  endFramePromptZh?: string;
  endFrameStatus?: SplitScene['endFrameStatus'];
  endFrameProgress?: number;
  endFrameError?: string | null;
  soundEffectText?: string;
};

export function normalizeDirectorSplitScene(scene: SplitScene): SplitScene {
  const legacy = scene as SplitScene & LegacySplitSceneFields;
  return {
    ...scene,
    sceneName: legacy.sceneName ?? '',
    sceneLocation: legacy.sceneLocation ?? '',
    imageHttpUrl: legacy.imageHttpUrl ?? null,
    imagePrompt: legacy.imagePrompt ?? scene.videoPrompt ?? '',
    imagePromptZh: legacy.imagePromptZh ?? scene.videoPromptZh ?? scene.videoPrompt ?? '',
    imageStatus: scene.imageStatus || 'completed',
    imageProgress: scene.imageProgress ?? 100,
    imageError: scene.imageError ?? null,
    needsEndFrame: legacy.needsEndFrame ?? false,
    endFrameImageUrl: scene.endFrameImageUrl ?? null,
    endFrameHttpUrl: legacy.endFrameHttpUrl ?? null,
    endFrameSource: scene.endFrameSource ?? null,
    endFramePrompt: legacy.endFramePrompt ?? '',
    endFramePromptZh: legacy.endFramePromptZh ?? '',
    endFrameStatus: legacy.endFrameStatus || 'idle',
    endFrameProgress: legacy.endFrameProgress ?? 0,
    endFrameError: legacy.endFrameError ?? null,
    videoPromptZh: scene.videoPromptZh ?? scene.videoPrompt ?? '',
    videoStatus: scene.videoStatus || 'idle',
    videoProgress: scene.videoProgress ?? 0,
    videoUrl: scene.videoUrl ?? null,
    videoError: scene.videoError ?? null,
    videoMediaId: scene.videoMediaId ?? null,
    characterIds: scene.characterIds ?? [],
    emotionTags: scene.emotionTags ?? [],
    dialogue: scene.dialogue ?? '',
    actionSummary: scene.actionSummary ?? '',
    cameraMovement: scene.cameraMovement ?? '',
    soundEffectText: legacy.soundEffectText ?? '',
    shotSize: scene.shotSize ?? null,
    duration: scene.duration ?? 5,
    ambientSound: scene.ambientSound ?? '',
    soundEffects: scene.soundEffects ?? [],
    lightingStyle: scene.lightingStyle ?? undefined,
    lightingDirection: scene.lightingDirection ?? undefined,
    colorTemperature: scene.colorTemperature ?? undefined,
    lightingNotes: scene.lightingNotes ?? undefined,
    depthOfField: scene.depthOfField ?? undefined,
    focusTarget: scene.focusTarget ?? undefined,
    focusTransition: scene.focusTransition ?? undefined,
    cameraRig: scene.cameraRig ?? undefined,
    movementSpeed: scene.movementSpeed ?? undefined,
    atmosphericEffects: scene.atmosphericEffects ?? undefined,
    effectIntensity: scene.effectIntensity ?? undefined,
    playbackSpeed: scene.playbackSpeed ?? undefined,
    specialTechnique: scene.specialTechnique ?? undefined,
    continuityRef: scene.continuityRef ?? undefined,
  };
}

export function normalizeDirectorSplitScenes(scenes: SplitScene[]): SplitScene[] {
  return scenes.map(normalizeDirectorSplitScene);
}
