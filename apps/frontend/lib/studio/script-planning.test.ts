import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildScriptManualContext, buildStudioManualContext, buildStoryboardTableManualContext, buildStudioManualsFromSkillFiles } from "./manuals";
import { buildDirectorPlanMessages } from "./director-plan";
import { buildStoryboardTableMessages } from "./storyboard-table";
import {
  buildStageMessages,
  buildStageReviewMessages,
  describeChapterModeAnnotation,
  determineChapterMode,
  extractPartialContent,
  hasFreshReviewIssues,
  isReviewFresh,
  METHOD_DOCS,
  parseStageOutput,
} from "./script-planning";

describe("studio script-planning 逐章编剧链（Markdown，B+ 单次生成）", () => {
  it("真实道劫手册经存储目录注入严格剧本请求时，叙述层旁白通道不被全面禁令抵消", () => {
    const relativePath = "story_skills/Daojie_xianxia/script_narrative.md";
    const narrative = readFileSync(join(process.cwd(), "frontend/assets/studio-manuals", relativePath), "utf8");
    const director = buildStudioManualsFromSkillFiles("director", [
      { relativePath: "story_skills/Daojie_xianxia/README.md", content: "# 道劫" },
      { relativePath, content: narrative },
    ]);
    const directorContext = buildScriptManualContext({ directorManualId: "Daojie_xianxia" }, { director });
    const messages = buildStageMessages("scriptDraft", {
      strictDaojieAdaptation: true,
      chapterTitle: "测试章",
      chapterText: "他逃亡十年，只因不愿交出断剑。",
      directorContext,
    });

    expect(directorContext).toContain(narrative.trim());
    expect(messages.system).toContain("四·附：叙述层转译通道");
    expect(messages.system).toContain("允许原文明示叙述按受控通道转为 V.S.（旁白）");
    expect(messages.system).not.toContain("不得把原文叙述转成OS/旁白");
    expect(messages.system).not.toContain("原文没有发声的地方就保持无台词");
    expect(messages.system).toContain("单集上限195秒，可短于目标");
    expect(messages.system).toContain("既有声音不能改为无声，数量及序数保留");
    expect(messages.system).toContain("全知叙述不自动变角色心声");
    expect(messages.system).not.toContain("不得借道 OS");
  });

  it("真实题材目录的三阶段请求允许有知情依据的转译，保留防越知与时序边界", () => {
    const root = "story_skills/Daojie_xianxia/";
    const files = ["README.md", "script_narrative.md", "driector_skills/director_planning_narrative.md", "driector_skills/director_storyboard_table_narrative.md"].map((name) => ({
      relativePath: `${root}${name}`,
      content: readFileSync(join(process.cwd(), "frontend/assets/studio-manuals", root, name), "utf8"),
    }));
    const catalog = { director: buildStudioManualsFromSkillFiles("director", files) };
    const config = { directorManualId: "Daojie_xianxia" };
    const common = { episodeId: "c1", scriptText: "候审剧本", sourceText: "他知道断剑是母亲留下的，因此不肯交出。", strictDaojieAdaptation: true };
    const requests = [
      buildStageMessages("scriptDraft", { chapterTitle: "测试章", chapterText: common.sourceText, strictDaojieAdaptation: true, directorContext: buildScriptManualContext(config, catalog) }),
      buildDirectorPlanMessages({ ...common, manualContext: buildStudioManualContext(config, catalog, { moduleCharCap: 0 }) }),
      buildStoryboardTableMessages({ ...common, manualContext: buildStoryboardTableManualContext(config, catalog) }),
    ];

    for (const request of requests) {
      expect(request.system).toContain("载体转换不等于新增事实");
      expect(request.system).toContain("原文明示叙述可转画面、V.S.或有当时知情依据的 OS");
      expect(request.system).toContain("全知叙述不自动变角色心声");
      expect(request.system).toContain("不得提前揭示");
      expect(request.system).toContain("过去事件不得伪装成当前动作");
      expect(request.system).toContain("比喻不能落实为新物理事实");
      expect(request.system).toContain("不新增对白轮次或现场声源");
      expect(request.system).toContain("画面已充分表达时不强加声音");
      expect(request.system).not.toContain("不得借道 OS");
      expect(request.system).not.toContain("且只走旁白");
      expect(request.user).toContain(common.sourceText);
    }

    expect(requests[0]!.system).toContain("角色眼下要达到什么具体目的");
    expect(requests[0]!.system).toContain("对谁说、想让对方做什么");
    expect(requests[1]!.system).toContain("每场写清人物目标、阻碍与结果");
    expect(requests[1]!.system).toContain("镜头意图写关键画面组的叙事目的");
    expect(requests[2]!.system).toContain("把行动、触发它的台词和可见反应按原文顺序落到镜头");
    expect(requests[2]!.system).toContain("不改写剧本原话");

    const review = buildStageReviewMessages("scriptDraft", {
      chapterTitle: "测试章",
      chapterText: common.sourceText,
      strictDaojieAdaptation: true,
    });
    expect(review.system).not.toContain("## 人物目标、对白目的与可见反应");
  });

  it("人物表达方法只进入有真实原文的严格道劫请求", () => {
    const strict = buildStageMessages("scriptDraft", {
      strictDaojieAdaptation: true,
      chapterTitle: "测试章",
      chapterText: "原文",
    });
    const generic = buildStageMessages("scriptDraft", {
      strictDaojieAdaptation: false,
      chapterTitle: "原创章",
      chapterText: "原创输入",
    });
    const blankSource = buildStageMessages("scriptDraft", {
      strictDaojieAdaptation: true,
      chapterTitle: "空原文",
      chapterText: "  ",
    });

    expect(strict.system).toContain("角色眼下要达到什么具体目的");
    expect(generic.system).not.toContain("角色眼下要达到什么具体目的");
    expect(blankSource.system).not.toContain("角色眼下要达到什么具体目的");
    expect(buildDirectorPlanMessages({ episodeId: "c1", scriptText: "剧本", sourceText: "原文", strictDaojieAdaptation: false }).system)
      .not.toContain("## 人物目标、对白目的与可见反应");
    expect(buildStoryboardTableMessages({ episodeId: "c1", scriptText: "剧本", sourceText: "原文", strictDaojieAdaptation: false }).system)
      .not.toContain("## 人物目标、对白目的与可见反应");
  });

  it("仅有真实原文的道劫审核在通用指标之后解释 D5 转译例外", () => {
    const common = { chapterTitle: "章", chapterText: "他逃亡十年。", selfCheckMetrics: "SELF-CHECK" };
    const strict = buildStageReviewMessages("scriptDraft", { ...common, strictDaojieAdaptation: true });
    expect(strict.user).toContain("## 道劫 D5 叙述转译审核注记");
    expect(strict.user.indexOf("## 道劫 D5")).toBeGreaterThan(strict.user.indexOf("SELF-CHECK"));
    expect(strict.user).toContain("4.6");
    expect(strict.user).toContain("本次单集时长上限195秒，允许短于目标");
    expect(strict.user).toContain("OS 不自动获得转译旁白例外");
    expect(strict.user).toContain("普通对白、无原文依据的 OS 仍按 4 字/秒");
    expect(strict.user).toContain("不得仅凭通用自检数值判违规");
    expect(strict.system).toContain("本次单集时长上限195秒，允许短于目标");
    expect(strict.system).toContain("以此覆盖通用参考时长±10秒判定");
    expect(strict.system.indexOf("## 道劫 D5")).toBeGreaterThan(strict.system.lastIndexOf("±10 秒"));
    expect(strict.system).toContain("OS 不自动获得转译旁白例外");
    expect(buildStageReviewMessages("scriptDraft", common).user).not.toContain("## 道劫 D5");
    expect(buildStageReviewMessages("scriptDraft", common).system).not.toContain("## 道劫 D5");
    expect(buildStageReviewMessages("scriptDraft", { ...common, chapterText: " ", strictDaojieAdaptation: true }).user).not.toContain("## 道劫 D5");
    expect(buildStageReviewMessages("scriptDraft", { ...common, chapterText: " ", strictDaojieAdaptation: true }).system).not.toContain("## 道劫 D5");
  });

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

  it("directorContext 原样推入(R2/G12)：题材剧本规则节自带标题,不再包「导演手法参考」,无视觉手册节", () => {
    const m = buildStageMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文",
      directorContext: "## 题材剧本规则（道劫·水墨国风修仙）\n旁白腔与三色灵气语汇正文",
    });
    expect(m.user).toContain("## 题材剧本规则（道劫·水墨国风修仙）");
    expect(m.user).toContain("旁白腔与三色灵气语汇正文");
    expect(m.user).not.toContain("导演手法参考");
    expect(m.user).not.toContain("# 视觉手册");

    const none = buildStageMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文",
    });
    expect(none.user).not.toContain("导演手法参考");
    expect(none.user).not.toContain("# 视觉手册");
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

  it("selfCheckMetrics 注入(R4/父 I5)：带指标 → user 在剧本主体后附自检指标节；不带 → 不含", () => {
    const withMetrics = buildStageReviewMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文",
      scriptDraft: "剧本C",
      selfCheckMetrics: "## 自检指标（代码计算，以此为准）\n- 场秒合计：30s（目标 120s，允许 ±10s）",
    });
    expect(withMetrics.user).toContain("## 自检指标（代码计算，以此为准）");
    expect(withMetrics.user).toContain("场秒合计：30s");
    // 锚存在性:indexOf 落空返回 -1 会使 toBeGreaterThan(-1) 恒真——先锁锚串确实存在
    expect(withMetrics.user).toContain("剧本（审核主体）");
    expect(withMetrics.user.indexOf("## 自检指标（代码计算，以此为准）")).toBeGreaterThan(
      withMetrics.user.indexOf("剧本（审核主体）"),
    );

    const withoutMetrics = buildStageReviewMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文",
      scriptDraft: "剧本C",
    });
    expect(withoutMetrics.user).not.toContain("## 自检指标（代码计算，以此为准）");
  });

  it("directorNarrative 注入(G33)：题材剧本规则节位于审核主体之后、自检指标之前;缺省不注入", () => {
    const withNarrative = buildStageReviewMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文",
      scriptDraft: "剧本C",
      directorNarrative: "## 题材剧本规则（道劫·水墨国风修仙）\n旁白腔与三色灵气语汇正文",
      selfCheckMetrics: "## 自检指标（代码计算，以此为准）\n- 场秒合计：30s",
    });
    expect(withNarrative.user).toContain("## 题材剧本规则（道劫·水墨国风修仙）");
    expect(withNarrative.user).toContain("旁白腔与三色灵气语汇正文");
    // 次序:审核主体 < 题材剧本规则节 < 自检指标(锚存在性先行,防 indexOf 落空假绿)
    expect(withNarrative.user).toContain("剧本（审核主体）");
    expect(withNarrative.user.indexOf("## 题材剧本规则（道劫·水墨国风修仙）")).toBeGreaterThan(
      withNarrative.user.indexOf("剧本（审核主体）"),
    );
    expect(withNarrative.user.indexOf("## 题材剧本规则（道劫·水墨国风修仙）")).toBeLessThan(
      withNarrative.user.indexOf("## 自检指标（代码计算，以此为准）"),
    );

    const withoutNarrative = buildStageReviewMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文",
      scriptDraft: "剧本C",
    });
    expect(withoutNarrative.user).not.toContain("## 题材剧本规则");
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
  it("三态判定(R1/G8 修订语义)：有原文非修订=小说改编 / 无原文=原创 / 带审核反馈修订=定稿", () => {
    expect(determineChapterMode({ sourceText: "晏燎雨夜入城。" }, false)).toBe("novel_adaptation");
    expect(determineChapterMode({ sourceText: "   \n " }, false)).toBe("original");
    expect(determineChapterMode({}, false)).toBe("original");
    expect(determineChapterMode({ sourceText: "晏燎雨夜入城。" }, true)).toBe("finalized");
    // 四象限第四角(F5 用户裁定 10-12):修订优先于判空——原创章带审核反馈同样判定稿
    // (手册判定表「按审核意见修订→不注入」无章型限定;原创内容随【上一版剧本】注入修订)
    expect(determineChapterMode({}, true)).toBe("finalized");
    expect(determineChapterMode({ sourceText: "   \n " }, true)).toBe("finalized");
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
      reviewFeedback: "🔴 台词超长，需修订",
    });
    expect(finalized.system).not.toContain("剧本改编方法：小说转短剧的取舍思考");
    expect(finalized.system).not.toContain("故事开发方法：单集定位与结构思考");

    // R1/G8:有原文+已有剧本+无审核反馈(普通重生成)→ 仍判小说改编,注入改编方法文档
    const regenerate = buildStageMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "晏燎雨夜入城。",
      scriptDraft: "# 已有定稿剧本",
    });
    expect(regenerate.system).toContain("剧本改编方法：小说转短剧的取舍思考");
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
    // R1/父 I4:修订态标注——第二参语义=「是否带审核反馈修订」
    expect(describeChapterModeAnnotation({ sourceText: "晏燎雨夜入城。" }, true)).toBe(
      "本章判定：修订模式 → 按审核意见修订，未注入方法文档",
    );
  });
});

