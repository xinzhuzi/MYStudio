import { describe, expect, it } from "vitest";
import {
  buildStageMessages,
  buildStageReviewMessages,
  describeChapterModeAnnotation,
  determineChapterMode,
  extractPartialContent,
  METHOD_DOCS,
  parseStageOutput,
} from "./script-planning";

describe("studio script-planning 逐章编剧链（Markdown，B+ 单次生成）", () => {
  it("parseStageOutput：去整篇代码围栏并 trim，Markdown 原样返回", () => {
    expect(parseStageOutput("# 剧本\n正文")).toBe("# 剧本\n正文");
    expect(parseStageOutput("```markdown\n# 剧本\n正文\n```")).toBe("# 剧本\n正文");
    expect(parseStageOutput("```\nS01 内景\n```")).toBe("S01 内景");
    expect(parseStageOutput("  纯文本  ")).toBe("纯文本");
    expect(parseStageOutput("<think>推理过程</think>\n# 剧本\n正文")).toBe("# 剧本\n正文");
    expect(parseStageOutput("正文在前<think>未闭合的思考被截断")).toBe("正文在前");
  });

  it("剧本消息：skill+方法文档+Markdown 格式作 system，项目信息/本章正文/事件入 user；旧 key（骨架/策略）不进 prompt", () => {
    const m = buildStageMessages("scriptDraft", {
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
    expect(m.user).toContain("> 请基于以上信息完成「剧本(含规划)」，并按输出格式返回。");
    expect(m.user).not.toContain("[!IMPORTANT]");
    expect(m.user).not.toContain("本章正文：\n独孤剑尘夜访道口镇。");
    expect(m.system).toContain("Markdown");
    expect(m.system).not.toContain('{"content"');
    // 旧阶段 key 钉死不进 prompt（B+ 收口：骨架/策略注入位删除而非置空，防死信复辟——G5）
    expect(m.user).not.toContain("故事骨架");
    expect(m.user).not.toContain("改编策略");
    expect(m.system).not.toContain("故事骨架审核");
    expect(m.system).not.toContain("改编策略审核");
  });

  it("衔接与修订注入：上一集剧本/上一版产出/审核意见均进 user", () => {
    const revise = buildStageMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文",
      previousEpisodeScript: "上一集剧本Z",
      previousOutput: "上一版剧本X",
      reviewFeedback: "审核：场1台词太长",
    });
    expect(revise.user).toContain("上一集剧本（仅用于衔接");
    expect(revise.user).toContain("上一集剧本Z");
    expect(revise.user).toContain("上一版剧本X");
    expect(revise.user).toContain("审核：场1台词太长");
    expect(revise.user).toContain("逐条修复");
  });

  it("审核消息：单主体=新格式剧本，对照事件分析与本章正文，无骨架/策略对照位", () => {
    const scriptReview = buildStageReviewMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文内容",
      eventState: "事件E",
      scriptDraft: "剧本C",
    });
    expect(scriptReview.user).toContain("剧本C");
    expect(scriptReview.user).toContain("剧本审核");
    expect(scriptReview.user).toContain("本章事件分析（对照）");
    expect(scriptReview.user).toContain("本章正文（删减合理性对照");
    expect(scriptReview.user).not.toContain("故事骨架");
    expect(scriptReview.user).not.toContain("改编策略");
  });

  it("原著圣经注入：位于 manualContext 之后；未提供时零影响", () => {
    const withBible = buildStageMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文内容",
      manualContext: "## 项目信息\n视觉风格：日式3D渲染2D",
      originalBibleContext: "# 原著圣经（最高优先级·人物一律用此表规范名）\n\n## 一句话主线\n复仇主线",
    });
    expect(withBible.user.indexOf("原著圣经（最高优先级")).toBeGreaterThan(withBible.user.indexOf("项目信息"));
    expect(withBible.user.indexOf("原著圣经（最高优先级")).toBeLessThan(withBible.user.indexOf("本章正文"));
    expect(withBible.user).toContain("请基于以上信息完成「剧本(含规划)」，遵守原著圣经，并按输出格式返回。");

    const withoutBible = buildStageMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文内容",
    });
    expect(withoutBible.user).not.toContain("原著圣经");
    expect(withoutBible.user).toContain("请基于以上信息完成「剧本(含规划)」，并按输出格式返回。");

    const review = buildStageReviewMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文",
      scriptDraft: "剧本C",
      originalBibleContext: "# 原著圣经（最高优先级·人物一律用此表规范名）",
    });
    expect(review.user).toContain("原著圣经（最高优先级");
    expect(review.user.indexOf("原著圣经（最高优先级")).toBeLessThan(review.user.indexOf("章节："));
  });
});

