import { describe, expect, it } from "vitest";

import {
  buildShotH3MultisegPrompt,
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

// ── multiseg 分段提示词(PRD 10-27 §14.1.3)────────────────────────────────────────────────────

describe("buildShotH3MultisegPrompt(分段组装,插件 h3_utils 解析契约)", () => {
  it("≤15s 单段:5s→单段 124 帧(17k+5 网格,与 i2v snap 同点);14.375s=345 帧单段上限", () => {
    const five = buildShotH3MultisegPrompt({ videoDesc: "剑修立于竹林。", durationTarget: 5, policy: "ambient" });
    expect(five.segments).toHaveLength(1);
    expect(five.segments[0]!.frames).toBe(124);
    expect(five.totalSeconds).toBeCloseTo(124 / 24, 6);
    expect(five.segments[0]!.secondsText).toBe("5.167"); // Math.floor(5.167×24)=124 还原自检
    const edge = buildShotH3MultisegPrompt({ videoDesc: "剑修立于竹林。", durationTarget: 345 / 24, policy: "ambient" });
    expect(edge.segments).toHaveLength(1);
    expect(edge.segments[0]!.frames).toBe(345); // 17×20+5=345 单段上限(14.375s)
  });

  it("20s→两段:首段 17k+5、非首段 17 倍,各段段长(含 context 5)≤360 帧=15s;总帧贴最近网格", () => {
    const r = buildShotH3MultisegPrompt({ videoDesc: "剑修立于竹林。", durationTarget: 20, policy: "ambient" });
    expect(r.segments).toHaveLength(2);
    const [first, second] = r.segments;
    expect((first!.frames - 5) % 17).toBe(0); // 首段 17k+5:frames−5 是 17 的倍数
    expect(second!.frames % 17).toBe(0); // 非首段纯 17 倍
    expect(first!.frames).toBe(243); // 17×14+5
    expect(second!.frames).toBe(238); // 17×14
    expect(first!.frames).toBeLessThanOrEqual(345);
    expect(second!.frames + 5).toBeLessThanOrEqual(360); // 段长=新增+context 5 ≤360
    expect(first!.frames + second!.frames).toBe(481); // T=480 贴最近网格 481(差 +1 ≤8)
  });

  it("40s 顶:三段在册、957 帧贴网格;>40s 硬顶拒派抛大白话(M1)", () => {
    const at = buildShotH3MultisegPrompt({ videoDesc: "剑修立于竹林。", durationTarget: 40, policy: "ambient" });
    expect(at.segments).toHaveLength(3);
    expect(at.segments.reduce((sum, s) => sum + s.frames, 0)).toBe(957);
    expect(() => buildShotH3MultisegPrompt({ videoDesc: "剑修立于竹林。", durationTarget: 41, policy: "ambient" }))
      .toThrow(/超过 multiseg 40 秒硬顶.*拒派/);
  });

  it("秒文本还原自检:每段 Math.floor(parseFloat(secondsText)×fps)===frames(M3,含 +0.001 修正路径)", () => {
    // 40s 三段 [311,306,340]:311/24=12.958333→toFixed(3)="12.958"→310.992 截断错位,+0.001 修正为 "12.959"
    const r = buildShotH3MultisegPrompt({ videoDesc: "剑修立于竹林。", durationTarget: 40, policy: "ambient" });
    expect(r.segments.map((s) => s.frames)).toEqual([311, 306, 340]);
    expect(r.segments[0]!.secondsText).toBe("12.959"); // 修正路径实证
    for (const segment of r.segments) {
      expect(Math.floor(parseFloat(segment.secondsText) * 24)).toBe(segment.frames);
    }
    // 自定义 fps 亦过自检
    const odd = buildShotH3MultisegPrompt({ videoDesc: "剑修立于竹林。", durationTarget: 20, policy: "ambient", fps: 30 });
    for (const segment of odd.segments) {
      expect(Math.floor(parseFloat(segment.secondsText) * 30)).toBe(segment.frames);
    }
  });

  it("段文案:标签行「段N:{秒}秒」独占一行+[Shot 1]+非首段锚定语+末块 overall_soundscape;声景三档", () => {
    const r = buildShotH3MultisegPrompt({ videoDesc: "剑修立于竹林。", durationTarget: 20, policy: "ambient", sound: "风穿竹叶" });
    expect(r.longPrompt).toContain("段1:10.125秒\n[Shot 1] 剑修立于竹林。");
    expect(r.longPrompt).toContain("段2:9.917秒\n[Shot 1] 承接上段结尾画面与人物状态,剑修立于竹林。");
    expect(r.longPrompt.endsWith("overall_soundscape: 风穿竹叶")).toBe(true);
    expect(r.longPrompt).not.toContain("FIXED_I2V"); // multiseg 提示词不带 FIXED_I2V 行(§14.1.1 针2 注)
    const bare = buildShotH3MultisegPrompt({ videoDesc: "剑修立于竹林。", durationTarget: 5, policy: "bare" });
    expect(bare.soundscape).toBe("Minimal ambient sound only.");
    const noSound = buildShotH3MultisegPrompt({ videoDesc: "剑修立于竹林。", durationTarget: 5, policy: "ambient" });
    expect(noSound.soundscape).toBe("Quiet ambience matching the scene.");
  });

  it("policy=full:台词逐字入段且整句分配(句边界切,单句永不跨段)+说话人编号跨段一致+逐字过门", () => {
    const lines = "甲：先走。\n乙：我知道。\n甲：小心脚下。\n乙：多谢。";
    const r = buildShotH3MultisegPrompt({ videoDesc: "雨夜石桥对峙。", durationTarget: 20, lines, policy: "full", voiceMood: "克制" });
    // 台词按段时长比例整句分配:两段各 2 句,每句完整在场(无跨段拆句)
    const planned = extractPlannedDialogueTexts(lines);
    expect(planned).toEqual(["先走。", "我知道。", "小心脚下。", "多谢。"]);
    expect(verifyPlannedTextVerbatim(r.longPrompt, planned).ok).toBe(true);
    for (const text of planned) {
      expect(r.longPrompt).toContain(`<d>[Chinese] ${text}</d>`); // 整句入段(非拼接碎句)
    }
    expect(r.longPrompt).toContain("says in a 克制 tone"); // voiceMood 锚同 i2v 口径
    // 说话人编号跨段一致:甲恒 S1、乙恒 S2(不随段重排)
    expect(r.longPrompt).toContain("甲 (S1) says");
    expect(r.longPrompt).toContain("乙 (S2) says");
    expect(r.longPrompt).not.toMatch(/乙 \(S1\)/);
  });

  it("ambient/bare:台词不进段(走外挂 TTS 线,清单空不拦)", () => {
    for (const policy of ["ambient", "bare"] as const) {
      const r = buildShotH3MultisegPrompt({ videoDesc: "雨夜石桥对峙。", durationTarget: 20, lines: "甲：先走。", policy });
      expect(r.longPrompt).not.toContain("<d>");
      expect(r.longPrompt).not.toContain("先走。");
      expect(verifyPlannedTextVerbatim(r.longPrompt, []).ok).toBe(true);
    }
  });
});
