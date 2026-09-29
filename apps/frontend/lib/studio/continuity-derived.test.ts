// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// @vitest-environment jsdom

/**
 * B3 A1 新字段推导式填充最小版(2026-09-29):纯函数+advisory。
 * 期望值契约:cueId/text 断言值全部来自 A7a dialogue_cue_numbering.py
 * 实跑输出(本仓 apps/build/chapter_video,story_cues_from_shot 同输入),
 * 逐字同源=格式或取值与 A7a 不一致即红(工单约束②)。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildShotCues,
  continuityDerivedFieldDiff,
  deriveDialogueCueId,
  deriveDialogueCues,
  deriveDialogueText,
  deriveFrameReferencePresence,
  segmentLetter,
} from "@/lib/studio/continuity-derived";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { StoryboardItem } from "@/types/studio";

function shot(partial: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: "sb-1",
    episodeId: "chapter-001",
    index: 1,
    trackKey: "opening",
    trackId: "track-1",
    duration: 5,
    prompt: "雨夜街巷",
    videoDesc: "",
    assetIds: [],
    state: "ready",
    ...partial,
  } as StoryboardItem;
}

const A7A_CUE_ID_PATTERN = /^S\d{2,}-D\d+[a-z]$/; // A7a CUE_ID_PATTERN 逐字镜像
const GUARD_CUE_ID_PATTERN = /^S\d+-D\d+[a-z]?$/; // visual-continuity 守卫口径

beforeEach(() => {
  useStudioStore.getState().resetStudioWorkflow();
});

afterEach(() => {
  useStudioStore.getState().resetStudioWorkflow();
});

describe("deriveDialogueCues/deriveDialogueCueId(A7a 逐字同源,期望值=python 实跑)", () => {
  it("lines 剥主说话人前缀 + <br> 分单元(python: idx7_lines)", () => {
    const storyboard = shot({
      index: 7,
      lines: "独孤剑尘：你来了。<br>我在这里等了很久。",
    });
    expect(deriveDialogueCues(storyboard)).toEqual([
      { cueId: "S07-D1a", shot: 7, unit: 1, segment: "a", text: "你来了。" },
      { cueId: "S07-D2a", shot: 7, unit: 2, segment: "a", text: "我在这里等了很久。" },
    ]);
    expect(deriveDialogueCueId(storyboard)).toBe("S07-D1a");
    expect(deriveDialogueText(storyboard)).toBe("你来了。<br>我在这里等了很久。");
  });

  it("line 字段优先于 lines(python: idx7_line_priority)", () => {
    const storyboard = shot({
      index: 7,
      line: "快走！这里要塌了。",
      lines: "独孤剑尘：无关紧要的旧值。<br>第二旧单元。",
    });
    expect(deriveDialogueCues(storyboard)).toEqual([
      { cueId: "S07-D1a", shot: 7, unit: 1, segment: "a", text: "快走！这里要塌了。" },
    ]);
    expect(deriveDialogueCueId(storyboard)).toBe("S07-D1a");
    expect(deriveDialogueText(storyboard)).toBe("快走！这里要塌了。");
  });

  it("超长单元按句末标点拆段,段序 a/b(python: overlong_sentence)", () => {
    const storyboard = shot({
      index: 3,
      line: "这是一句超过三十个字符的长台词需要按句末标点拆开成两段以上才行。短句。",
    });
    expect(deriveDialogueCues(storyboard).map((cue) => [cue.cueId, cue.text])).toEqual([
      ["S03-D1a", "这是一句超过三十个字符的长台词需要按句末标点拆开成两段以上才行。"],
      ["S03-D1b", "短句。"],
    ]);
  });

  it("句拆后仍超长按换气符拆,不硬切(python: overlong_breath/overlong_nopunct)", () => {
    expect(
      deriveDialogueCues(shot({
        index: 5,
        line: "这一句没有任何句末标点但是却有很多很多的换气停顿符，第一停顿，第二停顿，第三停顿，第四停顿。",
      })).map((cue) => cue.cueId),
    ).toEqual(["S05-D1a", "S05-D1b", "S05-D1c", "S05-D1d", "S05-D1e"]);
    expect(
      deriveDialogueCues(shot({
        index: 9,
        line: "这一句没有任何标点符号也没有任何停顿符所以绝对不能被硬切只能整段保留成一个段。",
      })).map((cue) => cue.cueId),
    ).toEqual(["S09-D1a"]);
  });

  it("空台词/无台词字段=零 cue,推导值为 undefined(python: empty/none)", () => {
    for (const storyboard of [shot({ index: 11, lines: "" }), shot({ index: 12 })]) {
      expect(deriveDialogueCues(storyboard)).toEqual([]);
      expect(deriveDialogueCueId(storyboard)).toBeUndefined();
      expect(deriveDialogueText(storyboard)).toBeUndefined();
    }
  });

  it("镜号≥100 自然三位(python: idx100);收尾引号跟随切分不拆段(python: closing_run)", () => {
    expect(deriveDialogueCueId(shot({ index: 100, line: "你好。" }))).toBe("S100-D1a");
    expect(deriveDialogueCueId(shot({ index: 13, line: "他说：「走开！」然后离开了房间。" }))).toBe("S13-D1a");
  });

  it("index 运行时缺失时从 id 尾号解析(python _shot_index 回退,实跑=S14-D1a)", () => {
    const storyboard = shot({ id: "sb-chapter-001-014", index: undefined, line: "嗯。" });
    expect(deriveDialogueCueId(storyboard)).toBe("S14-D1a");
  });

  it("所有生成 cueId 同时落在 A7a 编号模式与守卫格式内(不一致即红)", () => {
    const storyboards = [
      shot({ index: 7, lines: "独孤剑尘：你来了。<br>我在这里等了很久。" }),
      shot({ index: 5, line: "这一句没有任何句末标点但是却有很多很多的换气停顿符，第一停顿，第二停顿，第三停顿，第四停顿。" }),
      shot({ index: 100, line: "你好。" }),
    ];
    for (const storyboard of storyboards) {
      for (const cue of deriveDialogueCues(storyboard)) {
        expect(cue.cueId).toMatch(A7A_CUE_ID_PATTERN);
        expect(cue.cueId).toMatch(GUARD_CUE_ID_PATTERN);
      }
    }
  });

  it("segmentLetter 1..26=a..z,越界抛错(镜像 A7a 显式报错;>26 段实跑=THROWS)", () => {
    expect(segmentLetter(1)).toBe("a");
    expect(segmentLetter(26)).toBe("z");
    expect(() => segmentLetter(0)).toThrow();
    expect(() => segmentLetter(27)).toThrow(/段序超出 a-z 范围/);
    expect(() => buildShotCues(2, "。".repeat(27).replace(/。/g, "走。"))).toThrow(/段序超出 a-z 范围/);
  });
});

describe("deriveFrameReferencePresence(I1-I4 不变式推导)", () => {
  it("无 keyframes 无 mediaRef(该镜尚无任何画面)=missing/missing", () => {
    expect(deriveFrameReferencePresence(shot())).toEqual({ first: "missing", last: "missing" });
  });

  it("无 keyframes 旧数据由 mediaRef 合成单帧(单图时代)=present/present", () => {
    expect(
      deriveFrameReferencePresence(shot({ mediaRef: { kind: "image", path: "project-file://p/frames/f1.png" } })),
    ).toEqual({ first: "present", last: "present" });
    expect(
      deriveFrameReferencePresence(shot({ mediaRef: { kind: "video", path: "project-file://p/h3/v1.mp4" } })),
    ).toEqual({ first: "present", last: "present" });
  });

  it("空槽=建槽待补合法中间态=pending;帧实图=present", () => {
    const storyboard = shot({
      keyframes: [
        { frameId: "kf-1", mediaRef: { kind: "image", path: "project-file://p/f1.png" }, inUs: 0 },
        { frameId: "kf-2", mediaRef: { kind: "image", path: "" }, inUs: 2_000_000 },
      ],
    });
    expect(deriveFrameReferencePresence(storyboard)).toEqual({ first: "present", last: "pending" });
  });

  it("首帧空槽=pending/last 同帧判定", () => {
    const storyboard = shot({
      keyframes: [{ frameId: "kf-1", mediaRef: { kind: "image", path: "" }, inUs: 0 }],
    });
    expect(deriveFrameReferencePresence(storyboard)).toEqual({ first: "pending", last: "pending" });
  });

  it("I4 违纪路径(data:/blob:/http/file)=无实际可用受管图=missing", () => {
    const storyboard = shot({
      keyframes: [
        { frameId: "kf-1", mediaRef: { kind: "image", path: "data:image/png;base64,xxx" }, inUs: 0 },
        { frameId: "kf-2", mediaRef: { kind: "image", path: "project-file://p/f2.png" }, inUs: 1_000_000 },
      ],
    });
    expect(deriveFrameReferencePresence(storyboard)).toEqual({ first: "missing", last: "present" });
  });
});

describe("continuityDerivedFieldDiff(推导建议 vs 实际字段,advisory)", () => {
  const dialogueShot = shot({
    id: "sb-diff-1",
    index: 7,
    lines: "独孤剑尘：你来了。<br>我在这里等了很久。",
    mediaRef: { kind: "image", path: "project-file://p/f1.png" },
  });

  it("continuityState 缺省/新字段缺省 → 报 absent-actual(可填建议,不改分镜)", () => {
    const entries = continuityDerivedFieldDiff({ ...dialogueShot, continuityState: undefined });
    expect(entries).toEqual([
      expect.objectContaining({
        storyboardId: "sb-diff-1",
        field: "dialogueCueId",
        status: "absent-actual",
        derived: "S07-D1a",
      }),
      expect.objectContaining({
        storyboardId: "sb-diff-1",
        field: "dialogueText",
        status: "absent-actual",
        derived: "你来了。<br>我在这里等了很久。",
      }),
      expect.objectContaining({
        storyboardId: "sb-diff-1",
        field: "frameReferencePresence",
        status: "absent-actual",
        derived: { first: "present", last: "present" },
      }),
    ]);
  });

  it("实际字段与推导一致 → match", () => {
    const entries = continuityDerivedFieldDiff({
      ...dialogueShot,
      continuityState: {
        groupId: "g1",
        sceneVersionId: "sv1",
        sceneViewpointId: "svp1",
        lighting: "夜",
        palette: "冷",
        actionIn: "入",
        actionOut: "出",
        characters: [],
        inputFingerprint: "fp",
        dialogueCueId: "S07-D1a",
        dialogueText: "你来了。<br>我在这里等了很久。",
        frameReferencePresence: { first: "present", last: "present" },
      },
    });
    expect(entries.map((entry) => [entry.field, entry.status])).toEqual([
      ["dialogueCueId", "match"],
      ["dialogueText", "match"],
      ["frameReferencePresence", "match"],
    ]);
  });

  it("实际字段过时(与推导分歧)→ divergent-actual;字段有值而结构无台词 → divergent-actual", () => {
    const stale = continuityDerivedFieldDiff({
      ...dialogueShot,
      continuityState: {
        groupId: "g1",
        sceneVersionId: "sv1",
        sceneViewpointId: "svp1",
        lighting: "夜",
        palette: "冷",
        actionIn: "入",
        actionOut: "出",
        characters: [],
        inputFingerprint: "fp",
        dialogueCueId: "S07-D9z",
        frameReferencePresence: { first: "pending", last: "present" },
      },
    });
    expect(stale.filter((entry) => entry.status === "divergent-actual").map((entry) => entry.field)).toEqual([
      "dialogueCueId",
      "frameReferencePresence",
    ]);

    const orphan = continuityDerivedFieldDiff({
      ...shot({ id: "sb-orphan", index: 3 }),
      continuityState: {
        groupId: "g1",
        sceneVersionId: "sv1",
        sceneViewpointId: "svp1",
        lighting: "夜",
        palette: "冷",
        actionIn: "入",
        actionOut: "出",
        characters: [],
        inputFingerprint: "fp",
        dialogueCueId: "S03-D1a",
      },
    });
    const orphanEntry = orphan.find((entry) => entry.field === "dialogueCueId");
    expect(orphanEntry).toMatchObject({
      status: "divergent-actual",
      actual: "S03-D1a",
    });
    expect(orphanEntry?.derived).toBeUndefined();
    expect("derived" in (orphanEntry ?? {})).toBe(false);
  });

  it("无台词且无实际值 → 两条台词字段不产出条目;帧在场性恒可推导恒产出", () => {
    const entries = continuityDerivedFieldDiff(shot({ id: "sb-quiet", index: 4 }));
    expect(entries.map((entry) => entry.field)).toEqual(["frameReferencePresence"]);
    expect(entries[0]).toMatchObject({ status: "absent-actual", derived: { first: "missing", last: "missing" } });
  });
});

describe("纯度:零 store 写入/零入参突变", () => {
  it("全函数跑真 store 分镜,updateStoryboard 零调用;冻结入参不突变", () => {
    const store = useStudioStore.getState();
    store.addStoryboard({
      id: "sb-purity",
      episodeId: "chapter-001",
      prompt: "测试",
      lines: "独孤剑尘：你来了。",
      mediaRef: { kind: "image", path: "project-file://p/f1.png" },
    });
    const updateSpy = vi.spyOn(useStudioStore.getState(), "updateStoryboard");
    const before = useStudioStore.getState().storyboards;

    const storyboard = Object.freeze(
      useStudioStore.getState().storyboards.find((item) => item.id === "sb-purity"),
    );
    expect(storyboard).toBeDefined();
    expect(() => {
      deriveDialogueCues(storyboard!);
      deriveDialogueCueId(storyboard!);
      deriveDialogueText(storyboard!);
      deriveFrameReferencePresence(storyboard!);
      continuityDerivedFieldDiff(storyboard!);
    }).not.toThrow();

    expect(updateSpy).not.toHaveBeenCalled();
    expect(useStudioStore.getState().storyboards).toBe(before);
  });
});
