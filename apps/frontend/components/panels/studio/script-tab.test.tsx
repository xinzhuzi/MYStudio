// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { ComponentProps } from "react";
import { ScriptTab } from "./ScriptTab";
import { useStudioStore } from "@/stores/studio/studio-store";

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
    expect(tabSource).toContain("useThemeStore");
    expect(tabSource).toContain("theme={theme}");
    expect(tabSource).not.toContain('theme="dark"');
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

  it("shows generated stage content with self-check metrics in the generate panel", () => {
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
    // G38 一键生成自释锁:aria-label 须含可见文本「一键生成」(WCAG 2.5.3)+ 不走修订自释
    expect(generatePanel).toContain('aria-label="一键生成：按改编模式重新生成(不走修订)"');
    expect(generatePanel).toContain("props.runStage(");
    expect(generatePanel).toContain('target: "output"');
    // R6:自检指标框随被度量草稿迁入一键生成页(prompt 页不再持有)
    expect(generatePanel).toContain("script-self-check");
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
        scriptStreaming={{ key: "scriptDraft" as const, scopeId: "ch-think", text: "", thinking: "先想清楚章节主线……" }}
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
        scriptStreaming={{ key: "scriptDraft" as const, scopeId: "ch-think2", text: "# 剧本\n\n正文增量", thinking: "思考完毕" }}
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
        scriptStreaming={{ key: "scriptDraft" as const, scopeId: "ch-think3", text: "" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));

    expect(screen.queryByText("AI 思考中…")).toBeNull();
    expect(screen.queryByText(/AI 思考过程/)).toBeNull();
  });

  // R4/G9:一键生成页只读展示确定性自检指标 flags(有超标列条目;全达标显示「自检通过」)
  // R6(10-13):随被度量草稿迁至一键生成页,与产出同屏
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
          { id: "w1", key: "scriptDraft" as const, episodeId: "ch-check", data: draft, createdAt: 1, updatedAt: 1 },
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

    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));

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
          { id: "w1", key: "scriptDraft" as const, episodeId: "ch-pass", data: draft, createdAt: 1, updatedAt: 1 },
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

    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));

    expect(screen.getByText(/自检通过/)).toBeTruthy();
  });

  // R6:流式守卫——生成中(store 旧稿仍在,自检指标非 null)不得展示旧稿指标误导;
  // 一键生成页流式期 script-self-check 零占位,流结束(isStreaming=false)后恢复
  it("hides the self-check metrics on the generate panel while streaming (R6)", () => {
    const chapter = {
      id: "ch-r6-stream",
      index: 1,
      title: "第一章",
      sourceText: "正文……",
      importedAt: 1,
    };

    render(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[
          // 旧稿仍在 store:selfCheckMetrics 非 null——无守卫时旧稿指标会照常渲染
          { id: "w1", key: "scriptDraft" as const, episodeId: "ch-r6-stream", data: "# 已有旧稿", createdAt: 1, updatedAt: 1 },
        ]}
        saveAgentWorkData={vi.fn()}
        runStage={vi.fn()}
        runReview={vi.fn()}
        manualContext=""
        directorContext=""
        styleSummary=""
        scriptStreaming={{ key: "scriptDraft" as const, scopeId: "ch-r6-stream", text: "# 新稿增量" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));

    expect(screen.queryByTestId("script-self-check")).toBeNull();
  });

  // R1/G8→F3 迁移:预览/标注/摘要统一按「一键生成=非修订」口径——标注不再随审核态变化,
  // 已有剧本(无论有无审核问题)恒标小说改编;修订入口只剩「AI审核生成」按钮(判定走 reviseMode)
  it("labels the chapter mode from chapter data regardless of review state (F3 non-revision footing)", () => {
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
          { id: "w1", key: "scriptDraft" as const, episodeId: "ch-mode", data: "# 已有剧本", createdAt: 1, updatedAt: 1 },
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

    // 有审核问题(🔴,且晚于剧本=新鲜)→ 预览口径仍非修订:标注恒改编态(F3)
    rerender(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[
          { id: "w1", key: "scriptDraft" as const, episodeId: "ch-mode", data: "# 已有剧本", createdAt: 1, updatedAt: 1 },
          { id: "w2", key: "scriptDraftReview" as const, episodeId: "ch-mode", data: "🔴 台词超长", createdAt: 2, updatedAt: 2 },
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
    expect(screen.getByText(/本章判定：小说改编 → 已注入改编方法文档/)).toBeTruthy();
    expect(screen.queryByText(/修订模式/)).toBeNull();
  });

  // F3:预览与实发一致——「一键生成」固定非修订,预览/摘要同口径;「AI审核生成」是唯一修订入口
  it("previews the prompt on the non-revision footing even when fresh review issues exist (F3)", async () => {
    const chapter = {
      id: "ch-f3-fresh",
      index: 1,
      title: "第一章",
      sourceText: "正文……",
      importedAt: 1,
    };
    const previewMock = vi.fn(async () => null);

    render(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[
          { id: "w1", key: "scriptDraft" as const, episodeId: "ch-f3-fresh", data: "# 已有剧本", createdAt: 100, updatedAt: 100 },
          { id: "w2", key: "scriptDraftReview" as const, episodeId: "ch-f3-fresh", data: "🔴 台词超长", createdAt: 200, updatedAt: 200 },
        ]}
        saveAgentWorkData={vi.fn()}
        runStage={vi.fn()}
        runReview={vi.fn()}
        previewStageUserMessage={previewMock}
        manualContext=""
        directorContext=""
        styleSummary=""
        scriptStreaming={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI提示词" }));

    // 预览:按「一键生成」口径组装(useReviewFeedback=false),不因有审核问题切修订态
    await waitFor(() =>
      expect(previewMock).toHaveBeenCalledWith("scriptDraft", chapter, { useReviewFeedback: false }),
    );
    expect(previewMock).not.toHaveBeenCalledWith("scriptDraft", chapter, { useReviewFeedback: true });
    // 标注/摘要:仍为改编态,不带「审核意见(修订模式)」
    expect(screen.getByText(/本章判定：小说改编 → 已注入改编方法文档/)).toBeTruthy();
    expect(screen.queryByText(/修订模式/)).toBeNull();

    // 「AI审核生成」入口可用(新鲜审核+未修复问题)
    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));
    const aiReviewButton = screen.getByRole("button", { name: "AI审核生成" }) as HTMLButtonElement;
    expect(aiReviewButton.disabled).toBe(false);
  });

  // F3:审核早于最新剧本(重新生成后的旧审核)→「AI审核生成」不带审核意见——入口禁用
  it("disables AI审核生成 when the review predates the latest script draft (F3)", () => {
    const chapter = {
      id: "ch-f3-stale",
      index: 1,
      title: "第一章",
      sourceText: "正文……",
      importedAt: 1,
    };

    render(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[
          { id: "w1", key: "scriptDraft" as const, episodeId: "ch-f3-stale", data: "# 新版剧本", createdAt: 300, updatedAt: 300 },
          { id: "w2", key: "scriptDraftReview" as const, episodeId: "ch-f3-stale", data: "🔴 台词超长", createdAt: 100, updatedAt: 100 },
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

    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));
    const aiReviewButton = screen.getByRole("button", { name: "AI审核生成" }) as HTMLButtonElement;
    expect(aiReviewButton.disabled).toBe(true);
  });

  // F3:只读提示行——「AI审核生成」行为自释(语义 token,勿硬编码色)
  it("shows the read-only hint that AI审核生成 attaches the previous script and review (F3)", () => {
    const chapter = {
      id: "ch-f3-hint",
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
        scriptStreaming={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));
    // 无审核态:禁用原因自释(可用态文案「AI审核生成时将附带…」由审核用例覆盖)
    expect(
      screen.getByText("AI审核生成需针对当前版本且含未修复问题的审核(重跑「审核」后可用)"),
    ).toBeTruthy();
  });

  // R4:摘要按实含列出——原创章(无 sourceText)实发零注入「本章正文」(script-planning.ts trim 守卫),
  // 未选导演包(directorContext="")实发零注入导演条目;摘要行不虚列(旧实现恒列属账实不符)
  it("omits 本章正文 and the director entry from the sent summary for an original chapter without a director package (R4)", () => {
    const chapter = {
      id: "ch-r4-original",
      index: 1,
      title: "第一章",
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
        scriptStreaming={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI提示词" }));

    const summary = screen.getByText(/含：/).textContent ?? "";
    expect(summary).not.toContain("本章正文");
    expect(summary).not.toContain("题材剧本规则");
    expect(summary).not.toContain("导演手法");
    // #6:空 config(manualContext="")实发零注入「## 项目信息」节,摘要不虚列「项目信息」
    // ——防 sentSummary 的 manualContext 条件守卫回退(恒列)无红灯
    expect(summary).not.toContain("项目信息");
    // 无 previewStageUserMessage(本地回退构建)不含「## 上一集剧本」节,摘要不虚列
    expect(summary).not.toContain("上一集剧本");
    // 摘要行其余项不受影响:章节条目仍在
    expect(summary).toContain("章节：第一章");
  });

  // R4:小说改编章 + 已选导演包 → 摘要列「本章正文」与「题材剧本规则」(标签对齐实发节标题,弃「导演手法」)
  it("lists 本章正文 and 题材剧本规则 in the sent summary for an adaptation chapter with a director package (R4)", () => {
    const chapter = {
      id: "ch-r4-adapt",
      index: 1,
      title: "第二章",
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
        manualContext="## 项目信息\n单集参考时长：1分钟"
        directorContext="## 题材剧本规则（测试道劫包）\n- 旁白腔规则"
        styleSummary=""
        scriptStreaming={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI提示词" }));

    const summary = screen.getByText(/含：/).textContent ?? "";
    expect(summary).toContain("本章正文");
    expect(summary).toContain("题材剧本规则");
    expect(summary).toContain("项目信息");
    expect(summary).not.toContain("导演手法");
  });

  // R4 收口(复审 low + 实含清单补全):「上一集剧本」条目按实含列出——实发链
  // useScriptStageActions 取前一章最新 scriptDraft 注入「## 上一集剧本」节
  // (script-planning.ts previousEpisodeScript 非空守卫);摘要守卫与 memoryMarkers
  // 同款(promptSource includes 节标题)。此处 mock previewStageUserMessage 返回
  // 含该节的完整 user 消息(与 hook 完整构建产出的节格式一致),锁摘要不漏列。
  it("lists 上一集剧本 in the sent summary when the live prompt contains the previous episode section (R4)", async () => {
    const chapters = [
      {
        id: "ch-r4-prev-ep1",
        index: 1,
        title: "第一章",
        sourceText: "前集正文……",
        importedAt: 1,
      },
      {
        id: "ch-r4-prev-ep2",
        index: 2,
        title: "第二章",
        sourceText: "本章正文……",
        importedAt: 2,
      },
    ];

    render(
      <ScriptTab
        novelChapters={chapters}
        agentWorkData={[]}
        saveAgentWorkData={vi.fn()}
        runStage={vi.fn()}
        runReview={vi.fn()}
        manualContext=""
        directorContext=""
        styleSummary=""
        scriptStreaming={null}
        previewStageUserMessage={async () =>
          "## 本集信息（1 章 = 1 集）\n章节：第二章\n\n## 上一集剧本（仅用于衔接：承接其时间线与角色状态，禁止复述或改写其内容）\n前集剧本正文……"
        }
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI提示词" }));

    await waitFor(() => {
      const summary = screen.getByText(/含：/).textContent ?? "";
      expect(summary).toContain("上一集剧本");
    });
  });
});

// G1(批1步骤3 RED,10-13-audit4-gen-chain):章选择装载接线——
// T1 下拉 change → store.switchChapter 派发 + activeChapterId 翻转后下拉跟随
// T5 判定回归(livefire9 形态):store 锚定章(ch2 带 sourceText=装载后态)→ 预览标改编 + 摘要含本章正文
describe("章选择装载接线(G1)", () => {
  // 前章=轻索引形态(窗口化瘦身后无 sourceText),目标章=装载后带正文的完整章
  const ch1Light = { id: "ch1", index: 1, title: "第一章", importedAt: 1 };
  const ch2Full = { id: "ch2", index: 2, title: "第二章", sourceText: "本章正文", importedAt: 2 };

  const makeProps = () => ({
    agentWorkData: [],
    saveAgentWorkData: vi.fn(),
    runStage: vi.fn(),
    runReview: vi.fn(),
    manualContext: "",
    directorContext: "",
    styleSummary: "",
    scriptStreaming: null,
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // 重置 store 章锚,防测试间污染(既有用例均在 activeChapterId=null 下跑)
    useStudioStore.setState({ activeChapterId: null });
  });

  it("T1 下拉 change 派发 useStudioStore.switchChapter,store 锚翻转后下拉跟随", () => {
    const switchSpy = vi.spyOn(useStudioStore.getState(), "switchChapter");
    const props = { novelChapters: [ch1Light, ch2Full], ...makeProps() };
    const { rerender } = render(<ScriptTab {...props} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ch2" } });
    expect(switchSpy).toHaveBeenCalledWith("ch2");

    // 装载完成的等价观察态:activeChapterId 翻转后重渲,下拉选值跟随 store 真源
    useStudioStore.setState({ activeChapterId: "ch2" });
    rerender(<ScriptTab {...props} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("ch2");
  });

  it("T5 store 锚定章(ch2 带 sourceText)时「AI提示词」页标「本章判定：小说改编…」且摘要含「本章正文」", () => {
    useStudioStore.setState({ activeChapterId: "ch2" });
    render(<ScriptTab novelChapters={[ch1Light, ch2Full]} {...makeProps()} />);

    fireEvent.click(screen.getByRole("button", { name: "AI提示词" }));

    expect(screen.getByText(/本章判定：小说改编/)).toBeTruthy();
    const summary = screen.getByText(/含：/).textContent ?? "";
    expect(summary).toContain("本章正文");
  });
});

// G5(批2 RED,10-13-audit4-gen-chain):组装期占位串防线——livePrompt===null(组装中)时
// 「AI提示词」页「可编辑」禁用+title 自释,防「（正在组装提示词…）」被固化成 userDraft
// (ScriptTab.tsx:207-211 占位串进 promptSource → :392-397 可编辑无守卫直开编辑器);
// 组装完成后恢复可用(守卫只覆盖组装窗口,不得恒禁用)。
describe("组装期占位串防线(G5)", () => {
  const chapter = { id: "ch-g5", index: 1, title: "第一章", sourceText: "正文……", importedAt: 1 };

  it("livePrompt===null(组装中)时「可编辑」禁用+title 自释;组装完成恢复可用", async () => {
    let resolvePreview: ((text: string | null) => void) | undefined;
    const previewMock = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolvePreview = resolve;
        }),
    );

    render(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[]}
        saveAgentWorkData={vi.fn()}
        runStage={vi.fn()}
        runReview={vi.fn()}
        previewStageUserMessage={previewMock}
        manualContext=""
        directorContext=""
        styleSummary=""
        scriptStreaming={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI提示词" }));
    const editButton = () => screen.getByRole("button", { name: "可编辑" }) as HTMLButtonElement;

    // 组装中:禁用 + title 自释(现实现无 disabled → 红)
    expect(editButton().disabled).toBe(true);
    expect(editButton().title).toContain("组装");

    // 组装完成:恢复可用(非恒禁用)
    await act(async () => {
      resolvePreview?.("# 完整提示词");
    });
    await waitFor(() => expect(editButton().disabled).toBe(false));
  });

  // mustFix(10-14 复审):PRD G5 另一半「本地降级版」——livePrompt===""(hook 完整构建失败,
  // previewStageUserMessage 返 null → setLivePrompt(""))时 basePrompt 回退 standardMessages.user
  // (本地 buildStageMessages 降级产物,缺圣经/档案检索/项目记忆/上一集),守卫若只认占位串,
  // 降级版经编辑器固化成 userDraft 实发。
  it("G5:组装失败(livePrompt===\"\"回退本地降级版)时「可编辑」同样禁用", async () => {
    const chapter = { id: "ch-g5-fail", index: 1, title: "第一章", sourceText: "正文……", importedAt: 1 };
    // 完整构建失败:previewStageUserMessage 返 null → ScriptTab setLivePrompt("")
    const previewMock = vi.fn(async () => null);

    render(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[]}
        saveAgentWorkData={vi.fn()}
        runStage={vi.fn()}
        runReview={vi.fn()}
        previewStageUserMessage={previewMock}
        manualContext=""
        directorContext=""
        styleSummary=""
        scriptStreaming={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI提示词" }));

    await waitFor(() => expect(previewMock).toHaveBeenCalled());
    const editButton = screen.getByRole("button", { name: "可编辑" }) as HTMLButtonElement;
    expect(editButton.disabled).toBe(true);
    expect(editButton.title).toContain("组装");
  });

  // mustFix(10-14 复审)防线二:本地降级版(standardMessages.user)不得固化为 userDraft——
  // 无 hook 回退窗口打开编辑器原样保存 → 一键生成不得把降级版作 userOverride 实发
  it("G5:保存编辑器里的本地降级版(standardMessages.user 原样)不固化成 userDraft 实发", async () => {
    const chapter = { id: "ch-g5-save", index: 1, title: "第一章", sourceText: "正文……", importedAt: 1 };
    const runStageMock = vi.fn();

    render(
      <ScriptTab
        novelChapters={[chapter]}
        agentWorkData={[]}
        saveAgentWorkData={vi.fn()}
        runStage={runStageMock}
        runReview={vi.fn()}
        manualContext=""
        directorContext=""
        styleSummary=""
        scriptStreaming={null}
      />,
    );

    // 无 hook 回退窗口:basePrompt=standardMessages.user,「可编辑」可用,直开即降级版
    fireEvent.click(screen.getByRole("button", { name: "AI提示词" }));
    fireEvent.click(screen.getByRole("button", { name: "可编辑" }));
    // 编辑器直存未改的降级版(ScriptEditorDialog 保存钮,portal 内容)
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    // 同阶段切控制页签(userDraft 只按 chapterId/activeStage 清,控制页签切换不清)→ 一键生成
    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));
    fireEvent.click(
      screen.getByRole("button", { name: "一键生成：按改编模式重新生成(不走修订)" }),
    );

    expect(runStageMock).toHaveBeenCalledTimes(1);
    // 降级版不得作 userOverride 实发:第三参须 undefined(回落 hook 完整组装产物)
    expect(runStageMock).toHaveBeenCalledWith("scriptDraft", chapter, undefined, {
      useReviewFeedback: false,
    });
  });
});

// ── A批(10-14-audit4-residuals)R1/R5/R12 ─────────────────────────────────
// R1:切章装载期间给出「装载中」状态并禁用生成/审核/可编辑(此前只看 scriptStreaming,
//     装载窗口内旧章数据可被生成/编辑)。
// R5:人工改审(审核结果编辑器保存)与 AI 审核同口径——saveAgentWorkData 附
//     reviewTarget=被审剧本条目指纹(id+updatedAt),isReviewFresh 版本比对真源。
// R12/D7:章内最新条目按 updatedAt 口径取(workflow-helpers latestScriptDraftEntry
//     单源),不再按数组序 reverse().find。
describe("切章装载中禁用与章内最新条目口径(A批 R1/R5/R12)", () => {
  const chapter = { id: "ch-a", index: 1, title: "第一章", sourceText: "正文……", sourceId: "src-a", revision: 2, importedAt: 1 };
  const draft = { id: "w-draft", key: "scriptDraft" as const, episodeId: "ch-a", data: "# 当前剧本", createdAt: 10, updatedAt: 100 };
  const review = { id: "w-review", key: "scriptDraftReview" as const, episodeId: "ch-a", data: "# 旧审核", createdAt: 20, updatedAt: 200 };

  type ScriptTabTestProps = ComponentProps<typeof ScriptTab>;
  const makeProps = (overrides: Partial<ScriptTabTestProps> = {}): ScriptTabTestProps => ({
    novelChapters: [chapter],
    agentWorkData: [draft, review],
    saveAgentWorkData: vi.fn(),
    runStage: vi.fn(),
    runReview: vi.fn(),
    manualContext: "",
    directorContext: "",
    styleSummary: "",
    scriptStreaming: null,
    ...overrides,
  });

  const detailPanel = () =>
    document.querySelector("section.script-stage-detail-panel") as HTMLElement;

  afterEach(() => {
    useStudioStore.setState({ activeChapterId: null });
  });

  it("R1 装载中:显示装载中状态,一键生成/审核/可编辑禁用", () => {
    useStudioStore.setState({ activeChapterId: "ch-a", chapterSwitchLoading: true });
    render(<ScriptTab {...makeProps()} />);

    // 装载中状态可见(status live region)
    expect(screen.getByTestId("chapter-switch-loading")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));
    // 一键生成动作钮(aria-label 唯一)
    const generateBtn = screen.getByRole(
      "button",
      { name: "一键生成：按改编模式重新生成(不走修订)" },
    ) as HTMLButtonElement;
    expect(generateBtn.disabled).toBe(true);
    // 产出「可编辑」(装载前有产出=可用,装载窗口必须禁用)
    const outputEdit = within(detailPanel()).getByRole("button", { name: "可编辑" }) as HTMLButtonElement;
    expect(outputEdit.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    // 审核动作钮与控制页签同名——动作钮在 detail panel 内
    const reviewBtn = within(detailPanel()).getByRole("button", { name: "审核" }) as HTMLButtonElement;
    expect(reviewBtn.disabled).toBe(true);
    const reviewEdit = within(detailPanel()).getByRole("button", { name: "可编辑" }) as HTMLButtonElement;
    expect(reviewEdit.disabled).toBe(true);
  });

  it("R1 装载完成(标志位 false):同批按钮恢复可用,不恒禁用", () => {
    useStudioStore.setState({ activeChapterId: "ch-a", chapterSwitchLoading: false });
    render(<ScriptTab {...makeProps()} />);

    expect(screen.queryByTestId("chapter-switch-loading")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));
    const generateBtn = screen.getByRole(
      "button",
      { name: "一键生成：按改编模式重新生成(不走修订)" },
    ) as HTMLButtonElement;
    expect(generateBtn.disabled).toBe(false);
    const outputEdit = within(detailPanel()).getByRole("button", { name: "可编辑" }) as HTMLButtonElement;
    expect(outputEdit.disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    const reviewBtn = within(detailPanel()).getByRole("button", { name: "审核" }) as HTMLButtonElement;
    expect(reviewBtn.disabled).toBe(false);
    const reviewEdit = within(detailPanel()).getByRole("button", { name: "可编辑" }) as HTMLButtonElement;
    expect(reviewEdit.disabled).toBe(false);
  });

  it("R5 人工改审保存:saveAgentWorkData 附 reviewTarget=被审剧本条目 id+updatedAt", () => {
    const saveMock = vi.fn();
    useStudioStore.setState({ activeChapterId: "ch-a" });
    render(<ScriptTab {...makeProps({ saveAgentWorkData: saveMock })} />);

    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    fireEvent.click(within(detailPanel()).getByRole("button", { name: "可编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith(
      "scriptDraftReview",
      "# 旧审核",
      "ch-a",
      expect.objectContaining({
        sourceId: chapter.sourceId,
        revision: chapter.revision,
        reviewTarget: { entryId: "w-draft", updatedAt: 100 },
      }),
    );
  });

  it("R12/D7 产出与审核取章内最新条目按 updatedAt 口径,不按数组序", () => {
    const newerDraft = { id: "w-new", key: "scriptDraft" as const, episodeId: "ch-a", data: "# 新稿正文", createdAt: 2, updatedAt: 200 };
    const olderDraft = { id: "w-old", key: "scriptDraft" as const, episodeId: "ch-a", data: "# 旧稿正文", createdAt: 1, updatedAt: 100 };
    const newerReview = { id: "r-new", key: "scriptDraftReview" as const, episodeId: "ch-a", data: "# 新审核", createdAt: 4, updatedAt: 400 };
    const olderReview = { id: "r-old", key: "scriptDraftReview" as const, episodeId: "ch-a", data: "# 旧审核", createdAt: 3, updatedAt: 300 };
    useStudioStore.setState({ activeChapterId: "ch-a" });
    // 数组序:新条目在前、旧条目在后——reverse().find 会取旧条目(RED 本体)
    render(
      <ScriptTab
        {...makeProps({ agentWorkData: [newerDraft, olderDraft, newerReview, olderReview] })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "一键生成" }));
    const generateTexts = screen.getAllByTestId("md-preview").map((node) => node.textContent);
    expect(generateTexts).toContain("# 新稿正文");

    fireEvent.click(screen.getByRole("button", { name: "审核" }));
    const reviewTexts = screen.getAllByTestId("md-preview").map((node) => node.textContent);
    expect(reviewTexts).toContain("# 新审核");
  });
});
