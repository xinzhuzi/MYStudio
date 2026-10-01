import { describe, expect, it } from "vitest";

import { buildShotH3Prompt, buildShotH3RefPrompt, extractPlannedDialogueTexts, mapH3CameraMove, verifyPlannedTextVerbatim } from "./h3-shot-prompt";

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

  it("renders full-policy dialogue with speaker and narrator wording", () => {
    const result = buildShotH3Prompt({
      videoDesc: "Two people wait in a doorway.",
      lines: "甲：先走。\n旁白：雨声盖过脚步。\n乙: 我知道。",
      durationSec: 6,
    }, "full");

    expect(result.prompt).toContain("甲 (S1) says: <d>[Chinese] 先走。</d>");
    expect(result.prompt).toContain("The narrator (S2) says in an off-screen voiceover: <d>[Chinese] 雨声盖过脚步。</d> and no lips move on screen.");
    expect(result.prompt).toContain("乙 (S3) says: <d>[Chinese] 我知道。</d>");
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
  it("取每条台词正文(角色前缀剥离),与 renderDialogue 注入口径一致", () => {
    expect(extractPlannedDialogueTexts("甲：先走。\n旁白：雨声盖过脚步。\n乙: 我知道。"))
      .toEqual(["先走。", "雨声盖过脚步。", "我知道。"]);
    expect(extractPlannedDialogueTexts("无冒号整条即正文")).toEqual(["无冒号整条即正文"]);
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
