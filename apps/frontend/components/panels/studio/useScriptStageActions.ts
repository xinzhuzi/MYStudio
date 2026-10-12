import { useCallback, useMemo, useState } from "react";
import { aiManager } from "@/lib/ai/ai-manager";
import {
  buildStageMessages,
  buildStageReviewMessages,
  hasReviewIssues,
  parseStageOutput,
  SCRIPT_STAGE_LABEL,
  SCRIPT_STAGE_REVIEW_KEY,
  type ReviewableStage,
  type ScriptStageKey,
} from "@/lib/studio/script-planning";
import { readSourceMemoryActionContext } from "@/lib/studio/source-memory";
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

  const latestScriptStage = useCallback(
    (key: AgentWorkKey, scopeId: string) =>
      [...agentWorkData]
        .reverse()
        .find((item) => item.key === key && item.episodeId === scopeId)?.data ??
      "",
    [agentWorkData],
  );

  // 1011 thinking 进流:scriptStreaming 增设 thinking 增量位——思考单独累积不混正文,
  // 完成后随状态清零整体丢弃(零持久化,saveAgentWorkData 只落 result.text)。
  const [scriptStreaming, setScriptStreaming] = useState<{
    key: AgentWorkKey;
    scopeId: string;
    text: string;
    thinking?: string;
  } | null>(null);

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
    }) => {
      setScriptStreaming({
        key: opts.stageKey,
        scopeId: opts.scopeId,
        text: "",
        thinking: "",
      });
      // 1011 欠账⑤:textStream 顶层 reject(流式 IPC 异常等)时下方清零不可达,scriptStreaming
      // 永卡非 null——ScriptTab 生成/审核按钮(scriptStreaming!==null 即禁用)永久禁用无恢复
      // 入口。try/finally 兜底保证流态必回落;异常本身不吞仍向上抛(拒绝语义与修前一致)。
      // 生成与审核(handleStageReview)同走本流,一处修复两路受益。
      let result: Awaited<ReturnType<typeof aiManager.textStream>>;
      try {
        result = await aiManager.textStream(
          {
            binding: { agent: opts.agentKey },
            maxTokens: 32000,
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
      } finally {
        setScriptStreaming(null);
      }
      if (!result.success || !result.text) {
        toast.error(result.error || `${opts.label}生成失败`);
        return;
      }
      saveAgentWorkData(
        opts.stageKey,
        parseStageOutput(result.text),
        opts.scopeId,
        { sourceId: opts.sourceId ?? opts.scopeId, revision: opts.revision ?? 1 },
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
      | { ok: true; system: string; user: string }
      | { ok: false; error: string }
    > => {
      const scriptDraft = latestScriptStage("scriptDraft", chapter.id);
      const reviewKey = SCRIPT_STAGE_REVIEW_KEY[stage as ReviewableStage];
      const review = reviewKey ? latestScriptStage(reviewKey, chapter.id) : "";
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
      const built = buildStageMessages(stage, {
        manualContext: scriptStyleSummary,
        directorContext: scriptDirectorContext,
        originalBibleContext: memory.context,
        chapterTitle: chapter.title,
        chapterText: chapter.sourceText ?? "",
        eventState: chapter.eventState,
        previousEpisodeScript: previousEpisodeScript || undefined,
        eventMemoryContext,
        scriptDraft,
        reviewFeedback: useReviewFeedback && hasReviewIssues(review) ? review : undefined,
        previousOutput: latestScriptStage(stage, chapter.id),
      });
      return { ok: true, system: built.system, user: built.user };
    },
    [latestScriptStage, scriptStyleSummary, scriptDirectorContext, novelChapters],
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
      // B+ 单次生成：剧本(含规划)无前置阶段门禁——方法文档按本章判定自动注入(buildStageMessages 内)
      const built = await buildStageMessagesFull(stage, chapter, options);
      if (!built.ok) {
        toast.error(built.error);
        return;
      }
      return runScriptStage({
        agentKey: "scriptDraft",
        messages: { system: built.system, user: userOverride || built.user },
        stageKey: stage,
        scopeId: chapter.id,
        label: SCRIPT_STAGE_LABEL[stage],
        revised:
          options?.useReviewFeedback &&
          hasReviewIssues(
            latestScriptStage(SCRIPT_STAGE_REVIEW_KEY[stage as ReviewableStage], chapter.id) ?? "",
          ),
        sourceId: chapter.sourceId ?? chapter.id,
        revision: chapter.revision ?? 1,
      });
    },
    [runScriptStage, latestScriptStage, buildStageMessagesFull],
  );

  const handleStageReview = useCallback(
    async (stage: ReviewableStage, chapter: NovelChapter) => {
      const target = latestScriptStage(stage, chapter.id);
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
      return runScriptStage({
        agentKey: "scriptDraft",
        messages: { system: built.system, user: built.user },
        stageKey: SCRIPT_STAGE_REVIEW_KEY[stage],
        scopeId: chapter.id,
        label: `${SCRIPT_STAGE_LABEL[stage]}审核`,
        sourceId: chapter.sourceId ?? chapter.id,
        revision: chapter.revision ?? 1,
      });
    },
    [runScriptStage, latestScriptStage, scriptStyleSummary, scriptDirectorContext, workflowConfig],
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
