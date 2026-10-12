import { describe, expect, it } from "vitest";
import {
  analyzeScriptDraft,
  formatScriptDraftMetrics,
} from "./script-draft-metrics";

/**
 * 剧本确定性自检指标(G20/G25/G26/D2/父 I8):全部用合成短夹具(G21)。
 * 解析契约取自 b-plus-script-ch1.md / -glm.md 实样结构:
 * 粗体场头 `**1-1 …**`、裸场头(缺 ·约N秒)、同行语音 `名：内容`、
 * 行尾冒号+续行 `V.S.（…）：`、`人物：` 行、头部第三行画幅自述。
 */

// 主夹具:16:9 自述、2 分钟(beatLimit=⌊120/10⌋=12、语音上限 300 字、单句上限 20 字)
const FIXTURE_16_9 = [
  "# 测试作品 EP01：测试集",
  "# 范围与目标：测试范围 | 时长：2分钟",
  "# 已确定要求：测试画风/16:9横屏/中文对白/无音乐",
  "",
  "---",
  "",
  "## 剧情梗概",
  "",
  "测试梗概。",
  "",
  "---",
  "",
  "**1-1 码头 晨/外**  ",
  "人物：甲 乙 众矿奴若干",
  "",
  "△环境描述一。",
  "甲：你来啦！",
  "",
  "V.S.（旁白，冷）：",
  "旁白句一。",
  "",
  "△动作描述。",
  "OS（甲，克制）：内心一句话。 | 环境音：海浪",
  "",
  "1-2 室内 夜/内 ·约30秒",
  "人物：甲",
  "",
  "△描述。",
  "乙：好。",
].join("\n");

