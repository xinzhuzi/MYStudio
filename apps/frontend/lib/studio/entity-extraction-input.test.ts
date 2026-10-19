import { describe, expect, it, vi } from "vitest";
import {
  chapterIdFromNumber,
  dramaRelativePathForChapter,
  resolveExtractionChapterInput,
  type ReadDramaFile,
} from "./entity-extraction-input";

const okRead = vi.fn<ReadDramaFile>().mockResolvedValue({
  success: true,
  text: "【1】道口镇\n人物:陈九、老瞎子",
});

function makeReader(result: Awaited<ReturnType<ReadDramaFile>>): ReadDramaFile {
  return vi.fn<ReadDramaFile>().mockResolvedValue(result);
}

describe("entity-extraction-input · drama 路径构造(design §2 / AC1)", () => {
  it("补零规则同 createChapterId:3 位起步,≥1000 自然四位", () => {
    expect(chapterIdFromNumber(1)).toBe("chapter-001");
    expect(chapterIdFromNumber(2)).toBe("chapter-002");
    expect(chapterIdFromNumber(999)).toBe("chapter-999");
    // 盘上实证(research:chapter-1816/chapter-4125 四位、chapter-999 三位)
    expect(chapterIdFromNumber(1000)).toBe("chapter-1000");
    expect(chapterIdFromNumber(1816)).toBe("chapter-1816");
    expect(chapterIdFromNumber(4125)).toBe("chapter-4125");
  });

  it("drama 相对路径 = novel/drama/chapter-NNN_漫剧.md", () => {
    expect(dramaRelativePathForChapter(2)).toBe("novel/drama/chapter-002_漫剧.md");
    expect(dramaRelativePathForChapter(4125)).toBe("novel/drama/chapter-4125_漫剧.md");
  });
});

describe("entity-extraction-input · 输入源优先级(D1/D22:scriptDraft > drama > no_input)", () => {
  it("有 scriptDraft → 直接用草稿,不读 drama 文件", async () => {
    const read = vi.fn<ReadDramaFile>();
    const result = await resolveExtractionChapterInput({
      chapterNumber: 3,
      scriptDraft: "草稿正文",
      readDramaFile: read,
    });
    expect(result).toEqual({ status: "ok", source: "scriptDraft", text: "草稿正文" });
    expect(read).not.toHaveBeenCalled();
  });

  it("无草稿 → 读 drama 文件成功(未截断)→ source=drama", async () => {
    const result = await resolveExtractionChapterInput({
      chapterNumber: 3,
      scriptDraft: "   ",
      readDramaFile: okRead,
    });
    expect(result).toEqual({
      status: "ok",
      source: "drama",
      text: "【1】道口镇\n人物:陈九、老瞎子",
    });
    expect(okRead).toHaveBeenCalledWith("novel/drama/chapter-003_漫剧.md");
  });

  it("drama readText 返回 truncated=true → 判失败 input_truncated(不静默用半文)", async () => {
    const result = await resolveExtractionChapterInput({
      chapterNumber: 92,
      scriptDraft: null,
      readDramaFile: makeReader({ success: true, text: "前 256KB…", truncated: true }),
    });
    expect(result).toEqual({ status: "input_truncated" });
  });

  it("草稿空 + drama 读失败(文件不存在)→ no_input(D22:不回落小说原文)", async () => {
    const result = await resolveExtractionChapterInput({
      chapterNumber: 5,
      scriptDraft: undefined,
      readDramaFile: makeReader({ success: false, error: "ENOENT" }),
    });
    // D1/D22 统一口径:输入解析器根本没有小说 sourceText 参数——
    // 「不回落小说原文」由类型面锁死,而非运行时分支。
    expect(result).toEqual({ status: "no_input" });
  });

  it("drama 读成功但文本为空 → no_input(空剧本不可提取)", async () => {
    const result = await resolveExtractionChapterInput({
      chapterNumber: 6,
      scriptDraft: "",
      readDramaFile: makeReader({ success: true, text: "" }),
    });
    expect(result).toEqual({ status: "no_input" });
  });

  it("≥1000 章四位路径实锚:chapter-1000 的 drama 请求路径", async () => {
    const read = vi.fn<ReadDramaFile>().mockResolvedValue({
      success: true,
      text: "第 1000 章剧本",
    });
    await resolveExtractionChapterInput({ chapterNumber: 1000, scriptDraft: null, readDramaFile: read });
    expect(read).toHaveBeenCalledWith("novel/drama/chapter-1000_漫剧.md");
  });
});
