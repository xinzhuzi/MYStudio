import { describe, expect, it } from "vitest";
import * as scriptDraftMetrics from "./script-draft-metrics";

// R15:区间常量经 namespace 解构取用——导出缺失时 RED 落在用例上(「expected undefined」,
// 模块仍可加载、其余用例照跑),不落整文件加载失败(41ff54da RED-1 同款先例)。
const {
  analyzeScriptDraft,
  formatScriptDraftMetrics,
  VOICE_CPS_MAX,
  VOICE_CPS_MIN,
} = scriptDraftMetrics;

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
    expect(m.voiceCharLimit).toBe(480);
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

  it("OS 占比 >40% 入 flags;语音字数超区间上限(4 字/秒=240 字/分钟,超标判定用 MAX)入 flags", () => {
    const m = analyzeScriptDraft(FIXTURE_16_9, { durationMin: 2 });
    // OS 9 / 总 13 ≈ 69% > 40%
    expect(m.osRatio).toBeCloseTo(9 / 13, 5);
    expect(m.flags.some((f) => f.includes("OS 占比"))).toBe(true);
    expect(m.flags.some((f) => f.includes("语音字数"))).toBe(false);

    // 1 分钟 → 语音上限 240 字(Q1 区间上限 4 字/秒=VOICE_CPS_MAX,超标判定端;估算端 2.5 不进 flags 面):
    // 每行 10 字(9×「十」+数字),24 行恰 240 不报、25 行 250 报
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => `甲：${"十".repeat(9)}${i % 10}`).join("\n");
    const head = "# 已确定要求：x/16:9/y\n\n1-1 场 晨/外 ·约60秒\n人物：甲\n\n";
    const atLimit = analyzeScriptDraft(`${head}${lines(24)}\n`, { durationMin: 1 });
    expect(atLimit.voiceCharLimit).toBe(240);
    expect(atLimit.flags.some((f) => f.includes("语音字数"))).toBe(false);
    const overLimit = analyzeScriptDraft(`${head}${lines(25)}\n`, { durationMin: 1 });
    expect(overLimit.flags.some((f) => f.includes("语音字数") && f.includes("4 字/秒"))).toBe(true);
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

describe("F4 逐场对账(手册「九、时长与视觉预算」:△数×10s ≤ 场秒+10;语音字数 ≤ ⌊场秒×4⌋)", () => {
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
      // 5 行 × 20 字 = 100 字,每行恰 20 字不触超长句
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(20)}`,
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    // 4△×10s=40 > 20+10=30 → 镜头超场(G44 文案:△→镜头);100 字 > ⌊20×4⌋=80 → 语音超场
    expect(m.flags).toContain("场 1-1 镜头 4 个×10s 超本场 20s+10");
    expect(m.flags).toContain("场 1-1 语音 100 字超本场上限 80");
  });

  it("缺秒场不判;等值边界(n×10 = s+10、字数恰 = ⌊s×4⌋)不报", () => {
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

    // ·约30秒 + 4△(4×10=40 = 30+10 等值) + 120 字(恰 = ⌊30×4⌋) → 均不报
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
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(20)}`,
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

// ============================================================================
// 四审B(A4-M1..M6)RED 用例矩阵(.trellis/tasks/10-13-audit4-metrics-parser
// implement.md 批1-批5;design.md §1-§6)。全部合成夹具,不拷小说原文。
// 约定:每条 RED 断言按「修复后行为」书写,当前实现必红,红因在各 it 内钉死;
// 「绿-now 回归锁」=当前即绿、修复后必须保持的护栏断言(防修复越界,design §7)。
// ============================================================================

describe("M1 多行语音计至下一结构行(design §2;根因 :203-210 吞一行即 break)", () => {
  const HEAD = "# 已确定要求：x/16:9/y";

  it("多行累加:空内容 OS 后的内容行逐行计入,遇空段停——红=现只吞首行(osChars 48≠66)", () => {
    // 形状等价锚(design §7.3):两续行 OS、首行 48 字,绿判=全额累计 48+18=66
    // (prd 验收锚「场 1-1 OS 计 66 字」的形状等价回归,恒等式不可复现见 design F11)
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约60秒",
      "人物：甲",
      "",
      "OS（甲，克制）：",
      "一".repeat(48),
      "一".repeat(18),
      "",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.osChars).toBe(48 + 18); // 红:当前=48(吞首行即 break)
    expect(m.dialogueChars).toBe(1); // 锁:空段后「甲：好。」独立解析
    expect(m.scenes[0]?.voiceChars).toBe(48 + 18 + 1);
    // 超长句逐行判(design §2):48 字行超 20 报 1 条,18 字行不报——锁修复后不变
    expect(m.overlongLines).toHaveLength(1);
    expect(m.overlongLines[0]?.chars).toBe(48);
  });

  it("一般化:对白「甲：」空内容同样多行累加(单代码路径,OS 是动机案例非特例)——红=现只吞首行", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约30秒",
      "人物：甲",
      "",
      "甲：",
      "一".repeat(12),
      "一".repeat(8),
      "",
      "乙：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.dialogueChars).toBe(12 + 8 + 1); // 红:当前=13(只吞首行 12+乙「好」1)
  });

  it("停扫:空段即停——空内容语音行与内容之间隔空行即不算——红=现跳过空行继续吞(:204 continue)", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约30秒",
      "人物：甲",
      "",
      "甲：",
      "",
      "第一段落内容。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.dialogueChars).toBe(0); // 红:当前=6(空行被跳过后吞了内容行)
  });

  it("绿-now 停扫回归锁:续行遇语音行/SFX 行/镜头行即停,修复累加后必须保持(既有 :135-147/:644-649 的多行版)", () => {
    // 语音行停:甲吞 6 字后遇「乙：好。」停,乙行独立解析
    const f1 = [HEAD, "", "1-1 场 晨/外 ·约30秒", "人物：甲", "", "甲：", "第一段落内容。", "乙：好。"].join("\n");
    const m1 = analyzeScriptDraft(f1, { durationMin: 1 });
    expect(m1.dialogueChars).toBe(6 + 1);
    // SFX 行停:OS 吞 5 字后遇 SFX 配方行停,配方不入账
    const f2 = [HEAD, "", "1-1 场 晨/外 ·约30秒", "OS（甲，克制）：", "旁白第一行。", "SFX（惊）：配方"].join("\n");
    const m2 = analyzeScriptDraft(f2, { durationMin: 1 });
    expect(m2.osChars).toBe(5);
    expect(m2.dialogueChars).toBe(0);
    // 镜头行停:甲吞 4 字后遇「镜头1：」停,镜头行计拍不入语音账
    const f3 = [HEAD, "", "1-1 场 晨/外 ·约30秒", "人物：甲", "", "甲：", "续行内容。", "镜头1：码头晨光。"].join("\n");
    const m3 = analyzeScriptDraft(f3, { durationMin: 1 });
    expect(m3.dialogueChars).toBe(4);
    expect(m3.beats).toBe(1);
  });

  it("超长句逐行判:两续行各恰 20 字不报超长(累计 40 计入)——红=osChars 40≠20;超长=0 为锁", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约60秒",
      "OS（甲，克制）：",
      "一".repeat(20),
      "一".repeat(20),
      "",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.osChars).toBe(40); // 红:当前=20
    expect(m.overlongLines).toHaveLength(0); // 逐行判:两行各自 20≤20 不超——绿-now 锁
  });

  it("绿-now 锁:单条续行 21 字报 1 条(修复只加长吞入侧,不改单行超长判定)", () => {
    const fixture = [HEAD, "", "1-1 场 晨/外 ·约30秒", "OS（甲，克制）：", "一".repeat(21)].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.osChars).toBe(21);
    expect(m.overlongLines).toHaveLength(1);
  });
});

