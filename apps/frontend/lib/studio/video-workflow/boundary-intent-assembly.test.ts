import { describe, expect, it } from "vitest";
import { assembleBoundaryIntents } from "./boundary-intent-assembly";

const DURATIONS = new Map([
  ["shot-1", 4_000_000],
  ["shot-2", 3_800_000],
  ["shot-3", 3_600_000],
]);

function storyboards(
  overrides: Partial<Record<number, { styleWord: string; moodWord?: string }>> = {},
) {
  return [1, 2, 3].map((index) => ({
    id: `shot-${index}`,
    index,
    trackKey: `chapter-001-scene-${index <= 2 ? 1 : 2}`,
    ...(overrides[index] ? { shotSemantics: { transitionToNext: overrides[index]! } } : {}),
  }));
}

describe("assembleBoundaryIntents priority chain", () => {
  it("shot-level semantics win and carry mood; hard cut word produces no intent", () => {
    const result = assembleBoundaryIntents({
      storyboards: storyboards({
        1: { styleWord: "同场景硬切" },
        2: { styleWord: "水墨晕染", moodWord: "战斗" },
      }),
      shotDurationUsById: DURATIONS,
    });
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({
      fromShotId: "shot-2",
      toShotId: "shot-3",
      effectId: "gl:swap",
      styleWord: "水墨晕染",
      moodWord: "战斗",
    });
  });

  it("falls back to plan shot-level lines when semantics are absent", () => {
    const result = assembleBoundaryIntents({
      storyboards: storyboards(),
      scriptPlanTransitions: "- 镜1 → 镜2：风格词=境界跃迁；氛围词=天道",
      shotDurationUsById: DURATIONS,
    });
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ effectId: "gl:CrossZoom", fromShotId: "shot-1" });
  });

  it("falls back to plan scene-level lines at real scene boundaries only", () => {
    const result = assembleBoundaryIntents({
      storyboards: storyboards(),
      scriptPlanTransitions: "- Sc 1 → Sc 2：风格词=灵气色彩；氛围词=阴谋",
      shotDurationUsById: DURATIONS,
    });
    // shot-2(scene-1) → shot-3(scene-2) 是唯一真实场边界
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ fromShotId: "shot-2", toShotId: "shot-3", effectId: "gl:swap" });
  });

  it("no intents and no warnings when nothing is expressed (hard cuts)", () => {
    const result = assembleBoundaryIntents({ storyboards: storyboards(), shotDurationUsById: DURATIONS });
    expect(result.intents).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns on unknown style words and keeps the boundary a hard cut", () => {
    const result = assembleBoundaryIntents({
      storyboards: storyboards({ 1: { styleWord: "螺旋升天" } }),
      shotDurationUsById: DURATIONS,
    });
    expect(result.intents).toHaveLength(0);
    expect(result.warnings[0]).toContain("未命中词表");
  });

  it("clamps transition duration against the shorter neighbour", () => {
    const result = assembleBoundaryIntents({
      storyboards: storyboards({ 1: { styleWord: "水墨晕染" } }),
      shotDurationUsById: new Map([["shot-1", 4_000_000], ["shot-2", 900_000]]),
    });
    // 水墨晕染默认 1s,但下一镜 0.9s 半长 450ms 封顶
    expect(result.intents[0]!.durationUs).toBe(450_000);
  });
});
