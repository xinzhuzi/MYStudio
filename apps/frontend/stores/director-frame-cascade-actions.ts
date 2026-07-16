import type { DirectorStore } from "./director-store";

export type DirectorFrameCascadeActions = Pick<DirectorStore, "cascadeFramesToNextScene">;

type SetDirectorState = (partial: Partial<DirectorStore>) => void;
type GetDirectorState = () => DirectorStore;

export function createDirectorFrameCascadeActions(
  set: SetDirectorState,
  get: GetDirectorState,
): DirectorFrameCascadeActions {
  return {
    cascadeFramesToNextScene: (params) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const {
        nextSceneId,
        origFirstFrameImage,
        origFirstFrameHttpUrl,
        origFirstFramePrompt,
        origFirstFramePromptZh,
        newFirstFrameImage,
        newFirstFrameHttpUrl,
        newFirstFramePrompt,
        newFirstFramePromptZh,
      } = params;

      const splitScenes = project.splitScenes.map((scene) => {
        if (scene.id !== nextSceneId) return scene;
        const videoReset = scene.videoUrl ? {
          videoStatus: "idle" as const,
          videoProgress: 0,
          videoUrl: null,
          videoError: null,
          videoMediaId: null,
        } : {};

        return {
          ...scene,
          ...(origFirstFrameImage ? {
            endFrameImageUrl: origFirstFrameImage,
            endFrameHttpUrl: origFirstFrameHttpUrl,
            endFrameSource: "prev-scene-cascade" as const,
            endFrameStatus: "completed" as const,
            endFrameProgress: 100,
            endFrameError: null,
          } : {}),
          endFramePrompt: scene.endFramePrompt || origFirstFramePrompt,
          endFramePromptZh: scene.endFramePromptZh || origFirstFramePromptZh,
          needsEndFrame: true,
          imageDataUrl: newFirstFrameImage,
          imageHttpUrl: newFirstFrameHttpUrl,
          imagePrompt: newFirstFramePrompt,
          imagePromptZh: newFirstFramePromptZh,
          imageStatus: "completed" as const,
          imageProgress: 100,
          imageError: null,
          ...videoReset,
        };
      });

      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes },
        },
      });
      console.log("[DirectorStore] Cascade frames to next scene:", nextSceneId);
    },
  };
}
