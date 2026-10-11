/**
 * 失效传播(10-11 pipeline-human-node-automation 批6,D4/G5 共用指纹方案):
 * 剧本(或上游)正文变更 → 本章下游媒体任务(scriptAsset/derivedAssetImage/
 * storyboardImage)已终态的产物基于旧剧本 → 派生视图标 stale(UI 黄标+
 * 章验收卡横幅提示重跑),禁静默用旧。
 *
 * 口径裁定:
 * - 指纹公式**零新造**:复用 08-27 二期 R1 的 scriptPlanSourceFingerprint
 *   (「哪一章+剧本正文」盖戳,导演规划落库与面板比对同一公式)——两套指纹
 *   公式各自漂移是事故源,此处只做消费;
 * - 台账=章级「发车指纹」落盘(useChapterUpstreamStore,与成本估价同款
 *   fileStorage persist):章流水线发车时盖戳;比对点=任意时刻现势剧本指纹
 *   vs 台账戳,漂移=该章下游已终态任务全 stale(不逐任务猜输入,章内下游
 *   同源消费同一份剧本);
 * - 存量兼容:台账无记录(老数据/未跑过流水线)不误报,恒零 stale;
 * - 队列本体零改:stale 是**派生视图**(纯函数从 mediaTasks+台账+现势剧本
 *   算出),不写回任务状态;任务是否真要重跑由人裁定(半自动纪律)。
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { fileStorage } from "@/lib/storage/indexed-db-storage";
import { useStudioStore } from "@/stores/studio/studio-store";
import type {
  AgentWorkKey,
  MediaGenerationTask,
  MediaGenerationTaskKind,
} from "@/types/studio";
import {
  resolveScriptTextForEpisode,
  scriptPlanSourceFingerprint,
} from "./workflow-helpers";

/** 失效传播覆盖的下游任务 kind(吃剧本产物的三链)。 */
export const DOWNSTREAM_TASK_KINDS: readonly MediaGenerationTaskKind[] = [
  "scriptAsset",
  "derivedAssetImage",
  "storyboardImage",
];

/** 指纹输入快照(resolveScriptTextForEpisode 的依赖面,订阅切片口径)。 */
export interface ScriptFingerprintSnapshot {
  agentWorkData: Array<{ key: AgentWorkKey; episodeId?: string; data: string; updatedAt: number }>;
  novelChapters: Array<{ id: string; sourceText?: string }>;
  scriptPlans: Array<{ episodeId: string }>;
}

/** 现势章剧本指纹(公式=scriptPlanSourceFingerprint,零新造)。 */
export function computeChapterScriptFingerprint(
  chapterId: string,
  snapshot: ScriptFingerprintSnapshot,
): string {
  const scriptText = resolveScriptTextForEpisode(snapshot, chapterId) ?? "";
  return scriptPlanSourceFingerprint(chapterId, scriptText);
}

/** 从 studio-store 现势取指纹快照(非订阅场景/编排入口用)。 */
export function currentScriptFingerprintSnapshot(): ScriptFingerprintSnapshot {
  const state = useStudioStore.getState();
  return {
    agentWorkData: state.agentWorkData,
    novelChapters: state.novelChapters,
    scriptPlans: state.scriptPlans,
  };
}

// ── 发车指纹台账(落盘:App 重启后比对仍在,G9 断点续跑同源) ──────────────────

export interface ChapterUpstreamRecord {
  /** 章流水线发车时的剧本指纹(scriptPlanSourceFingerprint 口径)。 */
  scriptFingerprint: string;
  recordedAt: number;
}

interface ChapterUpstreamState {
  byChapter: Record<string, ChapterUpstreamRecord>;
  /** 章流水线发车时盖戳(批5 编排入口调用;同指纹重复盖戳幂等)。 */
  recordDispatch: (chapterId: string, scriptFingerprint: string) => void;
}

