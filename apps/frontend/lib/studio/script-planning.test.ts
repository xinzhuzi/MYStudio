import { describe, expect, it } from "vitest";
import { buildStageMessages, extractPartialContent, parseStageJson } from "./script-planning";

describe("studio script-planning 逐章编剧链（JSON）", () => {
  it("parseStageJson 取 JSON 的 content，支持代码围栏/前置文字，非法则回退原文", () => {
    expect(parseStageJson('{"content":"核心钩子：断剑复鸣"}')).toBe("核心钩子：断剑复鸣");
    expect(parseStageJson('```json\n{"content":"S01 内景"}\n```')).toBe("S01 内景");
    expect(parseStageJson('好的：\n{"content":"骨架A"}')).toBe("骨架A");
    expect(parseStageJson("纯文本无JSON")).toBe("纯文本无JSON");
  });

  it("骨架消息：skill+格式作 system，项目信息/本章正文/事件入 user", () => {
    const m = buildStageMessages("storySkeleton", {
      chapterTitle: "第1章 剑主夜访道口镇",
      chapterText: "独孤剑尘夜访道口镇。",
      eventState: "主线关系：强",
      manualContext: "## 项目信息\n视觉风格：日式3D渲染2D",
    });
    expect(m.user).toContain("独孤剑尘夜访道口镇");
    expect(m.user).toContain("主线关系：强");
    expect(m.user).toContain("视觉风格：日式3D渲染2D");
    expect(m.system).toContain('{"content"');
  });

  it("剧本消息串接骨架+改编+正文；审核消息含剧本", () => {
    const draft = buildStageMessages("scriptDraft", {
      chapterTitle: "第1章",
      chapterText: "正文内容",
      skeleton: "骨架A",
      strategy: "改编B",
    });
    expect(draft.user).toContain("骨架A");
    expect(draft.user).toContain("改编B");
    expect(draft.user).toContain("正文内容");

    const review = buildStageMessages("supervisionReport", {
      chapterTitle: "第1章",
      chapterText: "正文",
      skeleton: "骨架A",
      strategy: "改编B",
      scriptDraft: "剧本C",
    });
    expect(review.user).toContain("剧本C");
  });
});

describe("extractPartialContent 流式增量提取", () => {
  it("处理转义：\\n→换行、\\\"→引号、\\\\→反斜杠", () => {
    expect(extractPartialContent('{"content":"# 标题\\n正文\\"引\\"'))
      .toBe('# 标题\n正文"引"');
    expect(extractPartialContent('{"content":"路径 C:\\\\a'))
      .toBe("路径 C:\\a");
  });

  it("丢弃末尾不完整转义（悬挂反斜杠 / 不完整 \\u）", () => {
    expect(extractPartialContent('{"content":"abc\\')).toBe("abc");
    expect(extractPartialContent('{"content":"abc\\u4e')).toBe("abc");
    expect(extractPartialContent('{"content":"中\\u4e2d')).toBe("中中");
  });

  it("尚未出现 content 值时返回空；完成值正确截断", () => {
    expect(extractPartialContent('{"content":')).toBe("");
    expect(extractPartialContent("{\"con")).toBe("");
    expect(extractPartialContent('{"content":"done"}')).toBe("done");
  });

  it("非 JSON（模型直接返回正文）原样返回", () => {
    expect(extractPartialContent("# 直接 markdown")).toBe("# 直接 markdown");
  });
});