describe("analyzeScriptDraft 解析口径(D2)", () => {
  it("场头:粗体 **…** 剥离、行尾空格 trim、缺 ·约N秒 → seconds=null 并入 flags", () => {
    const m = analyzeScriptDraft(FIXTURE_16_9, { durationMin: 2 });
    expect(m.scenes).toHaveLength(2);
    expect(m.scenes[0]).toMatchObject({ id: "1-1", title: "码头 晨/外", seconds: null, beats: 2 });
    expect(m.scenes[1]).toMatchObject({ id: "1-2", seconds: 30, beats: 1 });
    expect(m.flags).toContain("场 1-1 缺·约N秒标注");
  });

  it("语音行:同行内容;V.S.（旁白…）计 OS;人物：行跳过;字数去标点空白", () => {
    const m = analyzeScriptDraft(FIXTURE_16_9, { durationMin: 2 });
    // 对白:甲「你来啦！」→3 字 + 乙「好。」→1 字
    expect(m.dialogueChars).toBe(4);
    // OS:V.S.（旁白，冷）续行「旁白句一。」→4 字;OS（甲，克制）句本体「内心一句话」→5 字
    expect(m.osChars).toBe(9);
    // 人物：行不计对白
    expect(m.voiceCharLimit).toBe(300);
  });

  it("G25:超长句按句本体计量,行内「| 环境音」注释列不计入字数", () => {
    const m = analyzeScriptDraft(FIXTURE_16_9, { durationMin: 2 });
    // OS（甲，克制）句本体 5 字,注释列「| 环境音：海浪」剥离后不产生超长句
    expect(m.overlongLines).toHaveLength(0);
    expect(m.scenes[0]?.voiceChars).toBe(3 + 4 + 5);
  });

  it("父 D2:非旁白括注的 V.S. 计对白(画外对白不虚增 OS)——实样 out/b-plus-script-ch1.md:151 形态", () => {
    const fixture = [
      "# 测试 EP01：x",
      "# 范围与目标：x | 时长：2分钟",
      "# 已确定要求：x/16:9横屏/x",
      "",
      "1-1 客栈 夜/内 ·约30秒",
      "人物：宗门弟子甲 乙",
      "",
      "V.S.（宗门弟子甲，随意）：",
      "灵矿产量又涨了。",
      "",
      "V.S.（宗门弟子乙，含笑）：师傅说明年还能翻倍。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 2 });
    // 「灵矿产量又涨了」7 字 + 「师傅说明年还能翻倍」9 字,均计对白;OS 为 0
    expect(m.dialogueChars).toBe(7 + 9);
    expect(m.osChars).toBe(0);
    expect(m.osRatio).toBe(0);
  });

  it("SFX 行不计入语音:配方不入对白/OS/场语音字数,长配方不伪造超长句(手册 §三 音效意图)", () => {
    const fixture = [
      "# 测试 EP01：x",
      "# 范围与目标：x | 时长：1分钟",
      "# 已确定要求：x/16:9横屏/x",
      "",
      "1-1 码头 晨/外 ·约60秒",
      "SFX（紧张）：铁链拖地声渐近+心跳声+突然静音",
      "甲：好。",
      "SFX（惊）：",
      "茶杯摔碎声+人群倒吸气",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    // 仅「好。」1 字入语音;14 字同行配方与续行配方均不入账
    expect(m.dialogueChars).toBe(1);
    expect(m.osChars).toBe(0);
    expect(m.scenes[0]?.voiceChars).toBe(1);
    // 「茶杯摔碎声+人群倒吸气+椅子翻倒声+脚步声杂沓远去」级长配方若误计即超 20 上限
    expect(m.overlongLines).toHaveLength(0);
  });

  it("场秒合计与目标 ±10s 对账;·约 全缺(无对账值)不误报总时长超标", () => {
    const m = analyzeScriptDraft(FIXTURE_16_9, { durationMin: 2 });
    // 仅 1-2 有秒数:合计 30s vs 目标 120s,偏离 90s > 10s → flag
    expect(m.totalSeconds).toBe(30);
    expect(m.targetSeconds).toBe(120);
    expect(m.flags.some((f) => f.includes("场秒合计") && f.includes("30"))).toBe(true);

    const allMissing = FIXTURE_16_9.replace(" ·约30秒", "");
    const m2 = analyzeScriptDraft(allMissing, { durationMin: 2 });
    expect(m2.scenes.every((s) => s.seconds === null)).toBe(true);
    expect(m2.flags.some((f) => f.includes("场秒合计"))).toBe(false);
    expect(m2.flags.filter((f) => f.includes("缺·约N秒"))).toHaveLength(2);
  });

  it("△ 预算:beatLimit=⌊target/10⌋(G26 单值),超限入 flags", () => {
    const m = analyzeScriptDraft(FIXTURE_16_9, { durationMin: 2 });
    expect(m.beats).toBe(3);
    expect(m.beatLimit).toBe(12);
    expect(m.flags.some((f) => f.includes("个超上限"))).toBe(false);

    // 2 分钟上限 12:塞 13 个 △ → flag
    const beats = Array.from({ length: 13 }, (_, i) => `△动作${i}。`).join("\n");
    const over = `# 已确定要求：x/16:9/y\n\n1-1 场 晨/外 ·约30秒\n人物：甲\n\n${beats}\n`;
    const mOver = analyzeScriptDraft(over, { durationMin: 2 });
    expect(mOver.beats).toBe(13);
    expect(mOver.flags.some((f) => f.includes("△ 13") && f.includes("12"))).toBe(true);
  });

  it("OS 占比 >40% 入 flags;语音字数超 150字/分钟 上限入 flags(恰 150 等值不报)", () => {
    const m = analyzeScriptDraft(FIXTURE_16_9, { durationMin: 2 });
    // OS 9 / 总 13 ≈ 69% > 40%
    expect(m.osRatio).toBeCloseTo(9 / 13, 5);
    expect(m.flags.some((f) => f.includes("OS 占比"))).toBe(true);
    expect(m.flags.some((f) => f.includes("语音字数"))).toBe(false);

    // 1 分钟 → 语音上限 150 字:每行 10 字(9×「十」+数字),15 行恰 150 不报、16 行 160 报
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => `甲：${"十".repeat(9)}${i % 10}`).join("\n");
    const head = "# 已确定要求：x/16:9/y\n\n1-1 场 晨/外 ·约60秒\n人物：甲\n\n";
    const atLimit = analyzeScriptDraft(`${head}${lines(15)}\n`, { durationMin: 1 });
    expect(atLimit.voiceCharLimit).toBe(150);
    expect(atLimit.flags.some((f) => f.includes("语音字数"))).toBe(false);
    const overLimit = analyzeScriptDraft(`${head}${lines(16)}\n`, { durationMin: 1 });
    expect(overLimit.flags.some((f) => f.includes("语音字数") && f.includes("150"))).toBe(true);
  });

  it("父 I8:画幅真源=头部第三行自述,16:9→单句上限 20 字", () => {
    const line21 = "OS（甲）：甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌";
    const fixture = `# 测试 EP01：x\n# 范围与目标：x | 时长：2分钟\n# 已确定要求：x/16:9横屏/x\n\n1-1 场 晨/外 ·约30秒\n人物：甲\n\n${line21}\n`;
    const m = analyzeScriptDraft(fixture, { durationMin: 2 });
    expect(m.lineLimit).toBe(20);
    expect(m.overlongLines).toHaveLength(1);
    expect(m.overlongLines[0]).toMatchObject({ scene: "1-1", chars: 21 });
    expect(m.flags.some((f) => f.includes("超长句 1"))).toBe(true);
  });

  it("父 I8:9:16 自述变体 → 单句上限 15 字,16 字对白即超长", () => {
    const line16 = "甲：甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳";
    const fixture = `# 测试 EP01：x\n# 范围与目标：x | 时长：2分钟\n# 已确定要求：x/9:16竖屏/x\n\n1-1 场 晨/外 ·约30秒\n人物：甲\n\n${line16}\n`;
    const m = analyzeScriptDraft(fixture, { durationMin: 2 });
    expect(m.lineLimit).toBe(15);
    expect(m.overlongLines).toHaveLength(1);
    expect(m.overlongLines[0]?.chars).toBe(16);
  });

  it("父 I8 优先级:头部自述 16:9 优先于 opts.aspectRatio 9:16 → 上限取 20", () => {
    const line16 = "甲：甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳";
    const fixture = `# 测试 EP01：x\n# 范围与目标：x | 时长：2分钟\n# 已确定要求：x/16:9横屏/x\n\n1-1 场 晨/外 ·约30秒\n人物：甲\n\n${line16}\n`;
    const m = analyzeScriptDraft(fixture, { durationMin: 2, aspectRatio: "9:16" });
    expect(m.lineLimit).toBe(20);
    // 16 字@20 不超;若误取 opts 9:16(15) 则会误报超长
    expect(m.overlongLines).toHaveLength(0);
  });

  it("父 I8:「16:9」出现在非头部自述的第三行不作为真源(仍走 opts 兜底)", () => {
    const line16 = "甲：甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳";
    const fixture = `# 测试 EP01：x\n# 范围与目标：x | 时长：2分钟\n# 备选说明：x（画幅 16:9 备选，未定）\n\n1-1 场 晨/外 ·约30秒\n人物：甲\n\n${line16}\n`;
    const m = analyzeScriptDraft(fixture, { durationMin: 2, aspectRatio: "9:16" });
    expect(m.lineLimit).toBe(15);
    // 16 字@15 超长;若误把非头部第三行的「16:9」当真源(上限 20)则会漏报
    expect(m.overlongLines).toHaveLength(1);
  });

  it("头部无画幅自述 → opts.aspectRatio 兜底;再缺省 → 16:9", () => {
    const fixture = "1-1 场 晨/外 ·约30秒\n人物：甲\n\n甲：好。\n";
    const mFallback = analyzeScriptDraft(fixture, { durationMin: 2, aspectRatio: "9:16" });
    expect(mFallback.lineLimit).toBe(15);
    const mDefault = analyzeScriptDraft(fixture, { durationMin: 2 });
    expect(mDefault.lineLimit).toBe(20);
  });

  it("durationMin 缺省 3 分钟;格式漂移(无场次)给 0/null 并入 flags,永不抛错", () => {
    const m = analyzeScriptDraft(FIXTURE_16_9);
    expect(m.targetSeconds).toBe(180);
    expect(m.beatLimit).toBe(18);

    const drift = analyzeScriptDraft("完全不是剧本的乱文本\n第二行", { durationMin: 2 });
    expect(drift.scenes).toHaveLength(0);
    expect(drift.beats).toBe(0);
    expect(drift.dialogueChars + drift.osChars).toBe(0);
    expect(drift.flags.some((f) => f.includes("未识别到场次"))).toBe(true);
    expect(() => analyzeScriptDraft("", {})).not.toThrow();
  });
});

describe("等值边界(手册条款=严格大于才超标,恰达上限不报)", () => {
  it("单句恰 20 字@16:9 不超长(21 字才报)", () => {
    const line20 = "甲：甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉"; // 句本体恰 20 字
    const fixture = `# 测试 EP01：x\n# 范围与目标：x | 时长：1分钟\n# 已确定要求：x/16:9横屏/x\n\n1-1 场 晨/外 ·约60秒\n人物：甲\n\n${line20}\n`;
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.lineLimit).toBe(20);
    expect(m.overlongLines).toHaveLength(0);
    expect(m.flags.some((f) => f.includes("超长句"))).toBe(false);

    const over = fixture.replace(line20, `${line20}戌`); // 21 字
    const mOver = analyzeScriptDraft(over, { durationMin: 1 });
    expect(mOver.overlongLines).toHaveLength(1);
  });

  it("△ 恰等于 beatLimit 不超标(2 分钟=12 个;13 个才报)", () => {
    const beats = Array.from({ length: 12 }, (_, i) => `△动作${i}。`).join("\n");
    const fixture = `# 已确定要求：x/16:9/y\n\n1-1 场 晨/外 ·约120秒\n人物：甲\n\n${beats}\n甲：好。\n`;
    const m = analyzeScriptDraft(fixture, { durationMin: 2 });
    expect(m.beats).toBe(12);
    expect(m.beatLimit).toBe(12);
    expect(m.flags.some((f) => f.includes("个超上限"))).toBe(false);
  });

  it("OS 占比恰 40% 不超标(OS=4/语音总=10;>40% 才报)", () => {
    const fixture = [
      "# 测试 EP01：x",
      "# 范围与目标：x | 时长：1分钟",
      "# 已确定要求：x/16:9横屏/x",
      "",
      "1-1 场 晨/外 ·约60秒",
      "人物：甲 乙",
      "",
      "甲：你说对", // 对白 3
      "乙：没错呀", // 对白 3
      "OS（甲）：再想想看", // OS 4 → 4/10 = 0.4
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.osRatio).toBe(0.4);
    expect(m.flags.some((f) => f.includes("OS 占比"))).toBe(false);
  });

  it("场秒合计偏离恰 10s 不超标(±10s 允许:70/50 vs 60 均不报;71 才报)", () => {
    const mk = (sec: number) =>
      `# 已确定要求：x/16:9/y\n\n1-1 场 晨/外 ·约${sec}秒\n人物：甲\n\n△动作。\n甲：好。\n`;
    expect(analyzeScriptDraft(mk(70), { durationMin: 1 }).flags.some((f) => f.includes("场秒合计"))).toBe(false);
    expect(analyzeScriptDraft(mk(50), { durationMin: 1 }).flags.some((f) => f.includes("场秒合计"))).toBe(false);
    expect(analyzeScriptDraft(mk(71), { durationMin: 1 }).flags.some((f) => f.includes("场秒合计"))).toBe(true);
  });
});

