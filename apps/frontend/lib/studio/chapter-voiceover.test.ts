import { describe, expect, it } from "vitest";
import {
  assertChapterVoiceoverPlan,
  auditChapterVoiceoverPlan,
  buildStoryboardVoiceoverItem,
  resolveCanonicalSpeakerId,
  type StoryboardVoiceoverItem,
} from "./chapter-voiceover";

const CHARACTERS = [
  { characterId: "char-dugu", name: "独孤剑尘", aliases: ["剑尘"] },
  { characterId: "char-keeper", name: "掌柜", aliases: ["老掌柜"] },
];

describe("chapter voiceover speaker identity", () => {
  it("resolves narrator labels, exact names, declared aliases, and canonical ids", () => {
    expect(resolveCanonicalSpeakerId("VO", CHARACTERS)).toBe("narrator");
    expect(resolveCanonicalSpeakerId("独孤剑尘", CHARACTERS)).toBe(
      "character:char-dugu",
    );
    expect(resolveCanonicalSpeakerId("老掌柜", CHARACTERS)).toBe(
      "character:char-keeper",
    );
    expect(resolveCanonicalSpeakerId("character:char-dugu", CHARACTERS)).toBe(
      "character:char-dugu",
    );
  });

  it("blocks unknown and conflicting aliases without fuzzy guessing", () => {
    expect(() =>
      buildStoryboardVoiceoverItem({
        storyboardId: "sb-unknown",
        index: 1,
        description: "赵四站在门外。",
        lines: "赵四：开门。",
        duration: 3,
        characters: CHARACTERS,
      }),
    ).toThrow("分镜 sb-unknown speaker 解析失败: speaker 无法解析到角色资产: 赵四");

    expect(() =>
      buildStoryboardVoiceoverItem({
        storyboardId: "sb-conflict",
        index: 2,
        description: "两名守卫同时回头。",
        lines: "守卫：停下。",
        duration: 3,
        characters: [
          { characterId: "guard-a", name: "甲", aliases: ["守卫"] },
          { characterId: "guard-b", name: "乙", aliases: ["守卫"] },
        ],
      }),
    ).toThrow(
      "分镜 sb-conflict speaker 解析失败: speaker 对应多个角色资产: 守卫 -> guard-a, guard-b",
    );
  });
});

describe("chapter voiceover item contract", () => {
  it("turns an empty-dialogue shot into grounded narration", () => {
    const item = buildStoryboardVoiceoverItem({
      storyboardId: "sb-narration",
      index: 1,
      description: "雨水顺着客栈檐角砸落，独孤剑尘压住怀中断剑。",
      lines: "无台词",
      duration: 4,
      emotion: "压抑",
      characters: CHARACTERS,
    });

    expect(item).toMatchObject({
      storyboardId: "sb-narration",
      speaker: "旁白",
      speakerId: "narrator",
      requiresFixedVoice: true,
    });
    expect(item.line).toContain("雨水顺着客栈檐角砸落");
    expect(item.ttsSpokenText).toBe(item.line);
    expect(item.durationTarget).toBeGreaterThan(0);
    expect(item.voiceStyle).toContain("电影级中文旁白");
  });

  it("keeps spoken copy separate and removes visual-only stage directions", () => {
    const item = buildStoryboardVoiceoverItem({
      storyboardId: "sb-dialogue",
      index: 2,
      description: "掌柜收住算盘。",
      lines: "掌柜：[动作：压低声音]客官，外头雨大。",
      duration: 4,
      emotion: "谨慎",
      characters: CHARACTERS,
    });

    expect(item.speakerId).toBe("character:char-keeper");
    expect(item.line).toBe("[动作：压低声音]客官，外头雨大。");
    expect(item.ttsSpokenText).toBe("客官，外头雨大。");
    expect(item.durationTarget).toBe(4);
    expect(item.voiceStyle).toContain("中文角色对白");
  });

  it("audits source count and every required field", () => {
    const items = [
      buildStoryboardVoiceoverItem({
        storyboardId: "sb-1",
        index: 1,
        description: "掌柜收住算盘。",
        lines: "掌柜：客官，外头雨大。",
        duration: 4,
        characters: CHARACTERS,
      }),
      buildStoryboardVoiceoverItem({
        storyboardId: "sb-2",
        index: 2,
        description: "独孤剑尘侧身避雨。",
        lines: "剑尘：借一盏灯。",
        duration: 4,
        characters: CHARACTERS,
      }),
    ];

    expect(assertChapterVoiceoverPlan(items, 2)).toMatchObject({
      passed: true,
      speakerIds: ["character:char-dugu", "character:char-keeper"],
    });
    expect(auditChapterVoiceoverPlan(items, 1)).toMatchObject({
      passed: false,
      errors: ["口播数量与源分镜不一致: 2/1"],
    });

    const invalid = {
      ...items[0],
      ttsSpokenText: "",
      durationTarget: 0,
      requiresFixedVoice: false,
    } as unknown as StoryboardVoiceoverItem;
    expect(auditChapterVoiceoverPlan([invalid], 1)).toMatchObject({
      passed: false,
      errors: [
        "分镜 sb-1 缺少 ttsSpokenText",
        "分镜 sb-1 durationTarget 必须大于 0",
        "分镜 sb-1 requiresFixedVoice 必须为 true",
      ],
    });
  });
});
