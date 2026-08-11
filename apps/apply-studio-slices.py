#!/usr/bin/env python3
"""重新应用 studio-store slice 拆分。独立脚本,避免 heredoc/持久化问题。"""
import sys

path = "frontend/stores/studio/studio-store.ts"
with open(path) as f:
    c = f.read()

# 1. imports(已加,跳过如果存在)
if "createMaterialSliceActions" not in c:
    c = c.replace(
        'import { buildMediaRefFromMaterial, createMaterialRecord } from "@/lib/studio/material";',
        'import { createMaterialSliceActions } from "./material-slice";\n'
        'import { createConfigSliceActions } from "./config-slice";\n'
        'import { createNovelSliceActions } from "./novel-slice";\n'
        'import { createMemorySliceActions } from "./memory-slice";\n'
        'import { createEntitySliceActions } from "./entity-slice";\n'
        'import { createProductionSliceActions } from "./production-slice";\n'
        'import { createAgentWorkSliceActions } from "./agent-work-slice";\n'
        'import { createStoryboardSliceActions } from "./storyboard-slice";')

# 2. store 创建 + material/novel/config
old_block = """export const useStudioStore = create<StudioWorkflowStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      addMaterial: (input) => {
        const material = createMaterialRecord(input);
        set((state) => ({
          materials: [
            material,
            ...state.materials.filter((item) => item.id !== material.id && item.localPath !== material.localPath),
          ],
        }));
        return material.id;
      },

      deleteMaterial: (id) => {
        set((state) => ({
          materials: state.materials.filter((item) => item.id !== id),
          storyboards: state.storyboards.map((item) => {
            const material = state.materials.find((candidate) => candidate.id === id);
            if (!material || item.mediaRef?.path !== material.localPath) return item;
            return { ...item, mediaRef: undefined };
          }),
        }));
        get().rebuildTracks();
      },

      bindMaterialToStoryboard: (storyboardId, materialId) => {
        const material = get().materials.find((item) => item.id === materialId);
        if (!material) return;
        get().updateStoryboard(storyboardId, { mediaRef: buildMediaRefFromMaterial(material) });
      },

      importNovelText: (sourceText) => {
        const novelChapters = parseNovelChapters(sourceText);
        set({ novelChapters });
        syncNovelChapterMirrors(novelChapters);
      },

      appendNovelText: (sourceText, sourceName) => {
        const novelChapters = appendNovelChapters(get().novelChapters, sourceText, { sourceName });
        const importedChapters = novelChapters.slice(get().novelChapters.length);
        set({ novelChapters });
        syncNovelChapterMirrors(importedChapters);
      },

      replaceNovelText: (sourceText, sourceName) => {
        const previousChapters = get().novelChapters;
        const novelChapters = replaceNovelChapters(sourceText, { sourceName });
        set({ novelChapters });
        syncNovelChapterMirrors(novelChapters);
        removeNovelChapterMirrors(previousChapters.filter((chapter) => !novelChapters.some((next) => next.id === chapter.id)));
      },

      updateNovelChapter: (id, updates) => {
        const chapterUpdates = { ...updates };
        delete chapterUpdates.sourceId;
        delete chapterUpdates.revision;
        set((state) => ({
          novelChapters: state.novelChapters.map((chapter) => {
            if (chapter.id !== id) return chapter;

            const sourceId = chapter.sourceId ?? chapter.id;
            const revision = chapter.revision ?? 1;
            const nextChapter = { ...chapter, ...chapterUpdates };
            const sourceIdentityChanged =
              nextChapter.title !== chapter.title ||
              nextChapter.volume !== chapter.volume ||
              nextChapter.sourceText !== chapter.sourceText;

            return {
              ...nextChapter,
              sourceId,
              revision: sourceIdentityChanged ? revision + 1 : revision,
              updatedAt: Date.now(),
            };
          }),
        }));
        const updatedChapter = get().novelChapters.find((chapter) => chapter.id === id);
        if (updatedChapter) {
          syncNovelChapterMirrors([updatedChapter]);
        }
      },

      setWorkflowConfig: (updates) => {
        set((state) => ({
          workflowConfig: {
            ...state.workflowConfig,
            ...updates,
          },
        }));
      },"""

new_block = """export const useStudioStore = create<StudioWorkflowStore>()(
  persist(
    (set, get) => {
      const materialSlice = createMaterialSliceActions(set as never, get as never);
      const configSlice = createConfigSliceActions(set as never);
      const novelSlice = createNovelSliceActions(set as never, get as never, { syncNovelChapterMirrors, removeNovelChapterMirrors });
      const memorySlice = createMemorySliceActions(set as never, get as never);
      const entitySlice = createEntitySliceActions(set as never);
      const productionSlice = createProductionSliceActions(set as never);
      const agentWorkSlice = createAgentWorkSliceActions(set as never, get as never);
      const storyboardSlice = createStoryboardSliceActions(set as never, get as never);
      return {
      ...initialState,
      addMaterial: materialSlice.addMaterial,
      deleteMaterial: materialSlice.deleteMaterial,
      bindMaterialToStoryboard: materialSlice.bindMaterialToStoryboard,
      importNovelText: novelSlice.importNovelText,
      appendNovelText: novelSlice.appendNovelText,
      replaceNovelText: novelSlice.replaceNovelText,
      updateNovelChapter: novelSlice.updateNovelChapter,
      setWorkflowConfig: configSlice.setWorkflowConfig,"""

if old_block in c:
    c = c.replace(old_block, new_block)
    print("✓ material/novel/config block")
else:
    print("✗ material/novel/config block NOT FOUND")

with open(path, "w") as f:
    f.write(c)
print(f"lines: {len(c.splitlines())}")
