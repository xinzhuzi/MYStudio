/**
 * Config slice — 从 studio-store.ts 拆出(Child 2 R3 Step 3)。
 *
 * 模式与 material-slice 一致:导出 createConfigSliceActions(set),
 * store 创建时注入 zustand set 并展开。只操作 workflowConfig 域,无跨域依赖。
 */
import type { StudioWorkflowConfig } from "@/types/studio";

/** 单集参考时长上限 3 分钟（下限 1）：一切写入与水合在此归一；非法值归 undefined（渲染默认 3）。 */
export function clampEpisodeDurationMin(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.min(3, Math.round(n)) : undefined;
}

/** Config slice 契约。 */
export interface ConfigSlice {
  workflowConfig: StudioWorkflowConfig;
  setWorkflowConfig: (updates: Partial<StudioWorkflowConfig>) => void;
}

/** slice 能看到的 store 局部视图。 */
interface ConfigSliceStore {
  workflowConfig: StudioWorkflowConfig;
}

type SetFn = (
  fn: (state: ConfigSliceStore) => Partial<ConfigSliceStore>,
) => void;

/** config slice 的 action 实现。 */
export function createConfigSliceActions(set: SetFn) {
  return {
    setWorkflowConfig: (updates: Partial<StudioWorkflowConfig>): void => {
      const normalized = { ...updates };
      if ("episodeDurationMin" in normalized) {
        normalized.episodeDurationMin = clampEpisodeDurationMin(
          normalized.episodeDurationMin,
        );
      }
      set((state) => ({
        workflowConfig: {
          ...state.workflowConfig,
          ...normalized,
        },
      }));
    },
  };
}
