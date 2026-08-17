import { describe, expect, it } from "vitest";
import type { VoiceProfile } from "@/types/tts";
import {
  detectNarratorVariant,
  filterNarratorVoiceFamily,
  isNarratorProfileOffFamily,
  pickNarratorClipForVariant,
  pickNarratorVoiceBase,
  resolveNarratorShotProfile,
} from "./narrator-voice";

const FAMILY = [
  { id: "voice-asset-mucheng-calm", name: "木成·平静｜高潮·战斗·诗歌", filePath: "audio/voice-asset-mucheng-calm.wav", referenceText: "他面色沉静，双眉舒展。" },
  { id: "voice-asset-mucheng-sad", name: "木成·悲伤｜平铺直叙·旁白", filePath: "audio/voice-asset-mucheng-sad.wav", referenceText: "方源站在他的墓前，少年满含泪水。" },
  { id: "voice-asset-mucheng-excited", name: "木成·兴奋｜平铺直叙·旁白", filePath: "audio/voice-asset-mucheng-excited.wav", referenceText: "实在是精彩啊，哈哈哈哈哈。" },
  { id: "voice-asset-mucheng-angry", name: "木成·愤怒｜高潮·战斗·诗歌", filePath: "audio/voice-asset-mucheng-angry.wav", referenceText: "方源，你陷害一代老祖。" },
];

const OTHERS = [
  { id: "other-1", name: "清冷少年.wav", filePath: "/voices/teen.wav", referenceText: "少年音。" },
  { id: "other-2", name: "沧桑老者.wav", filePath: "/voices/elder.wav", referenceText: "老者音。" },
];

