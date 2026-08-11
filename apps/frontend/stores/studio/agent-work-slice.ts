/**
 * Agent-work slice — 从 studio-store.ts 拆出(Child 2 R3 Step 8)。
 *
 * saveAgentWorkData:追加 agentWorkData,并在 productionPlan 含本地成片输出时
 * 联动创建 finalExport media task。跨域部分通过注入的 startMediaTask/finishMediaTask。
 */
import type { AgentWorkData, AgentWorkKey, StudioSourceIdentity } from "@/types/studio";
import { createStudioWorkflowId } from "./studio-store-runtime";

/** Agent-work slice 契约。 */
export interface AgentWorkSlice {
  agentWorkData: AgentWorkData[];
  saveAgentWorkData: (
    key: AgentWorkKey,
    data: string,
    episodeId?: string,
    identity?: StudioSourceIdentity,
  ) => string;
}

/** slice 能看到的 store 局部视图 + 跨域依赖。 */
interface AgentWorkSliceStore {
  agentWorkData: AgentWorkData[];
  startMediaTask: (input: {
    kind: string;
    targetId: string;
    episodeId?: string;
    provider?: string;
    inputFingerprint?: string;
  }) => string;
  finishMediaTask: (
    id: string,
    output?: { outputRef?: string },
  ) => void;
}

type SetFn = (
  fn: (state: AgentWorkSliceStore) => Partial<AgentWorkSliceStore>,
) => void;
type GetFn = () => AgentWorkSliceStore;

/** agent-work slice 的 action 实现。 */
export function createAgentWorkSliceActions(set: SetFn, get: GetFn) {
  return {
    saveAgentWorkData: (
      key: AgentWorkKey,
      data: string,
      episodeId?: string,
      identity?: StudioSourceIdentity,
    ): string => {
      const now = Date.now();
      const id = createStudioWorkflowId("work");
      const item: AgentWorkData = {
        id,
        key,
        episodeId,
        data,
        sourceId: identity?.sourceId,
        revision: identity?.revision,
        createdAt: now,
        updatedAt: now,
      };
      set((state) => ({ agentWorkData: [...state.agentWorkData, item] }));
      if (key === "productionPlan" && /本地成片输出[:：]\s*\S+/.test(data)) {
        const taskId = get().startMediaTask({
          kind: "finalExport",
          targetId: episodeId ?? id,
          episodeId,
          provider: "ffmpeg-local",
          inputFingerprint: data,
        });
        get().finishMediaTask(taskId, { outputRef: id });
      }
      return id;
    },
  };
}
