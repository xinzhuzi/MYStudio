import { describe, expect, it } from "vitest";
import {
  assignAudioToRoles,
  assignAudioToRolesWithAi,
  buildRoleAudioCandidates,
  createRoleAudioVoiceProfileInput,
  parseRoleAudioAiMatchResult,
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
    });
    expect(candidates[1]).toMatchObject({
      id: "runtime-2",
      referenceText: "少年立在雨中。",
    });
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
});
