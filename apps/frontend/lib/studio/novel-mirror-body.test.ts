import { describe, expect, it } from "vitest";
import {
  novelChapterMirrorRelativePath,
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
