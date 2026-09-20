// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  BGM_BATCH_BASE_SEED,
  BGM_BATCH_SEED_NODE_IDS,
  YUE2_BGM_LYRICS_IRON,
  bgmBatchInitialState,
  bgmBatchReducer,
  deriveBgmBatchSeeds,
  flacDurationSecondsFromB64,
  formatBgmBatchDuration,
  formatBgmBatchProgress,
  generateBgmBatch,
  withBgmBatchSeed,
  type BgmBatchCandidate,
  type BgmBatchState,
} from "./bgm-batch";

/** 库 YuE2 BGM 桥模板最小镜(带 seed 的 22/23/8 + 不带 seed 的 SaveAudio 10)。 */
function yue2WorkflowText(): string {
  return JSON.stringify({
    schemaVersion: 1,
    name: "yue2-bgm-test",
    graph: {
      "22": { class_type: "YuE2GenerateMusic", inputs: { style: "orig", lyrics: "orig", seed: 42 } },
      "23": { class_type: "YuE2GenerateABC", inputs: { style: "orig", lyrics: "orig", seed: 42 } },
      "8": { class_type: "KSampler", inputs: { seed: 42, steps: 32 } },
      "10": { class_type: "SaveAudioAdvanced", inputs: { format: { format: "flac" } } },
    },
  });
}

