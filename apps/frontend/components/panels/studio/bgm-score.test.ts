// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  YUE2_ABC_API_WORKFLOW_ID,
  YUE2_RENDER_ABC_INJECT_KEY,
  YUE2_RENDER_PRUNE_NODE_IDS,
  bgmScoreInitialState,
  bgmScoreReducer,
  buildRenderByScoreInputs,
  buildScoreInputs,
  firstScoreText,
  generateBgmScore,
  isRenderableAbc,
  isScoreBusy,
  pruneRenderByScoreGraph,
  renderBgmByScore,
  type BgmScoreState,
} from "./bgm-score";

const ABC_SAMPLE = "X:1\nT:Guzheng Etude\nM:4/4\nK:G\n| c'2 | c2 |";

/** 桥模板最小镜(出谱图 15/23/14)。 */
function bridgeWorkflowText(graph: Record<string, unknown>): string {
  return JSON.stringify({ schemaVersion: 1, name: "test", graph });
}

function scoreWorkflowText(): string {
  return bridgeWorkflowText({
    "15": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "yue2_3b_bf16.safetensors" } },
    "23": { class_type: "YuE2GenerateABC", inputs: { style: "orig", lyrics: "orig", seed: 42 } },
    "14": { class_type: "PreviewAny", inputs: { source: ["23", 0] } },
  });
}

/** 库 yue2-bgm api 图全节点镜像(15/100/23/14/22/5/8/17/10;连线照库原样:
 *  23←100,14←23,22.abc←14——按谱渲染注入 22.abc 后 14/23 成孤岛须剪)。 */
function renderWorkflowText(): string {
  return bridgeWorkflowText({
    "15": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "yue2_3b_bf16.safetensors" } },
    "100": { class_type: "LoraLoader", inputs: { model: ["15", 0], clip: ["15", 1], lora_name: "ar_lora_inst_v3abc_comfyui.safetensors", strength_model: 1.0, strength_clip: 1.0 } },
    "23": { class_type: "YuE2GenerateABC", inputs: { clip: ["100", 1], style: "orig", lyrics: "orig", seed: 42 } },
    "14": { class_type: "PreviewAny", inputs: { source: ["23", 0] } },
    "22": { class_type: "YuE2GenerateMusic", inputs: { clip: ["100", 1], style: "orig", lyrics: "orig", abc: ["14", 0], seed: 42 } },
    "5": { class_type: "EmptyYuE2LatentAudio", inputs: { seconds: ["22", 1], batch_size: 1 } },
    "8": { class_type: "KSampler", inputs: { model: ["100", 0], positive: ["22", 0], negative: ["22", 0], latent_image: ["5", 0], seed: 42 } },
    "17": { class_type: "VAEDecodeAudioTiled", inputs: { samples: ["8", 0], vae: ["15", 2] } },
    "10": { class_type: "SaveAudioAdvanced", inputs: { audio: ["17", 0], format: { format: "flac" } } },
  });
}

describe("buildScoreInputs / buildRenderByScoreInputs(注入面·纯函数)", () => {
  it("出谱注入:23.style/23.lyrics;seed 可选注入,缺省不带", () => {
    expect(buildScoreInputs("s", "l")).toEqual({ "23.style": "s", "23.lyrics": "l" });
    expect(buildScoreInputs("s", "l", 42)).toEqual({ "23.style": "s", "23.lyrics": "l", "23.seed": "42" });
  });

  it("按谱渲染注入:只注 22 一节(style/lyrics/abc 直喂;23 被剪枝不再同源注)", () => {
    expect(buildRenderByScoreInputs("s", "l", ABC_SAMPLE)).toEqual({
      "22.style": "s",
      "22.lyrics": "l",
      [YUE2_RENDER_ABC_INJECT_KEY]: ABC_SAMPLE,
    });
    expect(YUE2_RENDER_ABC_INJECT_KEY).toBe("22.abc");
  });

  it("剪枝面:孤岛节点恒 14/23(PreviewAny 是输出节点,不剪会牵着 23 整场重跑)", () => {
    expect(YUE2_RENDER_PRUNE_NODE_IDS).toEqual(["14", "23"]);
  });

  it("剪枝纯函数:深拷贝不动原图;孤岛节点缺失时静默幂等", () => {
    const graph = {
      "22": { class_type: "YuE2GenerateMusic", inputs: { abc: ["14", 0] } },
      "14": { class_type: "PreviewAny", inputs: { source: ["23", 0] } },
      "23": { class_type: "YuE2GenerateABC", inputs: {} },
    };
    const pruned = pruneRenderByScoreGraph(graph);
    expect(Object.keys(pruned).sort()).toEqual(["22"]);
    expect(Object.keys(graph).sort()).toEqual(["14", "22", "23"]);
    expect(pruneRenderByScoreGraph(pruned)).toEqual(pruned);
  });
});

