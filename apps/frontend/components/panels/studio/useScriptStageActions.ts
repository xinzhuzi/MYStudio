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
import {
  buildStudioManualContext,
  type StudioManualCatalog,
} from "@/lib/studio/manuals";
import { useStudioStore } from "@/stores/studio-store";
import type {
  AgentWorkData,
  AgentWorkKey,
  NovelChapter,
  StudioWorkflowConfig,
} from "@/types/studio";
import { toast } from "sonner";

type StudioStore = ReturnType<typeof useStudioStore.getState>;

export function useScriptStageActions({
  workflowConfig,
  manualCatalog,
  projectName,
  novelChapterCount,
  agentWorkData,
  saveAgentWorkData,
}: {
  workflowConfig: StudioWorkflowConfig;
  manualCatalog: StudioManualCatalog;
  projectName: string;
  novelChapterCount: number;
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
      `单集时长：${workflowConfig.episodeDurationMin ?? 3}分钟`,
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

  const scriptDirectorContext = useMemo(
    () => buildStudioManualContext(workflowConfig, manualCatalog),
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

  const [scriptStreaming, setScriptStreaming] = useState<{
    key: AgentWorkKey;
    scopeId: string;
    text: string;
  } | null>(null);

  const runScriptStage = useCallback(
    async (opts: {
      agentKey:
        | "storySkeletonAgent"
        | "adaptationStrategyAgent"
        | "scriptDraft";
      messages: { system: string; user: string };
      stageKey: AgentWorkKey;
      scopeId: string;
      label: string;
      revised?: boolean;
    }) => {
      setScriptStreaming({
        key: opts.stageKey,
        scopeId: opts.scopeId,
        text: "",
      });
      const result = await aiManager.textStream(
        {
          binding: { agent: opts.agentKey },
          maxTokens: 32000,
          messages: [
            { role: "system", content: opts.messages.system },
            { role: "user", content: opts.messages.user },
          ],
        },
        (delta) =>
          setScriptStreaming((s) =>
            s && s.key === opts.stageKey && s.scopeId === opts.scopeId
              ? { ...s, text: s.text + delta }
              : s,
          ),
      );
      setScriptStreaming(null);
      if (!result.success || !result.text) {
        toast.error(result.error || `${opts.label}生成失败`);
        return;
      }
      saveAgentWorkData(
        opts.stageKey,
        parseStageOutput(result.text),
        opts.scopeId,
      );
      toast.success(
        opts.revised
          ? `已按审核修订「${opts.label}」，请重新审核确认`
          : `${opts.label}已生成`,
      );
    },
    [saveAgentWorkData],
  );

  const handleScriptStage = useCallback(
    (
      stage: ScriptStageKey,
      chapter: NovelChapter,
      userOverride?: string,
      options?: { useReviewFeedback?: boolean },
    ) => {
      const skeleton = latestScriptStage("storySkeleton", chapter.id);
      const strategy = latestScriptStage("adaptationStrategy", chapter.id);
      const scriptDraft = latestScriptStage("scriptDraft", chapter.id);
      const reviewKey = SCRIPT_STAGE_REVIEW_KEY[stage as ReviewableStage];
      const review = reviewKey ? latestScriptStage(reviewKey, chapter.id) : "";
      const useReviewFeedback = options?.useReviewFeedback;
      if (stage === "adaptationStrategy" && !skeleton) {
        toast.error("请先生成故事骨架");
        return;
      }
      if (stage === "scriptDraft" && (!skeleton || !strategy)) {
        toast.error("请先生成故事骨架与改编策略");
        return;
      }
      const built = buildStageMessages(stage, {
        manualContext: scriptStyleSummary,
        directorContext: scriptDirectorContext,
        chapterTitle: chapter.title,
        chapterText: chapter.sourceText,
        eventState: chapter.eventState,
        skeleton,
        strategy,
        scriptDraft,
        reviewFeedback: useReviewFeedback && hasReviewIssues(review) ? review : undefined,
        previousOutput: latestScriptStage(stage, chapter.id),
      });
      return runScriptStage({
        agentKey:
          stage === "storySkeleton"
            ? "storySkeletonAgent"
            : stage === "adaptationStrategy"
              ? "adaptationStrategyAgent"
              : "scriptDraft",
        messages: { system: built.system, user: userOverride || built.user },
        stageKey: stage,
        scopeId: chapter.id,
        label: SCRIPT_STAGE_LABEL[stage],
        revised: useReviewFeedback && hasReviewIssues(review),
      });
    },
    [
      runScriptStage,
      latestScriptStage,
      scriptStyleSummary,
      scriptDirectorContext,
    ],
  );

  const handleStageReview = useCallback(
    (stage: ReviewableStage, chapter: NovelChapter) => {
      const target = latestScriptStage(stage, chapter.id);
      if (!target) {
        toast.error(`请先生成${SCRIPT_STAGE_LABEL[stage]}`);
        return;
      }
      const built = buildStageReviewMessages(stage, {
        manualContext: scriptStyleSummary,
        chapterTitle: chapter.title,
        chapterText: chapter.sourceText,
        eventState: chapter.eventState,
        skeleton: latestScriptStage("storySkeleton", chapter.id),
        strategy: latestScriptStage("adaptationStrategy", chapter.id),
        scriptDraft: latestScriptStage("scriptDraft", chapter.id),
      });
      return runScriptStage({
        agentKey: "scriptDraft",
        messages: { system: built.system, user: built.user },
        stageKey: SCRIPT_STAGE_REVIEW_KEY[stage],
        scopeId: chapter.id,
        label: `${SCRIPT_STAGE_LABEL[stage]}审核`,
      });
    },
    [runScriptStage, latestScriptStage, scriptStyleSummary],
  );

  return {
    scriptStyleSummary,
    scriptDirectorContext,
    scriptStreaming,
    handleScriptStage,
    handleStageReview,
  };
}
