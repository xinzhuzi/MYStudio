import { describe, expect, it } from "vitest";
import type { NovelChapter } from "@/types/studio";
import {
  buildNovelChapterMirror,
  mergeNovelChapterWithMirror,
  novelChapterMirrorRelativePath,
  parseNovelChapterMirror,
  parseNovelChapterMirrorBody,
} from "./novel";

/** 镜像格式与 buildNovelChapterMirror 逐段对称：`# 标题` + `> ` 元数据块 + 空行 + 正文。 */
const MIRROR = [
  "# 第2章：暮色灵猫结替身",
  "",
  "> 卷：第一卷",
  "> 源ID：chapter-002",
  "> 修订：1",
  "> 来源：2_暮色灵猫结替身.md",
  "",
  "# 第2章：暮色灵猫结替身",
  "",
  "金水河的风灯一盏盏亮起来。",
  "镇北塾馆的油灯要等天黑透才点。",
].join("\n");

describe("novelChapterMirrorRelativePath", () => {
  it("按 index 生成与镜像写出对称的项目根相对路径", () => {
    expect(novelChapterMirrorRelativePath(2)).toBe("novel/chapters/chapter-002.md");
    expect(novelChapterMirrorRelativePath(4125)).toBe("novel/chapters/chapter-4125.md");
  });
});

describe("parseNovelChapterMirrorBody", () => {
  it("剥离镜像头，正文含自带 `#` 行时保留", () => {
    const body = parseNovelChapterMirrorBody(MIRROR);
    expect(body).toContain("# 第2章：暮色灵猫结替身");
    expect(body).toContain("金水河的风灯一盏盏亮起来。");
    expect(body).not.toContain("> 卷：第一卷");
  });

  it("截断到事件分析段之前", () => {
    const withEvents = `${MIRROR}\n\n## 事件分析\n\n摘要：灵猫结替身。\n状态：\n- A`;
    const body = parseNovelChapterMirrorBody(withEvents);
    expect(body).toContain("镇北塾馆的油灯要等天黑透才点。");
    expect(body).not.toContain("## 事件分析");
    expect(body).not.toContain("摘要：灵猫结替身。");
  });

  it("元数据块结束后的正文不以空行开头（只吃镜像头后的单个空行）", () => {
    const body = parseNovelChapterMirrorBody(MIRROR);
    expect(body?.startsWith("#")).toBe(true);
  });

  it("无正文（只有镜像头）返回 null", () => {
    const headOnly = ["# 第3章", "", "> 卷：第一卷", "> 源ID：chapter-003", "> 修订：1", ""].join("\n");
    expect(parseNovelChapterMirrorBody(headOnly)).toBeNull();
  });

  it("事件分析紧随正文（无正文时）返回 null", () => {
    const eventsOnly = ["# 第4章", "", "> 卷：第一卷", "", "## 事件分析", "", "摘要：x"].join("\n");
    expect(parseNovelChapterMirrorBody(eventsOnly)).toBeNull();
  });

  it("CRLF 归一后解析一致", () => {
    const crlf = MIRROR.replace(/\n/g, "\r\n");
    expect(parseNovelChapterMirrorBody(crlf)).toBe(parseNovelChapterMirrorBody(MIRROR));
  });
});

/** 带修订号 2 与完整事件段的正文文件（与 buildNovelChapterMirror 输出格式逐段对称）。 */
const MIRROR_WITH_EVENTS = [
  "# 第2章：暮色灵猫结替身",
  "",
  "> 卷：第一卷",
  "> 源ID：chapter-002",
  "> 修订：2",
  "> 来源：2_暮色灵猫结替身.md",
  "",
  "金水河的风灯一盏盏亮起来。",
  "镇北塾馆的油灯要等天黑透才点。",
  "",
  "## 事件分析",
  "",
  "摘要：灵猫结替身。",
  "状态：",
  "- 主角潜入镇北塾馆",
  "- 灵猫灯下现形",
  "原始输出：模型说：灵猫夜行，塾馆灯灭。",
].join("\n");

/** 只有头与正文、无事件段的正文文件（修订号 2）。 */
const HEAD_BODY_ONLY = [
  "# 第2章：暮色灵猫结替身",
  "",
  "> 卷：第一卷",
  "> 源ID：chapter-002",
  "> 修订：2",
  "> 来源：2_暮色灵猫结替身.md",
  "",
  "金水河的风灯一盏盏亮起来。",
  "镇北塾馆的油灯要等天黑透才点。",
].join("\n");