describe("firstScoreText / isRenderableAbc(产物提取与判定·纯函数)", () => {
  it("texts[0].text 原样带回;缺 texts/空数组/非串首元素给 null", () => {
    expect(firstScoreText({ texts: [{ nodeId: "14", text: ABC_SAMPLE }] })).toBe(ABC_SAMPLE);
    expect(firstScoreText({})).toBeNull();
    expect(firstScoreText({ texts: [] })).toBeNull();
  });

  it("谱文本可渲染 = trim 后非空;空白/换行/ null 全拦截", () => {
    expect(isRenderableAbc(ABC_SAMPLE)).toBe(true);
    expect(isRenderableAbc("   \n\t ")).toBe(false);
    expect(isRenderableAbc("")).toBe(false);
    expect(isRenderableAbc(null)).toBe(false);
    expect(isRenderableAbc(undefined)).toBe(false);
  });
});

describe("bgmScoreReducer(先出谱状态机·纯函数)", () => {
  it("主干:idle→scoring→editing→rendering→editing,谱文本随 score-done 进场", () => {
    let state: BgmScoreState = bgmScoreReducer(bgmScoreInitialState, { type: "score-start" });
    expect(state.phase).toBe("scoring");
    state = bgmScoreReducer(state, { type: "score-done", abcText: ABC_SAMPLE });
    expect(state).toEqual({ phase: "editing", abcText: ABC_SAMPLE, error: null });
    state = bgmScoreReducer(state, { type: "abc-edit", abcText: `${ABC_SAMPLE}| c2 |` });
    expect(state.abcText).toBe(`${ABC_SAMPLE}| c2 |`);
    state = bgmScoreReducer(state, { type: "render-start" });
    expect(state.phase).toBe("rendering");
    state = bgmScoreReducer(state, { type: "render-done" });
    expect(state).toEqual({ phase: "editing", abcText: `${ABC_SAMPLE}| c2 |`, error: null });
  });

  it("陈旧回调节流:scoring/rendering 中不收 score-start/render-start;非 scoring 不收 score-done", () => {
    const scoring = bgmScoreReducer(bgmScoreInitialState, { type: "score-start" });
    expect(bgmScoreReducer(scoring, { type: "score-start" }).phase).toBe("scoring");
    const editing = bgmScoreReducer(scoring, { type: "score-done", abcText: ABC_SAMPLE });
    expect(bgmScoreReducer(editing, { type: "score-done", abcText: "他谱" }).abcText).toBe(ABC_SAMPLE);
    const rendering = bgmScoreReducer(editing, { type: "render-start" });
    expect(bgmScoreReducer(rendering, { type: "render-start" }).phase).toBe("rendering");
    expect(bgmScoreReducer(rendering, { type: "score-start" }).phase).toBe("rendering");
  });

  it("fail 保谱文本;error 态可改谱回 editing,也可直接重试渲染", () => {
    const editing = bgmScoreReducer(
      bgmScoreReducer(bgmScoreInitialState, { type: "score-start" }),
      { type: "score-done", abcText: ABC_SAMPLE },
    );
    const failed = bgmScoreReducer(editing, { type: "render-start" });
    const errored = bgmScoreReducer(failed, { type: "fail", error: "引擎掉线" });
    expect(errored).toEqual({ phase: "error", abcText: ABC_SAMPLE, error: "引擎掉线" });
    expect(bgmScoreReducer(errored, { type: "abc-edit", abcText: "X:9" })).toEqual({
      phase: "editing",
      abcText: "X:9",
      error: null,
    });
    expect(bgmScoreReducer(errored, { type: "render-start" }).phase).toBe("rendering");
    expect(bgmScoreReducer(errored, { type: "score-start" }).phase).toBe("scoring");
  });

  it("reset 清空;idle 不收 fail;非 editing/error 不收 abc-edit", () => {
    expect(bgmScoreReducer(bgmScoreInitialState, { type: "fail", error: "x" })).toBe(bgmScoreInitialState);
    const scoring = bgmScoreReducer(bgmScoreInitialState, { type: "score-start" });
    expect(bgmScoreReducer(scoring, { type: "abc-edit", abcText: "X:1" })).toBe(scoring);
    const editing = bgmScoreReducer(scoring, { type: "score-done", abcText: ABC_SAMPLE });
    expect(bgmScoreReducer(editing, { type: "reset" })).toBe(bgmScoreInitialState);
  });
});

describe("isScoreBusy(busy 判定·纯函数)", () => {
  it("共用 busy(单发/抽卡)与自身 scoring/rendering 任一即锁", () => {
    expect(isScoreBusy(bgmScoreInitialState, false)).toBe(false);
    expect(isScoreBusy(bgmScoreInitialState, true)).toBe(true);
    expect(isScoreBusy({ phase: "scoring", abcText: null, error: null }, false)).toBe(true);
    expect(isScoreBusy({ phase: "rendering", abcText: ABC_SAMPLE, error: null }, false)).toBe(true);
    expect(isScoreBusy({ phase: "editing", abcText: ABC_SAMPLE, error: null }, false)).toBe(false);
  });
});

