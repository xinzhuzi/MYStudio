import { describe, expect, it, vi } from "vitest";
import {
  assignAudioToRoles,
  assignAudioToRolesWithAi,
  buildRoleAudioAiMatchPrompt,
  buildRoleAudioCandidates,
  createNarratorVoiceTarget,
  createRoleAudioVoiceProfileInput,
  parseRoleAudioAiMatchResult,
  planFixedRoleVoices,
} from "./role-audio-auto-assign";
import type { StudioMaterial } from "@/types/studio";
import type { StudioAssetSummary } from "@/types/studio-assets";

function role(id: string, name: string, setting: string): StudioAssetSummary {
  return {
    id,
    source: "toonflow-runtime",
    type: "role",
    name,
    setting,
    description: setting,
  };
}

function audio(id: string, name: string, description: string, filePath: string): StudioAssetSummary {
  return {
    id,
    source: "manying-local",
    type: "audio",
    name,
    description,
    sourcePath: filePath,
    filePath,
  };
}

describe("role audio auto assign", () => {
  it("matches role portraits to the closest audio sample by gender and age cues", () => {
    const roles = [
      role("elder", "苍玄真人", "性别：男。年龄：老年。气质：沉稳威严，低沉沧桑。"),
      role("girl", "洛青衣", "性别：女。年龄：少女。气质：清冷温柔。"),
    ];
    const candidates = buildRoleAudioCandidates([], [
      audio("voice-girl", "少女清冷女声.wav", "你终于回来了，风雪已经等了你三年。", "/voices/girl.wav"),
      audio("voice-old", "老年低沉男声.wav", "这场道劫，终究还是来了。", "/voices/old-man.wav"),
    ]);

    const assignments = assignAudioToRoles(roles, candidates);

    expect(assignments.map((item) => [item.role.id, item.audio.id])).toEqual([
      ["elder", "voice-old"],
      ["girl", "voice-girl"],
    ]);
    expect(assignments[0]?.reason).toContain("性别");
    expect(assignments[0]?.reason).toContain("年龄");
  });

  it("does not reuse audio before every candidate has been assigned once", () => {
    const roles = [
      role("r1", "甲", "性别：男。"),
      role("r2", "乙", "性别：男。"),
      role("r3", "丙", "性别：男。"),
    ];
    const candidates = buildRoleAudioCandidates([], [
      audio("a1", "青年男声一.wav", "第一句", "/voices/a1.wav"),
      audio("a2", "青年男声二.wav", "第二句", "/voices/a2.wav"),
    ]);

    const assignments = assignAudioToRoles(roles, candidates);

    expect(assignments.slice(0, 2).map((item) => item.audio.id).sort()).toEqual(["a1", "a2"]);
    expect(assignments[2]?.audio.id).toBe("a1");
  });

  it("uses character identity and temperament instead of candidate order", () => {
    const roles = [
      role("overseer", "监工赵四", "性别：男。中年记名弟子，拿赤练蛇皮鞭压迫苦力，性格狠厉、阴冷、粗暴。"),
      role("spark", "晏燎", "性别：男。十二三岁底层少年，掌心有暗红灵气，倔强不服输，稚嫩但有星火感。"),
    ];
    const candidates = buildRoleAudioCandidates([], [
      audio("gentle", "男-儒雅、温柔、体贴.wav", "我会护你周全。", "/voices/gentle.wav"),
      audio("villain", "男-奸诈狡猾 老谋深算.wav", "这点小把戏，也敢瞒我？", "/voices/villain.wav"),
      audio("boy", "街头玩耍小男孩.wav", "我还想再试一次。", "/voices/boy.wav"),
    ]);

    const assignments = assignAudioToRoles(roles, candidates);

    expect(assignments.map((item) => [item.role.id, item.audio.id])).toEqual([
      ["overseer", "villain"],
      ["spark", "boy"],
    ]);
    expect(assignments[0]?.reason).toContain("身份");
    expect(assignments[1]?.reason).toContain("年龄");
  });

  it("dedupes material and runtime audio by file path and keeps reference text", () => {
    const materials: StudioMaterial[] = [
      {
        id: "mat-1",
        kind: "audio",
        name: "女声样本",
        localPath: "/voices/same.wav",
        sourceName: "女声样本.wav",
        size: 12,
        importedAt: 1,
      },
    ];
    const candidates = buildRoleAudioCandidates(materials, [
      audio("runtime-1", "女声样本副本.wav", "这里是识别出的中文台词。", "/voices/same.wav"),
      audio("runtime-2", "青年男声.wav", "少年立在雨中。", "/voices/boy.wav"),
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      id: "material:mat-1",
      filePath: "/voices/same.wav",
      referenceText: "女声样本",
    });
    expect(candidates[1]).toMatchObject({
      id: "runtime-2",
      referenceText: "少年立在雨中。",
    });
  });

  it("drops path-like labels from role audio reference text", () => {
    const materials: StudioMaterial[] = [
      {
        id: "mat-path",
        kind: "audio",
        name: "/voices/material.wav",
        localPath: "/voices/material.wav",
        sourceName: "C:\\voices\\material.wav",
        size: 12,
        importedAt: 1,
      },
    ];
    const candidates = buildRoleAudioCandidates(materials, [
      audio("runtime-path", "runtime.OPUS", "/voices/runtime.wav", "/voices/runtime.wav"),
    ]);

    expect(candidates).toEqual([
      {
        id: "material:mat-path",
        name: "material.wav",
        filePath: "/voices/material.wav",
        referenceText: undefined,
        sourceLabel: "material.wav",
      },
      {
        id: "runtime-path",
        name: "runtime.OPUS",
        filePath: "/voices/runtime.wav",
        referenceText: undefined,
        sourceLabel: "runtime.wav",
      },
    ]);
  });

  it("creates a qwen reference voice profile bound to the role speaker id", () => {
    const [assignment] = assignAudioToRoles(
      [role("hero", "沈砚", "性别：男。年龄：青年。")],
      buildRoleAudioCandidates([], [
        audio("voice-hero", "青年男声.wav", "我会走到最后。", "/voices/hero.wav"),
      ]),
    );

    const result = createRoleAudioVoiceProfileInput(assignment!);

    expect(result.speakerId).toBe("character:hero");
    expect(result.profile).toMatchObject({
      name: "音色·沈砚·青年男声.wav",
      type: "reference",
      language: "zh",
      defaultEngine: "qwen",
      defaultModelSize: "1.7B",
      referenceAudioPath: "/voices/hero.wav",
      referenceText: "我会走到最后。",
    });
  });

  it("lets an AI matcher choose the final voice from rule-ranked candidates", async () => {
    const roles = [
      role("hero", "独孤剑尘", "性别：男。中年剑修，冷峻寡言，身负断剑，声音应低沉克制。"),
    ];
    const candidates = buildRoleAudioCandidates([], [
      audio("rule-pick", "男-中音,中等,清冷.wav", "我已无路可退。", "/voices/cold.wav"),
      audio("ai-pick", "低沉 磁性 醇厚  男.wav", "归元，忍住。", "/voices/deep.wav"),
    ]);

    const assignments = await assignAudioToRolesWithAi(roles, candidates, {
      maxCandidatesPerRole: 2,
      match: async ({ candidates: topCandidates }) => {
        expect(topCandidates.map((item) => item.id)).toContain("ai-pick");
        return { audioId: "ai-pick", reason: "AI语义匹配：低沉克制，更贴合断剑剑修" };
      },
    });

    expect(assignments[0]?.audio.id).toBe("ai-pick");
    expect(assignments[0]?.reason).toContain("AI语义匹配");
  });

  it("falls back to local rule matching when AI returns an invalid id", async () => {
    const roles = [
      role("overseer", "监工赵四", "性别：男。中年记名弟子，拿赤练蛇皮鞭压迫苦力，性格狠厉、阴冷、粗暴。"),
    ];
    const candidates = buildRoleAudioCandidates([], [
      audio("gentle", "男-儒雅、温柔、体贴.wav", "我会护你周全。", "/voices/gentle.wav"),
      audio("villain", "男-奸诈狡猾 老谋深算.wav", "这点小把戏，也敢瞒我？", "/voices/villain.wav"),
    ]);

    const assignments = await assignAudioToRolesWithAi(roles, candidates, {
      maxCandidatesPerRole: 2,
      match: async () => ({ audioId: "missing", reason: "无效返回" }),
    });

    expect(assignments[0]?.audio.id).toBe("villain");
    expect(assignments[0]?.reason).toContain("身份");
  });

  it("parses AI match JSON from code fences or surrounding text", () => {
    expect(parseRoleAudioAiMatchResult("```json\n{\"audioId\":\"voice-1\",\"reason\":\"低沉克制\"}\n```")).toEqual({
      audioId: "voice-1",
      reason: "低沉克制",
    });

    expect(parseRoleAudioAiMatchResult("匹配结果：{\"audioId\":null,\"reason\":\"无合适音色\"}")).toEqual({
      audioId: null,
      reason: "无合适音色",
    });

    expect(parseRoleAudioAiMatchResult("没有结构化结果")).toBeNull();
  });

  it("reuses a valid fixed binding without calling the matcher or changing its profile", async () => {
    const fixedProfile = {
      id: "profile-fixed",
      name: "固定主角音色",
      type: "reference" as const,
      language: "zh",
      defaultEngine: "qwen" as const,
      defaultModelSize: "1.7B",
      referenceAudioPath: "/voices/fixed.wav",
      referenceText: "我会走到最后。",
      createdAt: 100,
      updatedAt: 100,
    };
    const fixedBinding = {
      speakerId: "character:hero" as const,
      profileId: fixedProfile.id,
      defaultEngine: "qwen" as const,
      defaultModelSize: "1.7B",
    };
    const assignUnbound = vi.fn();

    const result = await planFixedRoleVoices({
      targets: [
        {
          speakerId: "character:hero",
          role: role("hero", "沈砚", "青年剑修，低沉克制。"),
        },
      ],
      candidates: [],
      bindings: { [fixedBinding.speakerId]: fixedBinding },
      voiceProfiles: { [fixedProfile.id]: fixedProfile },
      resolveReferenceAudioPath: async (audioPath) => audioPath,
      assignUnbound,
    });

    expect(result.errors).toEqual([]);
    expect(result.created).toEqual([]);
    expect(result.fixed[0]).toMatchObject({
      speakerId: "character:hero",
      binding: fixedBinding,
      profile: fixedProfile,
      match: "fixed",
    });
    expect(result.fixed[0]?.binding).toBe(fixedBinding);
    expect(result.fixed[0]?.profile).toBe(fixedProfile);
    expect(assignUnbound).not.toHaveBeenCalled();
  });

  it("creates an unbound speaker once and treats the persisted rerun as fixed", async () => {
    const target = {
      speakerId: "character:hero" as const,
      role: role("hero", "沈砚", "青年剑修，低沉克制。"),
    };
    const candidates = buildRoleAudioCandidates([], [
      audio("voice-hero", "青年男声.wav", "我会走到最后。", "/voices/hero.wav"),
    ]);
    const resolveReferenceAudioPath = vi.fn(async (audioPath: string) =>
      audioPath === "/voices/hero.wav" ? "/absolute/voices/hero.wav" : audioPath,
    );

    const first = await planFixedRoleVoices({
      targets: [target],
      candidates,
      bindings: {},
      voiceProfiles: {},
      resolveReferenceAudioPath,
    });

    expect(first.errors).toEqual([]);
    expect(first.fixed).toEqual([]);
    expect(first.created[0]).toMatchObject({
      speakerId: "character:hero",
      match: "ai-selected",
      draft: {
        speakerId: "character:hero",
        profile: { referenceAudioPath: "/absolute/voices/hero.wav" },
      },
    });

    const persistedProfile = {
      ...first.created[0]!.draft.profile,
      id: "profile-created-once",
      createdAt: 200,
      updatedAt: 200,
    };
    const persistedBinding = {
      ...first.created[0]!.draft.binding,
      profileId: persistedProfile.id,
    };
    const second = await planFixedRoleVoices({
      targets: [target],
      candidates: [],
      bindings: { [target.speakerId]: persistedBinding },
      voiceProfiles: { [persistedProfile.id]: persistedProfile },
      resolveReferenceAudioPath: async (audioPath) => audioPath,
      assignUnbound: vi.fn(),
    });

    expect(second.errors).toEqual([]);
    expect(second.created).toEqual([]);
    expect(second.fixed[0]?.binding.profileId).toBe("profile-created-once");
    expect(second.fixed[0]?.profile.referenceAudioPath).toBe(
      "/absolute/voices/hero.wav",
    );
    expect(second.fixed[0]?.profile.createdAt).toBe(200);
    expect(second.fixed[0]?.profile.updatedAt).toBe(200);
  });

  it("hard-fails broken fixed profiles before assigning any missing speaker", async () => {
    const assignUnbound = vi.fn();
    const result = await planFixedRoleVoices({
      targets: [
        {
          speakerId: "character:broken",
          role: role("broken", "坏绑定", "固定音色损坏。"),
        },
        createNarratorVoiceTarget(),
      ],
      candidates: buildRoleAudioCandidates([], [
        audio("voice", "旁白.wav", "这一夜，雨没有停。", "/voices/narrator.wav"),
      ]),
      bindings: {
        "character:broken": {
          speakerId: "character:broken",
          profileId: "missing-profile",
        },
      },
      voiceProfiles: {},
      resolveReferenceAudioPath: async () => null,
      assignUnbound,
    });

    expect(result.errors).toEqual([
      {
        speakerId: "character:broken",
        code: "missing-profile",
        message: "固定音色 character:broken 缺少 profile missing-profile",
      },
    ]);
    expect(result.created).toEqual([]);
    expect(assignUnbound).not.toHaveBeenCalled();
  });

  it("rejects missing reference text and unreadable selected audio", async () => {
    const missingText = await planFixedRoleVoices({
      targets: [
        {
          speakerId: "character:hero",
          role: role("hero", "沈砚", "青年剑修。"),
        },
      ],
      candidates: [
        {
          id: "voice-no-text",
          name: "voice.wav",
          filePath: "/voices/no-text.wav",
        },
      ],
      bindings: {},
      voiceProfiles: {},
      resolveReferenceAudioPath: async (audioPath) => audioPath,
    });
    expect(missingText.errors[0]?.code).toBe("missing-reference-text");

    const unreadable = await planFixedRoleVoices({
      targets: [createNarratorVoiceTarget()],
      candidates: [
        {
          id: "voice-narrator",
          name: "旁白.wav",
          filePath: "/voices/missing.wav",
          referenceText: "这一夜，雨没有停。",
        },
      ],
      bindings: {},
      voiceProfiles: {},
      resolveReferenceAudioPath: async () => null,
    });
    expect(unreadable.errors[0]).toMatchObject({
      speakerId: "narrator",
      code: "unreadable-reference-audio",
    });
  });
});