describe("M2 说话人组净化:叙述冒号行不入语音(design §3;livefire8 锚 F2/F12)", () => {
  const HEAD = "# 已确定要求：x/16:9/y";

  it("名含中文句读(，)→非语音——红=现整行计对白(名组不排中文标点,:72)", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约30秒",
      "人物：甲",
      "",
      "他看向窗外，压低了声音说道：来吧。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.dialogueChars).toBe(0); // 红:当前=2(「他看向窗外，压低了声音说道」过名组)
    expect(m.scenes[0]?.voiceChars).toBe(0);
    expect(m.overlongLines).toHaveLength(0);
  });

  it("超长无标点叙述名(13 字>VOICE_NAME_MAX 10)→非语音——红=现计对白(单测长度网)", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约30秒",
      "人物：甲",
      "",
      "月光穿过百叶窗落在旧沙发上：来吧。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.dialogueChars).toBe(0); // 红:当前=2(13 字名过现 {1,20} 名组)
    expect(m.overlongLines).toHaveLength(0);
  });

  it("livefire8 形态:真台词 35 字+叙述行 138 字——红=语音 173 超本场上限 112 假阳性;绿=语音 35 无告警", () => {
    // design F12 锚:叙述冒号行剔除后语音≈35(<60)且「语音…超本场上限」flag 消失
    const fixture = [
      HEAD,
      "",
      "1-4 场 夜/内 ·约45秒",
      "人物：甲",
      "",
      `甲：${"一".repeat(20)}`,
      `甲：${"一".repeat(15)}`,
      `他看向窗外，压低了声音说道：${"一".repeat(138)}`,
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.scenes[0]?.voiceChars).toBe(35); // 红:当前=173(35+138)
    expect(m.flags.some((f) => f.includes("语音") && f.includes("超本场上限"))).toBe(false); // 红:当前有「场 1-4 语音 173 字超本场上限 112」
  });

  it("绿-now 锁:间隔号「·」类名不被句读集误伤(沈·青岚形态,design §3 保留 ·)", () => {
    const fixture = [HEAD, "", "1-1 场 晨/外 ·约30秒", "人物：沈·青岚", "", "沈·青岚：好。"].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.dialogueChars).toBe(1);
  });
});

