// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Director Store
 * Manages AI screenplay generation and scene execution state
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createProjectScopedStorage } from '@/lib/project-storage';
import type { 
  AIScreenplay, 
  AIScene, 
  SceneProgress, 
  GenerationConfig 
} from '@opencut/ai-core';
import { createDirectorStoryboardActions } from './director-storyboard-actions';
import { createDirectorSplitSceneActions } from './director-split-scene-actions';
import { createDirectorGenerationLifecycleActions } from './director-generation-lifecycle-actions';
import { createDirectorTrailerActions } from './director-trailer-actions';
import { createDirectorFrameCascadeActions } from './director-frame-cascade-actions';
import { createDirectorSceneImportActions } from './director-scene-import-actions';
import {
  createDefaultDirectorProjectData,
  DEFAULT_DIRECTOR_EDITOR_PREFS,
  DEFAULT_DIRECTOR_SCREENPLAY_DRAFT,
} from './director-project-defaults';
import { mergeDirectorStore, partializeDirectorStore } from './director-persistence';
import {
  selectActiveDirectorProject,
  selectCompletedDirectorScenesCount,
  selectDirectorIsGenerating,
  selectDirectorOverallProgress,
  selectDirectorSceneProgress,
  selectFailedDirectorScenesCount,
} from './director-selectors';
import type {
  DirectorEditorPrefs,
  DirectorProjectData,
  DirectorScreenplayDraft,
  DirectorState,
  DirectorStore,
} from './director-store-types';

// ==================== Types ====================

// ==================== 预设常量（从 director-presets.ts 导入并重新导出） ====================
// 本地导入：用于本文件内的类型引用（SplitScene 等接口定义需要）
// 重新导出：保持向后兼容，现有 import { SHOT_SIZE_PRESETS } from '@/stores/director-store' 继续可用
export {
  SHOT_SIZE_PRESETS,
  type ShotSizeType,
  DURATION_PRESETS,
  type DurationType,
  SOUND_EFFECT_PRESETS,
  type SoundEffectTag,
  LIGHTING_STYLE_PRESETS,
  LIGHTING_DIRECTION_PRESETS,
  COLOR_TEMPERATURE_PRESETS,
  DEPTH_OF_FIELD_PRESETS,
  FOCUS_TRANSITION_PRESETS,
  CAMERA_RIG_PRESETS,
  MOVEMENT_SPEED_PRESETS,
  ATMOSPHERIC_EFFECT_PRESETS,
  EFFECT_INTENSITY_PRESETS,
  PLAYBACK_SPEED_PRESETS,
  EMOTION_PRESETS,
  type EmotionTag,
  CAMERA_ANGLE_PRESETS,
  type CameraAngleType,
  FOCAL_LENGTH_PRESETS,
  type FocalLengthType,
  PHOTOGRAPHY_TECHNIQUE_PRESETS,
  type PhotographyTechniqueType,
  CAMERA_MOVEMENT_PRESETS,
  type CameraMovementType,
  SPECIAL_TECHNIQUE_PRESETS,
  type SpecialTechniqueType,
} from './director-presets';
export type {
  DirectorEditorPrefs,
  DirectorProjectData,
  DirectorScreenplayDraft,
  DirectorStore,
  GenerationStatus,
  ScreenplayStatus,
  SplitScene,
  StoryboardStatus,
  TrailerConfig,
  TrailerDuration,
  VideoStatus,
} from './director-store-types';

// 分镜（原 Split scene 
// 三层提示词设计：
// 1. 首帧提示 (imagePrompt) - 静画面描述，用于生成首帧图片
// 2. 尾帧提示 (endFramePrompt) - 静画面描述，用于生成尾帧图片（如果需要）
// 3. 视频提示 (videoPrompt) - 动动作描述，用于生成视频
// ==================== Default Config ====================

const defaultConfig: GenerationConfig = {
  styleTokens: ['anime style', 'manga art', '2D animation', 'cel shaded'],
  qualityTokens: ['high quality', 'detailed', 'professional'],
  negativePrompt: 'blurry, low quality, watermark, realistic, photorealistic, 3D render',
  aspectRatio: '9:16',
  imageSize: '1K',
  videoSize: '480p',
  sceneCount: 5,
  concurrency: 1,
  imageProvider: 'memefast',
  videoProvider: 'memefast',
  chatProvider: 'memefast',
};

// ==================== Default Project Data ====================

