import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { analyzeScriptDraft } from "@/lib/studio/script-draft-metrics";
import {
  buildStageMessages,
  SCRIPT_STAGE_REVIEW_KEY,
  SCRIPT_STAGE_PROMPT_PLACEHOLDER,
  describeChapterModeAnnotation,
  extractPartialContent,
  getStageSkillContent,
  hasFreshReviewIssues,
  SCRIPT_STAGE_LABEL,
  type ScriptStageKey,
  type ReviewableStage,
} from "@/lib/studio/script-planning";
import { cn } from "@/lib/utils";
import { useStudioStore } from "@/stores/studio/studio-store";
import { useThemeStore } from "@/stores/app/theme-store";
import type { AgentWorkKey, NovelChapter } from "@/types/studio";
import { BrainCircuit, ClipboardList, Edit3, WandSparkles } from "lucide-react";
import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChapterSwitchSelect } from "./ChapterSwitchSelect";
import { ScriptEditorDialog } from "./ScriptEditorDialog";
import { latestAgentWorkEntry } from "./workflow-helpers";


export function ScriptTab(props: {
  novelChapters: ReturnType<typeof useStudioStore.getState>["novelChapters"];
  agentWorkData: ReturnType<typeof useStudioStore.getState>["agentWorkData"];
  saveAgentWorkData: ReturnType<
    typeof useStudioStore.getState
  >["saveAgentWorkData"];
  runStage: (
    stage: ScriptStageKey,
    chapter: NovelChapter,
    userOverride?: string,
    options?: { useReviewFeedback?: boolean },
  ) => void;
  runReview: (stage: ReviewableStage, chapter: NovelChapter) => void;
  /** 「AI提示词」预览源:返回与实际发送(未编辑时)一致的完整 user 消息(含导演偏好/原著圣经);缺省回退本地构建。 */
  previewStageUserMessage?: (
    stage: ScriptStageKey,
    chapter: NovelChapter,
    options?: { useReviewFeedback?: boolean },
  ) => Promise<string | null>;
  manualContext: string;
  directorContext: string;
  styleSummary: string;
  // 1011 thinking 进流:thinking 增量随流状态透出,渲染层思考预览区消费
  scriptStreaming: { key: AgentWorkKey; scopeId: string; text: string; thinking?: string } | null;
}) {
  // B+ 单次生成:三段卡收口为一段——「剧本(含规划)」,规划已溶解进单次剧本生成
  const SCRIPT_STAGES: ScriptStageKey[] = ["scriptDraft"];

  // G1 章选择真源迁移(design §1.1):本地 chapterId state 退役,单一真源=store.activeChapterId
  // (switchChapter 装载完成后才原子翻转,UI 选中的章恒为已装载章);空/不在 novelChapters 时
  // 回退第一本(与现行初始化行为等价)
  const activeChapterId = useStudioStore((state) => state.activeChapterId);
  // R1（A批）：切章装载中标志（store 瞬态位）——装载窗口内生成/审核/可编辑禁用+装载中
  // 状态自释，防对尚未装载完成的工作区照旧章数据生成/编辑
  const chapterSwitchLoading = useStudioStore((state) => state.chapterSwitchLoading);
  const theme = useThemeStore((state) => state.theme);
  const [activeStage, setActiveStage] =
    useState<ScriptStageKey>("scriptDraft");
  const [editor, setEditor] = useState<{
    target: "output" | "context" | "review";
    value: string;
  } | null>(null);
  const [activeControl, setActiveControl] = useState<
    "event" | "skill" | "prompt" | "generate" | "review"
  >("event");
  const [userDraft, setUserDraft] = useState<string | undefined>(undefined);
  // G1:章按 store 锚定派生(activeChapterId 为空/不在 novelChapters 时回退第一本);
  // 派生章 id 供编辑器/草稿复位 effect 依赖(从本地 state 换源,语义不变:切章清空)
  const chapter =
    props.novelChapters.find((item) => item.id === activeChapterId) ??
    props.novelChapters[0];
  const chapterId = chapter?.id ?? "";
  useEffect(() => {
    setEditor(null);
    setUserDraft(undefined);
  }, [chapterId, activeStage]);

  // R12/D7（A批）：章内最新条目按 updatedAt 口径取，不再按数组序 reverse().find——
  // 单源=workflow-helpers latestAgentWorkEntry（C 批 R12 落地的通用 per-key 选择器，
  // prd R12 点名的 latestScriptDraftEntry 亦委托它）；scriptDraft 与 scriptDraftReview
  // 同走一口径，数组序≠updatedAt 序时不再各说各话，平局取数组序靠后=与旧 reverse().find 真逐位一致。
  const stageData = (key: AgentWorkKey) =>
    chapter
      ? latestAgentWorkEntry(props.agentWorkData, key, chapter.id)
      : undefined;

  const reviewKey = SCRIPT_STAGE_REVIEW_KEY[activeStage as ReviewableStage];
  const reviewEntry = reviewKey ? stageData(reviewKey) : undefined;
  const reviewData = reviewEntry?.data;
  // F3 修订判定=共享完整判定(审核含未修复问题 且 晚于最新剧本);仅用于「AI审核生成」入口可用性——
  // 预览/标注/摘要已统一按「一键生成=非修订」口径(G38 前半句作废,10-12 用户裁定)
  const reviseMode = hasFreshReviewIssues(reviewEntry, stageData("scriptDraft"));


  const streamingText =
    props.scriptStreaming &&
    props.scriptStreaming.key === activeStage &&
    props.scriptStreaming.scopeId === (chapter?.id ?? "")
      ? props.scriptStreaming.text
      : null;
  const isStreaming = streamingText !== null;
  const reviewStreaming =
    props.scriptStreaming &&
    reviewKey &&
    props.scriptStreaming.key === reviewKey &&
    props.scriptStreaming.scopeId === (chapter?.id ?? "")
      ? props.scriptStreaming.text
      : null;
  const reviewIsStreaming = reviewStreaming !== null;
  // 1011 thinking 进流:思考增量预览源——与正文/审核同 key+scope 匹配才显示,空串零占位
  const streamingThinking =
    props.scriptStreaming &&
    props.scriptStreaming.key === activeStage &&
    props.scriptStreaming.scopeId === (chapter?.id ?? "")
      ? props.scriptStreaming.thinking ?? ""
      : null;
  const reviewThinking =
    props.scriptStreaming &&
    reviewKey &&
    props.scriptStreaming.key === reviewKey &&
    props.scriptStreaming.scopeId === (chapter?.id ?? "")
      ? props.scriptStreaming.thinking ?? ""
      : null;
  const streamRef = useRef("");
  streamRef.current = streamingText ?? "";
  const [liveMd, setLiveMd] = useState("");
  useEffect(() => {
    if (!isStreaming) {
      setLiveMd("");
      return;
    }
    setLiveMd(extractPartialContent(streamRef.current));
    const id = setInterval(
      () => setLiveMd(extractPartialContent(streamRef.current)),
      300,
    );
    return () => clearInterval(id);
  }, [isStreaming]);
  // 思考预览区展开态(1011):思考期展开由渲染处 open={!textStarted} 强制真,与本位无关;
  // 本位只存「用户手动展开」位且默认折叠——正文首增量到达后折叠为入口,可手动再展开;
  // 新一轮流式(生成或审核)开始时重置回折叠(其后思考期的展开由强制真接管)。
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  useEffect(() => {
    setThinkingExpanded(false);
  }, [isStreaming, reviewIsStreaming]);

  // 完整提示词预览(hook 侧构建,含导演偏好/原著圣经/档案检索/项目记忆):所见即所发。
  // null=加载中;""=构建失败,回退本地标准构建展示。
  const [livePrompt, setLivePrompt] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setLivePrompt(null);
    if (!chapter || !props.previewStageUserMessage) return;
    props
      .previewStageUserMessage(activeStage, chapter, {
        // F3:预览与实发一致——「一键生成」固定非修订,预览同口径(唯一修订入口=「AI审核生成」按钮)
        useReviewFeedback: false,
      })
      .then((text) => {
        if (alive) setLivePrompt(text ?? "");
      })
      .catch(() => {
        if (alive) setLivePrompt("");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStage, chapter?.id, props.agentWorkData, props.previewStageUserMessage]);
  // R4/G9:剧本确定性自检指标(一键生成(产出)页只读展示,与被度量草稿同屏;流式期隐藏防旧稿
  // 指标误导;不阻断保存不自动重跑)——与审核注入同源(analyzeScriptDraft);时长/画幅兜底从
  // styleSummary 解析(画幅真源=剧本头部自述,函数内解析)。须在下方早退之前调用(hooks 恒序)。
  const scriptDraftData = stageData("scriptDraft")?.data ?? "";
  const selfCheckMetrics = useMemo(() => {
    if (!scriptDraftData.trim()) return null;
    const durationMatch = /单集参考时长：(\d+(?:\.\d+)?)分钟/.exec(props.styleSummary);
    const aspectMatch = /目标画幅：(16:9|9:16)/.exec(props.styleSummary);
    return analyzeScriptDraft(scriptDraftData, {
      durationMin: durationMatch ? Number(durationMatch[1]) : undefined,
      aspectRatio: aspectMatch ? aspectMatch[1] : undefined,
    });
  }, [scriptDraftData, props.styleSummary]);
  if (!props.novelChapters.length) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        请先在「小说导入」导入章节（建议先做事件分析），再来这里逐章生成剧本。
      </div>
    );
  }

  const output = stageData(activeStage)?.data ?? "";
  const standardMessages = chapter
    ? buildStageMessages(activeStage, {
        manualContext: props.manualContext,
        directorContext: props.directorContext,
        chapterTitle: chapter.title,
        chapterText: chapter.sourceText ?? "",
        eventState: chapter.eventState,
        scriptDraft: stageData("scriptDraft")?.data,
        previousOutput: output,
      })
    : { system: "", user: "" };
  const skill = getStageSkillContent(activeStage);
  // 预览优先用 hook 完整构建(与发送一致);未接 hook 或加载失败回退本地构建
  const basePrompt =
    livePrompt === null
      ? props.previewStageUserMessage
        ? SCRIPT_STAGE_PROMPT_PLACEHOLDER
        : standardMessages.user
      : livePrompt || standardMessages.user;
  const promptSource = userDraft ?? basePrompt;
  // G5:完整产物未就绪防线——接了 hook 预览但 livePrompt 尚未就绪(组装中 null,或组装
  // 失败 "" 回退本地降级版 standardMessages.user,缺圣经/档案检索/项目记忆/上一集)时,
  // promptSource 不是 hook 完整组装产物,「可编辑」禁用+title 自释,防占位串/本地降级版
  // 经编辑器固化成 userDraft 实发(PRD G5 全语义,复审 mustFix 10-14)
  const promptNotReady =
    !!props.previewStageUserMessage && (livePrompt === null || livePrompt === "");
  // G12 本章判定只读标注:按章数据形态判定(小说改编/原创),只读不可改——判定错了修章数据,不修判定器
  // F3:标注统一按「一键生成=非修订」口径——已有剧本(含带审核)恒标改编态;修订入口只剩「AI审核生成」
  const chapterModeNote = chapter
    ? describeChapterModeAnnotation(chapter, false)
    : "";
  const memoryMarkers = [
    promptSource.includes("原著圣经") ? "原著圣经" : "",
    promptSource.includes("导演偏好") ? "导演偏好" : "",
    promptSource.includes("原著档案检索") ? "原著档案(按需)" : "",
    promptSource.includes("项目记忆") ? "项目记忆" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const sentSummary = [
    // R4:摘要按实含列出——守卫与实发 buildStageMessages 同款(manualContext/directorContext 空零注入、
    // 原创章无 sourceText 零注入「本章正文」);导演条目标签对齐实发节标题「题材剧本规则」(R2/G12 改制后)
    props.manualContext ? "项目信息" : "",
    memoryMarkers,
    props.directorContext ? "题材剧本规则" : "",
    chapter ? `章节：${chapter.title}` : "",
    // F3:摘要随预览走「一键生成=非修订」口径——不再列「审核意见(修订模式)」;
    // 「AI审核生成」的附带内容由其旁只读提示行自释
    chapter?.eventState ? "事件分析" : "",
    // 复审 low 收口(实含清单补全):「上一集剧本」按实含列出——实发链 useScriptStageActions
    // 取前一章最新 scriptDraft 注入「## 上一集剧本」节(script-planning.ts previousEpisodeScript
    // 非空守卫);摘要守卫与 memoryMarkers 同款(promptSource includes 节标题)
    promptSource.includes("## 上一集剧本") ? "上一集剧本" : "",
    chapter?.sourceText?.trim() ? "本章正文" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const eventMarkdown = [
    `# ${chapter?.title ?? "事件"}`,
    chapter?.eventSummary ? `## 事件摘要\n\n${chapter.eventSummary}` : "",
    chapter?.eventState
      ? `## 事件状态\n\n${chapter.eventState}`
      : "## 事件状态\n\n暂无事件分析。",
  ]
    .filter(Boolean)
    .join("\n\n");
  const skillMarkdown = skill || "# Skill 手册\n\n未找到该阶段 skill 手册。";
  const promptMarkdown = promptSource;
  const generatedMarkdown =
    streamingText !== null
      ? liveMd || `# ${SCRIPT_STAGE_LABEL[activeStage]}\n\n生成中...`
      : output || `# ${SCRIPT_STAGE_LABEL[activeStage]}\n\n暂无生成内容。`;
  const reviewMarkdown =
    reviewStreaming !== null
      ? extractPartialContent(reviewStreaming) || "# 审核结果\n\n审核中..."
      : reviewData || "# 审核结果\n\n暂无审核结果。";
  const renderMarkdownPreview = (modelValue: string, className?: string) => (
    <div
      className={cn(
        "script-stage-markdown-preview h-full min-h-0 w-full overflow-auto p-5 text-sm leading-7",
        className,
      )}
    >
      <MdPreview
        className="md-editor-preview-transparent bg-transparent! [&_.md-editor-preview-wrapper]:bg-transparent! [&_.md-editor-preview]:bg-transparent! [&_.md-editor]:bg-transparent!"
        modelValue={modelValue}
        theme={theme}
        language="zh-CN"
      />
    </div>
  );
  // 1011 thinking 进流:思考预览区——输出区上方、弱化样式(muted/小字号/限高可滚动);
  // 正文开始后折叠为入口(thinkingExpanded 手动再展开);thinking 空时调用侧不渲染(零占位)。
  const renderThinkingPreview = (thinking: string, textStarted: boolean) => (
    <Collapsible
      open={!textStarted || thinkingExpanded}
      onOpenChange={(open) => {
        if (textStarted) setThinkingExpanded(open);
      }}
      className="shrink-0 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-md text-xs text-muted-foreground select-none"
        >
          <BrainCircuit className="h-3.5 w-3.5 shrink-0" />
          {textStarted ? `AI 思考过程（${thinking.length} 字）` : "AI 思考中…"}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 max-h-[160px] overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground/85">
          {thinking}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );

  return (
    <div className="flex min-h-[640px] w-full flex-1 flex-col pb-5">
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
        {/* 页内导航:子阶段 tabs+章节选择(2026-09-10 随横幅退役自状态条迁入,原胶囊样式保留) */}
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        {SCRIPT_STAGES.map((stage, idx) => (
          <button
            key={stage}
            type="button"
            onClick={() => setActiveStage(stage)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors ${
              activeStage === stage
                ? "border-primary/70 bg-transparent font-medium text-primary"
                : "border-foreground/[0.12] bg-transparent text-foreground/85 hover:bg-foreground/[0.06] hover:text-foreground"
            }`}
          >
            {idx + 1}. {SCRIPT_STAGE_LABEL[stage]}
            {stageData(stage) ? " ✓" : ""}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* 1015 可搜索章节选择器(10-19 外迁共享 ChapterSwitchSelect,全仓单源):G1 切章走
            store 装载器,R1 装载窗口禁用+live region 由共享组件自带;行为测试锚经本组件
            render 覆盖(script-tab.test 既有 describe),消费方禁止就地复制选择器 DOM */}
        <ChapterSwitchSelect
          chapters={props.novelChapters}
          label="章节（1 章 = 1 集）"
        />
      </div>
    </div>
          <div className="script-stage-control-tabs flex flex-wrap gap-2 border-b border-border pb-2">
            {[
              ["event", "事件"],
              ["skill", "Skill 手册名字"],
              ["prompt", "AI提示词"],
              ["generate", "一键生成"],
              ["review", "审核"],
            ].map(([key, label]) => (
              <Button
                key={key}
                type="button"
                variant={activeControl === key ? "default" : "secondary"}
                className={cn(
                  "min-w-[112px] justify-center border text-sm font-medium transition-all",
                  activeControl === key
                    ? "script-stage-control-active border-primary/70 bg-primary text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.35),0_10px_28px_hsl(var(--primary)/0.22)]"
                    : "border-border/70 bg-muted/40 text-muted-foreground hover:border-primary/40 hover:bg-muted",
                )}
                onClick={() =>
                  setActiveControl(
                    key as "event" | "skill" | "prompt" | "generate" | "review",
                  )
                }
              >
                {label}
              </Button>
            ))}
          </div>
          <section className="script-stage-detail-panel flex min-h-[520px] w-full flex-1 rounded-md border border-border bg-panel/30 p-4 text-xs">
            {activeControl === "event" ? (
              renderMarkdownPreview(eventMarkdown, "h-full")
            ) : null}
            {activeControl === "skill" ? (
              renderMarkdownPreview(skillMarkdown, "h-full")
            ) : null}
            {activeControl === "prompt" ? (
              <div className="flex h-full w-full flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-muted-foreground">
                    {chapterModeNote ? `${chapterModeNote} · 含：${sentSummary}` : `含：${sentSummary}`}
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    // R1（A批）：装载窗口同禁（防对未装载完成的工作区编辑）
                    disabled={promptNotReady || chapterSwitchLoading}
                    title={
                      chapterSwitchLoading
                        ? "章节装载中，暂不可编辑"
                        : promptNotReady
                          ? "完整提示词未就绪（组装中或组装失败回退本地降级版），暂不可编辑"
                          : undefined
                    }
                    onClick={() =>
                      setEditor({
                        target: "context",
                        value: promptSource,
                      })
                    }
                  >
                    <Edit3 className="h-4 w-4" />
                    可编辑
                  </Button>
                </div>
                {renderMarkdownPreview(promptMarkdown, "flex-1")}
              </div>
            ) : null}
            {activeControl === "generate" ? (
              <div className="flex h-full w-full flex-col gap-3">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    // R1（A批）：装载窗口同禁
                    disabled={!output || chapterSwitchLoading}
                    onClick={() => setEditor({ target: "output", value: output })}
                  >
                    <Edit3 className="h-4 w-4" />
                    可编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="paid"
                    aria-label="一键生成：按改编模式重新生成(不走修订)"
                    title="按改编模式重新生成(不走修订)"
                    // R1（A批）：装载窗口禁用（此前只看 scriptStreaming，切章装载期可照旧章数据生成）
                    disabled={!chapter || props.scriptStreaming !== null || chapterSwitchLoading}
                    onClick={() =>
                      chapter &&
                      props.runStage(
                        activeStage,
                        chapter,
                        userDraft,
                        { useReviewFeedback: false },
                      )
                    }
                  >
                    <WandSparkles className="h-4 w-4" />
                    {streamingText !== null ? "生成中..." : "一键生成"}
                  </Button>
                  <span className="text-[10px] leading-none text-muted-foreground" aria-hidden="true">
                    不走修订
                  </span>
                  <Button
                    size="sm"
                    variant="paid"
                    // F3:仅当「针对当前版本的审核含未修复问题」(reviseMode)时可用——
                    // 旧审核(早于最新剧本)不驱动修订,入口禁用即不实发
                    // R1（A批）：装载窗口同禁
                    disabled={
                      !chapter ||
                      !reviseMode ||
                      props.scriptStreaming !== null ||
                      chapterSwitchLoading
                    }
                    onClick={() =>
                      chapter &&
                      props.runStage(activeStage, chapter, undefined, {
                        useReviewFeedback: true,
                      })
                    }
                  >
                    <WandSparkles className="h-4 w-4" />
                    AI审核生成
                  </Button>
                  {/* F3 只读提示:双态自释(禁用原因与附带内容),语义 token */}
                  <span className="text-[10px] leading-none text-muted-foreground">
                    {reviseMode
                      ? "AI审核生成时将附带上一版剧本与审核意见"
                      : "AI审核生成需针对当前版本且含未修复问题的审核(重跑「审核」后可用)"}
                  </span>
                </div>
                {/* R6:自检指标框迁入产出页——与被度量草稿同屏(所见即所发);流式期隐藏防旧稿指标误导 */}
                {selfCheckMetrics && !isStreaming ? (
                  <div
                    data-testid="script-self-check"
                    className="shrink-0 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground"
                  >
                    <span className="select-none">自检指标（代码计算，仅供 AI 审核参考）：{selfCheckMetrics.flags.length ? "以下项超标——" : "自检通过"}</span>
                    {selfCheckMetrics.flags.length ? (
                      <ul className="mt-1 list-inside list-disc">
                        {selfCheckMetrics.flags.map((flag) => (
                          <li key={flag}>{flag}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {streamingThinking
                  ? renderThinkingPreview(streamingThinking, Boolean(streamingText))
                  : null}
                {renderMarkdownPreview(generatedMarkdown, "flex-1")}
              </div>
            ) : null}
            {activeControl === "review" ? (
              <div className="flex h-full w-full flex-col gap-3">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    // R1（A批）：装载窗口同禁
                    disabled={!reviewData || chapterSwitchLoading}
                    onClick={() =>
                      setEditor({ target: "review", value: reviewData ?? "" })
                    }
                  >
                    <Edit3 className="h-4 w-4" />
                    可编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="paid"
                    // R1（A批）：装载窗口禁用（此前只看 scriptStreaming）
                    disabled={!chapter || !output || props.scriptStreaming !== null || chapterSwitchLoading}
                    onClick={() =>
                      chapter &&
                      props.runReview(activeStage as ReviewableStage, chapter)
                    }
                  >
                    <ClipboardList className="h-4 w-4" />
                    {reviewStreaming !== null ? "审核中..." : "审核"}
                  </Button>
                </div>
                {reviewThinking
                  ? renderThinkingPreview(reviewThinking, Boolean(reviewStreaming))
                  : null}
                {renderMarkdownPreview(reviewMarkdown, "flex-1")}
              </div>
            ) : null}
          </section>
        </div>

        <div className="space-y-2">
          <ScriptEditorDialog
            open={!!editor}
            title={`编辑 · ${
              editor?.target === "context"
                ? "发送内容"
                : editor?.target === "review"
                  ? "审核结果"
                : SCRIPT_STAGE_LABEL[activeStage]
            }`}
            value={editor?.value ?? ""}
            onOpenChange={(open) => !open && setEditor(null)}
            onChange={(value) =>
              setEditor((prev) => (prev ? { ...prev, value } : prev))
            }
            onCancel={() => setEditor(null)}
            onSave={() => {
              if (!editor) return;
              if (editor.target === "output") {
                if (chapter)
                  props.saveAgentWorkData(activeStage, editor.value, chapter.id, {
                    sourceId: chapter.sourceId ?? chapter.id,
                    revision: chapter.revision ?? 1,
                  });
              } else if (editor.target === "review") {
                if (chapter && reviewKey) {
                  // R5（G3 裁定⑤收口，A批）：人工改审与 AI 审核同口径——保存时点捕获
                  // 被审剧本条目指纹（id+updatedAt），isReviewFresh 版本比对真源；
                  // 无剧本条目不附着（回落 createdAt 时间比较=旧数据语义）
                  const reviewTargetEntry = stageData("scriptDraft");
                  props.saveAgentWorkData(reviewKey, editor.value, chapter.id, {
                    sourceId: chapter.sourceId ?? chapter.id,
                    revision: chapter.revision ?? 1,
                    reviewTarget:
                      reviewTargetEntry?.id && typeof reviewTargetEntry.updatedAt === "number"
                        ? {
                            entryId: reviewTargetEntry.id,
                            updatedAt: reviewTargetEntry.updatedAt,
                          }
                        : undefined,
                  });
                }
              } else {
                // G5 防线二:占位串/本地降级版(standardMessages.user=完整组装失败回退产物,
                // PRD G5「或本地降级版」)都不固化为 userDraft(编辑器在未就绪窗口打开的残留场景);
                // 实发边界由 useScriptStageActions 的占位串守卫再兜一层
                if (
                  editor.value !== SCRIPT_STAGE_PROMPT_PLACEHOLDER &&
                  editor.value !== standardMessages.user
                ) {
                  setUserDraft(editor.value);
                }
              }
              setEditor(null);
            }}
          />
        </div>
      </div>
    </div>
  );
}