describe("M3 时长容错两文案(design §4:parseSceneSeconds 单源,缺文案串不变 §7.1)", () => {
  const HEAD = "# 已确定要求：x/16:9/y";
  const mk = (tail: string) => [HEAD, "", `1-1 码头 晨/外 ${tail}`, "人物：甲", "", "甲：好。"].join("\n");

  it.each([
    ["分隔符后空格", "· 约40秒"],
    ["内部空格", "·约 40 秒"],
    ["Ns 形态", "40s"],
    ["分:秒 形态", "0:40"],
    ["• 分隔符", "•约40秒"],
  ])("可解析写法(%s)→ seconds=40 且 title 剥净——红=现报「缺·约N秒标注」", (_label, tail) => {
    const m = analyzeScriptDraft(mk(tail), { durationMin: 1 });
    expect(m.scenes[0]?.seconds).toBe(40); // 红:当前=null(SCENE_SECONDS_RE 只认 ·约N秒 单形态)
    expect(m.flags).not.toContain("场 1-1 缺·约N秒标注"); // 红:当前含
    expect(m.scenes[0]?.title).toBe("码头 晨/外"); // 红:当前时长原文未剥净
  });

  it("不认的写法如实报「时长写法不识别」而非「缺时长」——红=现误报缺标注(implement.md 批3)", () => {
    const m = analyzeScriptDraft(mk("·约一分钟"), { durationMin: 1 });
    expect(m.flags).toContain("场 1-1 时长写法不识别：约一分钟"); // 红:当前无此文案
    expect(m.flags).not.toContain("场 1-1 缺·约N秒标注"); // 红:当前误报缺
    expect(m.scenes[0]?.seconds).toBeNull(); // 绿-now 锁:不识别→seconds 仍 null
  });
});

