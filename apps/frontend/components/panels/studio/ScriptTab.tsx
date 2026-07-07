import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  buildStageMessages,
  SCRIPT_STAGE_REVIEW_KEY,
  extractPartialContent,
  getStageSkillContent,
  hasReviewIssues,
  SCRIPT_STAGE_LABEL,
  type ScriptStageKey,
  type ReviewableStage,
} from "@/lib/studio/script-planning";
import { cn } from "@/lib/utils";
import { useStudioStore } from "@/stores/studio-store";
import { useThemeStore } from "@/stores/theme-store";
import type { AgentWorkKey, NovelChapter } from "@/types/studio";
import { ClipboardList, Edit3, WandSparkles } from "lucide-react";
import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/style.css";
import { ScriptEditorDialog } from "./ScriptEditorDialog";

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
  manualContext: string;
  directorContext: string;
  styleSummary: string;
  setHeaderActions: (actions: ReactNode) => void;
  scriptStreaming: { key: AgentWorkKey; scopeId: string; text: string } | null;
}) {
  const SCRIPT_STAGES: ScriptStageKey[] = [
    "storySkeleton",
    "adaptationStrategy",
    "scriptDraft",
  ];
  const PREREQ: Partial<Record<ScriptStageKey, ScriptStageKey>> = {
    adaptationStrategy: "storySkeleton",
    scriptDraft: "adaptationStrategy",
  };

  const [chapterId, setChapterId] = useState(props.novelChapters[0]?.id ?? "");
  const theme = useThemeStore((state) => state.theme);
  const [activeStage, setActiveStage] =
    useState<ScriptStageKey>("storySkeleton");
  const [editor, setEditor] = useState<{
    target: "output" | "context" | "review";
    value: string;
  } | null>(null);
  const [activeControl, setActiveControl] = useState<
    "event" | "skill" | "prompt" | "generate" | "review"
  >("event");
  const [userDraft, setUserDraft] = useState<string | undefined>(undefined);
  useEffect(() => {
    setEditor(null);
    setUserDraft(undefined);
  }, [chapterId, activeStage]);

  const chapter =
    props.novelChapters.find((item) => item.id === chapterId) ??
    props.novelChapters[0];
  const stageData = (key: AgentWorkKey) =>
    chapter
      ? [...props.agentWorkData]
          .reverse()
          .find((item) => item.key === key && item.episodeId === chapter.id)
      : undefined;

  const reviewKey = SCRIPT_STAGE_REVIEW_KEY[activeStage as ReviewableStage];
  const reviewData = reviewKey ? stageData(reviewKey)?.data : undefined;
  const reviseMode = hasReviewIssues(reviewData);

  const setHeaderActions = props.setHeaderActions;
  useEffect(() => {
    if (!props.novelChapters.length) {
      setHeaderActions(null);
      return;
    }
    setHeaderActions(
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 border-b border-border/70">
          {SCRIPT_STAGES.map((stage, idx) => (
            <button
              key={stage}
              type="button"
              onClick={() => setActiveStage(stage)}
              className={`px-4 py-2 text-sm ${activeStage === stage ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground"}`}
            >
              {idx + 1}. {SCRIPT_STAGE_LABEL[stage]}
              {stageData(stage) ? " ✓" : ""}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-sm">章节（1 章 = 1 集）</Label>
          <select
            className="h-9 min-w-[260px] rounded-md border border-input bg-background px-3 text-sm"
            value={chapterId || props.novelChapters[0]?.id || ""}
            onChange={(event) => setChapterId(event.target.value)}
          >
            {props.novelChapters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.index}. {item.title}
              </option>
            ))}
          </select>
        </div>
      </div>,
    );
    return () => setHeaderActions(null);
  }, [
    setHeaderActions,
    props.novelChapters,
    props.agentWorkData,
    chapterId,
    activeStage,
  ]);

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
  if (!props.novelChapters.length) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        请先在「小说导入」导入章节（建议先做事件分析），再来这里逐章生成剧本。
      </div>
    );
  }

  const prereq = PREREQ[activeStage];
  const hasPrereq = !prereq || Boolean(stageData(prereq));
  const output = stageData(activeStage)?.data ?? "";
  const standardMessages = chapter
    ? buildStageMessages(activeStage, {
        manualContext: props.manualContext,
        directorContext: props.directorContext,
        chapterTitle: chapter.title,
        chapterText: chapter.sourceText,
        eventState: chapter.eventState,
        skeleton: stageData("storySkeleton")?.data,
        strategy: stageData("adaptationStrategy")?.data,
        scriptDraft: stageData("scriptDraft")?.data,
        previousOutput: output,
      })
    : { system: "", user: "" };
  const reviewMessages = chapter
    ? buildStageMessages(activeStage, {
        manualContext: props.manualContext,
        directorContext: props.directorContext,
        chapterTitle: chapter.title,
        chapterText: chapter.sourceText,
        eventState: chapter.eventState,
        skeleton: stageData("storySkeleton")?.data,
        strategy: stageData("adaptationStrategy")?.data,
        scriptDraft: stageData("scriptDraft")?.data,
        reviewFeedback: reviseMode ? reviewData : undefined,
        previousOutput: output,
      })
    : { system: "", user: "" };
  const messages = reviseMode ? reviewMessages : standardMessages;
  const skill = getStageSkillContent(activeStage);
  const sentSummary = [
    "项目信息",
    activeStage === "adaptationStrategy" || activeStage === "scriptDraft"
      ? "导演手法"
      : "",
    chapter ? `章节：${chapter.title}` : "",
    chapter?.eventState ? "事件分析" : "",
    activeStage !== "storySkeleton" && stageData("storySkeleton")
      ? "故事骨架"
      : "",
    activeStage === "scriptDraft" && stageData("adaptationStrategy")
      ? "改编策略"
      : "",
    reviseMode ? "审核意见(修订模式)" : "",
    "本章正文",
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
  const promptMarkdown = userDraft ?? messages.user;
  const generatedMarkdown =
    streamingText !== null
      ? liveMd || `# ${SCRIPT_STAGE_LABEL[activeStage]}\n\n生成中...`
      : output ||
        `# ${SCRIPT_STAGE_LABEL[activeStage]}\n\n${
          hasPrereq
            ? "暂无生成内容。"
            : prereq
              ? `请先完成「${SCRIPT_STAGE_LABEL[prereq]}」。`
              : "暂无生成内容。"
        }`;
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
        className="md-editor-preview-transparent !bg-transparent [&_.md-editor-preview-wrapper]:!bg-transparent [&_.md-editor-preview]:!bg-transparent [&_.md-editor]:!bg-transparent"
        modelValue={modelValue}
        theme={theme}
        language="zh-CN"
      />
    </div>
  );

  return (
    <div className="flex min-h-[640px] w-full flex-1 flex-col pb-5">
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
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
                <div className="flex items-center justify-between gap-2">
                  <p className="text-muted-foreground">含：{sentSummary}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() =>
                      setEditor({
                        target: "context",
                        value: userDraft ?? messages.user,
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
                    disabled={!output}
                    onClick={() => setEditor({ target: "output", value: output })}
                  >
                    <Edit3 className="h-4 w-4" />
                    可编辑
                  </Button>
                  <Button
                    size="sm"
                    disabled={!chapter || !hasPrereq || props.scriptStreaming !== null}
                    onClick={() =>
                      chapter &&
                      props.runStage(
                        activeStage,
                        chapter,
                        userDraft ?? standardMessages.user,
                        { useReviewFeedback: false },
                      )
                    }
                  >
                    <WandSparkles className="h-4 w-4" />
                    {streamingText !== null ? "生成中..." : "一键生成"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      !chapter ||
                      !hasPrereq ||
                      !reviewData ||
                      props.scriptStreaming !== null
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
                </div>
                {renderMarkdownPreview(generatedMarkdown, "flex-1")}
              </div>
            ) : null}
            {activeControl === "review" ? (
              <div className="flex h-full w-full flex-col gap-3">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!reviewData}
                    onClick={() =>
                      setEditor({ target: "review", value: reviewData ?? "" })
                    }
                  >
                    <Edit3 className="h-4 w-4" />
                    可编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!chapter || !output || props.scriptStreaming !== null}
                    onClick={() =>
                      chapter &&
                      props.runReview(activeStage as ReviewableStage, chapter)
                    }
                  >
                    <ClipboardList className="h-4 w-4" />
                    {reviewStreaming !== null ? "审核中..." : "审核"}
                  </Button>
                </div>
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
                  props.saveAgentWorkData(activeStage, editor.value, chapter.id);
              } else if (editor.target === "review") {
                if (chapter && reviewKey)
                  props.saveAgentWorkData(reviewKey, editor.value, chapter.id);
              } else {
                setUserDraft(editor.value);
              }
              setEditor(null);
            }}
          />
        </div>
      </div>
    </div>
  );
}
