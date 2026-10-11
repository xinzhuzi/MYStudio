import { describe, expect, it } from "vitest";

import {
  buildShotH3Prompt,
  buildShotH3RefPrompt,
  dialogueAudioPolicy,
  extractPlannedDialogueTexts,
  externalNarratorSpokenText,
  mapH3CameraMove,
  splitDialogueLines,
  verifyPlannedTextVerbatim,
} from "./h3-shot-prompt";

describe("统一旁白判定源拆行", () => {
  it("混合行:角色/旁白各归各", () => {
    const split = splitDialogueLines("林昭：你来。\n旁白：风起。");
    expect(split.character.map((l) => l.text)).toEqual(["你来。"]);
    expect(split.narrator.map((l) => l.text)).toEqual(["风起。"]);
  });
  it("无冒号整行=旁白(对齐 chapter-voiceover 口径)", () => {
    expect(splitDialogueLines("风起云涌").narrator).toHaveLength(1);
    expect(splitDialogueLines("风起云涌").character).toHaveLength(0);
  });
  it("解说/vo/画外音=旁白", () => {
    for (const line of ["解说：大战将起", "vo：低语", "画外音：风声"]) {
      expect(splitDialogueLines(line).narrator).toHaveLength(1);
    }
  });
});

describe("dialogueAudioPolicy", () => {
  it("有角色行→full;纯旁白/无冒号/空→ambient", () => {
    expect(dialogueAudioPolicy("林昭：你来。\n旁白：风起。")).toBe("full");
    expect(dialogueAudioPolicy("旁白：风起。")).toBe("ambient");
    expect(dialogueAudioPolicy("风起云涌")).toBe("ambient");
    expect(dialogueAudioPolicy(undefined)).toBe("ambient");
  });
  // AC R3a 字面:宽集旁白前缀在 policy 直测也要落(此前只在 splitDialogueLines 侧锁,派生链断时拦不住)
  it("解说/vo/画外音=旁白→ambient(AC 字面直测)", () => {
    for (const line of ["解说：大战将起", "vo：低语", "画外音：风声"]) {
      expect(dialogueAudioPolicy(line)).toBe("ambient");
    }
  });
});

describe("externalNarratorSpokenText", () => {
  it("混合行=旁白行正文;纯对白=空;纯旁白=原样", () => {
    expect(externalNarratorSpokenText("林昭：你来。\n旁白：风起。", "全文")).toBe("风起。");
    expect(externalNarratorSpokenText("林昭：你来。", "你来。")).toBe("");
    expect(externalNarratorSpokenText("旁白：风起。", "风起。")).toBe("风起。");
  });
});

describe("full 政策只注角色行 + 音色锚(D1)", () => {
  const lines = "林昭：你来。\n旁白：风起。";
  it("prompt 含角色 says,不含 narrator voiceover", () => {
    const r = buildShotH3Prompt({ videoDesc: "对峙", lines, durationSec: 6 }, "full");
    expect(r.prompt).toContain("林昭 (S1) says");
    expect(r.prompt).not.toContain("off-screen voiceover");
  });
  it("voiceMood 在场时 says 行含音色锚,缺省时无锚(D1)", () => {
    const withMood = buildShotH3Prompt({ videoDesc: "对峙", lines, durationSec: 6, voiceMood: "克制" }, "full");
    expect(withMood.prompt).toContain("says in a 克制 tone");
    const noMood = buildShotH3Prompt({ videoDesc: "对峙", lines, durationSec: 6 }, "full");
    expect(noMood.prompt).not.toContain("says in a");
  });
  it("自检门计划清单=角色行(旁白行不进清单)", () => {
    expect(extractPlannedDialogueTexts(lines)).toEqual(["你来。"]);
    const r = buildShotH3Prompt({ videoDesc: "对峙", lines, durationSec: 6 }, "full");
    expect(verifyPlannedTextVerbatim(r.prompt, ["你来。"]).ok).toBe(true);
  });
  it("纯旁白镜 ambient 回归锁:lips stay closed", () => {
    const r = buildShotH3Prompt({ videoDesc: "远景", lines: "旁白：风起。", durationSec: 6 }, "ambient");
    expect(r.prompt).toContain("lips stay closed");
  });
});

