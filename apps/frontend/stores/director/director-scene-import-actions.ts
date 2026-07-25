import { buildSplitScenesFromScript } from "./director-script-scene-builder";
import type { DirectorStore, SplitScene } from "./director-store-types";

export type DirectorSceneImportActions = Pick<DirectorStore, "addScenesFromScript" | "addBlankSplitScene">;

type SetDirectorState = (partial: Partial<DirectorStore>) => void;
type GetDirectorState = () => DirectorStore;

export function createDirectorSceneImportActions(
  set: SetDirectorState,
  get: GetDirectorState,
): DirectorSceneImportActions {
  return {
    addScenesFromScript: (scenes) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const splitScenes = project?.splitScenes || [];
      const startId = splitScenes.length > 0 ? Math.max(...splitScenes.map((scene) => scene.id)) + 1 : 0;
      const newScenes = buildSplitScenesFromScript(scenes, startId);
      const currentConfig = project.storyboardConfig;
      const calibratedUpdate = currentConfig.visualStyleId && !currentConfig.calibratedStyleId
        ? { storyboardConfig: { ...currentConfig, calibratedStyleId: currentConfig.visualStyleId } }
        : {};

      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...project,
            ...calibratedUpdate,
            splitScenes: [...splitScenes, ...newScenes],
            storyboardStatus: "editing",
          },
        },
      });
      console.log("[DirectorStore] Added", newScenes.length, "scenes from script, total:", splitScenes.length + newScenes.length);
    },

    addBlankSplitScene: () => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const splitScenes = project?.splitScenes || [];
      const newId = splitScenes.length > 0 ? Math.max(...splitScenes.map((scene) => scene.id)) + 1 : 0;
      const blankScene: SplitScene = {
        id: newId,
        sceneName: `空白分镜 ${newId + 1}`,
        sceneLocation: "",
        imageDataUrl: "",
        imageHttpUrl: null,
        width: 0,
        height: 0,
        imagePrompt: "",
        imagePromptZh: "",
        videoPrompt: "",
        videoPromptZh: "",
        endFramePrompt: "",
        endFramePromptZh: "",
        needsEndFrame: false,
        row: 0,
        col: 0,
        sourceRect: { x: 0, y: 0, width: 0, height: 0 },
        endFrameImageUrl: null,
        endFrameHttpUrl: null,
        endFrameSource: null,
        endFrameStatus: "idle",
        endFrameProgress: 0,
        endFrameError: null,
        characterIds: [],
        emotionTags: [],
        shotSize: null,
        duration: 5,
        ambientSound: "",
        soundEffects: [],
        soundEffectText: "",
        dialogue: "",
        actionSummary: "",
        cameraMovement: "",
        audioAmbientEnabled: true,
        audioSfxEnabled: true,
        audioDialogueEnabled: true,
        audioBgmEnabled: false,
        backgroundMusic: "",
        imageStatus: "idle",
        imageProgress: 0,
        imageError: null,
        videoStatus: "idle",
        videoProgress: 0,
        videoUrl: null,
        videoError: null,
        videoMediaId: null,
      };

      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...project,
            splitScenes: [...splitScenes, blankScene],
            storyboardStatus: "editing",
          },
        },
      });
      console.log("[DirectorStore] Added blank scene, id:", newId, "total:", splitScenes.length + 1);
    },
  };
}
