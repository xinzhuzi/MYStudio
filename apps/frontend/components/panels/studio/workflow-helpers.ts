import type { AgentWorkKey, ScriptPlan } from "@/types/studio";

type WorkflowStoreSnapshot = {
  agentWorkData: Array<{
    key: AgentWorkKey;
    episodeId?: string;
    data: string;
    updatedAt: number;
  }>;
  novelChapters: Array<{ id: string; sourceText?: string }>;
  scriptPlans: Array<{ episodeId: string }>;
};

/** 把导演规划 ScriptPlan 关键维度压成分镜表的节奏/情绪基准文本。 */
export function formatScriptPlanContext(plan: ScriptPlan): string {
  return [
    plan.theme && `①主题立意：${plan.theme}`,
    plan.visualStyle && `②视觉风格：${plan.visualStyle}`,
    plan.narrativeRhythm && `③叙事节奏：${plan.narrativeRhythm}`,
    formatSceneIntentContext(plan.sceneIntents),
    plan.soundDirection && `⑤声音方向：${plan.soundDirection}`,
    plan.transitions && `⑥转场设计：${plan.transitions}`,
    formatDerivedAssetContext(plan.derivedAssetPlan),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSceneIntentContext(sceneIntents: ScriptPlan["sceneIntents"]): string {
  if (!sceneIntents.length) return "";
  return [
    "④分场景意图：",
    ...sceneIntents.map(
      (item) =>
        `- ${item.sceneId}｜情绪：${item.emotion}｜镜头：${item.shotIntent}｜空间：${item.spatial}`,
    ),
  ].join("\n");
}

function formatDerivedAssetContext(derivedAssetPlan: ScriptPlan["derivedAssetPlan"]): string {
  if (!derivedAssetPlan.length) return "";
  return [
    "⑦衍生资产预划：",
    ...derivedAssetPlan.map(
      (item) =>
        `- ${item.parentAssetId}｜${item.state}｜${item.reason}`,
    ),
  ].join("\n");
}

export function latestAgentWork(
  items: WorkflowStoreSnapshot["agentWorkData"],
  key: AgentWorkKey,
  episodeId?: string,
  options: { allowUnscopedFallback?: boolean } = {},
): string {
  const scoped = items
    .filter((item) => item.key === key && item.data.trim())
    .filter((item) => !episodeId || item.episodeId === episodeId);
  const candidates = scoped.length || options.allowUnscopedFallback === false
    ? scoped
    : items.filter((item) => item.key === key && item.data.trim());
  return (
    candidates.slice().sort((left, right) => right.updatedAt - left.updatedAt)[0]
      ?.data ?? ""
  );
}

export function resolveProductionEpisodeId(
  store: WorkflowStoreSnapshot,
  episodeId = "episode-1",
): string {
  if (episodeId !== "episode-1") return episodeId;
  const hasLegacyDraft = store.agentWorkData.some(
    (item) => item.key === "scriptDraft" && item.episodeId === episodeId,
  );
  if (hasLegacyDraft) return episodeId;
  return (
    [...store.agentWorkData]
      .reverse()
      .find((item) => item.key === "scriptDraft" && item.episodeId)
      ?.episodeId ??
    store.novelChapters[0]?.id ??
    episodeId
  );
}

export function resolveScriptTextForEpisode(
  store: WorkflowStoreSnapshot,
  episodeId: string,
): string {
  return (
    [...store.agentWorkData]
      .reverse()
      .find(
        (item) => item.key === "scriptDraft" && item.episodeId === episodeId,
      )?.data ??
    store.novelChapters.find((chapter) => chapter.id === episodeId)
      ?.sourceText ??
    (episodeId === "episode-1"
      ? [...store.agentWorkData]
          .reverse()
          .find((item) => item.key === "scriptDraft")?.data
      : undefined) ??
    store.novelChapters.map((chapter) => chapter.sourceText ?? "").join("\n\n")
  );
}

export function resolveScriptPlanEpisodeId(
  store: WorkflowStoreSnapshot,
  episodeId = "episode-1",
): string {
  if (episodeId !== "episode-1") return episodeId;
  if (store.scriptPlans.some((item) => item.episodeId === episodeId))
    return episodeId;
  return (
    store.scriptPlans[store.scriptPlans.length - 1]?.episodeId ??
    resolveProductionEpisodeId(store, episodeId)
  );
}

/**
 * 排序 key 的确定性 JSON 序列化(对象 key 排序,嵌套递归稳定)。
 * 08-27 二期自 useProductionPlanningActions 提升为共享导出,行为逐字节不变——
 * run 指纹与预划剧本锚共用同一序列化公式,杜绝两套公式各自漂移。
 */
export function stableRunFingerprint(value: unknown) {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return nested;
    return Object.keys(nested)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (nested as Record<string, unknown>)[key];
        return acc;
      }, {});
  });
}

/**
 * 预划剧本指纹锚(08-27 二期 R1):只对「哪一章 + 剧本正文」盖戳,刻意不含
 * manual/user 指令——改指令不该把预划判过期。导演规划落库侧与面板比对侧
 * 共用本函数(剧本正文提取统一走 resolveScriptTextForEpisode)。
 */
export function scriptPlanSourceFingerprint(
  episodeId: string,
  scriptText: string,
) {
  return stableRunFingerprint({ episodeId, scriptText });
}
