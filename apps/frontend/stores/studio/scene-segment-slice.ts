/**
 * Scene segment slice — 按场分段产物（Remotion chapter-scene job）登记域。
 *
 * 独立于 production 域：场级分段不走 videoCandidates/productionTracks
 * （ffmpeg 时代的 track 记账），成功后由渲染域 hook 按 jobId upsert 本表。
 */
import type { SceneSegmentRecord } from "@/types/studio";

/** Scene segment slice 契约。 */
export interface SceneSegmentSlice {
  sceneSegments: SceneSegmentRecord[];
  /** 按 jobId upsert（重试/重复导出复用同 job 身份）；同章同场旧记录被替换。 */
  registerSceneSegment: (record: SceneSegmentRecord) => void;
  removeSceneSegment: (id: string) => void;
}

/** slice 能看到的 store 局部视图。 */
interface SceneSegmentSliceStore {
  sceneSegments: SceneSegmentRecord[];
}

type SetFn = (
  fn: (state: SceneSegmentSliceStore) => Partial<SceneSegmentSliceStore>,
) => void;

export function createSceneSegmentSliceActions(set: SetFn) {
  return {
    registerSceneSegment: (record: SceneSegmentRecord): void => {
      set((state) => {
        // 同 jobId 幂等 upsert；同章同场的旧一代（分镜表/渲染计划已变）直接
        // 被替换——store 只保留每场最新一代分段。
        const deduped = state.sceneSegments.filter((item) =>
          item.jobId !== record.jobId
          && !(item.chapterId === record.chapterId && item.sceneNo === record.sceneNo));
        return { sceneSegments: [...deduped, record] };
      });
    },

    removeSceneSegment: (id: string): void => {
      set((state) => ({
        sceneSegments: state.sceneSegments.filter((item) => item.id !== id),
      }));
    },
  };
}
