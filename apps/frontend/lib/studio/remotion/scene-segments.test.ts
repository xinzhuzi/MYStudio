import { describe, expect, it } from "vitest";
import {
  deriveSceneGroups,
  planSceneSegmentFrameRanges,
  sanitizeSceneSegmentName,
  SCENE_STRUCTURE_LOST_MESSAGE,
  type SceneSegmentClipTiming,
} from "./scene-segments";

function groupedTableText(): string {
  return [
    "## 场1：河雾矿奴 ｜ 参演角色：[独孤剑尘, 赵四]",
    "**引用资产名称**：[独孤剑尘, 赵四]",
    "| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 |",
    "|---|---|---|---|---|---|---|",
    "| 1 | 矿奴拖链 | 6 | 中景 | 缓推 |  | 音效：铁链声 |",
    "| 2 | 鞭梢将落 | 7 | 近景 | 固定 | 旁白：雾锁道口 |  |",
    "## 场2：客栈亮剑 ｜ 参演角色：[独孤剑尘, 掌柜]",
    "**引用资产名称**：[独孤剑尘, 掌柜]",
    "| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 |",
    "|---|---|---|---|---|---|---|",
    "| 3 | 铜钱压账 | 7 | 特写 | 缓推 |  |  |",
    "| 4 | 断剑露形 | 6 | 近景 | 摇 | 掌柜：客官留步 |  |",
    "## 场3：塾馆引气 ｜ 参演角色：[晏燎]",
    "**引用资产名称**：[晏燎]",
    "| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 |",
    "|---|---|---|---|---|---|---|",
    "| 5 | 掌心暗红 | 7 | 特写 | 固定 |  |  |",
  ].join("\n");
}

function storyboardsForTable() {
  return [1, 2, 3, 4, 5].map((index) => ({
    id: `sb-${index}`,
    index,
    duration: 6 + (index % 2),
  }));
}

describe("deriveSceneGroups", () => {
  it("按场头分组并对齐面板分镜", () => {
    const result = deriveSceneGroups(groupedTableText(), storyboardsForTable());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.scenes).toHaveLength(3);
    expect(result.scenes[0]).toMatchObject({ sceneNo: 1, sceneName: "河雾矿奴", storyboardIds: ["sb-1", "sb-2"], shotCount: 2 });
    expect(result.scenes[1]).toMatchObject({ sceneNo: 2, sceneName: "客栈亮剑", storyboardIds: ["sb-3", "sb-4"] });
    expect(result.scenes[2]).toMatchObject({ sceneNo: 3, sceneName: "塾馆引气", storyboardIds: ["sb-5"] });
    expect(typeof result.scenes[0]!.durationSeconds).toBe("number");
  });

  it("无场头的回写表格报场结构丢失", () => {
    const rewritten = [
      "| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 |",
      "|---|---|---|---|---|---|---|",
      "| 1 | 001-1 场景列变 trackKey | 6 | 中景 | 缓推 |  |  |",
    ].join("\n");
    const result = deriveSceneGroups(rewritten, storyboardsForTable().slice(0, 1));
    expect(result).toMatchObject({ success: false, error: expect.stringContaining(SCENE_STRUCTURE_LOST_MESSAGE) as unknown });
  });

  it("面板分镜数量与表行不一致时报错", () => {
    const result = deriveSceneGroups(groupedTableText(), storyboardsForTable().slice(0, 4));
    expect(result).toMatchObject({ success: false });
    if (result.success) return;
    expect(result.error).toContain("不一致");
  });

  it("场号非递增（同名场交错）不可分段", () => {
    const interleaved = groupedTableText().replace("## 场3：塾馆引气", "## 场1：塾馆引气");
    const result = deriveSceneGroups(interleaved, storyboardsForTable());
    expect(result.success).toBe(false);
  });
});

describe("planSceneSegmentFrameRanges", () => {
  const clips: SceneSegmentClipTiming[] = [
    { clipId: "visual-sb-1", storyboardId: "sb-1", from: 0, durationInFrames: 30 },
    { clipId: "visual-sb-2", storyboardId: "sb-2", from: 28, durationInFrames: 35 },
    { clipId: "visual-sb-3", storyboardId: "sb-3", from: 61, durationInFrames: 35 },
    { clipId: "visual-sb-4", storyboardId: "sb-4", from: 94, durationInFrames: 30 },
    { clipId: "visual-sb-5", storyboardId: "sb-5", from: 122, durationInFrames: 35 },
  ];
  const durationInFrames = 157;
  const scenes = [
    { sceneNo: 1, sceneName: "A", storyboardIds: ["sb-1", "sb-2"] },
    { sceneNo: 2, sceneName: "B", storyboardIds: ["sb-3", "sb-4"] },
    { sceneNo: 3, sceneName: "C", storyboardIds: ["sb-5"] },
  ];

  it("分区覆盖全章且无损拼回（含转场重叠帧归属前场）", () => {
    const result = planSceneSegmentFrameRanges({ clips, durationInFrames, scenes });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.segments.map((segment) => [segment.startFrame, segment.endFrame]))
      .toEqual([[0, 60], [61, 121], [122, 156]]);
    // 拼接等值：首段起点 0、相邻段无缝、末段终点 = 总帧数-1
    expect(result.segments[0]!.startFrame).toBe(0);
    for (let index = 1; index < result.segments.length; index += 1) {
      expect(result.segments[index]!.startFrame).toBe(result.segments[index - 1]!.endFrame + 1);
    }
    expect(result.segments.at(-1)!.endFrame).toBe(durationInFrames - 1);
    expect(result.segments[0]!.clipIds).toEqual(["visual-sb-1", "visual-sb-2"]);
  });

  it("分镜不在任何场时报错", () => {
    const result = planSceneSegmentFrameRanges({
      clips,
      durationInFrames,
      scenes: scenes.slice(0, 2),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.join()).toContain("不属于任何场");
  });

  it("场引用不存在的分镜时报错", () => {
    const result = planSceneSegmentFrameRanges({
      clips,
      durationInFrames,
      scenes: [{ sceneNo: 9, sceneName: "X", storyboardIds: ["sb-missing"] }],
    });
    expect(result.success).toBe(false);
  });

  it("场顺序与片段顺序不一致时报错", () => {
    const result = planSceneSegmentFrameRanges({
      clips,
      durationInFrames,
      scenes: [...scenes].reverse(),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.join()).toContain("顺序不一致");
  });

  it("拒绝重复或非法场号，避免同场身份哈希冲突", () => {
    const result = planSceneSegmentFrameRanges({
      clips,
      durationInFrames,
      scenes: [
        { sceneNo: 1, sceneName: "A", storyboardIds: ["sb-1"] },
        { sceneNo: 1, sceneName: "B", storyboardIds: ["sb-2", "sb-3", "sb-4", "sb-5"] },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.join()).toContain("场号非法或重复");
  });
});

describe("sanitizeSceneSegmentName", () => {
  it("去除路径非法字符并限长", () => {
    expect(sanitizeSceneSegmentName("河雾/矿奴:矿场*?")).toBe("河雾矿奴矿场");
    expect(sanitizeSceneSegmentName("   ")).toBe("scene");
    expect(sanitizeSceneSegmentName("很".repeat(40)).length).toBeLessThanOrEqual(24);
  });
});