const MIRROR_BODY = "金水河的风灯一盏盏亮起来。\n镇北塾馆的油灯要等天黑透才点。";
const MIRROR_EVENT_SUMMARY = "灵猫结替身。";
const MIRROR_EVENT_STATE = "- 主角潜入镇北塾馆\n- 灵猫灯下现形";
const MIRROR_EVENT_RAW_OUTPUT = "模型说：灵猫夜行，塾馆灯灭。";

function makeChapter(overrides: Partial<NovelChapter> = {}): NovelChapter {
  return {
    id: "chapter-002",
    index: 2,
    title: "第2章：暮色灵猫结替身",
    importedAt: 1000,
    ...overrides,
  };
}

describe("parseNovelChapterMirror", () => {
  it("完整正文文件（头 + 正文 + 事件段）解析出全部字段", () => {
    expect(parseNovelChapterMirror(MIRROR_WITH_EVENTS)).toEqual({
      title: "第2章：暮色灵猫结替身",
      volume: "第一卷",
      sourceId: "chapter-002",
      revision: 2,
      sourceName: "2_暮色灵猫结替身.md",
      sourceText: MIRROR_BODY,
      eventSummary: MIRROR_EVENT_SUMMARY,
      eventState: MIRROR_EVENT_STATE,
      eventRawOutput: MIRROR_EVENT_RAW_OUTPUT,
    });
  });

  it("正文自带的 `# ` 行保留在正文里", () => {
    const mirror = parseNovelChapterMirror(MIRROR);
    expect(mirror?.sourceText.startsWith("# 第2章：暮色灵猫结替身")).toBe(true);
    expect(mirror?.sourceText).toContain("金水河的风灯一盏盏亮起来。");
    expect(mirror?.sourceText).not.toContain("> 卷：");
  });

  it("只有头部没有正文 → sourceText 为空串而非 null", () => {
    const headOnly = ["# 第3章", "", "> 卷：第一卷", "> 源ID：chapter-003", "> 修订：1", ""].join("\n");
    const mirror = parseNovelChapterMirror(headOnly);
    expect(mirror).not.toBeNull();
    expect(mirror?.sourceText).toBe("");
    expect(mirror?.eventSummary).toBeUndefined();
    expect(mirror?.eventState).toBeUndefined();
    expect(mirror?.eventRawOutput).toBeUndefined();
  });

  it("首行不是 `# ` 标题 → null（含缺空格的井号行）", () => {
    expect(parseNovelChapterMirror("正文没有标题行。\n第二行。")).toBeNull();
    expect(parseNovelChapterMirror("#第2章：井号后没有空格")).toBeNull();
    expect(parseNovelChapterMirror("")).toBeNull();
  });

  // 与 novel_text_audit.mirror_head 逐条对齐(复核 medium):头部混入非标准 `> ` 行
  // (外部工具/手改)时跳过该行继续收其后标准字段,不得 break 丢字段;
  // 非标准行本身不进正文。期望值 = Python mirror_head/mirror_body 对同一夹具的实跑输出。
  it("头部混入非标准 `> ` 行:跳过该行,其后标准字段照收(对齐 mirror_head)", () => {
    const markdown = [
      "# 第2章：暮色灵猫结替身",
      "",
      "> 卷：第一卷",
      "> 备注：外部工具批注行",
      "> 源ID：chapter-002",
      "> 修订：2",
      "> 来源：2_暮色灵猫结替身.md",
      "",
      "文件正文。",
      "",
      "## 事件分析",
      "",
      "摘要：灵猫替身被识破。",
    ].join("\n");
    expect(parseNovelChapterMirror(markdown)).toEqual({
      title: "第2章：暮色灵猫结替身",
      volume: "第一卷",
      sourceId: "chapter-002",
      revision: 2,
      sourceName: "2_暮色灵猫结替身.md",
      sourceText: "文件正文。",
      eventSummary: "灵猫替身被识破。",
    });
  });

  it("首条元数据前就有非标准 `> ` 行:同样跳过,后续字段照收", () => {
    const markdown = [
      "# 第2章：暮色灵猫结替身",
      "",
      "> 备注：外部工具批注行",
      "> 卷：第一卷",
      "> 源ID：chapter-002",
      "> 修订：2",
      "> 来源：2_暮色灵猫结替身.md",
      "",
      "文件正文。",
    ].join("\n");
    expect(parseNovelChapterMirror(markdown)).toMatchObject({
      volume: "第一卷",
      sourceId: "chapter-002",
      revision: 2,
      sourceName: "2_暮色灵猫结替身.md",
      sourceText: "文件正文。",
    });
  });

  it("CRLF 与 LF 解析结果相同", () => {
    const lf = parseNovelChapterMirror(MIRROR_WITH_EVENTS);
    const crlf = parseNovelChapterMirror(MIRROR_WITH_EVENTS.replace(/\n/g, "\r\n"));
    expect(crlf).toEqual(lf);
  });
});