/** 手搓最小 FLAC 头("fLaC"+STREAMINFO)→ b64;帧数据区随便填,解析器只读头。 */
function flacB64(sampleRate: number, totalSamples: number): string {
  const stream = new Uint8Array(34);
  const sr = sampleRate & 0xfffff;
  stream[10] = (sr >>> 12) & 0xff;
  stream[11] = (sr >>> 4) & 0xff;
  stream[12] = ((sr & 0xf) << 4) | ((1 & 0x7) << 1) | (15 >>> 4); // 双声道 16bit
  stream[13] = ((15 & 0xf) << 4) | (Math.floor(totalSamples / 2 ** 32) & 0xf);
  stream[14] = Math.floor(totalSamples / 2 ** 24) & 0xff;
  stream[15] = Math.floor(totalSamples / 2 ** 16) & 0xff;
  stream[16] = Math.floor(totalSamples / 2 ** 8) & 0xff;
  stream[17] = totalSamples & 0xff;
  const bytes = new Uint8Array(4 + 4 + 34 + 8);
  bytes.set([0x66, 0x4c, 0x61, 0x43], 0);
  bytes.set([0x00, 0x00, 0x00, 34], 4);
  bytes.set(stream, 8);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("deriveBgmBatchSeeds(批量抽卡种子派生·纯函数)", () => {
  it("seed_i = 42+i:2/4/8 连抽的档位全量核对", () => {
    expect(deriveBgmBatchSeeds(2)).toEqual([42, 43]);
    expect(deriveBgmBatchSeeds(4)).toEqual([42, 43, 44, 45]);
    expect(deriveBgmBatchSeeds(8)).toEqual([42, 43, 44, 45, 46, 47, 48, 49]);
    expect(BGM_BATCH_BASE_SEED).toBe(42);
  });

  it("同题同派生可复现:纯序号决定,两次调用恒同值;种子节点口径与单发注入口同批", () => {
    expect(deriveBgmBatchSeeds(4)).toEqual(deriveBgmBatchSeeds(4));
    expect(BGM_BATCH_SEED_NODE_IDS).toEqual(["22", "23", "8"]);
  });

  it("非法入参(0/负数/非整数)给空数组,不产出种子", () => {
    expect(deriveBgmBatchSeeds(0)).toEqual([]);
    expect(deriveBgmBatchSeeds(-1)).toEqual([]);
    expect(deriveBgmBatchSeeds(2.5)).toEqual([]);
  });
});

describe("withBgmBatchSeed(图种子注入·纯函数)", () => {
  it("深拷贝注入:22/23/8 的 seed 全改派生值,不带 seed 的节点不动,原图不被改写", () => {
    const graph = JSON.parse(yue2WorkflowText()).graph;
    const patched = withBgmBatchSeed(graph, 45);
    expect(patched["22"].inputs.seed).toBe(45);
    expect(patched["23"].inputs.seed).toBe(45);
    expect(patched["8"].inputs.seed).toBe(45);
    expect(patched["10"].inputs).toEqual({ format: { format: "flac" } });
    expect(graph["22"].inputs.seed).toBe(42);
    expect(patched).not.toBe(graph);
  });

  it("节点缺 seed 字段时保持工作流原值,不炸(缺项走原值口径)", () => {
    const patched = withBgmBatchSeed({ "10": { class_type: "SaveAudioAdvanced", inputs: { format: {} } } }, 99);
    expect(patched["10"].inputs).toEqual({ format: {} });
  });
});

describe("flacDurationSecondsFromB64(FLAC 头时长解析·纯函数)", () => {
  it("STREAMINFO 头解出时长=总采样/采样率", () => {
    const totalSamples = 4_189_500;
    const sampleRate = 44_100;
    expect(flacDurationSecondsFromB64(flacB64(sampleRate, totalSamples))).toBeCloseTo(totalSamples / sampleRate, 5);
  });

  it("非 FLAC/头部信息不全给 null(界面侧降级「时长未知」)", () => {
    expect(flacDurationSecondsFromB64(btoa("RIFF-not-flac"))).toBeNull();
    expect(flacDurationSecondsFromB64(flacB64(44_100, 0))).toBeNull();
    expect(flacDurationSecondsFromB64("")).toBeNull();
  });
});

describe("bgmBatchReducer(面板状态机)", () => {
  const candidate = (seed: number): BgmBatchCandidate => ({
    seed,
    filename: `bgm_yue2_${seed}.flac`,
    filePath: `/proj/media/audio/2026-09/bgm_yue2_${seed}.flac`,
    url: null,
    durationSeconds: 95,
  });

  it("idle → start → generating;逐首 complete-one 累加 done 与候选;finish 收口进 selecting", () => {
    let state = bgmBatchReducer(bgmBatchInitialState, { type: "start", total: 2 });
    expect(state).toMatchObject({ phase: "generating", total: 2, done: 0, candidates: [] });
    state = bgmBatchReducer(state, { type: "complete-one", candidate: candidate(42) });
    expect(state.done).toBe(1);
    expect(state.candidates.map((item) => item.seed)).toEqual([42]);
    state = bgmBatchReducer(state, { type: "complete-one", candidate: candidate(43) });
    expect(state.done).toBe(2);
    state = bgmBatchReducer(state, { type: "finish" });
    expect(state.phase).toBe("selecting");
    expect(formatBgmBatchProgress(state)).toContain("2/2");
  });

  it("中途失败:已产出候选保留可点选(文件已落项目),错误上墙;全灭才进 error", () => {
    let state = bgmBatchReducer(bgmBatchInitialState, { type: "start", total: 4 });
    state = bgmBatchReducer(state, { type: "complete-one", candidate: candidate(42) });
    state = bgmBatchReducer(state, { type: "fail", error: "第 2/4 首:引擎掉线" });
    expect(state.phase).toBe("selecting");
    expect(state.candidates).toHaveLength(1);
    expect(state.error).toBe("第 2/4 首:引擎掉线");
    const empty = bgmBatchReducer(bgmBatchReducer(bgmBatchInitialState, { type: "start", total: 2 }), { type: "fail", error: "通道不可用" });
    expect(empty.phase).toBe("error");
    expect(empty.error).toBe("通道不可用");
  });

  it("非生成态不收料(防陈旧回调);零产出 finish 进 error;reset 回 idle", () => {
    const stale = bgmBatchReducer(bgmBatchInitialState, { type: "complete-one", candidate: candidate(42) });
    expect(stale).toBe(bgmBatchInitialState);
    const noOutput = bgmBatchReducer(bgmBatchReducer(bgmBatchInitialState, { type: "start", total: 0 }), { type: "finish" });
    expect(noOutput.phase).toBe("error");
    expect(noOutput.error).toContain("没有产出");
    expect(bgmBatchReducer({ ...noOutput }, { type: "reset" })).toEqual(bgmBatchInitialState);
  });

  it("进度与时长文案:生成期「第 i/N 首」,点选期给收口提示;时长未知降级", () => {
    expect(formatBgmBatchProgress({ ...bgmBatchInitialState, phase: "generating", total: 4, done: 0 })).toBe("第 1/4 首");
    expect(formatBgmBatchProgress({ ...bgmBatchInitialState, phase: "generating", total: 4, done: 3 })).toBe("第 4/4 首");
    expect(formatBgmBatchProgress(bgmBatchInitialState)).toBe("");
    expect(formatBgmBatchDuration(95)).toBe("1:35");
    expect(formatBgmBatchDuration(null)).toBe("时长未知");
    expect(formatBgmBatchDuration(-1)).toBe("时长未知");
  });
});

describe("generateBgmBatch(编排器·引擎调用全 mock 不真跑)", () => {
  it("count=2 全链:库取一次→逐首串行(执行+落盘交替)→种子 42/43 注入 22/23/8→终态 selecting", async () => {
    const audioB64 = flacB64(44_100, 4_189_500);
    const events: string[] = [];
    const executePayloads: Array<{ seeds: number[]; strings: Record<string, string>; timeoutS?: number }> = [];
    const persisted: Array<{ b64: string; filename: string }> = [];
    const states: BgmBatchState[] = [];
    const finalState = await generateBgmBatch(
      { workflowId: "repo:3_声音/Yue2/yue2-bgm-纯音乐-lora版.api.json", style: " guzhheng-free ", lyrics: "  ", count: 2 },
      {
        fetchWorkflowText: async () => {
          events.push("fetch-workflow");
          return yue2WorkflowText();
        },
        execute: async (payload) => {
          const graph = payload.graph as unknown as Record<string, { inputs: Record<string, unknown> }>;
          executePayloads.push({
            seeds: BGM_BATCH_SEED_NODE_IDS.map((nodeId) => Number(graph[nodeId]?.inputs.seed)),
            strings: payload.inputs.strings,
            timeoutS: payload.timeoutS,
          });
          events.push("execute");
          return { audios: [{ nodeId: "10", filename: `audio/YuE2-BGM${executePayloads.length}.flac`, b64: audioB64 }] };
        },
        persistAudio: async (b64, filename) => {
          events.push("persist");
          persisted.push({ b64, filename });
          return { filePath: `/proj/media/audio/2026-09/bgm_yue2_${persisted.length}.flac`, url: "project-file://proj/media/audio/2026-09/x.flac" };
        },
        onStateChange: (state) => states.push(state),
      },
    );
    // 串行:取库一次,然后 执行→落盘→执行→落盘 交替(无并发交叉)
    expect(events).toEqual(["fetch-workflow", "execute", "persist", "execute", "persist"]);
    // 种子注入:每首 22/23/8 全改派生值;style 去空格注入双节点;空歌词回退铁律五标签
    expect(executePayloads.map((item) => item.seeds)).toEqual([[42, 42, 42], [43, 43, 43]]);
    expect(executePayloads[0]?.strings).toEqual({
      "22.style": "guzhheng-free", "23.style": "guzhheng-free",
      "22.lyrics": YUE2_BGM_LYRICS_IRON, "23.lyrics": YUE2_BGM_LYRICS_IRON,
    });
    expect(executePayloads.every((item) => item.timeoutS === 1200)).toBe(true);
    expect(persisted).toHaveLength(2);
    // 终态与快照流:generating(0)→generating(1)→generating(2)→selecting
    expect(states.map((state) => state.phase)).toEqual(["generating", "generating", "generating", "selecting"]);
    expect(finalState.phase).toBe("selecting");
    expect(finalState.candidates.map((item) => item.seed)).toEqual([42, 43]);
    expect(finalState.candidates.map((item) => item.filename)).toEqual(["bgm_yue2_1.flac", "bgm_yue2_2.flac"]);
    expect(finalState.candidates[0]?.durationSeconds).toBeCloseTo(4_189_500 / 44_100, 5);
  });

  it("逐首进度回报「第 i/N 首」口径:index 从 1 起随串行推进", async () => {
    const progresses: Array<{ index: number; total: number; seed: number; message: string }> = [];
    await generateBgmBatch(
      { workflowId: "repo:test", style: "s", lyrics: "l", count: 2 },
      {
        fetchWorkflowText: async () => yue2WorkflowText(),
        execute: async (_payload, onProgress) => {
          onProgress?.({ stage: "running", message: "引擎执行中…" });
          return { audios: [{ b64: flacB64(44_100, 44_100), filename: "a.flac" }] };
        },
        persistAudio: async () => ({ filePath: "/p/bgm.flac", url: null }),
        onProgress: (progress) => progresses.push(progress),
      },
    );
    expect(progresses).toEqual([
      { index: 1, total: 2, seed: 42, message: "引擎执行中…" },
      { index: 2, total: 2, seed: 43, message: "引擎执行中…" },
    ]);
  });

  it("首内出错即停:已落盘候选保留在 selecting,错误带「第 i/N 首」定位;不再提交后续首", async () => {
    let executeCalls = 0;
    const finalState = await generateBgmBatch(
      { workflowId: "repo:test", style: "s", lyrics: "l", count: 4 },
      {
        fetchWorkflowText: async () => yue2WorkflowText(),
        execute: async () => {
          executeCalls += 1;
          if (executeCalls === 1) return { audios: [{ b64: flacB64(44_100, 44_100), filename: "ok.flac" }] };
          throw new Error("引擎执行失败");
        },
        persistAudio: async () => ({ filePath: "/p/only.flac", url: null }),
      },
    );
    expect(executeCalls).toBe(2);
    expect(finalState.phase).toBe("selecting");
    expect(finalState.candidates).toHaveLength(1);
    expect(finalState.error).toBe("引擎执行失败");
  });

  it("无音频产物给「第 i/N 首」定位错误;工作流坏 JSON/空风格在提交前拦截(零 execute)", async () => {
    const execute = async () => {
      throw new Error("不应触达引擎");
    };
    const noAudio = await generateBgmBatch(
      { workflowId: "repo:test", style: "s", lyrics: "l", count: 2 },
      { fetchWorkflowText: async () => yue2WorkflowText(), execute: async () => ({ audios: [] }), persistAudio: async () => ({ filePath: "/p", url: null }) },
    );
    expect(noAudio.phase).toBe("error");
    expect(noAudio.error).toContain("第 1/2 首");
    const badWorkflow = await generateBgmBatch(
      { workflowId: "repo:test", style: "s", lyrics: "l", count: 2 },
      { fetchWorkflowText: async () => "{ not-json", execute, persistAudio: async () => ({ filePath: "/p", url: null }) },
    );
    expect(badWorkflow.phase).toBe("error");
    expect(badWorkflow.error).toBeTruthy();
    const emptyStyle = await generateBgmBatch(
      { workflowId: "repo:test", style: "  ", lyrics: "l", count: 2 },
      { fetchWorkflowText: async () => yue2WorkflowText(), execute, persistAudio: async () => ({ filePath: "/p", url: null }) },
    );
    expect(emptyStyle.phase).toBe("error");
    expect(emptyStyle.error).toBe("请先填写 BGM 风格描述");
  });
});
