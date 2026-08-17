import { describe, expect, it } from "vitest";
import {
  buildSourceBibleMessages,
  formatSourceBibleContext,
  parseBibleCharacters,
  parseSourceBibleDraft,
  sampleChaptersForBible,
  validateCharactersAgainstBible,
  SOURCE_BIBLE_MAX_CHARS,
  SOURCE_BIBLE_TEMPLATE,
} from "./source-bible";
import type { NovelChapter } from "@/types/studio";

function chapterOf(index: number, chars: number): NovelChapter {
  return {
    id: `c${index}`,
    index,
    volume: "正文卷",
    title: `第${index}章`,
    sourceText: "测".repeat(chars),
    importedAt: 0,
  };
}

describe("formatSourceBibleContext", () => {
  it("wraps the bible with the priority header and strips its own H1", () => {
    const wrapped = formatSourceBibleContext(
      "# 原著圣经\n\n## 一句话主线\n主角复仇\n\n## 主要人物\n- 林逸：主角",
    );
    expect(wrapped.startsWith("# 原著圣经（最高优先级")).toBe(true);
    expect(wrapped).toContain("人物一律用此表规范名");
    expect(wrapped).toContain("## 一句话主线");
    expect(wrapped).not.toMatch(/^# 原著圣经\n/);
    expect(wrapped).not.toContain("# 原著圣经\n\n## 一句话主线");
  });

  it("returns empty string for blank input (empty bible = zero injection)", () => {
    expect(formatSourceBibleContext("")).toBe("");
    expect(formatSourceBibleContext("   \n  ")).toBe("");
  });

  it("keeps the template within the hard cap", () => {
    expect(SOURCE_BIBLE_TEMPLATE.length).toBeLessThanOrEqual(SOURCE_BIBLE_MAX_CHARS);
    expect(SOURCE_BIBLE_MAX_CHARS).toBe(4000);
  });

  it("template contains the five required sections", () => {
    for (const section of ["一句话主线", "题材与基调", "主要人物", "世界观铁律", "改编红线"]) {
      expect(SOURCE_BIBLE_TEMPLATE).toContain(`## ${section}`);
    }
  });
});

describe("sampleChaptersForBible", () => {
  it("returns empty for no chapters", () => {
    expect(sampleChaptersForBible([])).toEqual([]);
  });

  it("keeps every chapter when total is under budget", () => {
    const sampled = sampleChaptersForBible([chapterOf(1, 100), chapterOf(2, 100)]);
    expect(sampled).toHaveLength(2);
    expect(sampled[0].excerpt).toBe("测".repeat(100));
  });

  it("always includes the first two and last two chapters for big books", () => {
    const chapters = Array.from({ length: 200 }, (_, i) => chapterOf(i + 1, 3000));
    const sampled = sampleChaptersForBible(chapters);
    const indices = sampled.map((item) => item.index);
    expect(indices[0]).toBe(1);
    expect(indices[1]).toBe(2);
    expect(indices).toContain(199);
    expect(indices).toContain(200);
    const totalChars = sampled.reduce((sum, item) => sum + item.excerpt.length, 0);
    expect(totalChars).toBeLessThanOrEqual(24000 + 200 * "…（截断）".length);
  });

  it("truncates per-chapter excerpts", () => {
    const sampled = sampleChaptersForBible(
      [chapterOf(1, 5000)],
      { perChapterChars: 1000 },
    );
    expect(sampled[0].excerpt.startsWith("测".repeat(1000))).toBe(true);
    expect(sampled[0].excerpt).toContain("（截断）");
  });
});

describe("buildSourceBibleMessages", () => {
  it("includes book name, genre and sampled chapters", () => {
    const { system, user } = buildSourceBibleMessages({
      projectName: "测试书",
      genre: "都市修仙",
      sampledChapters: [{ index: 1, title: "第1章", excerpt: "正文" }],
    });
    expect(system).toContain("# 原著圣经生成指令");
    expect(system).toContain(String(SOURCE_BIBLE_MAX_CHARS));
    expect(user).toContain("测试书");
    expect(user).toContain("都市修仙");
    expect(user).toContain("### 第1章");
  });
});

describe("parseSourceBibleDraft", () => {
  const validDraft = [
    "# 原著圣经",
    "## 一句话主线",
    "主线内容",
    "## 题材与基调",
    "题材内容",
    "## 主要人物",
    "- 林逸（小逸）：主角",
    "## 世界观铁律",
    "设定内容",
    "## 改编红线",
    "红线内容",
  ].join("\n");

  it("accepts a draft with all five sections and strips think/fences", () => {
    const text = parseSourceBibleDraft(`<think>推理</think>\n\`\`\`markdown\n${validDraft}\n\`\`\``);
    expect(text.startsWith("# 原著圣经")).toBe(true);
    expect(text).not.toContain("<think>");
    expect(text).not.toContain("```");
  });

  it("rejects drafts missing required sections with the missing list", () => {
    expect(() => parseSourceBibleDraft("# 原著圣经\n## 一句话主线\n只有一段"))
      .toThrow("题材与基调、主要人物、世界观铁律、改编红线");
    expect(() => parseSourceBibleDraft("# 原著圣经\n## 一句话主线\nx"))
      .toThrow(/题材与基调|主要人物|世界观铁律|改编红线/);
  });

  it("rejects oversized drafts", () => {
    const oversized = `${validDraft}\n${"注".repeat(SOURCE_BIBLE_MAX_CHARS)}`;
    expect(() => parseSourceBibleDraft(oversized)).toThrow(/超过/);
  });
});

describe("parseBibleCharacters", () => {
  it("parses canonical names and aliases from the character section only", () => {
    const characters = parseBibleCharacters(
      [
        "# 原著圣经",
        "## 一句话主线",
        "主线",
        "## 主要人物",
        "- 林逸（小逸、逸哥）：主角，魔术师转修仙",
        "- 白有容：女主，宗门圣女",
        "* 苏晚卿（晚卿）：师姐",
        "- 无冒号行应被忽略",
        "## 世界观铁律",
        "- 不是人物：这行不在人物段",
      ].join("\n"),
    );
    expect(characters).toEqual([
      { name: "林逸", aliases: ["小逸", "逸哥"] },
      { name: "白有容", aliases: [] },
      { name: "苏晚卿", aliases: ["晚卿"] },
    ]);
  });

  it("returns empty when the section is missing", () => {
    expect(parseBibleCharacters("# 原著圣经\n## 一句话主线\n主线")).toEqual([]);
  });
});

describe("validateCharactersAgainstBible", () => {
  const bibleCharacters = parseBibleCharacters(
    "## 主要人物\n- 林逸（小逸、逸哥）：主角\n- 白有容：女主",
  );

  it("flags names missing from both canonical names and aliases", () => {
    expect(
      validateCharactersAgainstBible(["林逸", "小逸", "神秘老者"], bibleCharacters),
    ).toEqual(["神秘老者"]);
  });

  it("returns empty when every name is registered", () => {
    expect(
      validateCharactersAgainstBible(["林逸", "逸哥", "白有容"], bibleCharacters),
    ).toEqual([]);
  });

  it("skips validation entirely when the bible has no character table (zero false positives)", () => {
    expect(validateCharactersAgainstBible(["谁都可以"], [])).toEqual([]);
  });
});