describe("mergeNovelChapterWithMirror", () => {
  it("file-wins：轻条目无正文 → 正文/修订号/标题/卷/来源名全取文件，changedFields 含 sourceText 与 revision", () => {
    const mirror = parseNovelChapterMirror(MIRROR_WITH_EVENTS)!;
    const entry = makeChapter({
      revision: 1,
      title: "旧标题",
      volume: "旧卷",
      sourceId: "chapter-002",
      sourceName: "旧来源.txt",
    });
    const result = mergeNovelChapterWithMirror(entry, mirror, "file-wins");
    expect(result.changed).toBe(true);
    expect(result.chapter.sourceText).toBe(mirror.sourceText);
    expect(result.chapter.revision).toBe(2);
    expect(result.chapter.title).toBe(mirror.title);
    expect(result.chapter.volume).toBe(mirror.volume);
    expect(result.chapter.sourceName).toBe(mirror.sourceName);
    expect(result.changedFields).toEqual(expect.arrayContaining(["sourceText", "revision"]));
  });

  it("file-wins：条目有正文、文件修订号更新且正文不同 → 取文件正文", () => {
    const mirror = parseNovelChapterMirror(MIRROR_WITH_EVENTS)!;
    const entry = makeChapter({ revision: 1, sourceText: "库内旧正文，与文件不同。" });
    const result = mergeNovelChapterWithMirror(entry, mirror, "file-wins");
    expect(result.changed).toBe(true);
    expect(result.chapter.sourceText).toBe(mirror.sourceText);
    expect(result.changedFields).toContain("sourceText");
  });

  it("file-wins：库内修订号严格大于文件（App 刚保存）→ 全部保留条目，changed 为 false", () => {
    const mirror = parseNovelChapterMirror(HEAD_BODY_ONLY)!;
    const entry = makeChapter({
      revision: 3,
      title: "库内标题",
      volume: "库内卷",
      sourceId: "chapter-002",
      sourceName: "库内来源.md",
      sourceText: "库内较新正文。",
    });
    const result = mergeNovelChapterWithMirror(entry, mirror, "file-wins");
    expect(result.changed).toBe(false);
    expect(result.chapter).toBe(entry);
    expect(result.changedFields).toEqual([]);
  });

  it("file-wins：修订号相同、正文不同 → 取文件正文", () => {
    const mirror = parseNovelChapterMirror(HEAD_BODY_ONLY)!;
    const entry = makeChapter({ revision: 2, sourceText: "库内另一版正文。" });
    const result = mergeNovelChapterWithMirror(entry, mirror, "file-wins");
    expect(result.changed).toBe(true);
    expect(result.chapter.sourceText).toBe(mirror.sourceText);
    expect(result.changedFields).toContain("sourceText");
    expect(result.changedFields).not.toContain("revision");
  });

  it("file-wins：事件字段只补库内缺失，不覆盖库内已有", () => {
    const mirror = parseNovelChapterMirror(MIRROR_WITH_EVENTS)!;
    // 条目与文件正文/元数据全同、只缺事件 → 三个事件字段补上
    const sparse = makeChapter({
      revision: 2,
      volume: "第一卷",
      sourceId: "chapter-002",
      sourceName: "2_暮色灵猫结替身.md",
      sourceText: MIRROR_BODY,
    });
    const filled = mergeNovelChapterWithMirror(sparse, mirror, "file-wins");
    expect(filled.changed).toBe(true);
    expect(filled.chapter.eventSummary).toBe(MIRROR_EVENT_SUMMARY);
    expect(filled.chapter.eventState).toBe(MIRROR_EVENT_STATE);
    expect(filled.chapter.eventRawOutput).toBe(MIRROR_EVENT_RAW_OUTPUT);
    expect(filled.changedFields).toEqual(
      expect.arrayContaining(["eventSummary", "eventState", "eventRawOutput"]),
    );
    // 条目已有事件字段（与文件不同）→ 保留条目值
    const rich = makeChapter({
      revision: 2,
      volume: "第一卷",
      sourceId: "chapter-002",
      sourceName: "2_暮色灵猫结替身.md",
      sourceText: MIRROR_BODY,
      eventSummary: "库内摘要。",
      eventState: "库内状态",
      eventRawOutput: "库内原始输出。",
    });
    const kept = mergeNovelChapterWithMirror(rich, mirror, "file-wins");
    expect(kept.changed).toBe(false);
    expect(kept.chapter).toBe(rich);
    expect(kept.chapter.eventSummary).toBe("库内摘要。");
    expect(kept.chapter.eventState).toBe("库内状态");
    expect(kept.chapter.eventRawOutput).toBe("库内原始输出。");
  });

  it("fill-missing-events：条目有正文无事件、文件有事件且修订号不同 → 只补事件", () => {
    const mirror = parseNovelChapterMirror(MIRROR_WITH_EVENTS)!;
    const entry = makeChapter({
      revision: 5,
      title: "库内标题",
      volume: "库内卷",
      sourceText: "库内正文自有主张。",
    });
    const result = mergeNovelChapterWithMirror(entry, mirror, "fill-missing-events");
    expect(result.changed).toBe(true);
    expect(result.chapter.sourceText).toBe("库内正文自有主张。");
    expect(result.chapter.title).toBe("库内标题");
    expect(result.chapter.volume).toBe("库内卷");
    expect(result.chapter.revision).toBe(5);
    expect(result.chapter.eventSummary).toBe(MIRROR_EVENT_SUMMARY);
    expect(result.chapter.eventState).toBe(MIRROR_EVENT_STATE);
    expect(result.chapter.eventRawOutput).toBe(MIRROR_EVENT_RAW_OUTPUT);
    expect(result.changedFields).toContain("eventSummary");
    expect(result.changedFields).not.toContain("sourceText");
    expect(result.changedFields).not.toContain("revision");
    expect(result.changedFields).not.toContain("title");
  });

  it("无变化时返回同一个对象引用，changed 为 false", () => {
    const mirror = parseNovelChapterMirror(HEAD_BODY_ONLY)!;
    const entry = makeChapter({
      revision: 2,
      volume: "第一卷",
      sourceId: "chapter-002",
      sourceName: "2_暮色灵猫结替身.md",
      sourceText: MIRROR_BODY,
    });
    const result = mergeNovelChapterWithMirror(entry, mirror, "file-wins");
    expect(result.changed).toBe(false);
    expect(result.chapter).toBe(entry);
    expect(result.changedFields).toEqual([]);
  });
});