describe("isReviewFresh 审核时效（F3）", () => {
  it("审核晚于最新剧本才新鲜；早于/同刻/条目缺失/createdAt 非数均不新鲜", () => {
    expect(isReviewFresh({ createdAt: 200 }, { createdAt: 100 })).toBe(true);
    // 重新生成剧本后,针对上一版的旧审核不新鲜
    expect(isReviewFresh({ createdAt: 100 }, { createdAt: 200 })).toBe(false);
    // 同刻不算严格晚于——保守判不新鲜
    expect(isReviewFresh({ createdAt: 100 }, { createdAt: 100 })).toBe(false);
    // 任一条目缺失 → 无法证明审核针对当前版本
    expect(isReviewFresh(undefined, { createdAt: 100 })).toBe(false);
    expect(isReviewFresh({ createdAt: 200 }, undefined)).toBe(false);
    // createdAt 非数(脏数据)不新鲜
    expect(isReviewFresh({ createdAt: 200 }, {})).toBe(false);
    expect(isReviewFresh({}, { createdAt: 100 })).toBe(false);
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

// G3(批3 RED,裁定⑤ 10-14,10-13-audit4-gen-chain):isReviewFresh 版本比对优先——
// 审核条目带 reviewTarget 指纹(被审剧本条目 id+updatedAt)时按版本比对;无指纹回落
// createdAt 时间比较(script-planning.ts:121-129 现实现=纯时间比较,存量行为逐位不变)。
// 场景钉板:审核 v1(w1/100)流式期间保存 v2(w2/150),审核完成落库 createdAt=200——
// 现实现 200>150 误判「针对当前版本」;G3 要求 v2 判「未审」。
// 注:入参以 as never 过宽——现签名只收 { createdAt? },G3 需条目 id/updatedAt/reviewTarget。
describe("isReviewFresh 版本比对(G3·裁定⑤)", () => {
  it("指纹 entryId 不匹配 → 不新鲜(v2 判未审),即便审核 createdAt 晚于剧本", () => {
    const review = {
      data: "🔴 台词超长",
      createdAt: 200,
      reviewTarget: { entryId: "w1", updatedAt: 100 },
    } as never;
    const v2 = { id: "w2", data: "# v2 剧本", createdAt: 150, updatedAt: 150 } as never;
    expect(isReviewFresh(review, v2)).toBe(false);
    // 共享判定收口:hasFreshReviewIssues 同步判 false(reviseMode/修订注入/旗标三处共用)
    expect(hasFreshReviewIssues(review, v2)).toBe(false);
  });

  it("指纹 updatedAt 不匹配(同条目被改) → 不新鲜", () => {
    const review = {
      data: "🔴",
      createdAt: 200,
      reviewTarget: { entryId: "w1", updatedAt: 100 },
    } as never;
    const edited = { id: "w1", data: "# v1 被改", createdAt: 100, updatedAt: 150 } as never;
    expect(isReviewFresh(review, edited)).toBe(false);
  });

  it("指纹齐备且相等 → 新鲜(版本比对优先于 createdAt 先后)", () => {
    const review = {
      data: "🔴",
      createdAt: 200,
      reviewTarget: { entryId: "w1", updatedAt: 100 },
    } as never;
    const v1 = { id: "w1", data: "# v1", createdAt: 100, updatedAt: 100 } as never;
    expect(isReviewFresh(review, v1)).toBe(true);
  });

  it("旧数据无 reviewTarget 指纹 → 回落 createdAt 时间比较(存量行为逐位不变)", () => {
    expect(
      isReviewFresh({ createdAt: 200 } as never, { id: "w1", createdAt: 100, updatedAt: 100 } as never),
    ).toBe(true);
    expect(
      isReviewFresh({ createdAt: 100 } as never, { id: "w2", createdAt: 150, updatedAt: 150 } as never),
    ).toBe(false);
  });
});

// H9 rider2(RED):剧本手册自查清单「资产包」残称——现值 rg 钉在
// frontend/assets/studio-manuals/script_execution_script.md:341-342
// (`- [ ] 角色外貌描写符合资产包（如已注入）`/`- [ ] 场景描写符合资产包（如已注入）`);
// 该链路的注入真源早已是【原著圣经】(source-bible.ts:81,审核手册 script_agent_supervision.md:127
// 同用【原著圣经】称谓)。锁新值=改写为【原著圣经】称谓;正向断言防以删行凑绿。
describe("script_execution_script 手册残称(H9 rider2)", () => {
  const manual = readFileSync(
    join(process.cwd(), "frontend/assets/studio-manuals/script_execution_script.md"),
    "utf8",
  );

  it("自查清单不残留旧「资产包」称谓;角色/场景项对齐现注入真源【原著圣经】", () => {
    expect(manual).not.toContain("资产包");
    expect(manual).toContain("- [ ] 角色外貌描写符合【原著圣经】（如已注入）");
    expect(manual).toContain("- [ ] 场景描写符合【原著圣经】（如已注入）");
  });
});