describe("generateBgmScore / renderBgmByScore(编排器·全 mock)", () => {
  it("出谱:库取工作流→注入 23.style/23.lyrics→texts[0] 回带;超时档 600s", async () => {
    const execute = vi.fn().mockResolvedValue({ texts: [{ nodeId: "14", text: ABC_SAMPLE }] });
    const abc = await generateBgmScore(
      { workflowId: YUE2_ABC_API_WORKFLOW_ID, style: "guzheng", lyrics: "[intro]" },
      { fetchWorkflowText: async () => scoreWorkflowText(), execute },
    );
    expect(abc).toBe(ABC_SAMPLE);
    const payload = execute.mock.calls[0][0];
    expect(execute.mock.calls[0][0].inputs.strings).toEqual({ "23.style": "guzheng", "23.lyrics": "[intro]" });
    expect(payload.timeoutS).toBe(600);
    expect(Object.keys(payload.graph).sort()).toEqual(["14", "15", "23"]);
  });

  it("出谱无文本产物:抛『缺 PreviewAny 类输出节点』大白话", async () => {
    const execute = vi.fn().mockResolvedValue({ images: [], audios: [], texts: [] });
    await expect(
      generateBgmScore(
        { workflowId: YUE2_ABC_API_WORKFLOW_ID, style: "s", lyrics: "l" },
        { fetchWorkflowText: async () => scoreWorkflowText(), execute },
      ),
    ).rejects.toThrow("缺 PreviewAny 类输出节点");
  });

  it("按谱渲染:图剪掉孤岛 14/23(不重跑 LLM 出谱);注入只注 22.*;首音频产物回带;超时档 1200s", async () => {
    const execute = vi.fn().mockResolvedValue({ audios: [{ nodeId: "10", filename: "bgm.flac", b64: "QUJD" }] });
    const audio = await renderBgmByScore(
      { workflowId: "repo:3_声音/Yue2/yue2-bgm-纯音乐-lora版.api.json", style: "guzheng", lyrics: "[intro]", abc: ABC_SAMPLE },
      { fetchWorkflowText: async () => renderWorkflowText(), execute },
    );
    expect(audio.filename).toBe("bgm.flac");
    const payload = execute.mock.calls[0][0];
    // 剪枝:库图全节点 15/100/23/14/22/5/8/17/10 → 发引擎的图无 14/23
    // (PreviewAny 是输出节点,留着必牵 YuE2GenerateABC 整场重跑且产物全被丢弃)。
    expect(Object.keys(payload.graph).sort()).toEqual(["10", "100", "15", "17", "22", "5", "8"]);
    // 注入后无悬挂引用:按引擎同款口径(execute.py apply_string_injections=
    // nodeId.field 写进 inputs[field])应用 strings 后,22.abc 链接位已改字面量,
    // 剩余节点无人再指 14/23。
    const injected = JSON.parse(JSON.stringify(payload.graph)) as typeof payload.graph;
    for (const [key, value] of Object.entries(payload.inputs.strings)) {
      const dot = key.indexOf(".");
      const target = injected[key.slice(0, dot)];
      const field = key.slice(dot + 1);
      if (target && field in target.inputs) target.inputs[field] = value;
    }
    for (const node of Object.values(injected) as Array<{ inputs: Record<string, unknown> }>) {
      for (const value of Object.values(node.inputs)) {
        if (Array.isArray(value)) expect(YUE2_RENDER_PRUNE_NODE_IDS).not.toContain(String(value[0]));
      }
    }
    expect(payload.inputs.strings).toEqual({ "22.style": "guzheng", "22.lyrics": "[intro]", "22.abc": ABC_SAMPLE });
    expect(payload.timeoutS).toBe(1200);
  });

  it("按谱渲染守卫:空谱先拦;无音频产物抛大白话;库内容非桥模板抛大白话且不碰引擎", async () => {
    const execute = vi.fn().mockResolvedValue({ texts: [], audios: [] });
    await expect(
      renderBgmByScore(
        { workflowId: "w", style: "s", lyrics: "l", abc: "  " },
        { fetchWorkflowText: async () => renderWorkflowText(), execute },
      ),
    ).rejects.toThrow("谱文本为空");
    await expect(
      renderBgmByScore(
        { workflowId: "w", style: "s", lyrics: "l", abc: ABC_SAMPLE },
        { fetchWorkflowText: async () => renderWorkflowText(), execute },
      ),
    ).rejects.toThrow("没有输出音频");
    const executeUntouched = vi.fn();
    await expect(
      generateBgmScore(
        { workflowId: "w", style: "s", lyrics: "l" },
        { fetchWorkflowText: async () => "{ not-json-object", execute: executeUntouched },
      ),
    ).rejects.toThrow();
    expect(executeUntouched).not.toHaveBeenCalled();
  });
});