describe("narrator 木成家族锁定", () => {
  const muchengAssets = [
    audio("voice-asset-mucheng-calm", "木成·平静｜高潮·战斗·诗歌", "他面色沉静，双眉舒展。", "audio/voice-asset-mucheng-calm.wav"),
    audio("voice-asset-mucheng-sad", "木成·悲伤｜平铺直叙·旁白", "方源站在他的墓前，少年满含泪水。", "audio/voice-asset-mucheng-sad.wav"),
    audio("voice-asset-mucheng-angry", "木成·愤怒｜高潮·战斗·诗歌", "方源，你陷害一代老祖。", "audio/voice-asset-mucheng-angry.wav"),
  ];
  const otherAssets = [
    audio("voice-teen", "清冷少年.wav", "少年音。", "/voices/teen.wav"),
    audio("voice-elder", "沧桑老者.wav", "老者音。", "/voices/elder.wav"),
  ];

  it("未绑定旁白：家族可用时确定性取「平静」，不打分不漂移", async () => {
    const assignUnbound = vi.fn();
    const result = await planFixedRoleVoices({
      targets: [createNarratorVoiceTarget()],
      candidates: buildRoleAudioCandidates([], [...muchengAssets, ...otherAssets]),
      bindings: {},
      voiceProfiles: {},
      resolveReferenceAudioPath: async (audioPath) => audioPath,
      assignUnbound,
    });

    expect(result.errors).toEqual([]);
    expect(assignUnbound).not.toHaveBeenCalled();
    expect(result.created).toHaveLength(1);
    expect(result.created[0]).toMatchObject({
      speakerId: "narrator",
      match: "ai-selected",
    });
    expect(result.created[0]?.assignment.audio.filePath).toBe("audio/voice-asset-mucheng-calm.wav");
    expect(result.created[0]?.draft.profile.referenceAudioPath).toBe("audio/voice-asset-mucheng-calm.wav");
    expect(result.created[0]?.draft.profile.referenceText).toBe("他面色沉静，双眉舒展。");
  });

  it("既有旁白绑定已偏离木成且家族可用：视为过期重新绑定", async () => {
    const staleProfile = {
      id: "profile-stale",
      name: "音色·旁白·清冷少年",
      type: "reference" as const,
      language: "zh",
      defaultEngine: "qwen" as const,
      defaultModelSize: "1.7B",
      referenceAudioPath: "/voices/teen.wav",
      referenceText: "少年音。",
      createdAt: 0,
      updatedAt: 0,
    };
    const result = await planFixedRoleVoices({
      targets: [createNarratorVoiceTarget()],
      candidates: buildRoleAudioCandidates([], muchengAssets),
      bindings: {
        narrator: { speakerId: "narrator" as const, profileId: staleProfile.id, defaultEngine: "qwen" as const, defaultModelSize: "1.7B" },
      },
      voiceProfiles: { [staleProfile.id]: staleProfile },
      resolveReferenceAudioPath: async (audioPath) => audioPath,
    });

    expect(result.errors).toEqual([]);
    expect(result.fixed).toEqual([]);
    expect(result.created[0]?.assignment.audio.filePath).toBe("audio/voice-asset-mucheng-calm.wav");
  });

  it("旁白锁定不影响角色 speaker 的自动匹配", async () => {
    const assignUnbound = vi.fn(async (roles: StudioAssetSummary[]) =>
      roles.map((roleAsset) => ({
        role: roleAsset,
        audio: { id: "voice-teen", name: "清冷少年.wav", filePath: "/voices/teen.wav", referenceText: "少年音。" },
        reason: "测试指定",
      })),
    );
    const result = await planFixedRoleVoices({
      targets: [
        createNarratorVoiceTarget(),
        { speakerId: "character:hero", role: role("hero", "沈砚", "青年剑修。") },
      ],
      candidates: buildRoleAudioCandidates([], [...muchengAssets, ...otherAssets]),
      bindings: {},
      voiceProfiles: {},
      resolveReferenceAudioPath: async (audioPath) => audioPath,
      assignUnbound: assignUnbound as unknown as Parameters<typeof planFixedRoleVoices>[0]["assignUnbound"],
    });

    expect(result.errors).toEqual([]);
    expect(result.created).toHaveLength(2);
    expect(assignUnbound).toHaveBeenCalledTimes(1);
    expect(assignUnbound.mock.calls[0]?.[0]).toHaveLength(1);
    expect(result.created.find((item) => item.speakerId === "narrator")?.assignment.audio.filePath)
      .toBe("audio/voice-asset-mucheng-calm.wav");
    expect(result.created.find((item) => item.speakerId === "character:hero")?.assignment.audio.filePath)
      .toBe("/voices/teen.wav");
  });

  it("家族不可用时旁白回落既有全库行为（不因缺木成而阻塞）", async () => {
    const result = await planFixedRoleVoices({
      targets: [createNarratorVoiceTarget()],
      candidates: buildRoleAudioCandidates([], otherAssets),
      bindings: {},
      voiceProfiles: {},
      resolveReferenceAudioPath: async (audioPath) => audioPath,
    });

    expect(result.errors).toEqual([]);
    expect(result.created).toHaveLength(1);
    // 回落全库启发式：具体选段由既有打分决定，不在此钉死。
    expect(["/voices/teen.wav", "/voices/elder.wav"]).toContain(result.created[0]?.assignment.audio.filePath);
  });

  it("配置自定义旁白家族（narratorVoiceFamily）时按该家族锁定与重绑", async () => {
    const yunxiAssets = [
      audio("voice-yunxi-calm", "云希·平静｜旁白", "云希平静念白。", "audio/voice-yunxi-calm.wav"),
      audio("voice-yunxi-sad", "云希·悲伤｜旁白", "云希悲伤念白。", "audio/voice-yunxi-sad.wav"),
    ];
    // 既有绑定是木成（默认家族）——切到云希后应视为偏离并重绑云希
    const muchengProfile = {
      id: "profile-mucheng",
      name: "音色·旁白·木成·平静",
      type: "reference" as const,
      language: "zh",
      defaultEngine: "qwen" as const,
      defaultModelSize: "1.7B",
      referenceAudioPath: "audio/voice-asset-mucheng-calm.wav",
      referenceText: "他面色沉静，双眉舒展。",
      createdAt: 0,
      updatedAt: 0,
    };
    const result = await planFixedRoleVoices({
      targets: [createNarratorVoiceTarget()],
      candidates: buildRoleAudioCandidates([], [...yunxiAssets, ...muchengAssets]),
      narratorVoiceFamily: "云希",
      bindings: {
        narrator: { speakerId: "narrator" as const, profileId: muchengProfile.id, defaultEngine: "qwen" as const, defaultModelSize: "1.7B" },
      },
      voiceProfiles: { [muchengProfile.id]: muchengProfile },
      resolveReferenceAudioPath: async (audioPath) => audioPath,
    });

    expect(result.errors).toEqual([]);
    expect(result.fixed).toEqual([]);
    expect(result.created[0]?.assignment.audio.filePath).toBe("audio/voice-yunxi-calm.wav");
    expect(result.created[0]?.assignment.reason).toContain("云希");
  });
});