describe("M4 场头容错与幻影场(design §4)", () => {
  const HEAD = "# 已确定要求：x/16:9/y";
  const NO_SCENE_FLAG = "未识别到场次段落（格式漂移，场秒/镜头对账不可用）";

  it("「## 1-1 …」前缀容错——红=现按 Markdown 标题丢弃,零场", () => {
    const fixture = [HEAD, "", "## 1-1 码头 晨/外 ·约30秒", "人物：甲", "", "△动作。", "甲：好。"].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.scenes).toHaveLength(1); // 红:当前=0
    expect(m.scenes[0]).toMatchObject({ id: "1-1", title: "码头 晨/外", seconds: 30 }); // 红:前缀须剥净
    expect(m.flags).not.toContain(NO_SCENE_FLAG); // 红:当前含
  });

  it("全角连字符「1－1」识别且 id 归一半角——红=现整行漏识;锁:归一后不误报「场号格式不一致」", () => {
    const fixture = [
      HEAD,
      "",
      "1－1 码头 晨/外 ·约30秒",
      "人物：甲",
      "",
      "甲：好。",
      "",
      "1-2 场 夜/内 ·约30秒",
      "人物：乙",
      "",
      "乙：行。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.scenes).toHaveLength(2); // 红:当前=1(1－1 行漏识)
    expect(m.scenes[0]).toMatchObject({ id: "1-1", seconds: 30 }); // 红:id 归一半角
    expect(m.flags).not.toContain("场号格式不一致(N-M 与裸数字混用)"); // 锁:两场均 N-M 不误报(现绿;防「归一不彻底按裸数字计」的半吊子修复)
  });

  it("场内 N-M 裸叙述行「3-5 年前…」不生幻影场——红=现恒识别(:96 无尾锚)并误挂缺标注", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 河岸 晨/外 ·约30秒",
      "人物：甲",
      "",
      "△河雾未散。",
      "3-5 年前，这里的渡口还在。",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.scenes).toHaveLength(1); // 红:当前=2(幻影场「3-5」)
    expect(m.flags).not.toContain("场 3-5 缺·约N秒标注"); // 红:当前误挂
    expect(m.scenes[0]?.voiceChars).toBe(1); // 红:当前「甲：好。」被记进幻影场 3-5
  });

  it("无尾锚 N-M 场头「1-9 闲笔」拒绝——红=现幻影场;绿=零场并入「未识别到场次」", () => {
    const m = analyzeScriptDraft([HEAD, "", "1-9 闲笔"].join("\n"), { durationMin: 1 });
    expect(m.scenes).toHaveLength(0); // 红:当前=1
    expect(m.flags).toContain(NO_SCENE_FLAG); // 红:当前无
    expect(m.flags).not.toContain("场 1-9 缺·约N秒标注"); // 红:当前误挂
  });
});

