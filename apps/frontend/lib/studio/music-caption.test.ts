import { describe, expect, it } from "vitest";
import { buildStructuredCaption, planInstrumentalFill, MUSIC_STYLE_RECIPES } from "./music-caption";

describe("music-caption(minimax/music 技能资产包)", () => {
  it("配方已注册且含参数占位符", () => {
    expect(MUSIC_STYLE_RECIPES.length).toBeGreaterThanOrEqual(1);
    expect(MUSIC_STYLE_RECIPES[0].template).toContain("{{BRIEF}}");
    expect(MUSIC_STYLE_RECIPES[0].template).toContain("78-84 BPM"); // 风格锁(中速)实证锚点
  });

  it("已是专业 caption → 原样放行", () => {
    const pro = "Global Metadata\nwhatever\nVocal Details\nx\nArrangement\ny";
    expect(buildStructuredCaption({ brief: pro, mode: "bgm" })).toBe(pro);
  });

  it("bgm 模式:用户意图注入 + 器乐主奏声明 + 间奏/尾奏指令", () => {
    const caption = buildStructuredCaption({ brief: "宁静的水墨江南夜色", mode: "bgm", targetSeconds: 60 });
    expect(caption).toContain("宁静的水墨江南夜色");
    expect(caption).toContain("fully instrumental (no lead vocals)");
    expect(caption).toContain("instrumental Interlude");
    expect(caption).toContain("solo Guzheng for about");
    expect(caption).not.toContain("{{"); // 占位符全部替换
    expect(caption).toContain("78-84 BPM"); // 风格锁不被用户意图冲掉
  });

  it("song 模式:按校准表计算器乐填充(lessons.md 定律①③)", () => {
    const plan = planInstrumentalFill(45, 200);
    expect(plan.interludeS).toBeGreaterThanOrEqual(12);
    expect(plan.outroS).toBe(10);
    expect(plan.gapS).toBeLessThan(15); // 45 行中速 + 双件填充应贴近 200s
    const caption = buildStructuredCaption({ brief: "仙侠片头曲", mode: "song", lineCount: 45, targetSeconds: 200 });
    expect(caption).toContain("Solo female lead"); // song 模式保留人声段
    expect(caption).toMatch(/about \d+ seconds, accompanied by Guzheng/);
  });
});
