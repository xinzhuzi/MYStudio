// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { ScriptTab } from "./ScriptTab";
import { ScriptOutputPanel } from "./ScriptOutputPanel";

// MdPreview/MdEditor 在 jsdom 里不可靠,用最小替身(值展示)
vi.mock("md-editor-rt", () => ({
  MdPreview: ({ modelValue }: { modelValue: string }) => (
    <div data-testid="md-preview">{modelValue}</div>
  ),
  MdEditor: ({ modelValue }: { modelValue: string }) => (
    <div data-testid="md-editor">{modelValue}</div>
  ),
}));

(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

(globalThis as any).matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

afterEach(cleanup);

describe("ScriptTab", () => {
  it("prompts for novel import before script generation", () => {
    render(
      <ScriptTab
        novelChapters={[]}
        agentWorkData={[]}
        saveAgentWorkData={vi.fn()}
        runStage={vi.fn()}
        runReview={vi.fn()}
        manualContext=""
        directorContext=""
        styleSummary=""
        scriptStreaming={null}
      />,
    );

    expect(
      screen.getByText(
        "请先在「小说导入」导入章节（建议先做事件分析），再来这里逐章生成剧本。",
      ),
    ).toBeTruthy();
  });

  it("renders generated script output status in the extracted output panel", () => {
    render(
      <ScriptOutputPanel
        activeStage="scriptDraft"
        hasGeneratedOutput={true}
        hasPrereq={true}
        output="## 测试输出"
        streamingText={null}
        liveMd=""
        reviewStreaming={null}
        reviewData={undefined}
        reviseMode={false}
        onEditOutput={vi.fn()}
      />,
    );

    expect(screen.getByText("输出结果")).toBeTruthy();
    expect(screen.getByText("已生成")).toBeTruthy();
  });

  it("provides script sub-stage tabs inline in the tab body (header actions retired)", () => {
    const source = readFileSync(
      "frontend/components/panels/studio/ScriptTab.tsx",
      "utf8",
    );

    expect(source).not.toContain("setHeaderActions");
    expect(source).toContain("SCRIPT_STAGES.map");
    expect(source).not.toContain('<div className="flex gap-1 border-b border-border">');
  });

  it("keeps script markdown previews tied to the active theme", () => {
    const tabSource = readFileSync(
      "frontend/components/panels/studio/ScriptTab.tsx",
      "utf8",
    );
    const outputPanelSource = readFileSync(
      "frontend/components/panels/studio/ScriptOutputPanel.tsx",
      "utf8",
    );

    expect(tabSource).toContain("useThemeStore");
    expect(tabSource).toContain("theme={theme}");
    expect(tabSource).not.toContain('theme="dark"');
    expect(outputPanelSource).toContain("useThemeStore");
    expect(outputPanelSource).toContain("theme={theme}");
    expect(outputPanelSource).not.toContain('theme="dark"');
  });

  it("lays out script stage controls as horizontal buttons with one full-width detail panel", () => {
    const source = readFileSync(
      "frontend/components/panels/studio/ScriptTab.tsx",
      "utf8",
    );

    expect(source).toContain("script-stage-control-tabs");
    expect(source).toContain("script-stage-control-tabs flex flex-wrap gap-2 border-b");
    expect(source).toContain("flex min-h-[640px] w-full flex-1 flex-col pb-5");
    expect(source).toContain("script-stage-detail-panel flex min-h-[520px] w-full flex-1");
    expect(source).toContain("setActiveControl");
    expect(source).toContain("事件");
    expect(source).toContain("Skill 手册名字");
    expect(source).toContain("AI提示词");
    expect(source).toContain("一键生成");
    expect(source).toContain("审核");
    expect(source).toContain("script-stage-control-active");
    expect(source).not.toContain("xl:grid-cols-[1.15fr_1fr_1.25fr_0.85fr_0.85fr]");
    expect(source).not.toContain("发送内容（上下文）");
    expect(source).not.toContain("事件（本章）");
  });

  it("renders script reference documents as markdown previews instead of raw text blocks", () => {
    const source = readFileSync(
      "frontend/components/panels/studio/ScriptTab.tsx",
      "utf8",
    );

    expect(source).toContain("renderMarkdownPreview");
    expect(source).toContain("eventMarkdown");
    expect(source).toContain("skillMarkdown");
    expect(source).toContain("promptMarkdown");
    expect(source).toContain("script-stage-markdown-preview h-full min-h-0 w-full");
    expect(source).toContain("md-editor-preview-transparent");
    expect(source).not.toContain("script-stage-markdown-preview min-h-0 w-full overflow-auto rounded-md border");
    expect(source).not.toContain("bg-background/70 p-5 text-sm leading-7 shadow-inner");
    expect(source).not.toContain("<pre className=");
  });

  it("sends the hook-built full prompt with source memory and previews the same content", () => {
    const source = readFileSync(
      "frontend/components/panels/studio/ScriptTab.tsx",
      "utf8",
    );

    expect(source).toContain("previewStageUserMessage");
    // 未编辑时不再把 ScriptTab 本地构建当 override 传下去,hook 的完整构建(含导演偏好/原著圣经)生效
    expect(source).not.toContain("userDraft ?? standardMessages.user");
    expect(source).toContain("chapter,\n                        userDraft,");
    expect(source).toContain("原著圣经");
    expect(source).toContain("导演偏好");
    expect(source).toContain("livePrompt");
  });

  it("shows only generated stage content in the generate panel", () => {
    const source = readFileSync(
      "frontend/components/panels/studio/ScriptTab.tsx",
      "utf8",
    );

    const generateStart = source.indexOf('activeControl === "generate"');
    const generateEnd = source.indexOf('activeControl === "review"', generateStart);
    const generatePanel = source.slice(generateStart, generateEnd);

    expect(source).toContain("generatedMarkdown");
    expect(generatePanel).toContain("renderMarkdownPreview(generatedMarkdown");
    expect(generatePanel).toContain("AI审核生成");
    expect(generatePanel).toContain("useReviewFeedback: true");
    expect(generatePanel).toContain("useReviewFeedback: false");
    expect(generatePanel).not.toContain("<ScriptOutputPanel");
    expect(generatePanel).toContain("props.runStage(");
    expect(generatePanel).toContain('target: "output"');
    expect(source).toContain('activeControl === "review"');
  });

  it("shows only review results in the review panel", () => {
    const source = readFileSync(
      "frontend/components/panels/studio/ScriptTab.tsx",
      "utf8",
    );

    const reviewStart = source.indexOf('activeControl === "review"');
    const reviewEnd = source.indexOf("</section>", reviewStart);
    const reviewPanel = source.slice(reviewStart, reviewEnd);

    expect(source).toContain("reviewMarkdown");
    expect(reviewPanel).toContain("renderMarkdownPreview(reviewMarkdown");
    expect(reviewPanel).not.toContain("<ScriptOutputPanel");
    expect(reviewPanel).toContain("props.runReview(");
    expect(reviewPanel).toContain('target: "review"');
  });


  // 1011 thinking 进流:流式思考预览区——思考期弱化展示,正文开始后折叠,空思考零占位
  it("renders the streaming thinking preview above the output while the body has not started", () => {
    const chapter = {
      id: "ch-think",
      index: 1,
      title: "第一章",
      sourceText: "正文……",
      importedAt: 1,
    };

    render(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[]}
        saveAgentWorkData={vi.fn()}
        runStage={vi.fn()}
        runReview={vi.fn()}
        manualContext=""
        directorContext=""
        styleSummary=""
        scriptStreaming={{ key: "scriptDraft", scopeId: "ch-think", text: "", thinking: "先想清楚章节主线……" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));

    expect(screen.getByText("AI 思考中…")).toBeTruthy();
    expect(screen.getByText("先想清楚章节主线……")).toBeTruthy();
  });

  it("collapses the thinking preview once body text starts and keeps it expandable", () => {
    const chapter = {
      id: "ch-think2",
      index: 1,
      title: "第一章",
      sourceText: "正文……",
      importedAt: 1,
    };

    render(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[]}
        saveAgentWorkData={vi.fn()}
        runStage={vi.fn()}
        runReview={vi.fn()}
        manualContext=""
        directorContext=""
        styleSummary=""
        scriptStreaming={{ key: "scriptDraft", scopeId: "ch-think2", text: "# 剧本\n\n正文增量", thinking: "思考完毕" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));

    // 正文已开始:思考区折叠为入口(带字数),内容不再直接可见
    expect(screen.getByRole("button", { name: /AI 思考过程（4 字）/ })).toBeTruthy();
    expect(screen.queryByText("思考完毕")).toBeNull();

    // 手动展开后可回看
    fireEvent.click(screen.getByRole("button", { name: /AI 思考过程/ }));
    expect(screen.getByText("思考完毕")).toBeTruthy();
  });

  it("keeps zero footprint for the thinking preview when no thinking has arrived", () => {
    const chapter = {
      id: "ch-think3",
      index: 1,
      title: "第一章",
      sourceText: "正文……",
      importedAt: 1,
    };

    render(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[]}
        saveAgentWorkData={vi.fn()}
        runStage={vi.fn()}
        runReview={vi.fn()}
        manualContext=""
        directorContext=""
        styleSummary=""
        scriptStreaming={{ key: "scriptDraft", scopeId: "ch-think3", text: "" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));

    expect(screen.queryByText("AI 思考中…")).toBeNull();
    expect(screen.queryByText(/AI 思考过程/)).toBeNull();
  });

  // R4/G9:AI提示词页只读展示确定性自检指标 flags(有超标列条目;全达标显示「自检通过」)
  it("renders the deterministic self-check flags for the generated script draft", () => {
    const chapter = {
      id: "ch-check",
      index: 1,
      title: "第一章",
      sourceText: "正文……",
      importedAt: 1,
    };
    const draft = [
      "# 测试 EP01：x",
      "# 范围与目标：x | 时长：3分钟",
      "# 已确定要求：x/16:9横屏/x",
      "",
      "1-1 场 晨/外", // 缺 ·约N秒 → flag
      "人物：甲",
      "",
      "△动作。",
      "OS（甲）：甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌", // 21 字 > 20 → 超长句 flag
    ].join("\n");

    render(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[
          { id: "w1", key: "scriptDraft", episodeId: "ch-check", data: draft, createdAt: 1, updatedAt: 1 },
        ]}
        saveAgentWorkData={vi.fn()}
        runStage={vi.fn()}
        runReview={vi.fn()}
        manualContext=""
        directorContext=""
        styleSummary=""
        scriptStreaming={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI提示词" }));

    expect(screen.getByText(/缺·约N秒标注/)).toBeTruthy();
    expect(screen.getByText(/超长句 1 条/)).toBeTruthy();
    expect(screen.queryByText(/自检通过/)).toBeNull();
  });

  it("renders 自检通过 when the script draft has no flagged metrics", () => {
    const chapter = {
      id: "ch-pass",
      index: 1,
      title: "第一章",
      sourceText: "正文……",
      importedAt: 1,
    };
    const draft = [
      "# 测试 EP01：x",
      "# 范围与目标：x | 时长：1分钟",
      "# 已确定要求：x/16:9横屏/x",
      "",
      "1-1 场 晨/外 ·约60秒",
      "人物：甲",
      "",
      "△动作。",
      "甲：你来啦！",
    ].join("\n");

    render(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[
          { id: "w1", key: "scriptDraft", episodeId: "ch-pass", data: draft, createdAt: 1, updatedAt: 1 },
        ]}
        saveAgentWorkData={vi.fn()}
        runStage={vi.fn()}
        runReview={vi.fn()}
        manualContext=""
        directorContext=""
        styleSummary="## 项目信息\n单集参考时长：1分钟\n目标画幅：16:9"
        scriptStreaming={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI提示词" }));

    expect(screen.getByText(/自检通过/)).toBeTruthy();
  });

  // R1/G8:标注第二参=reviseMode(是否带审核反馈修订)——已有剧本但无审核问题 → 仍标小说改编
  it("labels the chapter mode by reviseMode, not by the existence of a script draft", () => {
    const chapter = {
      id: "ch-mode",
      index: 1,
      title: "第一章",
      sourceText: "正文……",
      importedAt: 1,
    };

    const { rerender } = render(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[
          { id: "w1", key: "scriptDraft", episodeId: "ch-mode", data: "# 已有剧本", createdAt: 1, updatedAt: 1 },
        ]}
        saveAgentWorkData={vi.fn()}
        runStage={vi.fn()}
        runReview={vi.fn()}
        manualContext=""
        directorContext=""
        styleSummary=""
        scriptStreaming={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI提示词" }));
    expect(screen.getByText(/本章判定：小说改编 → 已注入改编方法文档/)).toBeTruthy();
    expect(screen.queryByText(/修订模式/)).toBeNull();

    // 有审核问题(🔴)→ reviseMode=true → 修订态标注(父 I4)
    rerender(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[
          { id: "w1", key: "scriptDraft", episodeId: "ch-mode", data: "# 已有剧本", createdAt: 1, updatedAt: 1 },
          { id: "w2", key: "scriptDraftReview", episodeId: "ch-mode", data: "🔴 台词超长", createdAt: 2, updatedAt: 2 },
        ]}
        saveAgentWorkData={vi.fn()}
        runStage={vi.fn()}
        runReview={vi.fn()}
        manualContext=""
        directorContext=""
        styleSummary=""
        scriptStreaming={null}
      />,
    );
    expect(screen.getByText(/本章判定：修订模式 → 按审核意见修订，未注入方法文档/)).toBeTruthy();
  });
});