describe("buildShotH3Prompt", () => {
  it.each([
    [5, 124],
    [6, 158],
    [8, 192],
    [15, 362],
    [20, 362],
  ])("snaps %ss to the H3 frame grid", (durationSec, frames) => {
    expect(buildShotH3Prompt({ videoDesc: "A quiet room", durationSec }).lengthFrames).toBe(frames);
  });

  it("maps Chinese camera moves to the H3 vocabulary", () => {
    expect(mapH3CameraMove("推近")).toBe("Push In");
    expect(mapH3CameraMove("拉远")).toBe("Pull Out");
    expect(mapH3CameraMove("向左摇")).toBe("Pan Left");
    expect(mapH3CameraMove("向右摇")).toBe("Pan Right");
    expect(mapH3CameraMove("向左横移")).toBe("Truck Left");
    expect(mapH3CameraMove("向右横移")).toBe("Truck Right");
    expect(mapH3CameraMove("跟拍")).toBe("Tracking Shot");
    expect(mapH3CameraMove("升")).toBe("Pedestal Up");
    expect(mapH3CameraMove("降")).toBe("Pedestal Down");
    expect(mapH3CameraMove("俯拍")).toBe("Tilt Down");
    expect(mapH3CameraMove("仰拍")).toBe("Tilt Up");
    expect(mapH3CameraMove("环绕")).toBe("Arc Shot");
    expect(mapH3CameraMove("变焦拉远")).toBe("Zoom Out");
    expect(mapH3CameraMove("custom move")).toBe("custom move");
  });

  it("uses the ambient policy by default", () => {
    const result = buildShotH3Prompt({
      videoDesc: "A woman looks toward the window.",
      cameraMove: "推近",
      shotSize: "中近景",
      sound: "Rain outside",
      durationSec: 5,
    });

    expect(result.prompt).toContain("For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.");
    expect(result.prompt).toContain("integrated_multimodal_description:");
    expect(result.prompt).toContain("Push In");
    expect(result.prompt).toContain("No dialogue in this clip; the characters' lips stay closed.");
    expect(result.prompt).toContain("At 00:03.000, the described action is visible.");
    expect(result.prompt).not.toContain("00:03.000s");
    expect(result.prompt).toContain("overall_soundscape: Rain outside");
    expect(result.prompt).toContain("non_diegetic_music: None.");
    expect(result.prompt).not.toContain("<d>");
  });

  it("renders full-policy dialogue with character lines only (10-11 口径:旁白归外挂 TTS)", () => {
    const result = buildShotH3Prompt({
      videoDesc: "Two people wait in a doorway.",
      lines: "甲：先走。\n旁白：雨声盖过脚步。\n乙: 我知道。",
      durationSec: 6,
    }, "full");

    expect(result.prompt).toContain("甲 (S1) says: <d>[Chinese] 先走。</d>");
    expect(result.prompt).toContain("乙 (S2) says: <d>[Chinese] 我知道。</d>");
    expect(result.prompt).not.toContain("off-screen voiceover");
    expect(result.prompt).not.toContain("雨声盖过脚步");
  });

  it("keeps bare policy to minimal ambience", () => {
    const result = buildShotH3Prompt({ videoDesc: "An empty street", lines: "甲：你好", durationSec: 8 }, "bare");
    expect(result.prompt).toContain("overall_soundscape: Minimal ambient sound only.");
    expect(result.prompt).toContain("No dialogue in this clip; the characters' lips stay closed.");
    expect(result.prompt).not.toContain("你好");
  });
});

describe("buildShotH3RefPrompt (09-14-h3-ref2va-line)", () => {
  const base = {
    videoDesc: "雨夜中的石桥",
    lines: "掌柜：客官，外头雨大。",
    sound: "远处的雨声",
    durationSec: 5,
  };

  it("orders the six sections verbatim with subject/picture binding", () => {
    const { prompt, lengthFrames } = buildShotH3RefPrompt({
      ...base,
      characters: [{ name: "独孤剑尘", pictureIndex: 2 }],
      scene: { name: "金水河码头", pictureIndex: 3 },
    }, "full");
    expect(lengthFrames).toBe(124);
    const order = ["subject_definitions:", "summary:", "retention_analysis:", "detailed_description:", "overall_soundscape:", "non_diegetic_music:"]
      .map((section) => prompt.indexOf(section));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(prompt).toContain("<Subject 1> is 独孤剑尘, whose appearance comes from <Picture 2>");
    expect(prompt).toContain("<Picture 1> (storyboard frame) is fully referenced");
    expect(prompt).toContain("<Picture 3> retains the 金水河码头 environment");
    expect(prompt).toContain("<d>[Chinese] 客官，外头雨大。</d>");
  });

  it("keeps the audio policy trio and falls back without characters", () => {
    const bare = buildShotH3RefPrompt({ ...base, characters: [] }, "bare");
    expect(bare.prompt).toContain("overall_soundscape: Minimal ambient sound only.");
    expect(bare.prompt).toContain("subject_definitions: <Subject 1> is the main character");
    const ambient = buildShotH3RefPrompt({ ...base }, "ambient");
    expect(ambient.prompt).toContain("overall_soundscape: 远处的雨声");
  });
});

