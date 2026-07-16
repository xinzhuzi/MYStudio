import type { DirectorStore } from "./director-store";
import { normalizeDirectorSplitScenes } from "./director-scene-normalizer";

export type DirectorSplitSceneActions = Pick<
  DirectorStore,
  | "setSplitScenes"
  | "updateSplitSceneImagePrompt"
  | "updateSplitSceneVideoPrompt"
  | "updateSplitSceneEndFramePrompt"
  | "updateSplitSceneNeedsEndFrame"
  | "updateSplitScenePrompt"
  | "updateSplitSceneImage"
  | "updateSplitSceneImageStatus"
  | "updateSplitSceneVideo"
  | "updateSplitSceneEndFrame"
  | "updateSplitSceneEndFrameStatus"
  | "updateSplitSceneCharacters"
  | "updateSplitSceneCharacterVariationMap"
  | "updateSplitSceneEmotions"
  | "updateSplitSceneShotSize"
  | "updateSplitSceneDuration"
  | "updateSplitSceneAmbientSound"
  | "updateSplitSceneSoundEffects"
  | "updateSplitSceneReference"
  | "updateSplitSceneEndFrameReference"
  | "updateSplitSceneField"
  | "addAngleSwitchHistory"
  | "deleteSplitScene"
>;

type SetDirectorState = (partial: Partial<DirectorStore>) => void;
type GetDirectorState = () => DirectorStore;

