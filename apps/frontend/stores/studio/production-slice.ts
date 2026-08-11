/**
 * Production slice — 从 studio-store.ts 拆出(Child 2 R3 Step 7)。
 *
 * 本批先提取 3 个零跨域 setter:updateTrack / selectVideoCandidate /
 * deleteVideoCandidate。rebuildTracks / addVideoCandidate / updateVideoCandidate
 * 依赖 agent 域的 startMediaTask/finishMediaTask/failMediaTask,留主文件待后续。
 */
import type { ProductionTrack, VideoCandidate } from "@/types/studio";

/** Production slice 契约(本批子集)。 */
export interface ProductionSlice {
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
  updateTrack: (id: string, updates: Partial<ProductionTrack>) => void;
  selectVideoCandidate: (trackId: string, videoId: string) => void;
  deleteVideoCandidate: (id: string) => void;
}

/** slice 能看到的 store 局部视图。 */
interface ProductionSliceStore {
  productionTracks: ProductionTrack[];
  videoCandidates: VideoCandidate[];
}

type SetFn = (
  fn: (state: ProductionSliceStore) => Partial<ProductionSliceStore>,
) => void;

/** production slice 的简单 setter 实现(零跨域)。 */
export function createProductionSliceActions(set: SetFn) {
  return {
    updateTrack: (id: string, updates: Partial<ProductionTrack>): void => {
      set((state) => ({
        productionTracks: state.productionTracks.map((track) =>
          track.id === id ? { ...track, ...updates } : track,
        ),
      }));
    },

    selectVideoCandidate: (trackId: string, videoId: string): void => {
      set((state) => ({
        productionTracks: state.productionTracks.map((track) =>
          track.id === trackId ? { ...track, selectedVideoId: videoId } : track,
        ),
      }));
    },

    deleteVideoCandidate: (id: string): void => {
      set((state) => ({
        videoCandidates: state.videoCandidates.filter((item) => item.id !== id),
        productionTracks: state.productionTracks.map((track) => ({
          ...track,
          candidateVideoIds: track.candidateVideoIds.filter(
            (candidateId) => candidateId !== id,
          ),
          selectedVideoId:
            track.selectedVideoId === id ? undefined : track.selectedVideoId,
        })),
      }));
    },
  };
}
