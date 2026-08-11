/**
 * Material slice — 从 studio-store.ts 拆出的第一个 slice (Child 2 R3 Step 2)。
 *
 * 模式:本文件导出 createMaterialSliceActions(set, get),
 * store 在创建时直接注入 zustand 的 set/get(类型经 MaterialSliceStore 收窄),
 * 返回的 action 对象展开进 store。物理分离 material 逻辑,保持行为与测试不变。
 * 后续 novelSlice / productionSlice 等沿用同一模式,逐步降低主文件行数。
 */
import type { StudioMaterial, StoryboardItem, StoryboardMediaRef } from "@/types/studio";
import { buildMediaRefFromMaterial, createMaterialRecord } from "@/lib/studio/material";

/** Material slice 暴露的 state + actions 契约。 */
export interface MaterialSlice {
  materials: StudioMaterial[];
  addMaterial: (input: {
    name: string;
    localPath: string;
    size: number;
    importedAt?: number;
  }) => string;
  deleteMaterial: (id: string) => void;
  bindMaterialToStoryboard: (storyboardId: string, materialId: string) => void;
}

/**
 * slice 能看到的 store 局部视图。避免引用完整 StudioWorkflowStore(防循环依赖),
 * 但类型精确,无需适配层,行为与原内联实现 1:1 一致。
 */
interface MaterialSliceStore {
  materials: StudioMaterial[];
  storyboards: StoryboardItem[];
  updateStoryboard: (id: string, updates: Partial<StoryboardItem>) => void;
  rebuildTracks: () => void;
}

/** zustand 风格的 set/get 签名(slice 只用到这两个域)。 */
type SetFn = (
  fn: (state: MaterialSliceStore) => Partial<MaterialSliceStore>,
) => void;
type GetFn = () => MaterialSliceStore;

/** material slice 的 action 实现。 */
export function createMaterialSliceActions(set: SetFn, get: GetFn) {
  return {
    addMaterial: (input: {
      name: string;
      localPath: string;
      size: number;
      importedAt?: number;
    }): string => {
      const material = createMaterialRecord(input);
      set((state) => ({
        materials: [
          material,
          ...state.materials.filter(
            (item) =>
              item.id !== material.id && item.localPath !== material.localPath,
          ),
        ],
      }));
      return material.id;
    },

    deleteMaterial: (id: string): void => {
      set((state) => {
        const material = state.materials.find((candidate) => candidate.id === id);
        return {
          materials: state.materials.filter((item) => item.id !== id),
          storyboards: !material
            ? state.storyboards
            : state.storyboards.map((item) =>
                item.mediaRef?.path === material.localPath
                  ? { ...item, mediaRef: undefined }
                  : item,
              ),
        };
      });
      get().rebuildTracks();
    },

    bindMaterialToStoryboard: (
      storyboardId: string,
      materialId: string,
    ): void => {
      const material = get().materials.find((item) => item.id === materialId);
      if (!material) return;
      get().updateStoryboard(storyboardId, {
        mediaRef: buildMediaRefFromMaterial(material) as StoryboardMediaRef,
      });
    },
  };
}
