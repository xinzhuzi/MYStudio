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
    expect(m.scenes[1]).toMatchObject({ id: "1-2", title: "室内 夜/内", seconds: 30, beats: 1 });
    expect(m.flags).toContain("场 1-1 缺·约N秒标注");
  });

  it("裸场号兼容(10-12 装机实弹:glm-5.3 用裸数字「2」…「6」):「2 码头 晨/外 ·约30秒」识别为场 2", () => {
    const fixture = [
      "# 已确定要求：x/16:9/y",
      "",
      "2 码头 晨/外 ·约30秒",
      "人物：甲",
      "",
      "△动作。",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.scenes).toHaveLength(1);
    expect(m.scenes[0]).toMatchObject({ id: "2", title: "码头 晨/外", seconds: 30, beats: 1 });
    // 仅 ·约N秒 锚(无「/」)的裸数字形态同样识别;缺锚普通行不误吞为场头
    const anchored = analyzeScriptDraft("# 已确定要求：x/16:9/y\n\n3 山道 ·约45秒\n人物：甲\n", { durationMin: 1 });
    expect(anchored.scenes[0]).toMatchObject({ id: "3", seconds: 45 });
    const noAnchor = analyzeScriptDraft("# 已确定要求：x/16:9/y\n\n3 个小时后他回来了。\n甲：好。\n", { durationMin: 1 });
    expect(noAnchor.scenes).toHaveLength(0);
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

  it("续行停扫:空内容语音行的下一行是语音/SFX 行形态即停,该行留给主循环独立解析(不整行吞并)", () => {
    // 「甲：」空内容,下一行「乙：好。」是语音行 → 停;乙行按乙解析 → 对白仅「好」1 字
    const f1 = ["# 已确定要求：x/16:9/y", "", "1-1 场 晨/外 ·约30秒", "人物：甲 乙", "", "甲：", "乙：好。"].join("\n");
    const m1 = analyzeScriptDraft(f1, { durationMin: 1 });
    expect(m1.dialogueChars).toBe(1);

    // 「OS（甲，克制）：」空内容,下一行 SFX 行形态 → 停:osChars=0 且 SFX 配方不入语音账
    const f2 = ["# 已确定要求：x/16:9/y", "", "1-1 场 晨/外 ·约30秒", "OS（甲，克制）：", "SFX（惊）：配方"].join("\n");
    const m2 = analyzeScriptDraft(f2, { durationMin: 1 });
    expect(m2.osChars).toBe(0);
    expect(m2.dialogueChars).toBe(0);
    expect(m2.overlongLines).toHaveLength(0);
  });

  it("场秒合计对账口径(10-12 迁移):存在缺标注场只报逐场缺标注,全部有秒才对账总时长", () => {
    const m = analyzeScriptDraft(FIXTURE_16_9, { durationMin: 2 });
    // 旧「部分有秒即对账」口径废止:1-1 缺标注 → 不再报「合计 30s 偏离 120s」总偏差 flag
    expect(m.totalSeconds).toBe(30);
    expect(m.targetSeconds).toBe(120);
    expect(m.flags.some((f) => f.includes("场秒合计"))).toBe(false);
    expect(m.flags).toContain("场 1-1 缺·约N秒标注");

    const allMissing = FIXTURE_16_9.replace(" ·约30秒", "");
    const m2 = analyzeScriptDraft(allMissing, { durationMin: 2 });
    expect(m2.scenes.every((s) => s.seconds === null)).toBe(true);
    expect(m2.flags.some((f) => f.includes("场秒合计"))).toBe(false);
    expect(m2.flags.filter((f) => f.includes("缺·约N秒"))).toHaveLength(2);

    // 全部有秒才对账:1-1 ·约10秒 + 1-2 ·约30秒 = 40s vs 目标 120s → 偏离 flag
    const allPresent = FIXTURE_16_9.replace("**1-1 码头 晨/外**", "**1-1 码头 晨/外 ·约10秒**");
    const m3 = analyzeScriptDraft(allPresent, { durationMin: 2 });
    expect(m3.scenes.every((s) => s.seconds !== null)).toBe(true);
    expect(m3.flags.some((f) => f.includes("场秒合计") && f.includes("40"))).toBe(true);
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
    // G44 文案人话化:计数口径不变,flag 串改「镜头」(旧 △ 夹具=向后兼容锁,断言 beats 数不变)
    expect(mOver.flags).toContain("镜头 13 个超上限 12（每镜头按 10 秒预算）");
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
    // 本夹具场 1-1 缺·约 → 展示层与新对账口径一致:不对账,不挂 ±10s 数字对账行
    expect(text).toContain("场秒对账：1 个场缺·约N秒标注，总时长不对账");
    expect(text).not.toContain("允许 ±10s");
    // G44 文案人话化:视觉预算/场摘要改「镜头/镜」,本夹具输出不再含 △ 字样
    expect(text).toContain("视觉预算：镜头 3 个（上限 12，每镜头按 10 秒预算）");
    expect(text).toContain("·镜2·"); // 场 1-1 两个 △ → 场摘要 ·镜N·
    expect(text).toContain("·镜1·"); // 场 1-2 一个 △
    expect(text).not.toContain("△");
    expect(text).toContain("OS 占比");
    expect(text).toContain("缺·约N秒标注");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("NaN");
  });

  it("全部有秒才输出数字对账行;裸场号防误吞收口径——叙述行不入场、留作续行内容", () => {
    const all = analyzeScriptDraft(
      "# 已确定要求：x/16:9/y\n\n1-1 场 晨/外 ·约30秒\n人物：甲\n\n1-2 场 夜/内 ·约30秒\n\n甲：好。\n",
      { durationMin: 1 },
    );
    expect(formatScriptDraftMetrics(all)).toContain("场秒合计：60s");
    // 「3 年后/开春，河雾照旧。」含「/」但行末带正文 → 不吞为幻影场,作 OS 续行内容保留
    const phantom = analyzeScriptDraft(
      "# 已确定要求：x/16:9/y\n\n1-1 场 晨/外 ·约60秒\n人物：甲\n\nOS（旁白）：\n3 年后/开春，河雾照旧。\n",
      { durationMin: 1 },
    );
    expect(phantom.scenes).toHaveLength(1);
    expect(phantom.osChars).toBe(9); // 「3年后开春河雾照旧」9 字(行首数字计入句本体)
    expect(phantom.flags).not.toContain("场 3 缺·约N秒标注");
    // 裸数字紧凑形态(装机实弹 glm-5.3 实况)仍识别
    const bare = analyzeScriptDraft(
      "# 已确定要求：x/16:9/y\n\n2 码头 晨/外 ·约30秒\n人物：甲\n\n甲：好。\n",
      { durationMin: 1 },
    );
    expect(bare.scenes[0]).toMatchObject({ id: "2", seconds: 30 });
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

describe("F2 场外语音不计(在场内状态:命中场头置真,遇 # 开头行置假)", () => {
  it("首场之前的梗概「名：内容」行不计对白不报超长;## 改编追踪之后的「删减理由：…」「新增：无」不计", () => {
    const fixture = [
      "# 测试 EP01：x",
      "# 范围与目标：x | 时长：1分钟",
      "# 已确定要求：x/16:9横屏/x",
      "",
      "## 剧情梗概",
      "",
      // 场外梗概行:句本体 22 字 > 20 上限,修复前误计对白并误报超长句
      "晏燎：一个呼吸暗合天地的少年，在夜课上被独孤剑尘察觉。",
      "",
      "1-1 码头 晨/外 ·约60秒",
      "人物：甲",
      "",
      "甲：好。",
      "",
      "## 改编追踪",
      "",
      "删减理由：矿奴装船细节压缩为转场带过。",
      "新增：无",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    // 场内仅「甲：好。」1 字;梗概行与追踪区两行均不计对白/不入场语音字数
    expect(m.dialogueChars).toBe(1);
    expect(m.osChars).toBe(0);
    expect(m.overlongLines).toHaveLength(0);
    expect(m.flags.some((f) => f.includes("超长句"))).toBe(false);
    expect(m.scenes[0]?.voiceChars).toBe(1);
  });

  it("场内语音照常计入;# 行出场后遇新场头重新入场,语音归属新场", () => {
    const fixture = [
      "1-1 码头 晨/外 ·约30秒",
      "人物：甲",
      "",
      "甲：场内句。",
      "## 改编追踪",
      "删减理由：x。",
      "1-2 室内 夜/内 ·约30秒",
      "人物：乙",
      "",
      "乙：回来。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    // 「场内句」3 字 + 「回来」2 字;中间「删减理由：x。」不计
    expect(m.dialogueChars).toBe(5);
    expect(m.scenes[0]?.voiceChars).toBe(3);
    expect(m.scenes[1]?.voiceChars).toBe(2);
  });
});

describe("F4 逐场对账(手册「九、时长与视觉预算」:△数×10s ≤ 场秒+10;语音字数 ≤ ⌊场秒×2.5⌋)", () => {
  it("1 场 ·约20秒 + 4△ + 60 字台词 → △ 与语音两条 flag 均出现", () => {
    const fixture = [
      "# 已确定要求：x/16:9/y",
      "",
      "1-1 场 晨/外 ·约20秒",
      "人物：甲",
      "",
      "△动作一。",
      "△动作二。",
      "△动作三。",
      "△动作四。",
      // 3 行 × 20 字 = 60 字,每行恰 20 字不触超长句
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(20)}`,
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    // 4△×10s=40 > 20+10=30 → 镜头超场(G44 文案:△→镜头);60 字 > ⌊20×2.5⌋=50 → 语音超场
    expect(m.flags).toContain("场 1-1 镜头 4 个×10s 超本场 20s+10");
    expect(m.flags).toContain("场 1-1 语音 60 字超本场上限 50");
  });

  it("缺秒场不判;等值边界(n×10 = s+10、字数恰 = ⌊s×2.5⌋)不报", () => {
    // 缺 ·约N秒 的场塞 5△+60 字(若误判即两条 flag)→ 只报缺标注,不判逐场对账
    const missing = [
      "# 已确定要求：x/16:9/y",
      "",
      "1-2 场 夜/内",
      "人物：甲",
      "",
      ...Array.from({ length: 5 }, (_, i) => `△动作${i}。`),
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(20)}`,
    ].join("\n");
    const mMissing = analyzeScriptDraft(missing, { durationMin: 1 });
    expect(mMissing.flags).toContain("场 1-2 缺·约N秒标注");
    expect(mMissing.flags.some((f) => f.includes("超本场"))).toBe(false);

    // ·约30秒 + 4△(4×10=40 = 30+10 等值) + 75 字(恰 = ⌊30×2.5⌋) → 均不报
    const equal = [
      "# 已确定要求：x/16:9/y",
      "",
      "1-1 场 晨/外 ·约30秒",
      "人物：甲",
      "",
      ...Array.from({ length: 4 }, (_, i) => `△动作${i}。`),
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(15)}`,
    ].join("\n");
    const mEqual = analyzeScriptDraft(equal, { durationMin: 1 });
    expect(mEqual.flags.some((f) => f.includes("超本场"))).toBe(false);
  });
});

describe("F6 场号格式漂移(N-M 与裸数字混用 → flag)", () => {
  it("同一剧本内 1-1 与裸 2 混用 → flag「场号格式不一致(N-M 与裸数字混用)」", () => {
    const fixture = [
      "# 已确定要求：x/16:9/y",
      "",
      "1-1 场 晨/外 ·约30秒",
      "人物：甲",
      "",
      "甲：好。",
      "",
      "2 场 夜/内 ·约30秒",
      "人物：乙",
      "",
      "乙：行。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.flags).toContain("场号格式不一致(N-M 与裸数字混用)");
  });

  it("单一形态(全 N-M 或全裸数字)不报", () => {
    const allRange = analyzeScriptDraft(
      "# 已确定要求：x/16:9/y\n\n1-1 场 晨/外 ·约30秒\n人物：甲\n\n甲：好。\n\n1-2 场 夜/内 ·约30秒\n",
      { durationMin: 1 },
    );
    expect(allRange.flags).not.toContain("场号格式不一致(N-M 与裸数字混用)");
    const allBare = analyzeScriptDraft(
      "# 已确定要求：x/16:9/y\n\n2 场 晨/外 ·约30秒\n人物：甲\n\n甲：好。\n\n3 场 夜/内 ·约30秒\n",
      { durationMin: 1 },
    );
    expect(allBare.flags).not.toContain("场号格式不一致(N-M 与裸数字混用)");
  });
});

// G44 双格式节拍识别:`镜头N：` 人话格式为手册现行,`△` 为存量兼容(禁删——用户项目库存量
// 剧本全是 △,机检不能瞎)。向后兼容锁=本文件既有 △ 用例(FIXTURE_16_9 主夹具 beats=3、
// 「△ 预算」beats=13、「△ 恰等于 beatLimit」beats=12、F4 4△ 逐场对账)全保留,计数断言不变。
describe("G44 双格式节拍识别(镜头N： 与 △ 并存,合计入 beats 与场内 beats)", () => {
  const HEAD = "# 已确定要求：x/16:9/y";

  it("新格式:镜头N： 行计一拍(全集与场内),序号后空格/全半角冒号均可;镜头行本身不是语音", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约30秒",
      "人物：甲",
      "",
      "镜头1：码头晨光，众人扛包。",
      "镜头 2：铁链声里，甲抬头。",
      "镜头3:乙望向远岸。",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.beats).toBe(3);
    expect(m.scenes[0]?.beats).toBe(3);
    // 行内容不入场语音账(名字「镜头N」不得误计为对白),语音仅「甲：好」1 字
    expect(m.dialogueChars).toBe(1);
  });

  it("转场括注形态(手册明教):镜头N（方式）：计一拍,括注与描述不入语音账(复审实锤收口)", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约30秒",
      "人物：甲",
      "",
      "镜头1：码头晨光，众人扛包。",
      "镜头2（叠化）：雪夜闪回，墨色漫过山门。",
      "镜头3(切):乙望向远岸。",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.beats).toBe(3);
    expect(m.scenes[0]?.beats).toBe(3);
    // 括注行整行不得落 VOICE_LINE_RE 计为「镜头2」的台词——语音仅「好」1 字
    expect(m.dialogueChars).toBe(1);
    expect(m.overlongLines).toHaveLength(0); // 镜头描述(可>20字)不是台词,不报超长
  });

  it("F2 同款门控:场外(## 改编追踪 之后)镜头行不计拍——人话前缀场外暴露面大于 △", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约30秒",
      "人物：甲",
      "",
      "镜头1：码头晨光。",
      "## 改编追踪",
      "镜头1：此镜头为新增画面说明。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.beats).toBe(1);
    expect(m.scenes[0]?.beats).toBe(1);
  });

  it("格式漂移路径输出零 △:无场次文本的 flag 文案已人话化(复审漏网收口)", () => {
    const m = analyzeScriptDraft("完全不是剧本的乱文本\n第二行", { durationMin: 1 });
    const text = formatScriptDraftMetrics(m);
    expect(text).toContain("未识别到场次段落");
    expect(text).not.toContain("△");
  });

  it("防误吞:纯数字行、无冒号的「镜头 N」叙述行、追踪表格行不是镜头", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约30秒",
      "人物：甲",
      "",
      "12",
      "镜头 1 删了半拍。",
      "| 1 | 镜头1：码头 | 压缩 |",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.beats).toBe(0);
    expect(m.dialogueChars).toBe(1);
  });

  it("混合格式:同剧本 △ 与 镜头N： 混用正常合计(全集/场内/逐场对账 flag 均按合计拍数)", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约20秒",
      "人物：甲",
      "",
      "△动作。",
      "镜头1：晨光扫过船头。",
      "△又一拍。",
      "镜头 2：乙入场。",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.beats).toBe(4); // 2△ + 2镜头
    expect(m.scenes[0]?.beats).toBe(4);
    // 4 拍×10s=40 > 20+10=30 → 逐场 flag 按合计拍数报
    expect(m.flags).toContain("场 1-1 镜头 4 个×10s 超本场 20s+10");
  });

  it("续行停扫:空内容语音行的下一行是镜头行即停,镜头行不被吞为语音续行", () => {
    const fixture = [HEAD, "", "1-1 场 晨/外 ·约30秒", "人物：甲", "", "甲：", "镜头1：码头晨光。"].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.beats).toBe(1);
    expect(m.dialogueChars).toBe(0); // 「镜头1：码头晨光。」不得被当作甲的台词续行
  });
});