describe("M5 语音行变体与标签排除(design §5)", () => {
  const HEAD = "# 已确定要求：x/16:9/y";
  const mk = (line: string) => [HEAD, "", "1-1 场 晨/外 ·约30秒", "人物：甲", "", line].join("\n");

  it("半角括号「OS(甲)：」→ OS——红=现名组吞「OS(甲)」计对白(名组只排全角（)", () => {
    const m = analyzeScriptDraft(mk("OS(甲)：内心一句话。"), { durationMin: 1 });
    expect(m.osChars).toBe(5); // 红:当前=0
    expect(m.dialogueChars).toBe(0); // 红:当前=5
  });

  it("「V.S（旁白，冷）：」(无尾点)→ OS——红=现 name「V.S」≠「V.S.」计对白", () => {
    const m = analyzeScriptDraft(mk("V.S（旁白，冷）：风声掠过塔檐。"), { durationMin: 1 });
    expect(m.osChars).toBe(6); // 红:当前=0
    expect(m.dialogueChars).toBe(0); // 红:当前=6
  });

  it("「VO（旁白）：」画外音=OS——红=现计对白", () => {
    const m = analyzeScriptDraft(mk("VO（旁白）：雾气漫过河面。"), { durationMin: 1 });
    expect(m.osChars).toBe(6); // 红:当前=0
    expect(m.dialogueChars).toBe(0); // 红:当前=6
  });

  it("「VO(甲)：」半角括注→ OS——红=现名组吞「VO(甲)」计对白", () => {
    const m = analyzeScriptDraft(mk("VO(甲)：脚步声近了。"), { durationMin: 1 });
    expect(m.osChars).toBe(5); // 红:当前=0
    expect(m.dialogueChars).toBe(0); // 红:当前=5
  });

  it("冒号前空格「甲 ：好。」→ 计对白——红=现名组含 \\s 整行漏计", () => {
    const m = analyzeScriptDraft(mk("甲 ：好。"), { durationMin: 1 });
    expect(m.dialogueChars).toBe(1); // 红:当前=0
  });

  it("「字幕：…」标签排除(不计台词)——红=现计对白", () => {
    const m = analyzeScriptDraft(mk("字幕：开场黑屏。"), { durationMin: 1 });
    expect(m.dialogueChars).toBe(0); // 红:当前=4
    expect(m.beats).toBe(0);
  });

  it("「镜头一：…」中文数字镜头行排除(不计台词亦不计拍)——红=现计对白", () => {
    const m = analyzeScriptDraft(mk("镜头一：晨光初现。"), { durationMin: 1 });
    expect(m.dialogueChars).toBe(0); // 红:当前=4
    expect(m.beats).toBe(0); // 绿-now 锁:中文数字本就不过 SHOT_LINE_RE,修复后仍不给漂移格式发拍数信用
  });

  it("绿-now 双形态保持锁:「V.S（甲，随意）：」恒计对白(手册 :257,design §5 原样保持)", () => {
    const m = analyzeScriptDraft(mk("V.S（甲，随意）：师傅说明年还能翻倍。"), { durationMin: 1 });
    expect(m.dialogueChars).toBe(9);
    expect(m.osChars).toBe(0);
  });
});

