// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { ScriptTab } from "./ScriptTab";
import { ScriptOutputPanel } from "./ScriptOutputPanel";

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
        setHeaderActions={vi.fn()}
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
        activeStage="storySkeleton"
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

  it("provides script sub-stage tabs through header actions instead of inline content", () => {
    const source = readFileSync(
      "frontend/components/panels/studio/ScriptTab.tsx",
      "utf8",
    );

    expect(source).toContain("setHeaderActions");
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
});