export function createDirectorSplitSceneActions(
  set: SetDirectorState,
  get: GetDirectorState,
): DirectorSplitSceneActions {
  return {
    setSplitScenes: (scenes) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      
      const initialized = normalizeDirectorSplitScenes(scenes);
      
      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...projects[activeProjectId],
            splitScenes: initialized,
          },
        },
      });
    },
    
    // ========== 三层提示词更新方法 ==========
    
    // 更新首帧提示词（静画面描述）
    updateSplitSceneImagePrompt: (sceneId, prompt, promptZh) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { 
          ...scene, 
          imagePrompt: prompt,
          imagePromptZh: promptZh !== undefined ? promptZh : scene.imagePromptZh,
        } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
    
    // 更新视频提示词（动作过程描述）
    updateSplitSceneVideoPrompt: (sceneId, prompt, promptZh) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { 
          ...scene, 
          videoPrompt: prompt,
          videoPromptZh: promptZh !== undefined ? promptZh : scene.videoPromptZh,
        } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
    
    // 更新尾帧提示词（静画面描述）
    updateSplitSceneEndFramePrompt: (sceneId, prompt, promptZh) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { 
          ...scene, 
          endFramePrompt: prompt,
          endFramePromptZh: promptZh !== undefined ? promptZh : scene.endFramePromptZh,
        } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
    
    // 设置是否需要尾帧
    updateSplitSceneNeedsEndFrame: (sceneId, needsEndFrame) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { ...scene, needsEndFrame } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
    
    // 兼容 API：更新视频提示词（实际上更新 videoPrompt）
    updateSplitScenePrompt: (sceneId, prompt, promptZh) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { 
          ...scene, 
          videoPrompt: prompt,
          videoPromptZh: promptZh !== undefined ? promptZh : scene.videoPromptZh,
        } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
  
    // 更新分镜图片
    // 注意：当图片变化时，如果没有传入新的 httpUrl，应该清除旧 httpUrl
    // 这样可以避免用户从素材库选择新图片后，旧 HTTP URL 仍然被使 
    // 关键：同时清 imageSource，避免视频生成时错误地使用旧 imageHttpUrl
    updateSplitSceneImage: (sceneId, imageDataUrl, width, height, httpUrl) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { 
          ...scene, 
          imageDataUrl,
          // 如果显式传入 httpUrl（包括空字符串），使用它；否则设置为 null 强制清除
          // 使用 null 而不 undefined，确保覆盖旧 
          imageHttpUrl: httpUrl !== undefined ? (httpUrl || null) : null,
          // 如果没有传入 httpUrl，清 imageSource 标记，避免视频生成时误判
          imageSource: httpUrl ? ('ai-generated' as const) : undefined,
          imageStatus: 'completed' as const,
          imageProgress: 100,
          imageError: null,
          ...(width !== undefined && { width }),
          ...(height !== undefined && { height }),
        } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
  
    updateSplitSceneImageStatus: (sceneId, updates) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { ...scene, ...updates } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
  
    updateSplitSceneVideo: (sceneId, updates) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { ...scene, ...updates } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
  
    // 更新尾帧图片（支持多种来源）
    // 注意：当尾帧变化时，如果没有传入新的 httpUrl，应该清除旧 httpUrl
    updateSplitSceneEndFrame: (sceneId, imageUrl, source, httpUrl) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { 
          ...scene, 
          endFrameImageUrl: imageUrl,
          // 如果显式传入 httpUrl，使用它；否则清空（因为尾帧已变化或删除）
          endFrameHttpUrl: httpUrl !== undefined ? (httpUrl || null) : null,
          endFrameSource: imageUrl ? (source || 'upload') : null,
          endFrameStatus: imageUrl ? 'completed' as const : 'idle' as const,
          endFrameProgress: imageUrl ? 100 : 0,
          endFrameError: null,
        } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
    
    // 更新尾帧生成状态
    updateSplitSceneEndFrameStatus: (sceneId, updates) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { ...scene, ...updates } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
  
    updateSplitSceneCharacters: (sceneId, characterIds) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { ...scene, characterIds } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
  
    updateSplitSceneCharacterVariationMap: (sceneId, characterVariationMap) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { ...scene, characterVariationMap } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
  
    updateSplitSceneEmotions: (sceneId, emotionTags) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { ...scene, emotionTags } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
  
    updateSplitSceneShotSize: (sceneId, shotSize) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { ...scene, shotSize } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
  
    updateSplitSceneDuration: (sceneId, duration) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { ...scene, duration } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
  
    updateSplitSceneAmbientSound: (sceneId, ambientSound) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { ...scene, ambientSound } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
  
    updateSplitSceneSoundEffects: (sceneId, soundEffects) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { ...scene, soundEffects } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
  
    // 场景库关联更新方法（首帧）
    updateSplitSceneReference: (sceneId, sceneLibraryId, viewpointId, referenceImage, subViewId) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId
          ? { ...scene, sceneLibraryId, viewpointId, subViewId, sceneReferenceImage: referenceImage }
          : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
      console.log('[DirectorStore] Updated scene reference for shot', sceneId, ':', sceneLibraryId, viewpointId, subViewId);
    },
  
    // 场景库关联更新方法（尾帧）
    updateSplitSceneEndFrameReference: (sceneId, sceneLibraryId, viewpointId, referenceImage, subViewId) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId
          ? { ...scene, endFrameSceneLibraryId: sceneLibraryId, endFrameViewpointId: viewpointId, endFrameSubViewId: subViewId, endFrameSceneReferenceImage: referenceImage }
          : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
      console.log('[DirectorStore] Updated end frame scene reference for shot', sceneId, ':', sceneLibraryId, viewpointId, subViewId);
    },
  
    // 通用字段更新方法（用于双击编辑）
    updateSplitSceneField: (sceneId, field, value) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene =>
        scene.id === sceneId ? { ...scene, [field]: value } : scene
      );
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
    
    // 视角切换历史记录更新方法
    addAngleSwitchHistory: (sceneId, type, historyItem) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const updated = project.splitScenes.map(scene => {
        if (scene.id !== sceneId) return scene;
        if (type === 'start') {
          const history = scene.startFrameAngleSwitchHistory || [];
          return { ...scene, startFrameAngleSwitchHistory: [...history, historyItem] };
        } else {
          const history = scene.endFrameAngleSwitchHistory || [];
          return { ...scene, endFrameAngleSwitchHistory: [...history, historyItem] };
        }
      });
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: updated },
        },
      });
    },
    
    deleteSplitScene: (sceneId) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      const remaining = project.splitScenes.filter(s => s.id !== sceneId);
      const renumbered = remaining.map((s, idx) => ({ ...s, id: idx }));
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...project, splitScenes: renumbered },
        },
      });
      console.log('[DirectorStore] Deleted split scene', sceneId, 'remaining:', renumbered.length);
    },
  };
}

