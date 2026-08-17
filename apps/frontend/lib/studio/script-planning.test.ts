import { describe, expect, it } from "vitest";
import { buildStageMessages, buildStageReviewMessages, extractPartialContent, parseStageOutput } from "./script-planning";

describe("studio script-planning 逐章编剧链（Markdown）", () => {
  it("parseStageOutput：去整篇代码围栏并 trim，Markdown 原样返回", () => {
    expect(parseStageOutput("# 骨架\n正文")).toBe("# 骨架\n正文");
    expect(parseStageOutput("```markdown\n# 骨架\n正文\n```")).toBe("# 骨架\n正文");
    expect(parseStageOutput("```\nS01 内景\n```")).toBe("S01 内景");
    expect(parseStageOutput("  纯文本  ")).toBe("纯文本");
    expect(parseStageOutput("<think>推理过程</think>\n# 骨架\n正文")).toBe("# 骨架\n正文");
    expect(parseStageOutput("正文在前<think>未闭合的思考被截断")).toBe("正文在前");
  });

  it("骨架消息：skill+Markdown 格式作 system，项目信息/本章正文/事件入 user", () => {
    const m = buildStageMessages("storySkeleton", {
      chapterTitle: "第1章 剑主夜访道口镇",
      chapterText: "独孤剑尘夜访道口镇。",
      eventState: "主线关系：强",
      projectMemoryContext: "## 项目记忆（编剧阶段范围检索）\n- [event] 第1章: 独孤入镇",
      manualContext: "## 项目信息\n视觉风格：日式3D渲染2D",
    });
    expect(m.user).toContain("独孤剑尘夜访道口镇");
    expect(m.user).toContain("主线关系：强");
    expect(m.user).toContain("项目记忆");
    expect(m.user).toContain("独孤入镇");
    expect(m.user).toContain("视觉风格：日式3D渲染2D");
    expect(m.user).toContain("## 本章正文（重点原文）");
    expect(m.user).toContain("> 独孤剑尘夜访道口镇。");
    expect(m.user).toContain("> 【重点执行要求】");
    expect(m.user).toContain("> 请基于以上信息完成「故事骨架」，并按输出格式返回。");
    expect(m.user).not.toContain("[!IMPORTANT]");
    expect(m.user).not.toContain("本章正文：\n独孤剑尘夜访道口镇。");
    expect(m.system).toContain("Markdown");
    expect(m.system).not.toContain('{"content"');
  });

  it("剧本消息串接骨架+改编+正文；审核消息含剧本", () => {
    const adapt = buildStageMessages("adaptationStrategy", {
      chapterTitle: "第1章",
      chapterText: "正文内容",
      skeleton: "骨架A",
    });
    expect(adapt.user).toContain("骨架A");
    expect(adapt.user).toContain("正文内容");

    const draft = buildStageMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文内容",
      skeleton: "骨架A",
      strategy: "改编B",
    });
    expect(draft.user).toContain("骨架A");
    expect(draft.user).toContain("改编B");
    expect(draft.user).toContain("正文内容");

    const revise = buildStageMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文",
      skeleton: "骨架A",
      strategy: "改编B",
      previousOutput: "上一版剧本X",
      reviewFeedback: "审核：场1台词太长",
    });
    expect(revise.user).toContain("上一版剧本X");
    expect(revise.user).toContain("审核：场1台词太长");
    expect(revise.user).toContain("逐条修复");

    const skeletonReview = buildStageReviewMessages("storySkeleton", {
      chapterTitle: "第1章",
      chapterText: "正文",
      skeleton: "骨架A",
      eventState: "事件E",
    });
    expect(skeletonReview.user).toContain("骨架A");
    expect(skeletonReview.user).toContain("故事骨架审核");

    const scriptReview = buildStageReviewMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文",
      skeleton: "骨架A",
      strategy: "改编B",
      scriptDraft: "剧本C",
    });
    expect(scriptReview.user).toContain("剧本C");
    expect(scriptReview.user).toContain("剧本审核");
  });

  it("原著圣经注入：位于 manualContext 之后；未提供时零影响", () => {
    const withBible = buildStageMessages("storySkeleton", {
      chapterTitle: "第1章",
      chapterText: "正文内容",
      manualContext: "## 项目信息\n视觉风格：日式3D渲染2D",
      originalBibleContext: "# 原著圣经（最高优先级·人物一律用此表规范名）\n\n## 一句话主线\n复仇主线",
    });
    expect(withBible.user.indexOf("原著圣经（最高优先级")).toBeGreaterThan(withBible.user.indexOf("项目信息"));
    expect(withBible.user.indexOf("原著圣经（最高优先级")).toBeLessThan(withBible.user.indexOf("本章正文"));
    expect(withBible.user).toContain("请基于以上信息完成「故事骨架」，遵守原著圣经，并按输出格式返回。");

    const withoutBible = buildStageMessages("storySkeleton", {
      chapterTitle: "第1章",
      chapterText: "正文内容",
    });
    expect(withoutBible.user).not.toContain("原著圣经");
    expect(withoutBible.user).toContain("请基于以上信息完成「故事骨架」，并按输出格式返回。");

    const review = buildStageReviewMessages("storySkeleton", {
      chapterTitle: "第1章",
      chapterText: "正文",
      skeleton: "骨架A",
      originalBibleContext: "# 原著圣经（最高优先级·人物一律用此表规范名）",
    });
    expect(review.user).toContain("原著圣经（最高优先级");
    expect(review.user.indexOf("原著圣经（最高优先级")).toBeLessThan(review.user.indexOf("章节："));
  });
});

describe("extractPartialContent 流式直通", () => {
  it("Markdown 原样返回，逐字累积", () => {
    expect(extractPartialContent("# 标题\n正文")).toBe("# 标题\n正文");
    expect(extractPartialContent("正文逐")).toBe("正文逐");
  });

  it("去掉起始代码围栏", () => {
    expect(extractPartialContent("```markdown\n# 标题")).toBe("# 标题");
    expect(extractPartialContent("```\nS01")).toBe("S01");
  });

  it("剥离 think：闭合整段删除，未闭合隐藏其后", () => {
    expect(extractPartialContent("<think>推理</think># 标题")).toBe("# 标题");
    expect(extractPartialContent("<think>还在想")).toBe("");
  });
});
