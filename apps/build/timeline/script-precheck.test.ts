// @vitest-environment node

// W0 副门·负例自证(10-29 script-rootcure-clearance design §3.3,vite-node 域同
// run-full-pipeline.test.ts 族)。四例证明「门真的会拦」:RED 先落 passed:false
// 回执再 throw(六步范式③)、三件套 evidence 落盘(④)、inputsSha256 与注入
// hashJson 产出一致(绑定)、口径B 缺失=pending 不阻断(design §5.7)。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runScriptPrecheckGate } from "./script-precheck";

const FIXED_SHA = "a".repeat(64);
const hashJsonMock = async () => FIXED_SHA;

function makeTempAutomationDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "w0-script-precheck-gate-"));
}

function makeShot(overrides: Partial<{ shotId: string; ttsSpokenText: string; audioPath: string; durationUs: number }> = {}) {
  return {
    shotId: "shot-1",
    ttsSpokenText: "走吧",
    audioPath: "",
    audioSha256: "b".repeat(64),
    textSha256: "c".repeat(64),
    durationUs: 10_000_000,
    sourceSha256: "d".repeat(64),
    ...overrides,
  };
}

function makeStoreLine(line: string) {
  return [{ id: "shot-1", episodeId: "chapter-001", lines: line }];
}

describe("W0 副门 runScriptPrecheckGate", () => {
  it("例1 mock shots 超速 → FAIL:回执落盘 passed:false、red 含镜号、throw、inputsSha256 与注入 hashJson 一致", async () => {
    const automationDir = makeTempAutomationDir();
    const wavPath = path.join(automationDir, "voice-1.wav");
    fs.writeFileSync(wavPath, "fake wav bytes");
    // 40 字 / wav 实长 6s ≈ 6.7 cps > 5.2 → RED;declared 10s → 口径A=4.0 恰在判线上不越线
    const shot = makeShot({ ttsSpokenText: "走".repeat(40), audioPath: wavPath, durationUs: 10_000_000 });
    await expect(runScriptPrecheckGate({
      automationDir,
      projectId: "p",
      chapterId: "chapter-001",
      shots: [shot],
      storeStoryboards: makeStoreLine(`甲：${"走".repeat(40)}`),
      durationCapSeconds: 195,
      scriptVoiceLines: [],
      probe: async () => ({ duration: 6 }),
      hashJson: hashJsonMock,
    })).rejects.toThrow("script-precheck-gate-failed");
    const receipt = JSON.parse(fs.readFileSync(path.join(automationDir, "script-precheck-acceptance.json"), "utf8")) as {
      passed: boolean; red: string[]; inputsSha256: string;
    };
    expect(receipt.passed).toBe(false);
    expect(receipt.red.some((item) => item.includes("镜1"))).toBe(true);
    expect(receipt.inputsSha256).toBe(FIXED_SHA);
    // ④ 三件套之 inputs 快照与测量均已落盘
    expect(fs.existsSync(path.join(automationDir, "script-precheck-inputs.json"))).toBe(true);
    expect(fs.existsSync(path.join(automationDir, "script-precheck-measurement.json"))).toBe(true);
  });

  it("例2 实词账不一致(store「甲：走」vs ttsSpokenText「跑」)→ FAIL", async () => {
    const automationDir = makeTempAutomationDir();
    await expect(runScriptPrecheckGate({
      automationDir,
      projectId: "p",
      chapterId: "chapter-001",
      shots: [makeShot({ ttsSpokenText: "跑" })],
      storeStoryboards: makeStoreLine("甲：走"),
      durationCapSeconds: 195,
      scriptVoiceLines: [],
      probe: async () => ({ duration: 5 }),
      hashJson: hashJsonMock,
    })).rejects.toThrow("实词账");
    const receipt = JSON.parse(fs.readFileSync(path.join(automationDir, "script-precheck-acceptance.json"), "utf8")) as {
      passed: boolean; red: string[];
    };
    expect(receipt.passed).toBe(false);
    expect(receipt.red.some((item) => item.includes("实词账"))).toBe(true);
  });

  it("例3 audioPath 不存在 → 口径B=pending,回执 passed:true 且 pendingCount=1", async () => {
    const automationDir = makeTempAutomationDir();
    const result = await runScriptPrecheckGate({
      automationDir,
      projectId: "p",
      chapterId: "chapter-001",
      shots: [makeShot({ ttsSpokenText: "走吧。", audioPath: path.join(automationDir, "absent.wav") })],
      storeStoryboards: makeStoreLine("甲：走吧。"),
      durationCapSeconds: 195,
      scriptVoiceLines: [],
      probe: async () => { throw new Error("probe must not be called for missing file"); },
      hashJson: hashJsonMock,
    });
    expect(result.passed).toBe(true);
    expect(result.pendingCount).toBe(1);
    expect(result.red).toEqual([]);
    const receipt = JSON.parse(fs.readFileSync(path.join(automationDir, "script-precheck-acceptance.json"), "utf8")) as {
      passed: boolean; pendingCount: number;
    };
    expect(receipt.passed).toBe(true);
    expect(receipt.pendingCount).toBe(1);
  });

  it("例4 正常 shots → passed:true,三件套齐", async () => {
    const automationDir = makeTempAutomationDir();
    const wavPath = path.join(automationDir, "voice-ok.wav");
    fs.writeFileSync(wavPath, "fake wav bytes");
    const result = await runScriptPrecheckGate({
      automationDir,
      projectId: "p",
      chapterId: "chapter-001",
      shots: [makeShot({ ttsSpokenText: "走吧", audioPath: wavPath, durationUs: 30_000_000 })],
      storeStoryboards: makeStoreLine("甲：走吧"),
      durationCapSeconds: 195,
      scriptVoiceLines: [{ scene: "1", kind: "dialogue", speech: "走吧" }],
      probe: async () => ({ duration: 5 }),
      hashJson: hashJsonMock,
    });
    expect(result.passed).toBe(true);
    expect(result.red).toEqual([]);
    expect(result.inputsSha256).toBe(FIXED_SHA);
    for (const name of ["script-precheck-inputs.json", "script-precheck-measurement.json", "script-precheck-acceptance.json"]) {
      expect(fs.existsSync(path.join(automationDir, name))).toBe(true);
    }
  });
});
