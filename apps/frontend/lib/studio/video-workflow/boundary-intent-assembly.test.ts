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
    expect(result.intents[0]).toMatchObject({ fromShotId: "shot-2", toShotId: "shot-3", effectId: "crossfade" });
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

describe("assembleBoundaryIntents AI 转场决策层（08-19）", () => {
  it("source=ai 的 transitionOut 优先于分镜语义，映射到桶表 effectId", () => {
    const result = assembleBoundaryIntents({
      storyboards: [1, 2, 3].map((index) => ({
        id: `shot-${index}`,
        index,
        ...(index === 1
          ? {
              shotFx: { transitionOut: "zoom-warp", source: "ai" },
              shotSemantics: { transitionToNext: { styleWord: "水墨晕染" } },
            }
          : {}),
      })),
      shotDurationUsById: DURATIONS,
    });
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({
      fromShotId: "shot-1",
      toShotId: "shot-2",
      effectId: "gl:CrossZoom",
      styleWord: "zoom-warp",
      durationUs: 500_000,
    });
  });

  it("source=ai 的显式 cut 抑制分镜语义/导演计划（边界保持硬切）", () => {
    const result = assembleBoundaryIntents({
      storyboards: [1, 2, 3].map((index) => ({
        id: `shot-${index}`,
        index,
        ...(index === 1
          ? {
              shotFx: { transitionOut: "cut", source: "ai" },
              shotSemantics: { transitionToNext: { styleWord: "水墨晕染" } },
            }
          : {}),
      })),
      scriptPlanTransitions: "- 镜1 → 镜2：风格词=境界跃迁；氛围词=天道",
      shotDurationUsById: DURATIONS,
    });
    expect(result.intents).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("source=ai 未知桶：警告并回落既有链（分镜语义接手）", () => {
    const result = assembleBoundaryIntents({
      storyboards: [1, 2, 3].map((index) => ({
        id: `shot-${index}`,
        index,
        ...(index === 1
          ? {
              shotFx: { transitionOut: "no-such-bucket", source: "ai" },
              shotSemantics: { transitionToNext: { styleWord: "血祭" } },
            }
          : {}),
      })),
      shotDurationUsById: DURATIONS,
    });
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ effectId: "blackout" });
    expect(result.warnings[0]).toContain("未命中转场桶");
  });

  it("source=heuristic 的 transitionOut 只作链尾兜底：不抢分镜语义", () => {
    const result = assembleBoundaryIntents({
      storyboards: [1, 2, 3].map((index) => ({
        id: `shot-${index}`,
        index,
        ...(index === 1
          ? {
              shotFx: { transitionOut: "blackout", source: "heuristic" },
              shotSemantics: { transitionToNext: { styleWord: "剑痕" } },
            }
          : index === 2
            ? { shotFx: { transitionOut: "impact-frame", source: "heuristic" } }
            : {}),
      })),
      shotDurationUsById: DURATIONS,
    });
    // 镜1:分镜语义(剑痕=flash)赢过启发式 blackout;镜2:无更高来源,启发式 impact-frame 兜底生效
    expect(result.intents).toHaveLength(2);
    expect(result.intents[0]).toMatchObject({ fromShotId: "shot-1", effectId: "flash" });
    expect(result.intents[1]).toMatchObject({ fromShotId: "shot-2", effectId: "impact-frame" });
  });
});

describe("assembleBoundaryIntents 08-22 转场密度裁定", () => {
  function denseStoryboards(count: number, word = "水墨晕染") {
    return Array.from({ length: count }, (_, i) => ({
      id: `shot-${i + 1}`,
      index: i + 1,
      trackKey: `chapter-001-scene-1`,
      ...(i + 1 < count ? { shotSemantics: { transitionToNext: { styleWord: word } } } : {}),
    }));
  }
  const durationsOf = (count: number) =>
    new Map(Array.from({ length: count }, (_, i) => [`shot-${i + 1}`, 4_000_000]));

  it("同款转场 5 边界内重复 → 降级硬切并告警;间距 ≥5 保留", () => {
    // 7 镜 6 边界全请求水墨晕染(gl:swap):保留边界 1、6,中间 4 个降级
    const result = assembleBoundaryIntents({
      storyboards: denseStoryboards(7),
      shotDurationUsById: durationsOf(7),
    });
    expect(result.intents.map((intent) => intent.fromShotId)).toEqual(["shot-1", "shot-6"]);
    expect(result.warnings).toHaveLength(4);
    expect(result.warnings[0]).toContain("降级硬切");
  });

  it("硬切边界计入距离:隔 3 个硬切后再用同款仍算 5 窗口内重复", () => {
    // 边界1=swap;边界2-4=无词表命中(硬切);边界5=同款 → 间距4<5 仍降级
    const boards = denseStoryboards(6).map((board, i) =>
      i === 1 || i === 2 || i === 3 ? { ...board, shotSemantics: undefined } : board,
    );
    const result = assembleBoundaryIntents({
      storyboards: boards,
      shotDurationUsById: durationsOf(6),
    });
    expect(result.intents.map((intent) => intent.fromShotId)).toEqual(["shot-1"]);
    expect(result.warnings).toHaveLength(1);
  });

  it("不同款转场不受密度钳制", () => {
    const boards = denseStoryboards(4).map((board, i) =>
      i === 1
        ? { ...board, shotSemantics: { transitionToNext: { styleWord: "境界跃迁" } } }
        : i === 2
          ? { ...board, shotSemantics: { transitionToNext: { styleWord: "剑痕" } } }
          : board,
    );
    const result = assembleBoundaryIntents({
      storyboards: boards,
      shotDurationUsById: durationsOf(4),
    });
    expect(result.intents.map((intent) => intent.effectId)).toEqual(["gl:swap", "gl:CrossZoom", "flash"]);
    expect(result.warnings).toHaveLength(0);
  });
});
