import { describe, expect, it } from "vitest";

import {
  assertionCoverage,
  buildShotExpectations,
  describeAssertionCoverage,
  shotsWithAssertion,
  type ChapterQcExpectationShotInput,
} from "./chapter-qc-expectations";

function shot(overrides: Partial<ChapterQcExpectationShotInput> = {}): ChapterQcExpectationShotInput {
  return { shotId: "s1", ordinal: 1, durationS: 5, ...overrides };
}

function oneExpectation(overrides: Partial<ChapterQcExpectationShotInput> = {}) {
  return buildShotExpectations([shot(overrides)]).shots[0];
}

function assertion(overrides: Partial<ChapterQcExpectationShotInput> = {}) {
  return oneExpectation(overrides).assertions;
}

describe("buildShotExpectations(分镜声明 → 逐镜期望,unknown 不折算)", () => {
  it("动态:显式定格 hold 压过隐式运镜声明;cameraMove/动作差/运镜配方各自成 expected", () => {
    expect(assertion({ shotFxMotion: "hold", cameraMove: "推" }).motion).toBe("forbidden");
    expect(oneExpectation({ shotFxMotion: "hold" }).provenance.motion).toContain("显式定格");
    expect(assertion({ cameraMove: "环绕" }).motion).toBe("expected");
    expect(assertion({ actionIn: "起身", actionOut: "推门而出" }).motion).toBe("expected");
    expect(assertion({ shotFxMotion: "float" }).motion).toBe("expected");
    expect(assertion({ shotFxMotion: "breathe", personFree: true }).motion).toBe("expected");
  });

  it("动态:无人空镜且无动作记载=静止合法(forbidden);什么都没记=unknown", () => {
    expect(assertion({ personFree: true }).motion).toBe("forbidden");
    expect(assertion({ personFree: true, actionIn: "风过芦苇" }).motion).toBe("unknown");
    expect(assertion({}).motion).toBe("unknown");
  });

  it("台词与字幕:文字声明优先于音频绑定;无台词不声明字幕 forbidden", () => {
    expect(assertion({ dialogueText: "金水河畔。" }).speech).toBe("expected");
    expect(assertion({ ttsSpokenText: "他回来了。" }).speech).toBe("expected");
    expect(assertion({ hasVoiceBinding: true }).speech).toBe("expected");
    expect(assertion({}).speech).toBe("unknown");
    expect(assertion({ dialogueText: "有词" }).subtitle).toBe("expected");
    expect(assertion({}).subtitle).toBe("unknown");
  });

  it("出镜:personFree=forbidden,列了角色=expected,只写 personFree=false 也算 expected(缺明细是指名不是无声明)", () => {
    expect(assertion({ personFree: true, visibleCharacterCount: 2 })["cast-visible"]).toBe("forbidden");
    expect(assertion({ visibleCharacterCount: 3 })["cast-visible"]).toBe("expected");
    expect(assertion({ personFree: false })["cast-visible"]).toBe("expected");
    expect(assertion({})["cast-visible"]).toBe("unknown");
    expect(oneExpectation({ visibleCharacterCount: 3 }).provenance["cast-visible"]).toBe("visibleCharacters 3 人");
  });

  it("人脸可判读:只有人出镜的近景/特写才要求可辨;中远景脸小属物理必然", () => {
    expect(assertion({ personFree: false, shotSize: "特写" })["face-readable"]).toBe("expected");
    expect(assertion({ visibleCharacterCount: 1, shotSize: "近景" })["face-readable"]).toBe("expected");
    expect(assertion({ visibleCharacterCount: 1, shotSize: "全景" })["face-readable"]).toBe("unknown");
    expect(assertion({ shotSize: "特写" })["face-readable"]).toBe("unknown");
    expect(oneExpectation({ personFree: false, shotSize: "特写" }).provenance["face-readable"]).toContain("shotSize=特写");
  });

  it("时长:只有声明了 durationTarget 的镜才成为断言", () => {
    expect(assertion({ durationTargetS: 6 })["duration-in-target"]).toBe("expected");
    expect(assertion({ durationTargetS: 0 })["duration-in-target"]).toBe("unknown");
    expect(assertion({})["duration-in-target"]).toBe("unknown");
  });

  it("coverage 逐键三态计数,且与 shotsWithAssertion 一致", () => {
    const set = buildShotExpectations([
      shot({ shotId: "s1", ordinal: 1, cameraMove: "推", dialogueText: "一" }),
      shot({ shotId: "s2", ordinal: 2, shotFxMotion: "hold" }),
      shot({ shotId: "s3", ordinal: 3 }),
      shot({ shotId: "s4", ordinal: 4, personFree: true }),
    ]);
    expect(assertionCoverage(set, "motion")).toMatchObject({ expected: 1, forbidden: 2, unknown: 1 });
    expect(assertionCoverage(set, "speech")).toMatchObject({ expected: 1, forbidden: 0, unknown: 3 });
    expect(set.coverage.map((row) => row.key)).toEqual([
      "motion", "speech", "subtitle", "cast-visible", "face-readable", "duration-in-target",
    ]);
    expect(shotsWithAssertion(set, "motion", "expected").map((item) => item.shotId)).toEqual(["s1"]);
    expect(shotsWithAssertion(set, "motion", "forbidden").map((item) => item.shotId)).toEqual(["s2", "s4"]);
    expect(describeAssertionCoverage(set, "motion")).toBe("声明应成立 1 镜 / 声明不应成立 2 镜 / 分镜未记 1 镜");
    expect(set.shots[1].durationS).toBe(5);
  });

  it("空集与缺集:一切逐镜判定只能拿 0 计数走缺证分支,不许把「无声明」当「无问题」", () => {
    const empty = buildShotExpectations([]);
    expect(empty.shots).toEqual([]);
    expect(assertionCoverage(empty, "motion")).toMatchObject({ expected: 0, forbidden: 0, unknown: 0 });
    expect(assertionCoverage(undefined, "speech")).toMatchObject({ expected: 0, forbidden: 0, unknown: 0 });
    expect(shotsWithAssertion(undefined, "motion", "expected")).toEqual([]);
    expect(describeAssertionCoverage(undefined, "speech")).toContain("分镜未记 0 镜");
  });
});
