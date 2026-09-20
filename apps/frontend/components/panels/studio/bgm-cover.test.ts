// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  YUE2_COVER_API_WORKFLOW_ID,
  YUE2_COVER_AUDIO_INPUT_KEY,
  YUE2_COVER_EXECUTE_TIMEOUT_S,
  bgmCoverInitialState,
  bgmCoverReducer,
  buildBgmCoverStringInputs,
  formatBgmCoverHint,
  generateBgmCover,
  toBgmCoverAssetOptions,
  type BgmCoverState,
} from "./bgm-cover";
import { YUE2_BGM_LYRICS_IRON } from "./bgm-batch";

/** 库翻唱记谱线桥模板最小镜(LoadAudio 30 + YuE2GenerateMusic 22 + SaveAudio 10)。 */
function coverWorkflowText(): string {
  return JSON.stringify({
    schemaVersion: 1,
    name: "yue2-cover-test",
    graph: {
      "30": { class_type: "LoadAudio", inputs: { audio: "cover-ref.mp3" } },
      "22": { class_type: "YuE2GenerateMusic", inputs: { style: "orig", lyrics: "orig", abc: ["14", 0], mode: "melody", seed: 42 } },
      "14": { class_type: "PreviewAny", inputs: { source: ["32", 0] } },
      "10": { class_type: "SaveAudioAdvanced", inputs: { format: { format: "flac" } } },
    },
  });
}

