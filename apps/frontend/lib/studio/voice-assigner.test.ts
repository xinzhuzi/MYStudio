import { describe, expect, it } from "vitest";
import {
  assignVoiceForCharacter,
  assignVoicesForCharacters,
} from "./voice-assigner";

describe("studio voice assigner", () => {
  it("maps mature male to a deep male preset and young female to a bright female preset (deterministic)", () => {
    const oldMan = assignVoiceForCharacter({
      id: "char-001",
      name: "老掌门",
      gender: "男",
      age: "老年",
      personality: "沉稳威严",
    });
    expect(oldMan.characterId).toBe("char-001");
    expect(oldMan.speakerId).toBe("character:char-001");
    expect(oldMan.presetVoiceId).toBe("Uncle_Fu");
    expect(oldMan.engine).toBe("qwen_custom_voice");

    const girl = assignVoiceForCharacter({
      id: "char-002",
      name: "苏晚卿",
      gender: "女",
      age: "少女",
      personality: "明媚机灵",
    });
    expect(girl.presetVoiceId).toBe("Vivian");

    // 同输入必得同输出（确定性）
    expect(assignVoiceForCharacter({ id: "char-002", name: "苏晚卿", gender: "女", age: "少女", personality: "明媚机灵" }).presetVoiceId).toBe("Vivian");
  });

  it("falls back to gendered default when age/personality are missing, and to narrator-neutral when gender unknown", () => {
    const maleNoAge = assignVoiceForCharacter({ id: "c", name: "无名", gender: "男" });
    expect(["Dylan", "Eric", "Uncle_Fu"]).toContain(maleNoAge.presetVoiceId);

    const unknown = assignVoiceForCharacter({ id: "c2", name: "旁白者" });
    expect(unknown.presetVoiceId).toBeTruthy(); // 仍给出一个可用预设，不留空
    expect(unknown.reason).toBeTruthy();
  });

  it("assigns a warm/gentle female personality to Serena rather than the bright default", () => {
    const gentle = assignVoiceForCharacter({
      id: "char-003",
      name: "师娘",
      gender: "女",
      age: "中年",
      personality: "温柔慈和",
    });
    expect(gentle.presetVoiceId).toBe("Serena");
  });

  it("batch-assigns and keeps one entry per character", () => {
    const result = assignVoicesForCharacters([
      { id: "a", name: "甲", gender: "男", age: "青年" },
      { id: "b", name: "乙", gender: "女", age: "少女" },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.characterId)).toEqual(["a", "b"]);
    expect(result.every((item) => item.speakerId.startsWith("character:"))).toBe(true);
  });
});
