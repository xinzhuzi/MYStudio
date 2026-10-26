import { useCallback, useMemo, useRef, useState } from "react";
import { isDaojieAdaptation, reviewDaojieGeneration } from "@/lib/studio/daojie-generation-audit";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  buildStageMessages,
  buildStageReviewMessages,
  hasFreshReviewIssues,
  parseStageOutput,
  SCRIPT_STAGE_LABEL,
  SCRIPT_STAGE_PROMPT_PLACEHOLDER,
  SCRIPT_STAGE_REVIEW_KEY,
  type ReviewableStage,
  type ScriptStageKey,
} from "@/lib/studio/script-planning";
import { latestAgentWorkEntry } from "./workflow-helpers";
import { readSourceMemoryActionContext } from "@/lib/studio/source-memory";
import { logEvent } from "@/lib/diagnostics/logger";
import { loadStudioChapterWorkspace } from "@/lib/storage/project-storage";
import {
  analyzeScriptDraft,
  formatScriptDraftMetrics,
} from "@/lib/studio/script-draft-metrics";
import {
  buildScriptManualContext,
  type StudioManualCatalog,
} from "@/lib/studio/manuals";
import {
  buildProjectMemoryRecords,
  formatProjectMemoryContext,
  retrieveProjectMemory,
} from "@/lib/studio/project-memory";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useProjectStore } from "@/stores/project/project-store";
import type {
  AgentWorkData,
  AgentWorkKey,
  NovelChapter,
  StudioReviewTarget,
  StudioWorkflowConfig,
} from "@/types/studio";
import { toast } from "sonner";

type StudioStore = ReturnType<typeof useStudioStore.getState>;

/**
 * 剧本阶段(B+ 单次生成,全上下文注入)流式整体预算。
 * 装机实弹(10-11 GLM):39k 级 prompt 走 HTTP 回退一次性生成可超 300s——流式 IPC
 * 缺省 300s 会把回退腿掐死在 AbortError;此处按「非流式最坏 300s+」量级给 600s,
 * 穿透 aiManager.textStream → 主进程 SDK 流式 + HTTP 回退共享预算。
 */
export const SCRIPT_STAGE_STREAM_TIMEOUT_MS = 600_000;

/**
 * S7 分镜表流式整体预算(10-14 livefire17 ch002 定谳):分镜表期望总时长 690-1215s
 * (正文 5862 字,乐观/悲观吞吐两支),600s 档=人为墙(实弹 600s 流式停摆即降级链)。
 * 1200s=判定性预算非充分预算:停摆超时可判「载荷问题」,不承诺再给时间必成。
 * 仅分镜表调用点(useProductionPlanningActions handleStoryboardTable)使用;
 * S2 剧本阶段与导演规划侧维持 600s 档不动。
 */
export const STORYBOARD_TABLE_STREAM_TIMEOUT_MS = 1_200_000;

function scriptWritebackVersion(episodeId: string): string {
  const store = useStudioStore.getState();
  return JSON.stringify({
    projectId: useProjectStore.getState().activeProjectId,
    chapter: store.novelChapters.find((item) => item.id === episodeId),
    workflowConfig: store.workflowConfig,
    bible: store.seriesBible,
    drafts: store.agentWorkData.filter((item) => item.key === "scriptDraft"),
  });
}

