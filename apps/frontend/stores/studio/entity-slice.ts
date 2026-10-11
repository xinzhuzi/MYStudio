/**
 * Entity slice — 从 studio-store.ts 拆出(Child 2 R3 Step 6)。
 *
 * 4 个简单 setter,操作 entityExtractions/scriptPlans/seriesBible/episodeOutlines,
 * 均按 episodeId 去重 upsert 或整对象替换,无跨域依赖。
 */
import type {
  EntityExtractionResult,
  EpisodeOutline,
  ScriptPlan,
  SeriesBible,
} from "@/types/studio";

/** Entity slice 契约。 */
export interface EntitySlice {
  entityExtractions: EntityExtractionResult[];
  scriptPlans: ScriptPlan[];
  seriesBible: SeriesBible | null;
  /**
   * @deprecated 分集细纲阶段已死件清除(10-11 G3:episodeOutline 部署键与技能文档已删,
   * 零 UI 消费)。字段与存量数据保留,读写口(saveEpisodeOutline)留一年后再删。
   */
  episodeOutlines: EpisodeOutline[];
  saveEntityExtraction: (result: EntityExtractionResult) => void;
  saveScriptPlan: (plan: ScriptPlan) => void;
  saveSeriesBible: (bible: SeriesBible) => void;
  saveEpisodeOutline: (outline: EpisodeOutline) => void;
}

/** slice 能看到的 store 局部视图。 */
interface EntitySliceStore {
  entityExtractions: EntityExtractionResult[];
  scriptPlans: ScriptPlan[];
  seriesBible: SeriesBible | null;
  /** @deprecated 见 EntitySlice.episodeOutlines(10-11 G3 死件清除,存量数据面保留一年)。 */
  episodeOutlines: EpisodeOutline[];
}

type SetFn = (
  fnOrPartial:
    | ((state: EntitySliceStore) => Partial<EntitySliceStore>)
    | Partial<EntitySliceStore>,
) => void;

/** entity slice 的 action 实现。 */
export function createEntitySliceActions(set: SetFn) {
  return {
    saveEntityExtraction: (result: EntityExtractionResult): void => {
      set((state) => ({
        entityExtractions: [
          ...state.entityExtractions.filter(
            (item) => item.episodeId !== result.episodeId,
          ),
          result,
        ],
      }));
    },

    saveScriptPlan: (plan: ScriptPlan): void => {
      set((state) => ({
        scriptPlans: [
          ...state.scriptPlans.filter(
            (item) => item.episodeId !== plan.episodeId,
          ),
          plan,
        ],
      }));
    },

    saveSeriesBible: (bible: SeriesBible): void => {
      set({ seriesBible: bible });
    },

    saveEpisodeOutline: (outline: EpisodeOutline): void => {
      set((state) => ({
        episodeOutlines: [
          ...state.episodeOutlines.filter(
            (item) => item.episodeId !== outline.episodeId,
          ),
          outline,
        ],
      }));
    },
  };
}