/** 手搓最小 FLAC 头("fLaC"+STREAMINFO)→ b64(与 bgm-batch.test.ts 同款手法)。 */
function flacB64(sampleRate: number, totalSamples: number): string {
  const stream = new Uint8Array(34);
  const sr = sampleRate & 0xfffff;
  stream[10] = (sr >>> 12) & 0xff;
  stream[11] = (sr >>> 4) & 0xff;
  stream[12] = ((sr & 0xf) << 4) | ((1 & 0x7) << 1) | (15 >>> 4);
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

const assetFixture = { id: "a1", name: "参考曲A", url: "asset-file://audio/ref-a-mp3.mp3", filename: "ref-a.mp3" };

describe("toBgmCoverAssetOptions(资产→参考曲选项·纯函数)", () => {
  it("有读址的资产进选项:filename 取读址尾段(带扩展名);无读址的滤除(读不了字节)", () => {
    const options = toBgmCoverAssetOptions([
      { id: "a1", source: "manying-local", type: "audio", name: "参考曲A", previewUrl: "asset-file://audio/%E7%BF%BB%E5%94%B1%E5%8F%82%E8%80%83.flac" },
      { id: "a2", source: "manying-local", type: "audio", name: "无读址资产" },
      { id: "a3", source: "manying-local", type: "audio", name: "空串读址", previewUrl: "  " },
    ]);
    expect(options).toEqual([
      { id: "a1", name: "参考曲A", url: "asset-file://audio/%E7%BF%BB%E5%94%B1%E5%8F%82%E8%80%83.flac", filename: "翻唱参考.flac" },
    ]);
  });

  it("尾段解码失败(坏百分号)回退资产名,不炸", () => {
    const options = toBgmCoverAssetOptions([
      { id: "a9", source: "manying-local", type: "audio", name: "fallback.mp3", previewUrl: "asset-file://audio/bad-%E4%.mp3" },
    ]);
    expect(options[0]?.filename).toBe("bad-%E4%.mp3");
  });
});

describe("buildBgmCoverStringInputs(翻唱文本注入面·纯函数)", () => {
  it("只注入 22 一个文本节点——记谱线没有 YuE2GenerateABC,无 23 同源对", () => {
    expect(buildBgmCoverStringInputs("s", "l")).toEqual({ "22.style": "s", "22.lyrics": "l" });
  });
});

describe("bgmCoverReducer(面板状态机)", () => {
  it("idle → load-assets → loading-assets → assets-loaded → ready;ready 期可选参考曲", () => {
    let state = bgmCoverReducer(bgmCoverInitialState, { type: "load-assets" });
    expect(state.phase).toBe("loading-assets");
    state = bgmCoverReducer(state, { type: "assets-loaded", assets: [assetFixture] });
    expect(state.phase).toBe("ready");
    expect(state.assets).toEqual([assetFixture]);
    state = bgmCoverReducer(state, { type: "select-asset", assetId: "a1" });
    expect(state.selectedAssetId).toBe("a1");
  });

  it("ready → start → generating → complete → done(产物字段原样入态)", () => {
    let state: BgmCoverState = { ...bgmCoverInitialState, phase: "ready", assets: [assetFixture], selectedAssetId: "a1" };
    state = bgmCoverReducer(state, { type: "start" });
    expect(state.phase).toBe("generating");
    state = bgmCoverReducer(state, { type: "complete", result: { filename: "bgm_yue2_1.flac", filePath: "/p/bgm_yue2_1.flac", url: null, durationSeconds: 95 } });
    expect(state.phase).toBe("done");
    expect(state.result?.filename).toBe("bgm_yue2_1.flac");
    expect(state.error).toBeNull();
  });

  it("列举/生成失败进 error;done 不被后续 fail 覆写(防陈旧回调)", () => {
    const listing = bgmCoverReducer(bgmCoverInitialState, { type: "fail", error: "资产库通道不可用" });
    expect(listing.phase).toBe("error");
    expect(listing.error).toBe("资产库通道不可用");
    const generating = { ...bgmCoverInitialState, phase: "generating" } as BgmCoverState;
    expect(bgmCoverReducer(generating, { type: "fail", error: "引擎掉线" }).phase).toBe("error");
    const done: BgmCoverState = { ...bgmCoverInitialState, phase: "done", result: { filename: "f", filePath: "/f", url: null, durationSeconds: null } };
    expect(bgmCoverReducer(done, { type: "fail", error: "迟到的失败" })).toBe(done);
  });

  it("非列举期不收 assets-loaded;非 ready 期不收 select;非生成期不收 complete(防陈旧回调)", () => {
    const ready: BgmCoverState = { ...bgmCoverInitialState, phase: "ready", assets: [] };
    expect(bgmCoverReducer(ready, { type: "assets-loaded", assets: [assetFixture] })).toBe(ready);
    const generating = { ...ready, phase: "generating" } as BgmCoverState;
    expect(bgmCoverReducer(generating, { type: "select-asset", assetId: "a1" })).toBe(generating);
    expect(bgmCoverReducer(bgmCoverInitialState, { type: "complete", result: { filename: "f", filePath: "/f", url: null, durationSeconds: null } })).toBe(bgmCoverInitialState);
  });

  it("重新列举清空选择与结果(资产清单已变,旧选择不可信);reset 回 idle", () => {
    const done: BgmCoverState = { phase: "done", assets: [assetFixture], selectedAssetId: "a1", error: null, result: { filename: "f", filePath: "/f", url: null, durationSeconds: 1 } };
    const reloaded = bgmCoverReducer(done, { type: "load-assets" });
    expect(reloaded).toEqual({ ...bgmCoverInitialState, phase: "loading-assets" });
    expect(bgmCoverReducer(reloaded, { type: "reset" })).toEqual(bgmCoverInitialState);
  });

  it("提示文案:列举中/空资产/未选参考曲各给指引,其余空串", () => {
    expect(formatBgmCoverHint({ ...bgmCoverInitialState, phase: "loading-assets" })).toBe("正在列举项目音频资产…");
    expect(formatBgmCoverHint({ ...bgmCoverInitialState, phase: "ready", assets: [] })).toContain("暂无音频资产");
    expect(formatBgmCoverHint({ ...bgmCoverInitialState, phase: "ready", assets: [assetFixture] })).toContain("选择参考曲");
    expect(formatBgmCoverHint(bgmCoverInitialState)).toBe("");
    expect(formatBgmCoverHint({ ...bgmCoverInitialState, phase: "generating" })).toBe("");
  });
});

describe("generateBgmCover(编排器·引擎调用全 mock 不真跑)", () => {
  it("全链:库取工作流→读参考曲 b64→参考曲走 images 注入口(30.audio)+文本走 22 注入→persist→终态 done", async () => {
    const audioB64 = flacB64(44_100, 4_189_500);
    const events: string[] = [];
    const states: BgmCoverState[] = [];
    let executePayload: {
      graphKeys: string[];
      strings: Record<string, string>;
      images: Array<{ key: string; name: string; b64: string }>;
      timeoutS?: number;
    } | undefined;
    const finalState = await generateBgmCover(
      {
        workflowId: YUE2_COVER_API_WORKFLOW_ID,
        style: " jazz cover, smoky saxophone, slow 70 bpm ",
        lyrics: "   ",
        asset: assetFixture,
      },
      {
        fetchWorkflowText: async () => {
          events.push("fetch-workflow");
          return coverWorkflowText();
        },
        readAudioB64: async (url) => {
          events.push(`read:${url}`);
          return audioB64;
        },
        execute: async (payload) => {
          const graph = payload.graph as unknown as Record<string, unknown>;
          executePayload = {
            graphKeys: Object.keys(graph).sort(),
            strings: payload.inputs.strings,
            images: payload.inputs.images.map(({ key, name, b64 }) => ({ key, name, b64 })),
            timeoutS: payload.timeoutS,
          };
          events.push("execute");
          return { audios: [{ nodeId: "10", filename: "audio/YuE2-Cover_00001_.flac", b64: audioB64 }] };
        },
        persistAudio: async (b64, filename) => {
          events.push(`persist:${filename}`);
          expect(b64).toBe(audioB64);
          return { filePath: "/proj/media/audio/2026-09/bgm_yue2_99.flac", url: "project-file://proj/media/audio/2026-09/bgm_yue2_99.flac" };
        },
        // 组件接线同款基线:现态的清单+选择随 start 保留(onStateChange 整体回推不清空)。
        initialState: { ...bgmCoverInitialState, phase: "ready", assets: [assetFixture], selectedAssetId: "a1" },
        onStateChange: (state) => states.push(state),
      },
    );
    // 链路顺序:取库→读参考曲→执行→落盘
    expect(events).toEqual(["fetch-workflow", `read:${assetFixture.url}`, "execute", "persist:audio/YuE2-Cover_00001_.flac"]);
    // 执行载荷:图=库图全节点;style 去空格注入 22;空歌词回退纯音乐铁律;参考曲走 30.audio 上传位
    expect(executePayload?.graphKeys).toEqual(["10", "14", "22", "30"]);
    expect(executePayload?.strings).toEqual({ "22.style": "jazz cover, smoky saxophone, slow 70 bpm", "22.lyrics": YUE2_BGM_LYRICS_IRON });
    expect(executePayload?.images).toEqual([{ key: YUE2_COVER_AUDIO_INPUT_KEY, name: "ref-a.mp3", b64: audioB64 }]);
    expect(executePayload?.timeoutS).toBe(YUE2_COVER_EXECUTE_TIMEOUT_S);
    expect(YUE2_COVER_EXECUTE_TIMEOUT_S).toBe(1200);
    // 终态与快照流:generating → done;产物文件名取落盘路径尾段,时长解自 FLAC 头
    expect(states.map((state) => state.phase)).toEqual(["generating", "done"]);
    // 基线保留:生成期与 done 快照都带参考曲清单与选择(生成期面板展示所选资产,
    // done 后二次翻唱不被 !selectedAssetId 锁死;缺基线时这里曾整体清空组件态)。
    expect(states.map((state) => ({ assets: state.assets, selectedAssetId: state.selectedAssetId }))).toEqual([
      { assets: [assetFixture], selectedAssetId: "a1" },
      { assets: [assetFixture], selectedAssetId: "a1" },
    ]);
    expect(finalState.phase).toBe("done");
    expect(finalState.assets).toEqual([assetFixture]);
    expect(finalState.selectedAssetId).toBe("a1");
    expect(finalState.result?.filename).toBe("bgm_yue2_99.flac");
    expect(finalState.result?.durationSeconds).toBeCloseTo(4_189_500 / 44_100, 5);
    expect(finalState.error).toBeNull();
  });

  it("基线缺省=initial(assets 空)仍可用;start 从任意非 generating 基线起步不炸", async () => {
    const noBaseline = await generateBgmCover(
      { workflowId: "repo:test", style: "s", lyrics: "", asset: assetFixture },
      {
        fetchWorkflowText: async () => coverWorkflowText(),
        readAudioB64: async () => "AAAA",
        execute: async () => ({ audios: [{ b64: flacB64(44_100, 44_100), filename: "a.flac" }] }),
        persistAudio: async () => ({ filePath: "/p/a.flac", url: null }),
      },
    );
    expect(noBaseline.phase).toBe("done");
    expect(noBaseline.assets).toEqual([]);
    expect(noBaseline.selectedAssetId).toBeNull();
    // 组件 done/error 态重跑:start 放行(仅拒 generating),清单与选择原样保留。
    const rerunFromDone = await generateBgmCover(
      { workflowId: "repo:test", style: "s", lyrics: "", asset: assetFixture },
      {
        fetchWorkflowText: async () => coverWorkflowText(),
        readAudioB64: async () => "AAAA",
        execute: async () => ({ audios: [{ b64: flacB64(44_100, 44_100), filename: "a.flac" }] }),
        persistAudio: async () => ({ filePath: "/p/a.flac", url: null }),
        initialState: { phase: "done", assets: [assetFixture], selectedAssetId: "a1", error: null, result: { filename: "old.flac", filePath: "/p/old.flac", url: null, durationSeconds: null } },
      },
    );
    expect(rerunFromDone.phase).toBe("done");
    expect(rerunFromDone.assets).toEqual([assetFixture]);
    expect(rerunFromDone.selectedAssetId).toBe("a1");
    expect(rerunFromDone.result?.filename).toBe("a.flac");
  });

  it("歌词非空时原样注入(不回退铁律);引擎进度逐次回报", async () => {
    const progresses: string[] = [];
    let strings: Record<string, string> | undefined;
    await generateBgmCover(
      { workflowId: "repo:test", style: "s", lyrics: "[verse]\n新词", asset: assetFixture },
      {
        fetchWorkflowText: async () => coverWorkflowText(),
        readAudioB64: async () => "AAAA",
        execute: async (payload, onProgress) => {
          strings = payload.inputs.strings;
          onProgress?.({ stage: "upload", message: "上传输入图 1/1…" });
          onProgress?.({ stage: "running", message: "引擎执行中…" });
          return { audios: [{ b64: flacB64(44_100, 44_100), filename: "a.flac" }] };
        },
        persistAudio: async () => ({ filePath: "/p/cover.flac", url: null }),
        onProgress: (message) => progresses.push(message),
      },
    );
    expect(strings?.["22.lyrics"]).toBe("[verse]\n新词");
    expect(progresses).toEqual(["上传输入图 1/1…", "引擎执行中…"]);
  });

  it("失败路径:空风格/坏工作流/读参考曲失败/无音频产物均进 error 且零 persist(不抛出)", async () => {
    const depsBase = {
      fetchWorkflowText: async () => coverWorkflowText(),
      readAudioB64: async () => "AAAA",
      persistAudio: async () => {
        throw new Error("不应触达落盘");
      },
    };
    const emptyStyle = await generateBgmCover(
      { workflowId: "repo:test", style: "  ", lyrics: "", asset: assetFixture },
      { ...depsBase, execute: async () => { throw new Error("不应触达引擎"); } },
    );
    expect(emptyStyle.phase).toBe("error");
    expect(emptyStyle.error).toBe("请先填写翻唱新风格描述");
    const badWorkflow = await generateBgmCover(
      { workflowId: "repo:test", style: "s", lyrics: "", asset: assetFixture },
      { ...depsBase, fetchWorkflowText: async () => "{ not-json", execute: async () => { throw new Error("不应触达引擎"); } },
    );
    expect(badWorkflow.phase).toBe("error");
    expect(badWorkflow.error).toBeTruthy();
    const readFail = await generateBgmCover(
      { workflowId: "repo:test", style: "s", lyrics: "", asset: assetFixture },
      { ...depsBase, readAudioB64: async () => { throw new Error("参考曲读取失败"); }, execute: async () => { throw new Error("不应触达引擎"); } },
    );
    expect(readFail.phase).toBe("error");
    expect(readFail.error).toBe("参考曲读取失败");
    const noAudio = await generateBgmCover(
      { workflowId: "repo:test", style: "s", lyrics: "", asset: assetFixture },
      { ...depsBase, execute: async () => ({ audios: [] }) },
    );
    expect(noAudio.phase).toBe("error");
    expect(noAudio.error).toContain("没有输出音频");
  });
});