describe("determineChapterMode 本章判定三态（B+ 方法文档按需注入）", () => {
  it("三态判定：有原文无剧本=小说改编 / 无原文=原创 / 有原文有剧本=定稿", () => {
    expect(determineChapterMode({ sourceText: "晏燎雨夜入城。" }, false)).toBe("novel_adaptation");
    expect(determineChapterMode({ sourceText: "   \n " }, false)).toBe("original");
    expect(determineChapterMode({}, false)).toBe("original");
    expect(determineChapterMode({ sourceText: "晏燎雨夜入城。" }, true)).toBe("finalized");
  });

  it("注入矩阵：改编→改编方法 / 原创→故事开发方法 / 定稿→零注入，每次 ≤1 份且位于 system 段 skill 之后 --- 分隔", () => {
    expect(METHOD_DOCS.novel_adaptation).toBe("method_screen_adaptation");
    expect(METHOD_DOCS.original).toBe("method_story_development");
    expect(METHOD_DOCS.finalized).toBeNull();

    const adaptation = buildStageMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "晏燎雨夜入城。",
    });
    expect(adaptation.system).toContain("剧本改编方法：小说转短剧的取舍思考");
    expect(adaptation.system).not.toContain("故事开发方法：单集定位与结构思考");
    expect(adaptation.system.indexOf("剧本改编方法：")).toBeGreaterThan(
      adaptation.system.indexOf("剧本编写 Agent"),
    );
    // 方法文档以 --- 分隔接在 skill 之后、输出格式之前（system 段结构：skill --- 方法文档 --- 输出格式）
    expect(adaptation.system).toContain("\n\n---\n\n# 剧本改编方法：小说转短剧的取舍思考");
    expect(adaptation.system.indexOf("剧本改编方法：")).toBeLessThan(
      adaptation.system.indexOf("## 输出格式（最高优先级）"),
    );

    const original = buildStageMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "",
    });
    expect(original.system).toContain("故事开发方法：单集定位与结构思考");
    expect(original.system).not.toContain("剧本改编方法：小说转短剧的取舍思考");

    const finalized = buildStageMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "晏燎雨夜入城。",
      scriptDraft: "# 已有定稿剧本",
    });
    expect(finalized.system).not.toContain("剧本改编方法：小说转短剧的取舍思考");
    expect(finalized.system).not.toContain("故事开发方法：单集定位与结构思考");
  });

  it("非剧本生成阶段（审核）不注入方法文档", () => {
    const m = buildStageMessages("supervisionReport", {
      chapterTitle: "第1章",
      chapterText: "晏燎雨夜入城。",
    });
    expect(m.system).not.toContain("剧本改编方法：小说转短剧的取舍思考");
    expect(m.system).not.toContain("故事开发方法：单集定位与结构思考");
  });

  it("G12 预览页只读判定标注：三态各返回一条只读说明文案", () => {
    expect(describeChapterModeAnnotation({ sourceText: "晏燎雨夜入城。" }, false)).toBe(
      "本章判定：小说改编 → 已注入改编方法文档",
    );
    expect(describeChapterModeAnnotation({ sourceText: "" }, false)).toBe(
      "本章判定：原创 → 已注入故事开发方法文档",
    );
    expect(describeChapterModeAnnotation({ sourceText: "晏燎雨夜入城。" }, true)).toBe(
      "本章判定：已有定稿剧本 → 未注入方法文档",
    );
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