const defaultProjectData = createDefaultDirectorProjectData;
const defaultScreenplayDraft = DEFAULT_DIRECTOR_SCREENPLAY_DRAFT;
const defaultEditorPrefs = DEFAULT_DIRECTOR_EDITOR_PREFS;

// ==================== Initial State ====================

const initialState: DirectorState = {
  activeProjectId: null,
  projects: {},
  sceneProgress: new Map(),
  config: defaultConfig,
  isExpanded: true,
  selectedSceneId: null,
};

// ==================== Store ====================

export const useDirectorStore = create<DirectorStore>()(
  persist(
    (set, get) => ({
      ...initialState,

  // Project management
  setActiveProjectId: (projectId) => {
    set({ activeProjectId: projectId });
    if (projectId) {
      get().ensureProject(projectId);
    }
  },
  
  ensureProject: (projectId) => {
    const { projects } = get();
    if (projects[projectId]) return;
    set({
      projects: { ...projects, [projectId]: defaultProjectData() },
    });
  },
  
  getProjectData: (projectId) => {
    const { projects } = get();
    return projects[projectId] || defaultProjectData();
  },

  // Screenplay management
  setScreenplay: (screenplay) => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    set({
      projects: {
        ...projects,
        [activeProjectId]: {
          ...projects[activeProjectId],
          screenplay,
          screenplayError: null,
        },
      },
    });
  },
  
  setScreenplayStatus: (status) => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    set({
      projects: {
        ...projects,
        [activeProjectId]: {
          ...projects[activeProjectId],
          screenplayStatus: status,
        },
      },
    });
  },
  
  setScreenplayError: (error) => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    const currentProject = projects[activeProjectId];
    set({
      projects: {
        ...projects,
        [activeProjectId]: {
          ...currentProject,
          screenplayError: error,
          screenplayStatus: error ? 'error' : currentProject?.screenplayStatus || 'idle',
        },
      },
    });
  },

  // Scene editing
  updateScene: (sceneId, updates) => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    const project = projects[activeProjectId];
    if (!project?.screenplay) return;
    
    const updatedScenes = project.screenplay.scenes.map(scene => 
      scene.sceneId === sceneId ? { ...scene, ...updates } : scene
    );
    
    set({
      projects: {
        ...projects,
        [activeProjectId]: {
          ...project,
          screenplay: {
            ...project.screenplay,
            scenes: updatedScenes,
            updatedAt: Date.now(),
          },
        },
      },
    });
  },
  
  // Delete a single scene
  deleteScene: (sceneId) => {
    const { activeProjectId, projects, sceneProgress } = get();
    if (!activeProjectId) return;
    const project = projects[activeProjectId];
    if (!project?.screenplay) return;
    
    const remainingScenes = project.screenplay.scenes.filter(scene => scene.sceneId !== sceneId);
    const renumberedScenes = remainingScenes.map((scene, index) => ({
      ...scene,
      sceneId: index + 1,
    }));
    
    const newProgressMap = new Map<number, SceneProgress>();
    remainingScenes.forEach((scene, index) => {
      const oldProgress = sceneProgress.get(scene.sceneId);
      if (oldProgress) {
        newProgressMap.set(index + 1, { ...oldProgress, sceneId: index + 1 });
      }
    });
    
    set({
      projects: {
        ...projects,
        [activeProjectId]: {
          ...project,
          screenplay: {
            ...project.screenplay,
            scenes: renumberedScenes,
            updatedAt: Date.now(),
          },
        },
      },
      sceneProgress: newProgressMap,
    });
    
    console.log('[DirectorStore] Deleted scene', sceneId, 'remaining:', renumberedScenes.length);
  },
  
  // Delete all scenes and reset to idle
  deleteAllScenes: () => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    set({
      projects: {
        ...projects,
        [activeProjectId]: {
          ...projects[activeProjectId],
          screenplay: null,
          screenplayStatus: 'idle',
          screenplayError: null,
        },
      },
      sceneProgress: new Map(),
      selectedSceneId: null,
    });
    console.log('[DirectorStore] Deleted all scenes, reset to idle');
  },

  // Scene progress
  updateSceneProgress: (sceneId, partialProgress) => {
    const current = get().sceneProgress.get(sceneId);
    const updated = current 
      ? { ...current, ...partialProgress }
      : { 
          sceneId, 
          status: 'pending' as const, 
          stage: 'idle' as const, 
          progress: 0, 
          ...partialProgress 
        };
    
    set((state) => {
      const newMap = new Map(state.sceneProgress);
      newMap.set(sceneId, updated);
      return { sceneProgress: newMap };
    });
  },
  
  setSceneProgress: (sceneId, progress) => {
    set((state) => {
      const newMap = new Map(state.sceneProgress);
      newMap.set(sceneId, progress);
      return { sceneProgress: newMap };
    });
  },
  
  clearSceneProgress: () => set({ sceneProgress: new Map() }),

  // Config
  updateConfig: (partialConfig) => set((state) => ({
    config: { ...state.config, ...partialConfig }
  })),

  // UI
  setExpanded: (expanded) => set({ isExpanded: expanded }),
  setSelectedScene: (sceneId) => set({ selectedSceneId: sceneId }),

  // Storyboard actions (new workflow) - Project-aware
  ...createDirectorStoryboardActions(set, get),
  
  ...createDirectorSplitSceneActions(set, get),
  
  setStoryboardConfig: (partialConfig) => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    const project = projects[activeProjectId];
    set({
      projects: {
        ...projects,
        [activeProjectId]: {
          ...project,
          storyboardConfig: { ...project.storyboardConfig, ...partialConfig },
        },
      },
    });
  },

  setScreenplayDraft: (partialDraft) => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    const project = projects[activeProjectId];
    set({
      projects: {
        ...projects,
        [activeProjectId]: {
          ...project,
          screenplayDraft: {
            ...(project.screenplayDraft || defaultScreenplayDraft),
            ...partialDraft,
            updatedAt: Date.now(),
          },
        },
      },
    });
  },

  clearScreenplayDraft: () => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    const project = projects[activeProjectId];
    set({
      projects: {
        ...projects,
        [activeProjectId]: {
          ...project,
          screenplayDraft: {
            ...defaultScreenplayDraft,
            updatedAt: Date.now(),
          },
        },
      },
    });
  },

  setEditorPrefs: (partialPrefs) => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    const project = projects[activeProjectId];
    set({
      projects: {
        ...projects,
        [activeProjectId]: {
          ...project,
          editorPrefs: {
            ...(project.editorPrefs || defaultEditorPrefs),
            ...partialPrefs,
          },
        },
      },
    });
  },
  
  resetStoryboard: () => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    set({
      projects: {
        ...projects,
        [activeProjectId]: {
          ...projects[activeProjectId],
          storyboardImage: null,
          storyboardImageMediaId: null,
          storyboardStatus: 'editing',
          storyboardError: null,
          splitScenes: [],
        },
      },
    });
    console.log('[DirectorStore] Reset storyboard state for project', activeProjectId);
  },

  // Mode 2: Add scenes from script directly (skip storyboard generation)
  ...createDirectorSceneImportActions(set, get),

  // Workflow actions
  ...createDirectorGenerationLifecycleActions(set, get, initialState),
  ...createDirectorTrailerActions(set, get),
  ...createDirectorFrameCascadeActions(set, get),
  setCinematographyProfileId: (profileId) => {
    const { activeProjectId, projects } = get();
    if (!activeProjectId) return;
    const project = projects[activeProjectId];
    set({
      projects: {
        ...projects,
        [activeProjectId]: {
          ...project,
          cinematographyProfileId: profileId,
        },
      },
    });
    console.log('[DirectorStore] Cinematography profile set to:', profileId);
  },
    }),
    {
      name: 'mystudio-director-store',
      storage: createJSONStorage(() => createProjectScopedStorage('director')),
      partialize: partializeDirectorStore,
      merge: mergeDirectorStore,
    }
  )
);

// ==================== Selectors ====================

/**
 * Get current active project data (for reading splitScenes, storyboardImage, etc.)
 */
export const useActiveDirectorProject = (): DirectorProjectData | null => {
  return useDirectorStore(selectActiveDirectorProject);
};

/**
 * Get progress for a specific scene
 */
export const useSceneProgress = (sceneId: number): SceneProgress | undefined => {
  return useDirectorStore(selectDirectorSceneProgress(sceneId));
};

/**
 * Get overall progress (0-100)
 */
export const useOverallProgress = (): number => {
  return useDirectorStore(selectDirectorOverallProgress);
};

/**
 * Check if any scene is currently generating
 */
export const useIsGenerating = (): boolean => {
  return useDirectorStore(selectDirectorIsGenerating);
};

/**
 * Get count of completed scenes
 */
export const useCompletedScenesCount = (): number => {
  return useDirectorStore(selectCompletedDirectorScenesCount);
};

/**
 * Get count of failed scenes
 */
export const useFailedScenesCount = (): number => {
  return useDirectorStore(selectFailedDirectorScenesCount);
};
