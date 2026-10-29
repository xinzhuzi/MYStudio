// W0 剧本检查门·四项判定纯函数负例自证(10-29 script-rootcure-clearance design §3.1)。
// 单测直打 checkDurationCap/checkSpeechRate/checkDialogueCoverage/checkOsBudget 与
// runScriptPrecheck 汇总——「门真的会拦」的第一层证明;hook 级(主门写回位)与副门
// (管线入口)另有各自的负例用例。

import { describe, expect, it } from "vitest";
import { extractScriptVoiceLines } from "./script-draft-metrics";
import {
  checkDialogueCoverage,
  checkDurationCap,
  checkOsBudget,
  checkSpeechRate,
  runScriptPrecheck,
} from "./script-precheck";

/** 纯汉字台词体(无标点)——normalizeLiteral 只去标点,字数=原文长度,期望值可手算。 */
const speech = (chars: number) => "走".repeat(chars);

describe("W0 script-precheck ①时长帽", () => {
  it("Σ超帽 → RED,red 明细含合计秒数与帽值(20镜Σ200s cap195 同构造)", () => {
    const over = [{ duration: 201, index: 1, lines: "无台词" }];
    const receipt = runScriptPrecheck({
      rows: over,
      scriptVoiceLines: [],
      durationCapSeconds: 195,
    });
    expect(receipt.passed).toBe(false);
    expect(receipt.red.some((item) => item.includes("201"))).toBe(true);
    // 20 镜 ×10s=200s(合法单镜形态)同样在 195 帽下超帽
    const rows = Array.from({ length: 20 }, (_, i) => ({ duration: 10, index: i + 1, lines: "无台词" }));
    expect(checkDurationCap(rows, 195)).toMatchObject({ totalSeconds: 200, cap: 195, passed: false });
  });

  it("Σ201s cap180(通用帽)同构造同样 RED", () => {
    const receipt = runScriptPrecheck({
      rows: [{ duration: 201, index: 1, lines: "无台词" }],
      scriptVoiceLines: [],
      durationCapSeconds: 180,
    });
    expect(receipt.passed).toBe(false);
    expect(receipt.red.some((item) => item.includes("180"))).toBe(true);
  });
});

describe("W0 script-precheck ②语速双口径", () => {
  it("30字/5s=6.0cps → band=red;22字/5s=4.4 → yellow;口径B缺 → pending", () => {
    const result = checkSpeechRate([
      { index: 1, duration: 5, lines: `甲：${speech(30)}` }, // 6.0 cps
      { index: 2, duration: 5, lines: `甲：${speech(22)}` }, // 4.4 cps
      { index: 3, duration: 5, lines: `甲：${speech(10)}` },  // 2.0 cps,B 缺
    ]);
    expect(result.rows[0]?.band).toBe("red");
    expect(result.rows[1]?.band).toBe("yellow");
    expect(result.rows[2]?.band).toBe("pending");
    expect(result.red.some((item) => item.includes("镜1"))).toBe(true);
    expect(result.yellow.some((item) => item.includes("镜2"))).toBe(true);
    expect(result.pendingCount).toBe(1);
  });

  it("口径B有数据才判:同字数 B=3s → 10/3≈3.3仍green;B=1s → 10cps red", () => {
    const result = checkSpeechRate([
      { index: 1, duration: 5, lines: `甲：${speech(10)}`, audioActualSeconds: 3 },
      { index: 2, duration: 5, lines: `甲：${speech(10)}`, audioActualSeconds: 1 },
    ]);
    expect(result.rows[0]?.band).toBe("green");
    expect(result.rows[0]?.cpsB).toBeCloseTo(3.33, 1);
    expect(result.rows[1]?.band).toBe("red");
    expect(result.red.some((item) => item.includes("voice实测"))).toBe(true);
  });

  it("转译判线分流:旁白23字/5s=4.6 → green(≤4.6);对白同值 → yellow", () => {
    const result = checkSpeechRate([
      { index: 1, duration: 5, lines: `旁白：${speech(23)}`, audioActualSeconds: 5 },
      { index: 2, duration: 5, lines: `甲：${speech(23)}`, audioActualSeconds: 5 },
    ]);
    expect(result.rows[0]?.kind).toBe("translation");
    expect(result.rows[0]?.band).toBe("green");
    expect(result.rows[1]?.kind).toBe("dialogue");
    expect(result.rows[1]?.band).toBe("yellow");
  });
});

