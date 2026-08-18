// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Project Switcher
 * 
 * Coordinates project switching across all stores:
 * 1. Updates activeProjectId in project-store
 * 2. Rehydrates all project-scoped stores from new project's files
 * 
 * Must be used instead of directly calling setActiveProject()
 * to ensure data consistency across stores.
 */

import { useProjectStore } from '@/stores/project/project-store';
import { useScriptStore } from '@/stores/script/script-store';
import { useDirectorStore } from '@/stores/director/director-store';
import { useMediaStore } from '@/stores/media/media-store';
import { useCharacterLibraryStore } from '@/stores/library/character-library-store';
import { useSceneStore } from '@/stores/library/scene-store';
import { useSimpleTimelineStore } from '@/stores/editing/simple-timeline-store';
import { useSClassStore } from '@/stores/sclass/sclass-store';
import { useTtsStore } from '@/stores/tts/tts-store';
import { useEditingStore } from '@/stores/editing/editing-store';
import { useSelfMediaStore } from '@/stores/self-media/self-media-store';
import { useStudioStore } from '@/stores/studio/studio-store';

/**
 * Switch to a different project. Saves current project data and loads new project data.
 * 
 * CRITICAL: The execution order matters! We must:
 * 1. Update project-store's activeProjectId (so storage adapters route to new project files)
 * 2. Rehydrate all stores (loads data from new project's per-project files)
 * 3. THEN sync internal activeProjectId (by this time data is already loaded, so persist
 *    writes will save correct data instead of empty defaults)
 * 
 * Previous bug: setting internal activeProjectId BEFORE rehydrate triggered persist writes
 * that overwrote per-project files with empty/default data.
 * 
 * @param newProjectId - The project ID to switch to
 * @returns Promise that resolves when all stores have been rehydrated
 */
/**
 * `force` 为 true 时,即便 currentId === newProjectId 也走完整 rehydrate 链。
 * 启动恢复活跃项目后,project-scoped store 的自动水合与 project-store 的
 * rehydrate 存在时序竞态——赌输的 store 整个 session 拿空数据,而同 ID 的
 * switchProject 直接 no-op,「打开项目」修不回来(单项目用户无路可走)。
 */
export async function switchProject(
  newProjectId: string,
  options?: { force?: boolean },
): Promise<void> {
  const currentId = useProjectStore.getState().activeProjectId;

  // No-op if same project (unless forced)
  if (currentId === newProjectId && !options?.force) return;

  if (typeof window !== "undefined" && window.remotionQueue?.canSwitchProject) {
    const decision = await window.remotionQueue.canSwitchProject(newProjectId);
    if (!decision.allowed) {
      throw new Error(`Remotion 任务仍在运行，暂不能切换项目: ${decision.jobIds.join(", ")}`);
    }
  }

  if (currentId && typeof window !== "undefined" && window.remotionStudio?.closeSession) {
    await window.remotionStudio.closeSession(currentId);
  }

  if (typeof window !== "undefined" && window.remotionQueue?.switchProject) {
    const decision = await window.remotionQueue.switchProject(newProjectId);
    if (!decision.allowed) {
      throw new Error(`Remotion 任务仍在运行，暂不能切换项目: ${decision.jobIds.join(", ")}`);
    }
  }


  // 1. Wait briefly for any pending persist writes to complete
  //    (persist middleware fires setItem synchronously on state change,
  //     but the actual IPC write is async)
  await new Promise((r) => setTimeout(r, 50));

  // 2. Update ONLY the project-store's activeProjectId
  //    This controls which per-project files the storage adapters read/write.
  //    DO NOT set activeProjectId on individual stores yet — that triggers persist
  //    writes which would overwrite per-project files with empty data.
  useProjectStore.getState().setActiveProject(newProjectId);

  // 3. Rehydrate all project-scoped stores FIRST
  //    The storage adapters call getActiveProjectId() → reads from project-store → newProjectId
  //    So they'll read from _p/{newProjectId}/ directory
  try {
    await useScriptStore.persist.rehydrate();
  } catch (e) {
    console.warn('[ProjectSwitcher] Failed to rehydrate script store:', e);
  }

  try {
    await useDirectorStore.persist.rehydrate();
  } catch (e) {
    console.warn('[ProjectSwitcher] Failed to rehydrate director store:', e);
  }

  try {
    await useMediaStore.persist.rehydrate();
  } catch (e) {
    console.warn('[ProjectSwitcher] Failed to rehydrate media store:', e);
  }

  try {
    await useCharacterLibraryStore.persist.rehydrate();
  } catch (e) {
    console.warn('[ProjectSwitcher] Failed to rehydrate character library:', e);
  }

  try {
    await useSceneStore.persist.rehydrate();
  } catch (e) {
    console.warn('[ProjectSwitcher] Failed to rehydrate scene store:', e);
  }

  try {
    await useSimpleTimelineStore.persist.rehydrate();
  } catch (e) {
    console.warn('[ProjectSwitcher] Failed to rehydrate timeline store:', e);
  }

  try {
    await useSClassStore.persist.rehydrate();
  } catch (e) {
    console.warn('[ProjectSwitcher] Failed to rehydrate sclass store:', e);
  }

  try {
    await useTtsStore.persist.rehydrate();
  } catch (e) {
    console.warn('[ProjectSwitcher] Failed to rehydrate TTS store:', e);
  }

  try {
    await useEditingStore.persist.rehydrate();
  } catch (e) {
    console.warn('[ProjectSwitcher] Failed to rehydrate editing store:', e);
  }

  try {
    await useSelfMediaStore.persist.rehydrate();
  } catch (e) {
    console.warn('[ProjectSwitcher] Failed to rehydrate self-media store:', e);
  }

  try {
    await useStudioStore.persist.rehydrate();
  } catch (e) {
    console.warn('[ProjectSwitcher] Failed to rehydrate studio workflow store:', e);
  }

  // 4. NOW sync internal activeProjectId in stores that track it.
  //    By this point, per-project data is already loaded into memory via rehydrate(),
  //    so the persist write triggered here will save the correct data (not empty defaults).
  useScriptStore.getState().setActiveProjectId(newProjectId);
  useDirectorStore.getState().setActiveProjectId(newProjectId);
  useSClassStore.getState().setActiveProjectId(newProjectId);
  useTtsStore.getState().setActiveProjectId(newProjectId);
  useEditingStore.getState().setActiveProjectId(newProjectId);
  useSelfMediaStore.getState().setActiveProjectId(newProjectId);

  // 5. Ensure project data exists in stores that need it
  useScriptStore.getState().ensureProject(newProjectId);
  useDirectorStore.getState().ensureProject(newProjectId);
  useSClassStore.getState().ensureProject(newProjectId);
  useTtsStore.getState().ensureProject(newProjectId);
  useSelfMediaStore.getState().ensureProject(newProjectId);

}