describe("配音分层分配（主角优先 / NPC 可复用）", () => {
  const layeredCandidates = buildRoleAudioCandidates([], [
    audio("c1", "清冷剑修音", "剑修清冷念白。", "/voices/sword-cold.wav"),
    audio("c2", "先生书生儒雅", "书生儒雅念白。", "/voices/scholar.wav"),
  ]);
  const roleA = role("char-a", "沈砚", "青年剑修，冷峻寡言。");
  const roleB = role("char-b", "叶孤鸿", "青年剑修，冷峻寡言。");

  it("主角先挑：标记 protagonist 的角色优先拿到最佳片段（即使排在数组后面）", () => {
    const assignments = assignAudioToRoles(
      [roleA, roleB],
      layeredCandidates,
      { importanceByRoleId: { "char-b": "protagonist" } },
    );
    const byRoleId = new Map(assignments.map((item) => [item.role.id, item.audio.filePath]));
    expect(byRoleId.get("char-b")).toBe("/voices/sword-cold.wav");
    expect(byRoleId.get("char-a")).toBe("/voices/scholar.wav");
  });

  it("无标记时保持数组顺序（既有行为不变）", () => {
    const assignments = assignAudioToRoles([roleA, roleB], layeredCandidates);
    const byRoleId = new Map(assignments.map((item) => [item.role.id, item.audio.filePath]));
    expect(byRoleId.get("char-a")).toBe("/voices/sword-cold.wav");
    expect(byRoleId.get("char-b")).toBe("/voices/scholar.wav");
  });

  it("NPC 允许复用：不因片段已被配角占用而受罚，可拿到同一段最佳匹配", () => {
    const npcRole = role("char-n", "路人甲", "青年剑修，冷峻寡言。");
    const assignments = assignAudioToRoles(
      [roleA, npcRole],
      layeredCandidates,
      { importanceByRoleId: { "char-n": "npc" } },
    );
    const byRoleId = new Map(assignments.map((item) => [item.role.id, item.audio.filePath]));
    expect(byRoleId.get("char-a")).toBe("/voices/sword-cold.wav");
    expect(byRoleId.get("char-n")).toBe("/voices/sword-cold.wav");
  });

  it("planFixedRoleVoices 透传 importanceByRoleId 给自动分配", async () => {
    const result = await planFixedRoleVoices({
      targets: [
        { speakerId: "character:char-a" as const, role: roleA },
        { speakerId: "character:char-b" as const, role: roleB },
      ],
      candidates: layeredCandidates,
      importanceByRoleId: { "char-b": "protagonist" },
      bindings: {},
      voiceProfiles: {},
      resolveReferenceAudioPath: async (audioPath) => audioPath,
    });

    expect(result.errors).toEqual([]);
    const createdById = new Map(result.created.map((item) => [item.speakerId, item.assignment.audio.filePath]));
    expect(createdById.get("character:char-b")).toBe("/voices/sword-cold.wav");
    expect(createdById.get("character:char-a")).toBe("/voices/scholar.wav");
  });

  it("AI 精选提示词含候选 audioId 与角色名，解析回路成立", () => {
    const localAssignments = assignAudioToRoles([roleA], layeredCandidates);
    const prompt = buildRoleAudioAiMatchPrompt({
      role: roleA,
      candidates: layeredCandidates,
      localAssignment: localAssignments[0]!,
    });
    expect(prompt).toContain("沈砚");
    expect(prompt).toContain("audioId=c1");
    const parsed = parseRoleAudioAiMatchResult(
      '```json\n{"audioId": "material:c1", "reason": "剑修气质贴合"}\n```',
    );
    expect(parsed).toEqual({ audioId: "material:c1", reason: "剑修气质贴合" });
  });
});

