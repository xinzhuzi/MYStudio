import { describe, expect, it } from "vitest";
import { diffSubtitlesAgainstScript, normalizeScriptText, similarityRatio } from "./chapter-qc-text-diff";
import type { VideoUseSubtitleCueV1 } from "../../contracts/video-workflow";

function cue(cueId: string, shotId: string, text: string, startS = 0): VideoUseSubtitleCueV1 {
  return { cueId, shotId, text, startUs: startS * 1e6, durationUs: 2_000_000, source: "alignment" };
}

describe("normalizeScriptText", () => {
  it("去空白与中英标点", () => {
    expect(normalizeScriptText("你好,世界! Hello, world…")).toBe("你好世界Helloworld");
  });
});

describe("similarityRatio", () => {
  it("同串=1,异串按编辑距离", () => {
    expect(similarityRatio("晏燎拔剑", "晏燎拔剑")).toBe(1);
    expect(similarityRatio("晏燎拔剑", "晏燎拔刀")).toBeCloseTo(0.75, 5);
  });
});

describe("diffSubtitlesAgainstScript", () => {
  it("逐字一致通过(含标点噪声)", () => {
    const script = "晏燎抬手,剑光如虹。玄清子退了半步。";
    const cues = [cue("c1", "s1", "晏燎抬手,剑光如虹。", 0), cue("c2", "s2", "玄清子退了半步。", 3)];
    expect(diffSubtitlesAgainstScript(cues, script)).toEqual([]);
  });

  it("错字低于阈值报 text-mismatch", () => {
    const script = "晏燎抬手剑光如虹斩向道口镇上空";
    const cues = [cue("c1", "s1", "晏燎抬手剑光如虹斩向道口县城上空", 0)];
    const findings = diffSubtitlesAgainstScript(cues, script);
    expect(findings).not.toBeNull();
    expect(findings!.some((f) => f.code === "chapter-qc.subtitle.text-mismatch" && f.cueId === "c1")).toBe(true);
  });

  it("剧本大面积未覆盖报 coverage-low(漏烧)", () => {
    const script = "第一句。第二句。第三句。第四句。第五句。第六句。第七句。第八句。";
    const cues = [cue("c1", "s1", "第一句。", 0)];
    const findings = diffSubtitlesAgainstScript(cues, script);
    expect(findings!.some((f) => f.code === "chapter-qc.subtitle.coverage-low")).toBe(true);
  });

  it("scriptText 缺失返回 null(调用方按 skipped 处理)", () => {
    expect(diffSubtitlesAgainstScript([cue("c1", "s1", "任意")], undefined)).toBeNull();
  });

  it("空文本 cue 不参与也不误报", () => {
    const script = "正文";
    const cues = [cue("c1", "s1", "", 0), cue("c2", "s1", "正文", 1)];
    expect(diffSubtitlesAgainstScript(cues, script)).toEqual([]);
  });
});
