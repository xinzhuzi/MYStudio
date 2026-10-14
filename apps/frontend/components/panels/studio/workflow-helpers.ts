import type { AgentWorkKey, ScriptPlan } from "@/types/studio";

type WorkflowStoreSnapshot = {
  agentWorkData: Array<{
    /** D2/D5 sourceScript 戳记需要条目身份;快照为结构类型,存疑缺省。 */
    id?: string;
    key: AgentWorkKey;
    episodeId?: string;
    data: string;
    updatedAt: number;
  }>;
  novelChapters: Array<{ id: string; sourceText?: string }>;
  scriptPlans: Array<{ episodeId: string }>;
  /**
   * D6(10-13-audit4-downstream,design §2):当前章真源(studio-store,由
   * 10-13-audit4-gen-chain G1 接活)。无草稿时章定位回落到它,不再猜 novelChapters[0]。
   */
  activeChapterId?: string | null;
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

/**
 * 最新条目单源选择器(D7 收口,C 批 R12/10-14-audit4-residuals):按 updatedAt
 * 取最新,数组序不再参与语义。此前剧本侧四处「数组序 reverse().find」与本函数
 * (及 latestAgentWork 的 updatedAt 排序)多口径各自为政,在「数组序 ≠ updatedAt
 * 序」时各说各话——ScriptTab 之外的三处(useScriptStageActions.latestScriptStage
 * Entry、AssetsTab 本章剧本、workflow-readiness.findScriptTarget)全部收敛到此。
 * 平局(updatedAt 相等)取数组序靠后者——与旧 reverse().find 逐位一致,除双口径
 * bug 本身外零行为漂移。
 */
export function latestAgentWorkEntry(
  items: WorkflowStoreSnapshot["agentWorkData"],
  key: AgentWorkKey,
  episodeId?: string,
): WorkflowStoreSnapshot["agentWorkData"][number] | undefined {
  let best: WorkflowStoreSnapshot["agentWorkData"][number] | undefined;
  for (const item of items) {
    if (item.key !== key) continue;
    if (episodeId ? item.episodeId !== episodeId : !item.episodeId) continue;
    // >=:平局取数组序靠后——与旧 reverse().find 真逐位一致(原 latestScriptDraft
    // Entry 用 > 在平局保靠前,与其自身注释相悖,此处一并校正)。
    if (!best || item.updatedAt >= best.updatedAt) best = item;
  }
  return best;
}

/**
 * 最新剧本草稿条目(D7 单源,10-13-audit4-downstream design §3):委托
 * latestAgentWorkEntry,本函数保留作 scriptDraft 语义的具名入口。
 */
export function latestScriptDraftEntry(
  store: WorkflowStoreSnapshot,
  episodeId?: string,
): WorkflowStoreSnapshot["agentWorkData"][number] | undefined {
  return latestAgentWorkEntry(store.agentWorkData, "scriptDraft", episodeId);
}

/**
 * 章定位安全变体(D6 配套):渲染/订阅比对等无法「报错」的路径用本函数——
 * 不可定位时返 null,由调用方显式回落(如 "episode-1" 哨兵)或判空中止;
 * 动作链(规划/分镜/提取)仍用严格版,让不可定位现形为错误而非静默猜章。
 */
export function tryResolveProductionEpisodeId(
  store: WorkflowStoreSnapshot,
  episodeId = "episode-1",
): string | null {
  try {
    return resolveProductionEpisodeId(store, episodeId);
  } catch {
    return null;
  }
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
  // D7:最新草稿按 updatedAt(单源 latestScriptDraftEntry),不再按数组序猜。
  const latestDraft = latestScriptDraftEntry(store);
  if (latestDraft?.episodeId) return latestDraft.episodeId;
  // D6(design §2):无草稿不回落第 1 章——多章项目里 novelChapters[0] 是猜测,
  // 会拿到错章的章身份;改用当前章真源(activeChapterId,G1 接活),皆空=报错。
  const activeChapterId = store.activeChapterId;
  if (typeof activeChapterId === "string" && activeChapterId.trim()) {
    return activeChapterId;
  }
  throw new Error(
    "无法定位剧本章：既无剧本草稿，也未设置当前章（activeChapterId）——请先导入/选择章节或保存剧本草稿",
  );
}

export function resolveScriptTextForEpisode(
  store: WorkflowStoreSnapshot,
  episodeId: string,
): string {
  return (
    // D7:同一章内最新草稿按 updatedAt 取(单源),不再按数组序。
    latestScriptDraftEntry(store, episodeId)?.data ??
    store.novelChapters.find((chapter) => chapter.id === episodeId)
      ?.sourceText ??
    (episodeId === "episode-1"
      ? latestScriptDraftEntry(store)?.data
      : undefined) ??
    // R14(10-14-audit4-residuals,D6 残项):无草稿且本章无正文时**不拼全书**——
    // 旧回落 `novelChapters.map(sourceText).join("\n\n")` 把别章正文冒充本章剧本,
    // 导演规划/提取/分镜全链拿混合正文;空串让调用方的「没有可规划的剧本」守卫
    // 正常发声(useProductionPlanningActions:82/:323、useNovelPipelineActions:259),
    // 指纹面(chapter-pipeline-stale:52 ?? "")同得确定性空正文。
    ""
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