describe("verifyPlannedTextVerbatim (文案逐字自检门,参考_文案逐字自检门.md §一)", () => {
  const prompt = "甲 (S1) says: <d>[Chinese] 先走。</d> The narrator (S2) says in an off-screen voiceover: <d>[Chinese] 雨声盖过脚步。</d> 招牌写着「风雨客栈」。";

  it("命中:全部计划文案一字不差在场即 ok", () => {
    const result = verifyPlannedTextVerbatim(prompt, ["先走。", "雨声盖过脚步。", "风雨客栈"]);
    expect(result).toEqual({ ok: true, missing: [] });
  });

  it("缺席:被改写/吞词的条目逐一指名,不止一条一并报", () => {
    const result = verifyPlannedTextVerbatim(prompt, ["先走吧。", "雨声盖过脚步。", "你先走。"]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["先走吧。", "你先走。"]);
  });

  it("空清单与空白清单=ok(无文案镜不拦;空白条目不比对)", () => {
    expect(verifyPlannedTextVerbatim(prompt, [])).toEqual({ ok: true, missing: [] });
    expect(verifyPlannedTextVerbatim(prompt, ["", "   ", "\t"])).toEqual({ ok: true, missing: [] });
  });

  it("标点差异=缺席:差一个标点、差一个字都不算在场,不做宽松匹配", () => {
    // prompt 丢了句号:计划「先走。」不算在场
    const droppedPeriod = "甲 (S1) says: <d>[Chinese] 先走</d>";
    expect(verifyPlannedTextVerbatim(droppedPeriod, ["先走。"]).missing).toEqual(["先走。"]);
    // 换标点(。→!)
    expect(verifyPlannedTextVerbatim(prompt, ["先走!"]).missing).toEqual(["先走!"]);
    // 差一个字
    expect(verifyPlannedTextVerbatim(prompt, ["雨声盖过脚。"]).missing).toEqual(["雨声盖过脚。"]);
    // 计划为 prompt 内文案的逐字前缀(先走 ⊂ 先走。)仍算在场——查询集=计划清单,验「计划在场」不验「prompt 无多余」
    expect(verifyPlannedTextVerbatim(prompt, ["先走"]).ok).toBe(true);
    // 条目首尾空白按 trim 后比对(与注入侧 trim 口径一致)
    expect(verifyPlannedTextVerbatim(prompt, ["  先走。  "]).ok).toBe(true);
  });
});

describe("extractPlannedDialogueTexts (计划清单与注入同源)", () => {
  it("只取角色行正文(10-11 口径:旁白/无冒号行归外挂 TTS,不进清单)", () => {
    expect(extractPlannedDialogueTexts("甲：先走。\n旁白：雨声盖过脚步。\n乙: 我知道。"))
      .toEqual(["先走。", "我知道。"]);
    expect(extractPlannedDialogueTexts("无冒号整条即旁白")).toEqual([]);
    expect(extractPlannedDialogueTexts("")).toEqual([]);
    expect(extractPlannedDialogueTexts(undefined)).toEqual([]);
  });

  it("full 档端到端:builder 注入的台词逐条过门(单镜直注路径天然逐字回归锁)", () => {
    const lines = "甲：先走。\n旁白：雨声盖过脚步。";
    const { prompt: i2v } = buildShotH3Prompt({ videoDesc: "石桥", lines, durationSec: 5 }, "full");
    const { prompt: ref } = buildShotH3RefPrompt({ videoDesc: "石桥", lines, durationSec: 5 }, "full");
    for (const p of [i2v, ref]) {
      expect(verifyPlannedTextVerbatim(p, extractPlannedDialogueTexts(lines))).toEqual({ ok: true, missing: [] });
    }
  });
});
