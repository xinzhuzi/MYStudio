import { describe, expect, it } from "vitest";
import { resolveWorkflowDepth } from "./workflow-depth";

describe("studio workflow depth resolver", () => {
  it("uses the flat chain for short projects (few episodes, short duration)", () => {
    const result = resolveWorkflowDepth({ episodeCount: 2, episodeDurationMin: 2 });
    expect(result.mode).toBe("flat");
    // 扁平链不含深链编剧阶段
    expect(result.stages).not.toContain("storySkeleton");
    expect(result.stages).not.toContain("adaptationStrategy");
    expect(result.stages).not.toContain("episodeOutline");
    // 但保留主干：事件→剧本→实体→导演→分镜→音色
    expect(result.stages).toContain("eventAnalysis");
    expect(result.stages).toContain("scriptDraft");
    expect(result.stages).toContain("storyboardTable");
    expect(result.reason).toBeTruthy();
  });

  it("uses the deep chain for long projects (many episodes or long duration)", () => {
    const result = resolveWorkflowDepth({ episodeCount: 20, episodeDurationMin: 5 });
    expect(result.mode).toBe("deep");
    expect(result.stages).toContain("storySkeleton");
    expect(result.stages).toContain("adaptationStrategy");
    expect(result.stages).toContain("episodeOutline");
    // 深链在骨架/改编后才到剧本
    expect(result.stages.indexOf("storySkeleton")).toBeLessThan(result.stages.indexOf("scriptDraft"));
    expect(result.stages.indexOf("episodeOutline")).toBeLessThan(result.stages.indexOf("scriptDraft"));
  });

  it("treats a high episode count as deep even when duration is short", () => {
    expect(resolveWorkflowDepth({ episodeCount: 30, episodeDurationMin: 1 }).mode).toBe("deep");
  });

  it("treats a long single-episode duration as deep even with few episodes", () => {
    expect(resolveWorkflowDepth({ episodeCount: 1, episodeDurationMin: 10 }).mode).toBe("deep");
  });

  it("defaults to flat when config is empty", () => {
    const result = resolveWorkflowDepth({});
    expect(result.mode).toBe("flat");
    expect(result.stages.length).toBeGreaterThan(0);
  });
});