describe("W0 script-precheck ③台词勾销账", () => {
  const SCRIPT = [
    "## 剧情梗概",
    "1 码头 夜/外 ·约30秒",
    "甲：走吧。",
    "乙：快跑。",
    "丙：别回头。",
    "## 改编追踪",
  ].join("\n");

  it("剧本 3 句语音行,分镜只覆盖 2 句 → 缺句 RED,missing 含缺句原文", () => {
    const scriptVoiceLines = extractScriptVoiceLines(SCRIPT);
    expect(scriptVoiceLines).toHaveLength(3);
    const coverage = checkDialogueCoverage(scriptVoiceLines, [
      { index: 1, duration: 10, lines: "甲：走吧。" },
      { index: 2, duration: 10, lines: "乙：快跑。" },
    ]);
    expect(coverage.passed).toBe(false);
    expect(coverage.coveredRatio).toBeCloseTo(2 / 3, 4);
    expect(coverage.missing).toHaveLength(1);
    expect(coverage.missing[0]?.speech).toContain("别回头");
    const receipt = runScriptPrecheck({
      rows: [
        { index: 1, duration: 10, lines: "甲：走吧。" },
        { index: 2, duration: 10, lines: "乙：快跑。" },
      ],
      scriptVoiceLines,
      durationCapSeconds: 195,
    });
    expect(receipt.passed).toBe(false);
    expect(receipt.red.some((item) => item.includes("别回头"))).toBe(true);
  });
});

describe("W0 script-precheck ④OS占比预算", () => {
  it("非豁免OS占比超40% → YELLOW(永不进 RED);字面=sourceText 子串 → 豁免后回落 green", () => {
    const rows = [
      { index: 1, duration: 5, lines: `甲：${speech(10)}` },
      { index: 2, duration: 5, lines: `旁白：${speech(10)}` }, // 豁免候选
      { index: 3, duration: 5, lines: `旁白：${speech(10)}` },
    ];
    const withoutExemption = checkOsBudget(rows);
    expect(withoutExemption.osRatio).toBeGreaterThan(0.4);
    expect(withoutExemption.passed).toBe(false);
    expect(withoutExemption.yellow.some((item) => item.includes("40%"))).toBe(true);

    const withExemption = checkOsBudget(rows, `夜色压境，${speech(10)}，火光渐熄。`);
    expect(withExemption.exemptRatio).toBeGreaterThan(0);
    expect(withExemption.osRatio).toBeLessThanOrEqual(0.4);
    expect(withExemption.passed).toBe(true);

    // 豁免只救占比:整单 RED 清单永不包含 OS 项
    const receipt = runScriptPrecheck({ rows, scriptVoiceLines: [], durationCapSeconds: 195, sourceTextForExemption: "" });
    expect(receipt.passed).toBe(true);
    expect(receipt.yellow.length).toBeGreaterThan(0);
  });

  it("非豁免OS连续3段(占比≤40%) → YELLOW;对白行打断游标", () => {
    const rows = [
      { index: 1, duration: 5, lines: `旁白：${speech(2)}` },
      { index: 2, duration: 5, lines: `旁白：${speech(2)}` },
      { index: 3, duration: 5, lines: `旁白：${speech(2)}` },
      { index: 4, duration: 5, lines: `甲：${speech(30)}` },
    ];
    const result = checkOsBudget(rows);
    expect(result.osRatio).toBeLessThanOrEqual(0.4); // 6/36≈16.7%,占比本身不违线
    expect(result.maxConsecutiveOs).toBe(3);
    expect(result.passed).toBe(false);
    expect(result.yellow.some((item) => item.includes("连续 3 段"))).toBe(true);

    const interrupted = checkOsBudget([
      { index: 1, duration: 5, lines: `旁白：${speech(2)}` },
      { index: 2, duration: 5, lines: `甲：${speech(30)}` },
      { index: 3, duration: 5, lines: `旁白：${speech(2)}` },
      { index: 4, duration: 5, lines: `甲：${speech(30)}` },
    ]);
    expect(interrupted.maxConsecutiveOs).toBe(1);
    expect(interrupted.passed).toBe(true);
  });
});

describe("W0 script-precheck 汇总(正常表 GREEN)", () => {
  it("帽内/全绿(口径B齐)/勾销100% → passed=true,red=[]", () => {
    const scriptVoiceLines = extractScriptVoiceLines([
      "## 剧情梗概",
      "1 码头 夜/外 ·约30秒",
      "甲：走吧。",
      "## 改编追踪",
    ].join("\n"));
    const receipt = runScriptPrecheck({
      rows: [
        { index: 1, duration: 15, lines: "甲：走吧。", audioActualSeconds: 2 },
        { index: 2, duration: 15, lines: "无台词" },
      ],
      scriptVoiceLines,
      durationCapSeconds: 195,
    });
    expect(receipt.passed).toBe(true);
    expect(receipt.red).toEqual([]);
    expect(receipt.checks.durationCap.passed).toBe(true);
    expect(receipt.checks.dialogueCoverage.passed).toBe(true);
    expect(receipt.summary).toContain("RED 0 项");
  });
});
