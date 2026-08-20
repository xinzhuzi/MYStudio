import { describe, expect, it } from "vitest";
import { buildLyricMessages, parseLyricsDraft, targetLineCount, recommendedStructure } from "./song-lyrics";

describe("song-lyrics(一键成曲·LLM 写词)", () => {
  it("目标行数按中速校准(秒÷4.3)", () => {
    expect(targetLineCount(43)).toBe(10);
    expect(targetLineCount(200)).toBe(47);
    expect(targetLineCount(10)).toBe(4); // 下限保护
  });

  it("结构模板按时长分档", () => {
    expect(recommendedStructure(30)).not.toContain("Bridge");
    expect(recommendedStructure(150)).toContain("Bridge");
    expect(recommendedStructure(200)).toContain("[Chorus]×2");
  });

  it("消息组装:行数硬约束+参考材料+风格气质+标签契约", () => {
    const { system, user } = buildLyricMessages({
      theme: "《道劫》片头曲:少年血仇逆天",
      reference: "晏燎,剑修;劫气仅用于天劫语境",
      styleLabel: "国风·烟雨行舟系(女声空灵/笛筝主线/中速)",
      targetSeconds: 200,
    });
    expect(system).toContain("[Intro] [Verse] [Chorus] [Bridge] [Outro]");
    expect(system).toContain("独占一行");
    expect(system).toContain("烟雨行舟");
    expect(user).toContain("晏燎");
    expect(user).toContain("42 ~ 52 行"); // 200s → 47±10%
    expect(user).toContain("第一约束");
  });

  it("解析:剥围栏与前后解说,保留标签段", () => {
    const raw = "好的,以下是歌词:\n```\n[Intro]\n长夜未央\n\n[Verse]\n灵气竭\n```\n希望你喜欢。";
    const parsed = parseLyricsDraft(raw, 10);
    expect(parsed.lyrics).toContain("[Intro]");
    expect(parsed.lyrics).toContain("长夜未央");
    expect(parsed.lyrics).not.toContain("好的");
    expect(parsed.lyrics).not.toContain("```");
    expect(parsed.warnings).toHaveLength(0);
  });

  it("校验:无标签告警+行数偏差告警+非标标签告警", () => {
    const noTag = parseLyricsDraft("只有唱词没有标签", 10);
    expect(noTag.warnings.join()).toContain("段落标签");
    const tooShort = parseLyricsDraft("[Verse]\n一行", 200);
    expect(tooShort.warnings.join()).toContain("偏差");
    const badTag = parseLyricsDraft("[PreChorus]\n[Verse]\n词", 10);
    expect(badTag.warnings.join()).toContain("非标准标签");
  });
});