function baseProfile(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    id: "profile-narrator",
    name: "音色·旁白·木成·平静",
    type: "reference",
    language: "zh",
    defaultEngine: "qwen",
    defaultModelSize: "1.7B",
    referenceAudioPath: "audio/voice-asset-mucheng-calm.wav",
    referenceText: "他面色沉静，双眉舒展。",
    instruct: "旁白锁定木成",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("filterNarratorVoiceFamily", () => {
  it("按名称与路径筛出木成家族", () => {
    const family = filterNarratorVoiceFamily([...FAMILY, ...OTHERS]);
    expect(family.map((item) => item.id)).toEqual(FAMILY.map((item) => item.id));
  });

  it("路径含 mucheng 但名称不含也能命中", () => {
    const family = filterNarratorVoiceFamily([
      { id: "x", name: "未命名.wav", filePath: "/audio/voice-asset-mucheng-calm.wav" },
    ]);
    expect(family).toHaveLength(1);
  });
});

describe("pickNarratorVoiceBase", () => {
  it("确定性优先「平静」片段", () => {
    expect(pickNarratorVoiceBase(FAMILY)?.id).toBe("voice-asset-mucheng-calm");
  });

  it("无平静时回落首个；空家族返回 undefined", () => {
    expect(pickNarratorVoiceBase([FAMILY[1]!])?.id).toBe("voice-asset-mucheng-sad");
    expect(pickNarratorVoiceBase([])).toBeUndefined();
  });
});

describe("detectNarratorVariant", () => {
  it("情绪字段优先命中（悲伤>愤怒>兴奋>默认平静）", () => {
    expect(detectNarratorVariant({ emotion: "悲伤", text: "他在尘土里醒来。" })).toBe("sad");
    expect(detectNarratorVariant({ emotion: "愤怒", text: "他在尘土里醒来。" })).toBe("angry");
    expect(detectNarratorVariant({ emotion: "喜悦", text: "" })).toBe("excited");
  });

  it("无情绪字段时按台词关键词判定", () => {
    expect(detectNarratorVariant({ text: "他满含泪水，哽咽难言。" })).toBe("sad");
    expect(detectNarratorVariant({ text: "杀气骤起，他暴喝一声。" })).toBe("angry");
    expect(detectNarratorVariant({ text: "众人哈哈大笑，惊喜连连。" })).toBe("excited");
    expect(detectNarratorVariant({ text: "他在尘土里醒来，看了看天。" })).toBe("calm");
  });
});

describe("pickNarratorClipForVariant", () => {
  it("按变体选片段；calm 回落基准；未命中回落基准；空家族 undefined", () => {
    expect(pickNarratorClipForVariant(FAMILY, "sad")?.id).toBe("voice-asset-mucheng-sad");
    expect(pickNarratorClipForVariant(FAMILY, "angry")?.id).toBe("voice-asset-mucheng-angry");
    expect(pickNarratorClipForVariant(FAMILY, "calm")?.id).toBe("voice-asset-mucheng-calm");
    expect(pickNarratorClipForVariant([FAMILY[0]!], "sad")?.id).toBe("voice-asset-mucheng-calm");
    expect(pickNarratorClipForVariant([], "sad")).toBeUndefined();
  });
});

describe("resolveNarratorShotProfile", () => {
  it("悲伤台词换 sad 参考片段：仅覆盖音频与文本，身份字段不动", () => {
    const profile = resolveNarratorShotProfile(
      baseProfile(),
      { text: "他站在墓前，满含泪水。" },
      FAMILY,
    );
    expect(profile.id).toBe("profile-narrator");
    expect(profile.type).toBe("reference");
    expect(profile.instruct).toBe("旁白锁定木成");
    expect(profile.referenceAudioPath).toBe("audio/voice-asset-mucheng-sad.wav");
    expect(profile.referenceText).toBe("方源站在他的墓前，少年满含泪水。");
  });

  it("平静台词与基准同段时原样返回（引用相等）", () => {
    const base = baseProfile();
    expect(resolveNarratorShotProfile(base, { text: "他在尘土里醒来。" }, FAMILY)).toBe(base);
  });

  it("空家族或非参考型基准不干预", () => {
    const base = baseProfile();
    expect(resolveNarratorShotProfile(base, { text: "泪流满面" }, [])).toBe(base);
    expect(
      resolveNarratorShotProfile(baseProfile({ type: "preset", referenceAudioPath: undefined }), { text: "泪流满面" }, FAMILY),
    ).toMatchObject({ type: "preset" });
  });
});

describe("isNarratorProfileOffFamily", () => {
  it("名称与路径都不含木成/mucheng 才算偏离", () => {
    expect(isNarratorProfileOffFamily(baseProfile())).toBe(false);
    expect(isNarratorProfileOffFamily(baseProfile({ name: "音色·旁白·清冷少年", referenceAudioPath: "/voices/teen.wav" }))).toBe(true);
  });
});

describe("自定义旁白家族（workflowConfig.narratorVoiceFamily）", () => {
  const OTHER_FAMILY = [
    { id: "voice-yunxi-calm", name: "云希·平静｜旁白", filePath: "audio/voice-yunxi-calm.wav", referenceText: "云希平静念白。" },
    { id: "voice-yunxi-sad", name: "云希·悲伤｜旁白", filePath: "audio/voice-yunxi-sad.wav", referenceText: "云希悲伤念白。" },
  ];

  it("按配置家族名筛选与判偏离；换家族后旧绑定视为偏离", () => {
    expect(filterNarratorVoiceFamily([...FAMILY, ...OTHER_FAMILY], "云希").map((c) => c.id))
      .toEqual(OTHER_FAMILY.map((c) => c.id));
    // 木成基准 profile 在切到云希后算偏离（不含云希标识）
    expect(isNarratorProfileOffFamily(baseProfile(), "云希")).toBe(true);
    // 云希片段不属于默认木成家族
    expect(isNarratorProfileOffFamily(baseProfile({ name: "音色·旁白·云希·平静", referenceAudioPath: "audio/voice-yunxi-calm.wav" }))).toBe(true);
  });

  it("自定义家族同样确定性取平静基准并按情境换段", () => {
    expect(pickNarratorVoiceBase(OTHER_FAMILY)?.id).toBe("voice-yunxi-calm");
    const profile = resolveNarratorShotProfile(
      baseProfile({ name: "音色·旁白·云希·平静", referenceAudioPath: "audio/voice-yunxi-calm.wav", referenceText: "云希平静念白。" }),
      { text: "他满含泪水，哽咽难言。" },
      OTHER_FAMILY,
    );
    expect(profile.referenceAudioPath).toBe("audio/voice-yunxi-sad.wav");
    expect(profile.referenceText).toBe("云希悲伤念白。");
  });

  it("家族名按字面匹配并转义正则特殊字符", () => {
    const weird = [{ id: "w", name: "A.B·平静", filePath: "/a/ab.wav", referenceText: "x" }];
    expect(filterNarratorVoiceFamily(weird, "A.B")).toHaveLength(1);
    expect(filterNarratorVoiceFamily(weird, "AXB")).toHaveLength(0);
  });
});