describe("M6 画幅+镜号+三手册规则警告级(design §6;裁定=警告级 flags)", () => {
  const HEAD = "# 已确定要求：x/16:9/y";

  it("画幅:全角冒号「9：16」识别为竖屏——红=现回落 16:9(lineLimit 20,:119-127 无归一)", () => {
    const fixture = ["# 已确定要求：x/9：16竖屏/x", "", "1-1 场 晨/外 ·约30秒", "人物：甲", "", `甲：${"一".repeat(16)}`].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.lineLimit).toBe(15); // 红:当前=20
    expect(m.overlongLines).toHaveLength(1); // 红:当前=0(16 字@20 不超)
  });

  it("画幅:同线双画幅取首个出现位置——红=现「非9:16」子串抢先命中误判竖屏", () => {
    const fixture = ["# 已确定要求：横屏16:9（非9:16）", "", "1-1 场 晨/外 ·约30秒", "人物：甲", "", `甲：${"一".repeat(16)}`].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.lineLimit).toBe(20); // 红:当前=15
    expect(m.overlongLines).toHaveLength(0); // 红:当前=1(16 字@15 误报超长)
  });

  it("镜号重复:场内 1/2/2 → 「场 1-1 镜号 2 重复」——红=现计拍从不校验号(F7)", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约60秒",
      "人物：甲",
      "",
      "镜头1：晨雾未散。",
      "镜头 2：甲走近渡口。",
      "镜头2：乙从船头回头。",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.flags).toContain("场 1-1 镜号 2 重复"); // 红:当前无
    expect(m.beats).toBe(3); // 绿-now 锁:拍数照计
    expect(m.flags.some((f) => f.includes("镜号跳号"))).toBe(false); // 绿-now 锁:1..max 无缺号
  });

  it("镜号跳号:场内 1/2/4 → 「场 1-1 镜号跳号：缺 3」——红=现从不校验号", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约60秒",
      "人物：甲",
      "",
      "镜头1：晨雾未散。",
      "镜头 2：甲走近渡口。",
      "镜头4：乙从船头回头。",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.flags).toContain("场 1-1 镜号跳号：缺 3"); // 红:当前无
    expect(m.beats).toBe(3);
    expect(m.flags.some((f) => f.includes("重复"))).toBe(false); // 无重复号
  });

  it("绿-now 锁:镜号每场从 1 重计(F7 手册锚)——跨场重起「镜头1」不报", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约30秒",
      "人物：甲",
      "",
      "镜头1：晨雾未散。",
      "甲：好。",
      "",
      "1-2 场 夜/内 ·约30秒",
      "人物：乙",
      "",
      "镜头1：灯火摇曳。",
      "乙：行。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.flags.some((f) => f.includes("镜号"))).toBe(false);
  });

  it("警告级规则①:场内 OS 连续 3 段(无对白间隔)→「警告」flag——红=现无此规则(F8 手册「九、时长与视觉预算」)", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约60秒",
      "人物：甲",
      "",
      "OS（旁白）：一段。",
      "OS（旁白）：二段。",
      "OS（旁白）：三段。",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.flags).toContain("「警告」场 1-1 OS 连续 3 段（手册：不连续超过 2 段）"); // 红:当前无
  });

  it("警告级规则②:场秒 70 超出场景段落 20-60s →「警告」flag——红=现无此规则(70s 本身零 flag)", () => {
    const fixture = [HEAD, "", "1-1 场 晨/外 ·约70秒", "人物：甲", "", "△动作。", "甲：好。"].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.flags).toContain("「警告」场 1-1 秒数 70s 超出场景段落 20-60s"); // 红:当前无(durationMin=1 时 70 vs 60 恰 ±10 不触场秒合计)
  });

  it("警告级规则③:纯视觉段 2 拍≈20s 超过 15 秒 →「警告」flag——红=现无此规则", () => {
    const fixture = [HEAD, "", "1-1 场 晨/外 ·约60秒", "人物：甲", "", "△第一拍。", "△第二拍。", "甲：好。"].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.flags).toContain("「警告」场 1-1 纯视觉段 2 拍≈20s 超过 15 秒"); // 红:当前无
  });

  it("绿-now 锁:全达标夹具(60s∈[20,60]/有对白/无 OS/纯视觉连拍≤1)过三新规则仍零 flags(design §7.2)", () => {
    const fixture = [HEAD, "", "1-1 场 晨/外 ·约60秒", "人物：甲", "", "△动作。", "甲：你来啦！"].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.flags).toHaveLength(0);
    expect(m.flags.filter((f) => f.startsWith("「警告」"))).toHaveLength(0);
  });
});

// ============================================================================
// 四审残项收口 B 批(.trellis/tasks/10-14-audit4-residuals implement.md B 批行;
// prd Q1/Q3 为权威)。全部合成夹具,不拷小说原文。
// R7=叙述行含 N秒/N分 不成场头(时长尾锚须整行场头形态);
// R8=裸 N秒/N分N秒/N分+(40s) 片段非空+标题去约/左右;
// R9=无标点短叙述(道:)/OS （甲）/小写 os/裸旁白：;
// R10=纯视觉计时 SFX 打断+镜号跳号合并提示;
// R15=VOICE_CPS 区间常量单源家(超标判定用 MAX,364d0d67 单口径表述反向修订)。
// ============================================================================

