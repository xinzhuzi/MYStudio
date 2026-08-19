import { describe, expect, it } from "vitest";
import {
  buildNovelEventAnalysisMessages,
  formatNovelEventState,
  parseNovelEventAnalysisLine,
} from "./event-analysis";

describe("studio novel event analysis", () => {
  it("parses Toonflow event extraction rows into structured chapter data", () => {
    const parsed = parseNovelEventAnalysisLine(
      "| 第1章 职业危机与许愿 | 林逸、白有容 | 林逸因事业崩塌而许愿，意外触发魔法系统绑定 | 强（动机建立+系统激活） | 高 | 50秒 | 转折+悬疑 |",
      { sourceId: "source-001", revision: 4 },
    );

    expect(parsed).toEqual({
      chapterLabel: "第1章 职业危机与许愿",
      characters: ["林逸", "白有容"],
      coreEvent: "林逸因事业崩塌而许愿，意外触发魔法系统绑定",
      mainlineRelation: "强（动机建立+系统激活）",
      informationDensity: "高",
      estimatedDurationSec: 50,
      emotionTags: ["转折", "悬疑"],
      rawLine:
        "| 第1章 职业危机与许愿 | 林逸、白有容 | 林逸因事业崩塌而许愿，意外触发魔法系统绑定 | 强（动机建立+系统激活） | 高 | 50秒 | 转折+悬疑 |",
      sourceId: "source-001",
      revision: 4,
    });
  });

  it("builds Toonflow-style event extraction messages from one chapter", () => {
    const messages = buildNovelEventAnalysisMessages({
      id: "chapter-001",
      index: 1,
      volume: "正文卷",
      title: "第1章 雨夜",
      sourceText: "王离在雨夜进城，账房门后传出低声争执。",
      importedAt: 1710000000000,
    });

    expect(messages.system).toContain("事件提取指令");
    expect(messages.user).toContain("小说章节数：1");
    expect(messages.user).toContain("小说章节名称：第1章 雨夜");
    expect(messages.user).toContain("王离在雨夜进城");
  });

  it("injects the source bible block at the head of the user message when provided", () => {
    const chapter = {
      id: "chapter-001",
      index: 1,
      volume: "正文卷",
      title: "第1章 雨夜",
      sourceText: "王离在雨夜进城。",
      importedAt: 1710000000000,
    };
    const withBible = buildNovelEventAnalysisMessages(chapter, {
      bibleContext: "# 原著圣经（最高优先级·人物一律用此表规范名）\n\n## 一句话主线\n复仇主线",
    });
    expect(withBible.user.startsWith("# 原著圣经（最高优先级")).toBe(true);
    expect(withBible.user.indexOf("原著圣经")).toBeLessThan(withBible.user.indexOf("小说章节数"));
    expect(withBible.user).toContain("复仇主线");

    const withoutBible = buildNovelEventAnalysisMessages(chapter);
    expect(withoutBible.user.startsWith("请根据以下小说章节数")).toBe(true);
    expect(withoutBible.user).not.toContain("原著圣经");
  });

  it("只接受一个合并记忆块，不再追加独立 archiveContext", () => {
    const chapter = {
      id: "chapter-001",
      index: 1,
      volume: "正文卷",
      title: "第1章 雨夜",
      sourceText: "王离在雨夜进城。",
      importedAt: 1710000000000,
    };
    const messages = buildNovelEventAnalysisMessages(chapter, {
      bibleContext: "# 合并记忆块\n\n## 原著档案检索\n- 当前命中",
      archiveContext: "## 第二个档案块\n- 不应注入",
    } as never);

    expect(messages.user.match(/原著档案检索/g)).toHaveLength(1);
    expect(messages.user).not.toContain("第二个档案块");
  });

  it("rolls the previous chapter event line in ahead of the chapter info", () => {
    const chapter = {
      id: "chapter-002",
      index: 2,
      volume: "正文卷",
      title: "第2章 雨夜",
      sourceText: "王离在雨夜进城。",
      importedAt: 1710000000000,
    };
    const prevLine = "| 第1章 入城 | 王离 | 王离持信入城 | 强（主线启动） | 高 | 40秒 | 悬疑 |";
    const withPrev = buildNovelEventAnalysisMessages(chapter, { prevEventContext: prevLine });
    expect(withPrev.user).toContain(`上一章事件（衔接参考，保持人物称呼一致）：\n${prevLine}`);
    expect(withPrev.user.indexOf("上一章事件")).toBeLessThan(withPrev.user.indexOf("小说章节数"));

    const withoutPrev = buildNovelEventAnalysisMessages(chapter);
    expect(withoutPrev.user).not.toContain("上一章事件");
  });

  it("formats event state with 涉及角色 first line", () => {
    const state = formatNovelEventState({
      chapterLabel: "第1章",
      characters: ["独孤剑尘", "晏燎", "李先生"],
      coreEvent: "x",
      mainlineRelation: "强（传承启动）",
      informationDensity: "高",
      estimatedDurationSec: 60,
      emotionTags: ["冲突", "悬疑"],
      rawLine: "",
    });
    expect(state).toContain("涉及角色：独孤剑尘、晏燎、李先生");
    expect(state).toContain("主线关系：强（传承启动）");
    expect(state).toContain("预估集长：60秒");
  });
});