describe("buildNovelChapterMirror ↔ parseNovelChapterMirror 往返", () => {
  it("content 经解析后 sourceText 与三个事件字段等于原条目", () => {
    const original = makeChapter({
      id: "chapter-007",
      index: 7,
      title: "第7章：往返验证",
      sourceId: "chapter-007",
      revision: 2,
      volume: "第二卷",
      sourceName: "7_往返.md",
      sourceText: "第一段正文。\n\n第二段正文。",
      eventSummary: "往返摘要。",
      eventState: "- 步骤一\n- 步骤二",
      eventRawOutput: "往返原始输出。",
    });
    const built = buildNovelChapterMirror("proj-1", original);
    const mirror = parseNovelChapterMirror(built.content)!;
    expect(mirror.sourceText).toBe(original.sourceText);
    expect(mirror.eventSummary).toBe(original.eventSummary);
    expect(mirror.eventState).toBe(original.eventState);
    expect(mirror.eventRawOutput).toBe(original.eventRawOutput);
    expect(mirror.title).toBe(original.title);
    expect(mirror.volume).toBe(original.volume);
    expect(mirror.sourceId).toBe(original.sourceId);
    expect(mirror.revision).toBe(original.revision);
    expect(mirror.sourceName).toBe(original.sourceName);
  });
});