describe("R7 叙述行含 N秒/N分 不成场头(时长尾锚须整行场头形态)", () => {
  const HEAD = "# 已确定要求：x/16:9/y";

  it("「3-5 年前，他等了 40 秒。」不生幻影场(prd 反例原文)——红=现 DURATIONISH 认行中「40 秒」", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 河岸 晨/外 ·约30秒",
      "人物：甲",
      "",
      "△河雾未散。",
      "3-5 年前，他等了 40 秒。",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.scenes).toHaveLength(1); // 红:当前=2(幻影场 3-5)
    expect(m.flags.some((f) => f.startsWith("场 3-5"))).toBe(false); // 红:当前「场 3-5 时长写法不识别：秒」
    expect(m.scenes[0]?.voiceChars).toBe(1); // 「甲：好。」归真场 1-1
  });

  it("「3 年后，又过了 5 分钟。」不生幻影场(prd 反例原文)——红=现认行中「5 分钟」", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 河岸 晨/外 ·约30秒",
      "人物：甲",
      "",
      "3 年后，又过了 5 分钟。",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.scenes).toHaveLength(1); // 红:当前=2(幻影场 3)
    expect(m.flags.some((f) => f.startsWith("场 3"))).toBe(false); // 红:当前「场 3 时长写法不识别：分」
  });

  it("绿-now 回归锁:整行场头形态的时长尾(·约N秒/Ns/不识别写法·约一分钟)仍成场", () => {
    const mk = (tail: string) => [HEAD, "", `1-1 码头 晨/外 ${tail}`, "人物：甲", "", "甲：好。"].join("\n");
    for (const tail of ["·约30秒", "40s", "·约一分钟"]) {
      expect(analyzeScriptDraft(mk(tail), { durationMin: 1 }).scenes).toHaveLength(1);
    }
  });
});

describe("R8 裸 N秒/N分N秒/N分+(40s) 片段非空+标题去约/左右(Q3 裁定)", () => {
  const HEAD = "# 已确定要求：x/16:9/y";
  const mk = (tail: string) => [HEAD, "", `1-1 码头 晨/外 ${tail}`, "人物：甲", "", "甲：好。"].join("\n");

  it.each([
    ["裸 N秒(Q3)", "40秒", 40],
    ["N分N秒(Q3:1分40秒=100s)", "1分40秒", 100],
    ["裸 N分", "2分", 120],
    ["(40s) 括注片段非空", "(40s)", 40],
    ["约40s 标题去约", "约40s", 40],
    ["·约30秒左右 标题去左右", "·约30秒左右", 30],
  ])("%s → seconds=%i 且 title 剥净", (_label, tail, seconds) => {
    const m = analyzeScriptDraft(mk(tail), { durationMin: 1 });
    expect(m.scenes[0]?.seconds).toBe(seconds); // 红:裸写法/(40s) 现=null
    expect(m.scenes[0]?.title).toBe("码头 晨/外"); // 红:「约40s」→「码头 晨/外 约」「·约30秒左右」→「…左右」残渣
    expect(m.flags.some((f) => f.includes("时长写法不识别"))).toBe(false); // 红:(40s) 现 flag 片段为空
  });
});

describe("R9 语音行变体:无标点短叙述(道:)/OS （甲）/小写 os/裸旁白：(M2/M5 残项)", () => {
  const HEAD = "# 已确定要求：x/16:9/y";
  const mk = (line: string) => [HEAD, "", "1-1 场 晨/外 ·约30秒", "人物：甲", "", line].join("\n");

  it("无标点短叙述「他冷冷道：滚。」不计对白——红=现名组「他冷冷道」过检计 1 字", () => {
    const m = analyzeScriptDraft(mk("他冷冷道：滚。"), { durationMin: 1 });
    expect(m.dialogueChars).toBe(0); // 红:当前=1
    expect(m.scenes[0]?.voiceChars).toBe(0);
  });

  it("「OS （甲）：内心一句话。」(名与括注间全角空格)计 OS——红=现整行漏计为 text", () => {
    const m = analyzeScriptDraft(mk("OS （甲）：内心一句话。"), { durationMin: 1 });
    expect(m.osChars).toBe(5); // 红:当前=0
    expect(m.dialogueChars).toBe(0);
  });

  it("小写「os（甲）：内心一句话。」计 OS——红=现 name「os」计对白", () => {
    const m = analyzeScriptDraft(mk("os（甲）：内心一句话。"), { durationMin: 1 });
    expect(m.osChars).toBe(5); // 红:当前=0
    expect(m.dialogueChars).toBe(0); // 红:当前=5
  });

  it("裸「旁白：夜风掠过河面。」无括注直接计 OS——红=现 name「旁白」计对白", () => {
    const m = analyzeScriptDraft(mk("旁白：夜风掠过河面。"), { durationMin: 1 });
    expect(m.osChars).toBe(6); // 红:当前=0
    expect(m.dialogueChars).toBe(0); // 红:当前=6
  });
});

