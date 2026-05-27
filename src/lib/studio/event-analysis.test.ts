import { describe, expect, it } from "vitest";
import {
  buildNovelEventAnalysisMessages,
  parseNovelEventAnalysisLine,
} from "./event-analysis";

describe("studio novel event analysis", () => {
  it("parses Toonflow event extraction rows into structured chapter data", () => {
    const parsed = parseNovelEventAnalysisLine(
      "| 第1章 职业危机与许愿 | 林逸、白有容 | 林逸因事业崩塌而许愿，意外触发魔法系统绑定 | 强（动机建立+系统激活） | 高 | 50秒 | 转折+悬疑 |",
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
});