describe("flags 去重(返回前 [...new Set(flags)])", () => {
  it("同 id 场重复缺 ·约N秒 标注只报一次(React key 重复与重复报告双治)", () => {
    const fixture = [
      "# 测试 EP01：x",
      "# 范围与目标：x | 时长：1分钟",
      "# 已确定要求：x/16:9横屏/x",
      "",
      "1-1 场 晨/外",
      "人物：甲",
      "",
      "甲：好。",
      "",
      "1-1 场 夜/内",
      "人物：甲",
      "",
      "乙：行。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.flags.filter((f) => f === "场 1-1 缺·约N秒标注")).toHaveLength(1);
    expect(new Set(m.flags).size).toBe(m.flags.length);
  });
});

describe("formatScriptDraftMetrics(父 I5 标题)", () => {
  it("首行=「## 自检指标（代码计算，以此为准）」,含对账数值与 flags", () => {
    const m = analyzeScriptDraft(FIXTURE_16_9, { durationMin: 2 });
    const text = formatScriptDraftMetrics(m);
    const lines = text.split("\n");
    expect(lines[0]).toBe("## 自检指标（代码计算，以此为准）");
    expect(text).toContain("场秒合计：30s");
    expect(text).toContain("目标 120s");
    expect(text).toContain("△ 3");
    expect(text).toContain("上限 12");
    expect(text).toContain("OS 占比");
    expect(text).toContain("缺·约N秒标注");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("NaN");
  });

  it("全达标时结论行=「自检通过」,无 flags 字样", () => {
    const fixture = [
      "# 测试 EP01：x",
      "# 范围与目标：x | 时长：1分钟",
      "# 已确定要求：x/16:9横屏/x",
      "",
      "1-1 场 晨/外 ·约60秒",
      "人物：甲",
      "",
      "△动作。",
      "甲：你来啦！",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.flags).toHaveLength(0);
    const text = formatScriptDraftMetrics(m);
    expect(text).toContain("自检通过");
  });
});
