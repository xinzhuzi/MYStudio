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
import { normalizeH3DurationUs } from "@/lib/studio/h3-duration-us";

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
  bindMaterialToStoryboard: (
    storyboardId: string,
    materialId: string,
    /** B1(09-29):视频素材绑定的 ffprobe 实测时长(微秒);先 probe 后调,非法值经守卫拒收。 */
    h3DurationUs?: number,
  ) => void;
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
      h3DurationUs?: number,
    ): void => {
      const material = get().materials.find((item) => item.id === materialId);
      if (!material) return;
      const mediaRef = buildMediaRefFromMaterial(material) as StoryboardMediaRef;
      // B1(09-29):视频素材落账带真实时长(正整数微秒守卫,非法拒收;换片
      // 时长未知则清空旧值,旧值不得冒充新片)。非视频素材不触碰该字段。
      get().updateStoryboard(storyboardId, {
        mediaRef,
        ...(mediaRef.kind === "video" ? { h3DurationUs: normalizeH3DurationUs(h3DurationUs) } : {}),
      });
    },
  };
}