export const useChapterUpstreamStore = create<ChapterUpstreamState>()(
  persist(
    (set) => ({
      byChapter: {},
      recordDispatch: (chapterId, scriptFingerprint) =>
        set((state) => {
          const existing = state.byChapter[chapterId];
          if (existing && existing.scriptFingerprint === scriptFingerprint) return state;
          return {
            byChapter: {
              ...state.byChapter,
              [chapterId]: { scriptFingerprint, recordedAt: Date.now() },
            },
          };
        }),
    }),
    {
      name: "mystudio-chapter-upstream-fingerprint",
      storage: createJSONStorage(() => fileStorage),
      merge: (persisted, current) => {
        const persistedState =
          persisted && typeof persisted === "object"
            ? (persisted as { byChapter?: unknown })
            : {};
        const raw = persistedState.byChapter;
        const byChapter: Record<string, ChapterUpstreamRecord> = {};
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          for (const [chapterId, record] of Object.entries(
            raw as Record<string, unknown>,
          )) {
            if (
              record &&
              typeof record === "object" &&
              typeof (record as { scriptFingerprint?: unknown }).scriptFingerprint === "string"
            ) {
              byChapter[chapterId] = {
                scriptFingerprint: (record as { scriptFingerprint: string }).scriptFingerprint,
                recordedAt:
                  typeof (record as { recordedAt?: unknown }).recordedAt === "number"
                    ? (record as { recordedAt: number }).recordedAt
                    : 0,
              };
            }
          }
        }
        return { ...current, byChapter };
      },
    },
  ),
);

// ── 派生 stale 视图(纯函数,零写回) ─────────────────────────────────────────

export interface StaleMediaTaskView {
  taskId: string;
  kind: MediaGenerationTaskKind;
  targetId: string;
  /** 派生口径的过期原因(横幅/黄标 tooltip)。 */
  reason: string;
}

export const STALE_REASON = "剧本已变更，该产物基于旧剧本生成，请重跑章流水线";

function isTerminalTask(task: MediaGenerationTask): boolean {
  return task.status === "success" || task.status === "failed" || task.status === "canceled";
}

/**
 * 本章上游是否漂移:台账有戳且与现势剧本指纹不一致。
 * 无台账(未跑过流水线/存量数据)= 不误报。
 */
export function chapterUpstreamDrifted(input: {
  chapterId: string;
  snapshot: ScriptFingerprintSnapshot;
  ledger: Record<string, ChapterUpstreamRecord>;
}): boolean {
  const record = input.ledger[input.chapterId];
  if (!record) return false;
  return computeChapterScriptFingerprint(input.chapterId, input.snapshot) !== record.scriptFingerprint;
}

/**
 * 收集本章 stale 下游任务(纯函数):上游漂移时,该章已终态的下游任务全 stale。
 * 供章验收卡/orb 黄标/横幅消费;不写回任务台账。
 */
export function collectStaleDownstreamTasks(input: {
  chapterId: string;
  mediaTasks: MediaGenerationTask[];
  snapshot: ScriptFingerprintSnapshot;
  ledger: Record<string, ChapterUpstreamRecord>;
}): StaleMediaTaskView[] {
  if (!chapterUpstreamDrifted(input)) return [];
  return input.mediaTasks
    .filter(
      (task) =>
        task.episodeId === input.chapterId &&
        (DOWNSTREAM_TASK_KINDS as readonly string[]).includes(task.kind) &&
        isTerminalTask(task),
    )
    .map((task) => ({
      taskId: task.id,
      kind: task.kind,
      targetId: task.targetId,
      reason: STALE_REASON,
    }));
}

/** 从 studio-store 现势直接收集(非订阅场景:编排入口/重算聚合)。 */
export function collectStaleDownstreamTasksFromStore(chapterId: string): StaleMediaTaskView[] {
  const state = useStudioStore.getState();
  return collectStaleDownstreamTasks({
    chapterId,
    mediaTasks: state.mediaTasks,
    snapshot: {
      agentWorkData: state.agentWorkData,
      novelChapters: state.novelChapters,
      scriptPlans: state.scriptPlans,
    },
    ledger: useChapterUpstreamStore.getState().byChapter,
  });
}
