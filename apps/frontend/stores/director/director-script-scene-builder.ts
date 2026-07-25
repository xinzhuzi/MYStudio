import type {
  AtmosphericEffect,
  CameraAngle,
  CameraRig,
  ColorTemperature,
  DepthOfField,
  EffectIntensity,
  FocalLength,
  FocusTransition,
  LightingDirection,
  LightingStyle,
  MovementSpeed,
  PhotographyTechnique,
  PlaybackSpeed,
} from "@/types/script";
import type { DurationType, EmotionTag, ShotSizeType, SoundEffectTag } from "./director-presets";
import type { SplitScene } from "./director-store-types";

export interface DirectorScriptSceneInput {
  promptZh: string;
  promptEn?: string;
  imagePrompt?: string;
  imagePromptZh?: string;
  videoPrompt?: string;
  videoPromptZh?: string;
  endFramePrompt?: string;
  endFramePromptZh?: string;
  needsEndFrame?: boolean;
  characterIds?: string[];
  emotionTags?: EmotionTag[];
  shotSize?: ShotSizeType | null;
  duration?: number;
  ambientSound?: string;
  soundEffects?: SoundEffectTag[];
  soundEffectText?: string;
  dialogue?: string;
  actionSummary?: string;
  cameraMovement?: string;
  sceneName?: string;
  sceneLocation?: string;
  sceneLibraryId?: string;
  viewpointId?: string;
  sceneReferenceImage?: string;
  narrativeFunction?: string;
  shotPurpose?: string;
  visualFocus?: string;
  cameraPosition?: string;
  characterBlocking?: string;
  rhythm?: string;
  visualDescription?: string;
  lightingStyle?: LightingStyle;
  lightingDirection?: LightingDirection;
  colorTemperature?: ColorTemperature;
  lightingNotes?: string;
  depthOfField?: DepthOfField;
  focusTarget?: string;
  focusTransition?: FocusTransition;
  cameraRig?: CameraRig;
  movementSpeed?: MovementSpeed;
  atmosphericEffects?: AtmosphericEffect[];
  effectIntensity?: EffectIntensity;
  playbackSpeed?: PlaybackSpeed;
  cameraAngle?: CameraAngle;
  focalLength?: FocalLength;
  photographyTechnique?: PhotographyTechnique;
  specialTechnique?: string;
  sourceEpisodeIndex?: number;
  sourceEpisodeId?: string;
  backgroundMusic?: string;
}

export function buildSplitScenesFromScript(
  scenes: DirectorScriptSceneInput[],
  startId: number,
): SplitScene[] {
  return scenes.map((scene, index) => ({
    id: startId + index,
    sceneName: scene.sceneName || "",
    sceneLocation: scene.sceneLocation || "",
    imageDataUrl: "",
    imageHttpUrl: null,
    width: 0,
    height: 0,
    imagePrompt: scene.imagePrompt || scene.promptEn || "",
    imagePromptZh: scene.imagePromptZh || scene.promptZh || "",
    videoPrompt: scene.videoPrompt || scene.promptEn || "",
    videoPromptZh: scene.videoPromptZh || scene.promptZh,
    endFramePrompt: scene.endFramePrompt || "",
    endFramePromptZh: scene.endFramePromptZh || "",
    needsEndFrame: scene.needsEndFrame || false,
    row: 0,
    col: 0,
    sourceRect: { x: 0, y: 0, width: 0, height: 0 },
    endFrameImageUrl: null,
    endFrameHttpUrl: null,
    endFrameSource: null,
    endFrameStatus: "idle",
    endFrameProgress: 0,
    endFrameError: null,
    characterIds: scene.characterIds || [],
    emotionTags: scene.emotionTags || [],
    shotSize: scene.shotSize || null,
    duration: (scene.duration || 5) as DurationType,
    ambientSound: scene.ambientSound || "",
    soundEffects: scene.soundEffects || [],
    soundEffectText: scene.soundEffectText || "",
    dialogue: scene.dialogue || "",
    actionSummary: scene.actionSummary || "",
    cameraMovement: scene.cameraMovement || "",
    audioAmbientEnabled: true,
    audioSfxEnabled: true,
    audioDialogueEnabled: true,
    audioBgmEnabled: false,
    backgroundMusic: scene.backgroundMusic || "",
    sceneLibraryId: scene.sceneLibraryId,
    viewpointId: scene.viewpointId,
    sceneReferenceImage: scene.sceneReferenceImage,
    narrativeFunction: scene.narrativeFunction || "",
    shotPurpose: scene.shotPurpose || "",
    visualFocus: scene.visualFocus || "",
    cameraPosition: scene.cameraPosition || "",
    characterBlocking: scene.characterBlocking || "",
    rhythm: scene.rhythm || "",
    visualDescription: scene.visualDescription || "",
    lightingStyle: scene.lightingStyle,
    lightingDirection: scene.lightingDirection,
    colorTemperature: scene.colorTemperature,
    lightingNotes: scene.lightingNotes,
    depthOfField: scene.depthOfField,
    focusTarget: scene.focusTarget,
    focusTransition: scene.focusTransition,
    cameraRig: scene.cameraRig,
    movementSpeed: scene.movementSpeed,
    atmosphericEffects: scene.atmosphericEffects,
    effectIntensity: scene.effectIntensity,
    playbackSpeed: scene.playbackSpeed,
    specialTechnique: scene.specialTechnique,
    cameraAngle: scene.cameraAngle,
    focalLength: scene.focalLength,
    photographyTechnique: scene.photographyTechnique,
    imageStatus: "idle",
    imageProgress: 0,
    imageError: null,
    videoStatus: "idle",
    videoProgress: 0,
    videoUrl: null,
    videoError: null,
    videoMediaId: null,
    sourceEpisodeIndex: scene.sourceEpisodeIndex,
    sourceEpisodeId: scene.sourceEpisodeId,
  }));
}
