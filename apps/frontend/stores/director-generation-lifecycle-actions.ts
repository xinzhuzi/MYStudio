import type { DirectorStore } from "./director-store";
import type { SceneProgress } from "@opencut/ai-core";

export type DirectorGenerationLifecycleActions = Pick<
  DirectorStore,
  | "startScreenplayGeneration"
  | "startImageGeneration"
  | "startVideoGeneration"
  | "retrySceneImage"
  | "retryScene"
  | "cancelAll"
  | "reset"
  | "onScreenplayGenerated"
  | "onSceneProgressUpdate"
  | "onSceneImageCompleted"
  | "onSceneCompleted"
  | "onSceneFailed"
  | "onAllImagesCompleted"
  | "onAllCompleted"
>;

type SetDirectorState = (partial: Partial<DirectorStore>) => void;
type GetDirectorState = () => DirectorStore;

export function createDirectorGenerationLifecycleActions(
  set: SetDirectorState,
  get: GetDirectorState,
  initialState: Partial<DirectorStore>,
): DirectorGenerationLifecycleActions {
  return {
    startScreenplayGeneration: (prompt, images) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...projects[activeProjectId],
            screenplayStatus: 'generating',
            screenplayError: null,
            screenplay: null,
          },
        },
      });
      
      console.log('[DirectorStore] Starting screenplay generation for:', prompt.substring(0, 50));
    },
  
    // Step 1: Start generating images only
    startImageGeneration: () => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const screenplay = project?.screenplay;
      if (!screenplay) {
        console.error('[DirectorStore] No screenplay to generate images');
        return;
      }
      
      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...project,
            screenplayStatus: 'generating_images',
          },
        },
      });
      
      const progressMap = new Map<number, SceneProgress>();
      for (const scene of screenplay.scenes) {
        progressMap.set(scene.sceneId, {
          sceneId: scene.sceneId,
          status: 'pending',
          stage: 'image',
          progress: 0,
        });
      }
      set({ sceneProgress: progressMap });
      
      console.log('[DirectorStore] Starting image generation for', screenplay.scenes.length, 'scenes');
    },
    
    // Step 2: Start generating videos from confirmed images
    startVideoGeneration: () => {
      const { activeProjectId, projects, sceneProgress } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const screenplay = project?.screenplay;
      if (!screenplay) {
        console.error('[DirectorStore] No screenplay to generate videos');
        return;
      }
      
      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...project,
            screenplayStatus: 'generating_videos',
          },
        },
      });
      
      const progressMap = new Map<number, SceneProgress>();
      for (const scene of screenplay.scenes) {
        const existing = sceneProgress.get(scene.sceneId);
        progressMap.set(scene.sceneId, {
          sceneId: scene.sceneId,
          status: 'pending',
          stage: 'video',
          progress: 50,
          imageUrl: existing?.imageUrl,
        });
      }
      set({ sceneProgress: progressMap });
      
      console.log('[DirectorStore] Starting video generation for', screenplay.scenes.length, 'scenes');
    },
    
    // Retry generating image for a single scene
    retrySceneImage: (sceneId) => {
      get().updateSceneProgress(sceneId, {
        status: 'pending',
        stage: 'image',
        progress: 0,
        imageUrl: undefined,
        error: undefined,
      });
      console.log('[DirectorStore] Retrying image for scene', sceneId);
    },
  
    retryScene: (sceneId) => {
      get().updateSceneProgress(sceneId, {
        status: 'pending',
        stage: 'idle',
        progress: 0,
        error: undefined,
      });
      console.log('[DirectorStore] Retrying scene', sceneId);
    },
  
    cancelAll: () => {
      const { activeProjectId, projects, sceneProgress } = get();
      if (activeProjectId) {
        const project = projects[activeProjectId];
        const screenplay = project?.screenplay;
        set({
          projects: {
            ...projects,
            [activeProjectId]: {
              ...project,
              screenplayStatus: screenplay ? 'ready' : 'idle',
            },
          },
        });
      }
      
      for (const [sceneId, progress] of sceneProgress) {
        if (progress.status === 'generating' || progress.status === 'pending') {
          get().updateSceneProgress(sceneId, {
            status: 'failed',
            error: 'Cancelled by user',
          });
        }
      }
      
      console.log('[DirectorStore] Cancelled all operations');
    },
  
    reset: () => set(initialState),
  
    // Worker callbacks
    onScreenplayGenerated: (screenplay) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...projects[activeProjectId],
            screenplay,
            screenplayStatus: 'ready',
            screenplayError: null,
          },
        },
      });
      console.log('[DirectorStore] Screenplay generated:', screenplay.title);
    },
  
    onSceneProgressUpdate: (sceneId, progress) => {
      get().setSceneProgress(sceneId, progress);
    },
  
    // Called when a scene's image is generated
    onSceneImageCompleted: (sceneId, imageUrl) => {
      get().updateSceneProgress(sceneId, {
        status: 'completed',
        stage: 'image',
        progress: 100,
        imageUrl,
      });
      
      const { activeProjectId, projects, sceneProgress } = get();
      const project = activeProjectId ? projects[activeProjectId] : null;
      const screenplay = project?.screenplay;
      if (screenplay) {
        get().updateScene(sceneId, { imageUrl });
      }
      
      if (screenplay) {
        const allImagesDone = screenplay.scenes.every(scene => {
          const progress = sceneProgress.get(scene.sceneId);
          return progress?.imageUrl || progress?.status === 'failed';
        });
        
        if (allImagesDone) {
          get().onAllImagesCompleted();
        }
      }
      
      console.log('[DirectorStore] Scene image completed:', sceneId, imageUrl?.substring(0, 50));
    },
  
    onSceneCompleted: (sceneId, mediaId) => {
      get().updateSceneProgress(sceneId, {
        status: 'completed',
        stage: 'done',
        progress: 100,
        mediaId,
        completedAt: Date.now(),
      });
      
      const { activeProjectId, projects, sceneProgress } = get();
      const project = activeProjectId ? projects[activeProjectId] : null;
      const screenplay = project?.screenplay;
      if (screenplay) {
        const allDone = screenplay.scenes.every(scene => {
          const progress = sceneProgress.get(scene.sceneId);
          return progress?.status === 'completed' || progress?.status === 'failed';
        });
        
        if (allDone) {
          get().onAllCompleted();
        }
      }
      
      console.log('[DirectorStore] Scene completed:', sceneId, 'mediaId:', mediaId);
    },
  
    onSceneFailed: (sceneId, error) => {
      get().updateSceneProgress(sceneId, {
        status: 'failed',
        error,
      });
      console.error('[DirectorStore] Scene failed:', sceneId, error);
    },
  
    // All images generated, ready for user review
    onAllImagesCompleted: () => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...projects[activeProjectId],
            screenplayStatus: 'images_ready',
          },
        },
      });
      console.log('[DirectorStore] All images completed, ready for review');
    },
  
    onAllCompleted: () => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...projects[activeProjectId],
            screenplayStatus: 'completed',
          },
        },
      });
      console.log('[DirectorStore] All scenes completed');
    },
  };
}