describe("角色配音固定（同名跨 id 复用）", () => {
  const swordCandidates = buildRoleAudioCandidates([], [
    audio("c1", "清冷剑修音", "剑修清冷念白。", "/voices/sword-cold.wav"),
    audio("c2", "先生书生儒雅", "书生儒雅念白。", "/voices/scholar.wav"),
  ]);

  it("实体重抽换 id 后，同名角色直接重绑既有 profile，不重新分配", async () => {
    // 旧 id 首次分配（无既有 profile → 正常创建）
    const oldId = "character:char-old-1" as const;
    const first = await planFixedRoleVoices({
      targets: [{ speakerId: oldId, role: role("char-old-1", "沈砚", "青年剑修，冷峻寡言。") }],
      candidates: swordCandidates,
      bindings: {},
      voiceProfiles: {},
      resolveReferenceAudioPath: async (audioPath) => audioPath,
    });
    expect(first.created).toHaveLength(1);
    // createRoleAudioVoiceProfileInput 的命名约定：音色·<角色名>·<片段名>
    expect(first.created[0]?.draft.profile.name).toBe("音色·沈砚·清冷剑修音");

    // 模拟调用方建档后，重抽生成新 id：同名角色应 name-matched 重绑同一 profile
    const existingProfile = {
      ...first.created[0]!.draft.profile,
      id: "profile-existing",
      createdAt: 0,
      updatedAt: 0,
    };
    const newId = "character:char-new-9" as const;
    const second = await planFixedRoleVoices({
      targets: [{ speakerId: newId, role: role("char-new-9", "沈砚", "青年剑修，冷峻寡言。") }],
      candidates: swordCandidates,
      bindings: {},
      voiceProfiles: { "profile-existing": existingProfile },
      resolveReferenceAudioPath: async (audioPath) => audioPath,
    });
    expect(second.errors).toEqual([]);
    expect(second.created).toEqual([]);
    expect(second.rebound).toHaveLength(1);
    expect(second.rebound[0]).toMatchObject({
      speakerId: newId,
      match: "name-matched",
    });
    expect(second.rebound[0]?.binding.profileId).toBe("profile-existing");
    expect(second.rebound[0]?.profile).toBe(existingProfile);
  });

  it("无同名 profile 时保持既有自动分配路径（不误绑）", async () => {
    const unrelated = {
      id: "profile-unrelated",
      name: "音色·叶孤鸿·清冷剑修音",
      type: "reference" as const,
      language: "zh",
      defaultEngine: "qwen" as const,
      defaultModelSize: "1.7B",
      referenceAudioPath: "/voices/sword-cold.wav",
      referenceText: "剑修清冷念白。",
      createdAt: 0,
      updatedAt: 0,
    };
    const result = await planFixedRoleVoices({
      targets: [{ speakerId: "character:char-a" as const, role: role("char-a", "沈砚", "青年剑修，冷峻寡言。") }],
      candidates: swordCandidates,
      bindings: {},
      voiceProfiles: { "profile-unrelated": unrelated },
      resolveReferenceAudioPath: async (audioPath) => audioPath,
    });
    expect(result.rebound).toEqual([]);
    expect(result.created).toHaveLength(1);
  });
});