describe("R10 纯视觉计时 SFX 打断+镜号跳号合并提示(M6 残项)", () => {
  const HEAD = "# 已确定要求：x/16:9/y";

  it("SFX 行打断纯视觉段:1△+SFX+1△+SFX+1△ 零「纯视觉段」误报——红=现 SFX 不断游标(3 拍≈30s 误报)", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约60秒",
      "人物：甲",
      "",
      "△第一拍。",
      "SFX（紧张）：铁链拖地声渐近。",
      "△第二拍。",
      "SFX（惊）：雷声炸响。",
      "△第三拍。",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.beats).toBe(3); // 绿-now 锁:拍数照计(SFX 不给拍)
    // 红:当前 silentBeats 跨 SFX 累计 3 拍≈30s>15s 误报;绿=各段 1 拍≈10s≤15s,音效在场即非纯画面
    expect(m.flags.some((f) => f.includes("纯视觉段"))).toBe(false);
  });

  it("打断处按段结算:2△+SFX+1△ 报「2 拍≈20s」恰一次——红=现报「3 拍≈30s」且跨段合并", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约60秒",
      "人物：甲",
      "",
      "△第一拍。",
      "△第二拍。",
      "SFX（惊）：雷声炸响。",
      "△第三拍。",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.flags).toContain("「警告」场 1-1 纯视觉段 2 拍≈20s 超过 15 秒"); // 红:当前=「3 拍≈30s」
    expect(m.flags.filter((f) => f.includes("纯视觉段"))).toHaveLength(1);
  });

  it("镜号跳号合并提示:缺 3、4 一条 flag——红=现逐号两条刷屏", () => {
    const fixture = [
      HEAD,
      "",
      "1-1 场 晨/外 ·约60秒",
      "人物：甲",
      "",
      "镜头1：晨雾未散。",
      "镜头2：甲走近渡口。",
      "镜头5：乙从船头回头。",
      "甲：好。",
    ].join("\n");
    const m = analyzeScriptDraft(fixture, { durationMin: 1 });
    expect(m.flags).toContain("场 1-1 镜号跳号：缺 3、4"); // 红:当前=「缺 3」「缺 4」两条
    expect(m.flags.filter((f) => f.includes("镜号跳号"))).toHaveLength(1); // 红:当前=2
  });
});

describe("R15 语速区间常量与超标判定(Q1 裁定:2.5~4 字/秒,单源家=本文件)", () => {
  it("导出 VOICE_CPS_MIN=2.5/VOICE_CPS_MAX=4(D 批 storyboard-table 消费,禁两处自定义)——红=导出缺失", () => {
    expect(VOICE_CPS_MIN).toBe(2.5); // 红:当前 undefined
    expect(VOICE_CPS_MAX).toBe(4); // 红:当前 undefined
  });

  it("超标判定用 MAX:voiceCharLimit=durationMin×240 不翻保守端 2.5", () => {
    const m = analyzeScriptDraft(FIXTURE_16_9, { durationMin: 2 });
    expect(m.voiceCharLimit).toBe(480); // 2 分钟×240;若误用 MIN 估算端则=300
  });

  it("flags 文案=「区间上限」表述(Q1):超上限 flag 含「区间上限 4 字/秒」——红=现「（4 字/秒）」单口径", () => {
    const head = "# 已确定要求：x/16:9/y\n\n1-1 场 晨/外 ·约60秒\n人物：甲\n\n";
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => `甲：${"十".repeat(9)}${i % 10}`).join("\n");
    const over = analyzeScriptDraft(`${head}${lines(25)}\n`, { durationMin: 1 });
    expect(over.flags).toContain("语音字数 250 超上限 240（区间上限 4 字/秒）"); // 红:当前=「（4 字/秒）」
  });
});