export function useScriptStageActions({
  workflowConfig,
  manualCatalog,
  projectName,
  novelChapterCount,
  novelChapters,
  agentWorkData,
  saveAgentWorkData,
}: {
  workflowConfig: StudioWorkflowConfig;
  manualCatalog: StudioManualCatalog;
  projectName: string;
  novelChapterCount: number;
  /** 章节列表（按顺序）：剧本阶段取前一章最新剧本作上一集衔接注入 */
  novelChapters?: readonly NovelChapter[];
  agentWorkData: AgentWorkData[];
  saveAgentWorkData: StudioStore["saveAgentWorkData"];
}) {
  const scriptStyleSummary = useMemo(() => {
    const visual = manualCatalog.visual?.find(
      (p) => p.id === workflowConfig.visualManualId,
    )?.name;
    return [
      "## 项目信息",
      `小说名称：${projectName}`,
      workflowConfig.novelGenre ? `小说类型：${workflowConfig.novelGenre}` : "",
      `目标画风：${visual || workflowConfig.stylePositioning || "未设"}`,
      `目标画幅：${workflowConfig.platformSpec || "16:9"}`,
      workflowConfig.episodeCount
        ? `集数：${workflowConfig.episodeCount}集`
        : "",
      `单集参考时长：${workflowConfig.episodeDurationMin ?? 3}分钟`,
      `章节数量：${novelChapterCount}章`,
    ]
      .filter(Boolean)
      .join("\n");
  }, [
    projectName,
    workflowConfig.visualManualId,
    workflowConfig.novelGenre,
    workflowConfig.stylePositioning,
    workflowConfig.platformSpec,
    workflowConfig.episodeCount,
    workflowConfig.episodeDurationMin,
    manualCatalog,
    novelChapterCount,
  ]);

  // R2/G11–G14:剧本阶段手册上下文=所选导演包 script_narrative(父 I3 标题自带,全文不截断);
  // buildStudioManualContext 另两调用方(导演规划阶段)不动
  const scriptDirectorContext = useMemo(
    () => buildScriptManualContext(workflowConfig, manualCatalog),
    [workflowConfig, manualCatalog],
  );

  /** 最新阶段条目(整条,含 createdAt)——F3 审核时效判定需要条目时间戳。
   * R12/D7(C批拷问补刀 10-15):委托 workflow-helpers latestAgentWorkEntry 单源——
   * 原本地 [...agentWorkData].reverse().find 数组序口径与 prd R12 剧本侧单口径相悖,
   * 数组序≠updatedAt 序时本章稿(:267)/上一集稿(:300)/审核主体(:405)会拿旧稿;
   * 平局取数组序靠后=与旧 reverse().find 真逐位一致,除双口径 bug 本身外零行为漂移。 */
  const latestScriptStageEntry = useCallback(
    (key: AgentWorkKey, scopeId: string) =>
      latestAgentWorkEntry(agentWorkData, key, scopeId),
    [agentWorkData],
  );

  const latestScriptStage = useCallback(
    (key: AgentWorkKey, scopeId: string) =>
      latestScriptStageEntry(key, scopeId)?.data ?? "",
    [latestScriptStageEntry],
  );

  // 1011 thinking 进流:scriptStreaming 增设 thinking 增量位——思考单独累积不混正文,
  // 完成后随状态清零整体丢弃(零持久化,saveAgentWorkData 只落 result.text)。
  const [scriptStreaming, setScriptStreaming] = useState<{
    key: AgentWorkKey;
    scopeId: string;
    text: string;
    thinking?: string;
  } | null>(null);

  // G2:互斥锁的同步面——ref 保证「点击当下」跨调用立即可见(setState 批处理异步不可靠),
  // scriptStreaming state 仅作 UI 投影;生成与审核共用同一槽位语义(互斥)。
  const scriptStreamSlotRef = useRef<{ stageKey: AgentWorkKey; scopeId: string } | null>(null);

  /** G2:点击当下同步占槽(早于 buildStageMessagesFull 的任何 await);已被占=拒绝(返回 false)。 */
  const acquireStreamSlot = useCallback(
    (stageKey: AgentWorkKey, scopeId: string): boolean => {
      if (scriptStreamSlotRef.current) return false;
      scriptStreamSlotRef.current = { stageKey, scopeId };
      setScriptStreaming({ key: stageKey, scopeId, text: "", thinking: "" });
      return true;
    },
    [],
  );

  /** G2:释放槽位(幂等;按 stageKey+scopeId 认领,陈旧释放不会误清新一轮)。 */
  const releaseStreamSlot = useCallback((stageKey: AgentWorkKey, scopeId: string) => {
    if (
      scriptStreamSlotRef.current?.stageKey !== stageKey ||
      scriptStreamSlotRef.current?.scopeId !== scopeId
    ) {
      return;
    }
    scriptStreamSlotRef.current = null;
    setScriptStreaming(null);
  }, []);

  const runScriptStage = useCallback(
    async (opts: {
      agentKey: "scriptDraft";
      messages: { system: string; user: string };
      stageKey: AgentWorkKey;
      scopeId: string;
      label: string;
      revised?: boolean;
      sourceId?: string;
      revision?: number;
      /** G3:审核条目附着被审剧本条目指纹(审核发起时点捕获),isReviewFresh 版本比对真源 */
      reviewTarget?: StudioReviewTarget;
      audit?: { sourceText: string; bibleContext: string; version: string };
    }) => {
      // 槽位由两个入口占用并在各自finally释放，覆盖生成、审核和写回。
      // 1011 欠账⑤:textStream 顶层 reject(流式 IPC 异常等)时下方清零不可达,scriptStreaming
      // 永卡非 null——ScriptTab 生成/审核按钮(scriptStreaming!==null 即禁用)永久禁用无恢复
      // 入口。try/finally 兜底保证流态必回落;异常本身不吞仍向上抛(拒绝语义与修前一致)。
      // 生成与审核(handleStageReview)同走本流,一处修复两路受益。
      let result: Awaited<ReturnType<typeof aiManager.textStream>>;
      try {
        result = await aiManager.textStream(
          {
            binding: { agent: opts.agentKey },
            timeoutMs: SCRIPT_STAGE_STREAM_TIMEOUT_MS,
            messages: [
              { role: "system", content: opts.messages.system },
              { role: "user", content: opts.messages.user },
            ],
          },
          (delta, kind) =>
            setScriptStreaming((s) =>
              s && s.key === opts.stageKey && s.scopeId === opts.scopeId
                ? kind === "thinking"
                  ? { ...s, thinking: (s.thinking ?? "") + delta }
                  : { ...s, text: s.text + delta }
                : s,
            ),
        );
      } catch (error) {
        // 1011 用户令「解决其他的问题」:顶层异常原本只上抛(console 可见、UI 无感),
        // 现按既有失败口径弹 toast——异常仍上抛保持拒绝语义,但用户必得提示。
        toast.error(error instanceof Error ? error.message : `${opts.label}生成异常,请重试`);
        throw error;
      }
      // 入口finally释放锁；审核及写回期间继续占槽，防止第二击越过审核。
      if (!result.success || !result.text) {
        toast.error(result.error || `${opts.label}生成失败`);
        return;
      }
      // G4:空解析不落库——<think> 未闭合截断等致 parseStageOutput trim 后为空时,
      // 原文非空但正文为零字符,落库会把上一版遮蔽成空串。此处不落库保上一版,
      // 原始文本留 console 诊断位,并按失败口径提示(先解锁后提示,finally 已释放)。
      const parsed = parseStageOutput(result.text);
      if (!parsed) {
        console.error(
          `[script-stage] ${opts.label} 输出解析为空(疑似被截断),已保留上一版。原始文本:`,
          result.text,
        );
        toast.error(`${opts.label}输出被截断/为空，已保留上一版`);
        return;
      }
      if (opts.audit) {
        const review = await reviewDaojieGeneration({
          stage: "script", sourceText: opts.audit.sourceText,
          bibleContext: opts.audit.bibleContext, outputText: parsed,
        }, (messages) => aiManager.textStream({
          binding: { agent: opts.agentKey }, timeoutMs: SCRIPT_STAGE_STREAM_TIMEOUT_MS,
          temperature: 0.2,
          messages: [{ role: "system", content: messages.system }, { role: "user", content: messages.user }],
        }, () => undefined));
        if (scriptWritebackVersion(opts.scopeId) !== opts.audit.version) {
          toast.error("审核期间项目、原文或剧本已更新，本次产出未写回");
          return;
        }
        saveAgentWorkData("supervisionReport", review.report, opts.scopeId, {
          sourceId: opts.sourceId ?? opts.scopeId, revision: opts.revision ?? 1,
        });
        if (!review.passed) {
          toast.error("道劫剧本未通过原文审核，已保留上一有效版本；详见审核报告");
          return;
        }
      }
      saveAgentWorkData(
        opts.stageKey,
        parsed,
        opts.scopeId,
        {
          sourceId: opts.sourceId ?? opts.scopeId,
          revision: opts.revision ?? 1,
          reviewTarget: opts.reviewTarget,
        },
      );
      toast.success(
        opts.revised
          ? `已按审核修订「${opts.label}」，请重新审核确认`
          : `${opts.label}已生成`,
      );
    },
    [saveAgentWorkData],
  );

  // 常驻圣经块 + 原著档案检索合一（用户裁定：每条消息常驻块只有一个，检索追加其后；
  // 档案不可用→零注入零阻断）。query 传当前章节的事件语境供检索定向。
  const readBibleContext = async (query?: string) => {
    const projectId = useProjectStore.getState().activeProjectId;
    return readSourceMemoryActionContext({
      projectId,
      archiveQuery: query ?? "",
    });
  };

  /** 组装某阶段完整消息(导演偏好+原著圣经+档案检索+项目记忆全注入);供生成与预览共用。 */
  const buildStageMessagesFull = useCallback(
    async (
      stage: ScriptStageKey,
      chapter: NovelChapter,
      options?: { useReviewFeedback?: boolean },
    ): Promise<
      | { ok: true; system: string; user: string; bibleContext: string }
      | { ok: false; error: string }
    > => {
      const scriptDraft = latestScriptStage("scriptDraft", chapter.id);
      const reviewKey = SCRIPT_STAGE_REVIEW_KEY[stage as ReviewableStage];
      // F3 审核时效:审核条目须晚于最新剧本条目才算「针对当前版本」——
      // isReviewFresh 与 ScriptTab reviseMode 同一共享判定,不两处各写
      const reviewEntry = reviewKey
        ? latestScriptStageEntry(reviewKey, chapter.id)
        : undefined;
      const review = reviewEntry?.data ?? "";
      const useReviewFeedback = options?.useReviewFeedback;
      const store = useStudioStore.getState();
      const projectId = useProjectStore.getState().activeProjectId ?? "studio-current-project";
      const eventMemoryContext = formatProjectMemoryContext(retrieveProjectMemory({
        records: buildProjectMemoryRecords({
          projectId,
          chapters: store.novelChapters,
          entityExtractions: store.entityExtractions,
          seriesBible: store.seriesBible,
        }),
        projectId,
        episodeId: chapter.id,
        query: `${chapter.title} ${chapter.eventSummary ?? ""} ${chapter.eventState ?? ""}`,
      }));
      const memory = await readBibleContext(
        `${chapter.title} ${chapter.eventSummary ?? ""} ${chapter.eventState ?? ""}`,
      );
      if (!memory.success) {
        return { ok: false, error: memory.error };
      }
      const chapterIndex = novelChapters?.findIndex((item) => item.id === chapter.id) ?? -1;
      const previousChapter =
        chapterIndex > 0 && novelChapters ? novelChapters[chapterIndex - 1] : undefined;
      const previousEpisodeScript =
        stage === "scriptDraft" && previousChapter
          ? latestScriptStage("scriptDraft", previousChapter.id)
          : undefined;
      // 腿3②（LF14 §7.3）：启动自动恢复态（持久化回放）不走 switchChapter，前章
      // agentWorkData 不在内存 →「上一集剧本」节缺失仍开（切章路径的前章并入只盖
      // 切章）。仅落诊断不改装配语义：持久化层有前章稿=真缺节（warn）；持久化也无
      // =前章从未生成剧本（合法缺节，debug 观察窗取证）。logEvent 全 try/catch 永不炸产线。
      if (stage === "scriptDraft" && previousChapter && !previousEpisodeScript) {
        let persistedPreviousScript = "";
        try {
          const previousWorkspace = await loadStudioChapterWorkspace(projectId, previousChapter.id);
          persistedPreviousScript = latestAgentWorkEntry(
            ((previousWorkspace?.domains.agentWorkData ?? []) as unknown) as AgentWorkData[],
            "scriptDraft",
            previousChapter.id,
          )?.data ?? "";
        } catch {
          // 持久化不可查（读链损坏/无项目）→ 观察窗降 debug，不拦截组装
        }
        void logEvent({
          level: persistedPreviousScript ? "warn" : "debug",
          category: "workflow",
          operationId: "scriptStage.previousEpisodeMissing",
          message: persistedPreviousScript
            ? "上一集剧本节缺失：持久化层有前章稿但未注入（恢复态）"
            : "上一集剧本节缺失：前章无剧本（合法缺节观察窗）",
          context: { chapterId: chapter.id, previousChapterId: previousChapter.id },
        });
      }
      const built = buildStageMessages(stage, {
        manualContext: scriptStyleSummary,
        directorContext: scriptDirectorContext,
        strictDaojieAdaptation: isDaojieAdaptation(workflowConfig.directorManualId, chapter.sourceText),
        originalBibleContext: memory.context,
        chapterTitle: chapter.title,
        chapterText: chapter.sourceText ?? "",
        eventState: chapter.eventState,
        previousEpisodeScript: previousEpisodeScript || undefined,
        eventMemoryContext,
        scriptDraft,
        reviewFeedback:
          useReviewFeedback &&
          hasFreshReviewIssues(reviewEntry, latestScriptStageEntry(stage, chapter.id))
            ? review
            : undefined,
        previousOutput: latestScriptStage(stage, chapter.id),
        // H9 集序:1 基章序/总集数随请求注入(原创章方法文档定位本集坐标的运行前提),
        // 不被 workflowConfig.episodeCount 门控;无章序列表时缺省零注入
        episodeOrdinal:
          chapterIndex >= 0 && novelChapters ? chapterIndex + 1 : undefined,
        episodeTotal: novelChapters?.length,
      });
      return { ok: true, system: built.system, user: built.user, bibleContext: memory.context ?? "" };
    },
    [latestScriptStageEntry, latestScriptStage, scriptStyleSummary, scriptDirectorContext, novelChapters, workflowConfig.directorManualId],
  );

  /** 「AI提示词」页预览:与实际发送(未编辑时)完全一致的完整 user 消息;失败返回 null 静默回退。 */
  const previewStageUserMessage = useCallback(
    async (
      stage: ScriptStageKey,
      chapter: NovelChapter,
      options?: { useReviewFeedback?: boolean },
    ): Promise<string | null> => {
      const built = await buildStageMessagesFull(stage, chapter, options);
      return built.ok ? built.user : null;
    },
    [buildStageMessagesFull],
  );

  const handleScriptStage = useCallback(
    async (
      stage: ScriptStageKey,
      chapter: NovelChapter,
      userOverride?: string,
      options?: { useReviewFeedback?: boolean },
    ) => {
      // G2:互斥锁在点击当下同步置位(早于 buildStageMessagesFull 的任何 await)——组装期
      // 第二击/生成+审核交叉在此被拒,全程只放行一路;锁面=ref(同步可见),state 仅 UI 投影。
      if (!acquireStreamSlot(stage, chapter.id)) {
        toast.error(`「${SCRIPT_STAGE_LABEL[stage]}」正在生成/审核中，请等待完成后再试`);
        return;
      }
      try {
        const liveDirectorId = useStudioStore.getState().workflowConfig?.directorManualId;
        if (stage === "scriptDraft" && liveDirectorId !== workflowConfig.directorManualId && (isDaojieAdaptation(liveDirectorId, chapter.sourceText) || isDaojieAdaptation(workflowConfig.directorManualId, chapter.sourceText))) {
          toast.error("题材选择已变化，请刷新后重新生成");
          return;
        }
        const strict = stage === "scriptDraft" && isDaojieAdaptation(workflowConfig.directorManualId, chapter.sourceText);
        const sourceChapter = strict ? useStudioStore.getState().novelChapters.find((item) => item.id === chapter.id) : undefined;
        if (strict && (!sourceChapter || sourceChapter.sourceText !== chapter.sourceText)) {
          toast.error("本章原文已变化，请刷新后重新生成");
          return;
        }
        const version = strict ? scriptWritebackVersion(chapter.id) : "";
        // B+ 单次生成：剧本(含规划)无前置阶段门禁——方法文档按本章判定自动注入(buildStageMessages 内)
        const built = await buildStageMessagesFull(stage, chapter, options);
        if (!built.ok) {
          toast.error(built.error);
          return;
        }
        // F3:修订文案旗标与注入判定同口径——审核含未修复问题 且 晚于最新剧本(isReviewFresh 共享)
        const reviewKey = SCRIPT_STAGE_REVIEW_KEY[stage as ReviewableStage];
        const reviewEntry = reviewKey
          ? latestScriptStageEntry(reviewKey, chapter.id)
          : undefined;
        // G5:实发边界拒绝字面占位串——组装期占位串即便漏进 userDraft(编辑器残留等),
        // 也不得固化为 userOverride,回落完整组装产物
        const effectiveOverride =
          userOverride && userOverride !== SCRIPT_STAGE_PROMPT_PLACEHOLDER
            ? userOverride
            : undefined;
        return await runScriptStage({
          agentKey: "scriptDraft",
          audit: strict ? { sourceText: chapter.sourceText ?? "", bibleContext: built.bibleContext, version } : undefined,
          messages: { system: built.system, user: effectiveOverride || built.user },
          stageKey: stage,
          scopeId: chapter.id,
          label: SCRIPT_STAGE_LABEL[stage],
          revised:
            options?.useReviewFeedback &&
            hasFreshReviewIssues(reviewEntry, latestScriptStageEntry(stage, chapter.id)),
          sourceId: chapter.sourceId ?? chapter.id,
          revision: chapter.revision ?? 1,
        });
      } finally {
        // G2:组装段早退(构建失败/异常)也必须释放;成功路径已被 runScriptStage 的
        // finally 先行释放,此处幂等兜底
        releaseStreamSlot(stage, chapter.id);
      }
    },
    [runScriptStage, latestScriptStageEntry, buildStageMessagesFull, acquireStreamSlot, releaseStreamSlot, workflowConfig.directorManualId],
  );

  const handleStageReview = useCallback(
    async (stage: ReviewableStage, chapter: NovelChapter) => {
      const reviewStageKey = SCRIPT_STAGE_REVIEW_KEY[stage];
      // G2:与生成共用同一互斥槽,点击当下同步占位——组装期交叉点击在此被拒
      if (!acquireStreamSlot(reviewStageKey, chapter.id)) {
        toast.error(`「${SCRIPT_STAGE_LABEL[stage]}审核」正在生成/审核中，请等待完成后再试`);
        return;
      }
      try {
        // G3:被审剧本条目在审核发起时点捕获(此后至落库前保存的新版本不改变指纹)——
        // 「审核 v1 流式期间保存 v2」时指纹仍指 v1,落库后 v2 判「未审」
        const targetEntry = latestScriptStageEntry(stage, chapter.id);
        const target = targetEntry?.data ?? "";
        if (!target) {
          toast.error(`请先生成${SCRIPT_STAGE_LABEL[stage]}`);
          return;
        }
        const memory = await readBibleContext(
          `${chapter.title} ${chapter.eventSummary ?? ""} ${chapter.eventState ?? ""}`,
        );
        if (!memory.success) {
          toast.error(memory.error);
          return;
        }
        const built = buildStageReviewMessages(stage, {
          manualContext: scriptStyleSummary,
          // G33:审核侧同注题材剧本规则节——复用生成侧同一 memo 产物(scriptDirectorContext),
          // 注入位在审核主体之后、自检指标之前(buildStageReviewMessages 内)
          directorNarrative: scriptDirectorContext,
          originalBibleContext: memory.context,
          chapterTitle: chapter.title,
          chapterText: chapter.sourceText ?? "",
          eventState: chapter.eventState,
          scriptDraft: target,
          // R4/G9:审核前对审核主体算确定性自检指标(父 I5 节随 user 注入,审核以其数值为准);
          // 画幅真源=剧本头部自述(script-draft-metrics 内解析),opts 仅兜底
          ...(stage === "scriptDraft"
            ? {
                selfCheckMetrics: formatScriptDraftMetrics(
                  analyzeScriptDraft(target, {
                    durationMin: workflowConfig.episodeDurationMin ?? 3,
                    aspectRatio: workflowConfig.platformSpec || "16:9",
                  }),
                ),
              }
            : {}),
        });
        return await runScriptStage({
          agentKey: "scriptDraft",
          messages: { system: built.system, user: built.user },
          stageKey: reviewStageKey,
          scopeId: chapter.id,
          label: `${SCRIPT_STAGE_LABEL[stage]}审核`,
          sourceId: chapter.sourceId ?? chapter.id,
          revision: chapter.revision ?? 1,
          // R12 拷问补刀随迁:latestAgentWorkEntry 快照形态 id 可选,无 id 不附着指纹
          // (回落 createdAt 时间比较=旧数据语义,与 ScriptTab 人工改审保存同守卫)
          reviewTarget:
            targetEntry?.id && typeof targetEntry.updatedAt === "number"
              ? { entryId: targetEntry.id, updatedAt: targetEntry.updatedAt }
              : undefined,
        });
      } finally {
        // G2:同 handleScriptStage——早退/异常路径幂等兜底释放
        releaseStreamSlot(reviewStageKey, chapter.id);
      }
    },
    [runScriptStage, latestScriptStageEntry, scriptStyleSummary, scriptDirectorContext, workflowConfig, acquireStreamSlot, releaseStreamSlot],
  );

  return {
    scriptStyleSummary,
    scriptDirectorContext,
    scriptStreaming,
    previewStageUserMessage,
    handleScriptStage,
    handleStageReview,
  };
}
