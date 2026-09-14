import { describe, expect, it } from "vitest";

import { assertH3TemplateIntegrity, buildShotH3RefWorkflow, buildShotH3Workflow } from "./h3-shot-video-workflow";

function makeShot(overrides: Record<string, unknown> = {}) {
  return {
    id: "sb-chapter-001-001",
    episodeId: "chapter-001",
    index: 1,
    trackKey: "main",
    trackId: "track-1",
    duration: 5,
    durationTarget: 5,
    prompt: "备用画面描述",
    videoDesc: "雨夜中的石桥",
    assetIds: [],
    lines: "",
    sound: "远处的雨声",
    mediaRef: { kind: "image" as const, path: "project-file://frame.jpg" },
    shotSemantics: {
      sceneViewpointId: "bridge",
      personFree: true,
      visibleCharacters: [],
      visibleProps: [],
      actionIn: "雨幕落下",
      actionOut: "水面泛起涟漪",
    },
    ...overrides,
  };
}

function nodeWidgets(ui: Record<string, unknown>, id: number): unknown[] {
  const nodes = ui.nodes as Array<{ id: number; widgets_values?: unknown[] }>;
  return nodes.find((node) => node.id === id)?.widgets_values ?? [];
}

describe("buildShotH3Workflow", () => {
  it("injects prompt, snapped seconds, image names, prefix, and anchor data", () => {
    const result = buildShotH3Workflow({ shot: makeShot(), chapterId: "chapter-001", chapterLabel: "第一章 雨夜" });
    const nodes = result.ui.nodes as Array<Record<string, unknown>>;
    const byId = new Map(nodes.map((node) => [node.id, node]));

    expect(result.name).toBe("MY-单镜视频 · 第一章 雨夜 · S01");
    expect(result.report).toMatchObject({ shot: 1, frames: 124, policy: "ambient" });
    expect(nodeWidgets(result.ui, 14)[0]).toContain("integrated_multimodal_description:");
    expect(nodeWidgets(result.ui, 20)[0]).toBe(124 / 24);
    expect(nodeWidgets(result.ui, 9)[0]).toBe("my-shot-h3-sb-chapter-001-001.jpg");
    expect(nodeWidgets(result.ui, 4)[0]).toBe("video/漫影/chapter-001/sb-chapter-001-001/ambient");
    expect(String(nodeWidgets(result.ui, 4)[0])).not.toContain("video/漫影_S");
    expect(nodeWidgets(result.ui, 100)).toEqual(["sb-chapter-001-001", "S01", "雨夜中的石桥", "图✓"]);
    expect(byId.get(100)?.properties).toMatchObject({ myPreview: "my-shot-h3-sb-chapter-001-001.jpg" });
    expect((byId.get(4)?.outputs as Array<{ links?: number[] }>)[0]?.links).toContain(70);
    expect((byId.get(100)?.inputs as Array<{ name?: string }>)[0]?.name).toBe("video");
  });

  it("uses prompt as the description fallback and remains deterministic", () => {
    const shot = makeShot({ videoDesc: "", prompt: "一盏灯在风中摇晃", duration: 8, durationTarget: undefined });
    const first = buildShotH3Workflow({ shot, chapterId: "chapter-002", chapterLabel: "第二章" });
    const second = buildShotH3Workflow({ shot, chapterId: "chapter-002", chapterLabel: "第二章" });
    expect(first).toEqual(second);
    expect(first.report.frames).toBe(192);
    expect(nodeWidgets(first.ui, 14)[0]).toContain("一盏灯在风中摇晃");
  });

  it("fails fast when a required template punch hole drifts", () => {
    expect(() => assertH3TemplateIntegrity({ nodes: [] })).toThrow("h3-shot-template drift");
  });

  it("locks the single-stage direct-output graph per 09-14 late rulings (no upscale, no tail frame)", () => {
    const result = buildShotH3Workflow({ shot: makeShot(), chapterId: "chapter-001", chapterLabel: "第一章 雨夜" });
    const nodes = result.ui.nodes as Array<{ id: number; type: string; mode?: number; widgets_values?: unknown[] }>;
    const types = nodes.map((node) => node.type);
    // 裁定一:超分不进工作流——单段直出,无放大/AV 拼拆链
    expect(types).not.toContain("MinimaxH3LatentUpscaler3D");
    expect(types).not.toContain("LTXVSeparateAVLatent");
    expect(types).not.toContain("LTXVConcatAVLatent");
    expect(types.filter((type) => type === "MiniMaxH3ImageToVideo")).toHaveLength(1);
    expect(types.filter((type) => type === "SamplerCustomAdvanced")).toHaveLength(1);
    // 裁定二:I2V 单图——尾帧槽(节点 10)不存在;首帧节点 9 激活;selector 原生档 0.98
    expect(nodes.some((node) => node.id === 10)).toBe(false);
    expect(nodes.find((node) => node.id === 9)?.mode).toBe(0);
    const selector = nodes.find((node) => node.type === "ResolutionSelector");
    expect(selector?.widgets_values?.[1]).toBe(0.98);
    // 实弹教训(09-14 E2E):tiny_vae 引擎列表只有 ['none'],taeh3 值会被
    // /prompt 验证整图打回(Output will be ignored)——预览加速模型锁 'none'
    const preview = nodes.find((node) => node.type === "ModelPreviewOverrideKJ");
    expect(preview?.widgets_values).toContain("none");
    expect(preview?.widgets_values).not.toContain("taeh3.safetensors");
  });

  it("maps storyboard shotSize/cameraMove vocabulary into the H3 prompt (09-14 upstream alignment)", () => {
    const base = makeShot();
    const shot = makeShot({
      shotSemantics: { ...base.shotSemantics, cameraMove: "缓推", shotSize: "近景" },
    });
    const result = buildShotH3Workflow({ shot, chapterId: "chapter-001", chapterLabel: "第一章 雨夜" });
    const prompt = String(nodeWidgets(result.ui, 14)[0]);
    expect(prompt).toContain("Push In");
    expect(prompt).toContain("近景");
  });
});

describe("buildShotH3RefWorkflow (09-14-h3-ref2va-line)", () => {
  it("activates ref slots per assets and injects the six-section prompt", () => {
    const result = buildShotH3RefWorkflow({
      shot: makeShot(),
      chapterId: "chapter-001",
      chapterLabel: "第一章 雨夜",
      refs: [
        { name: "独孤剑尘", kind: "character", imageName: "my-shot-h3-ref-role-001.jpg" },
        { name: "金水河码头", kind: "scene", imageName: "my-shot-h3-ref-scene-001.jpg" },
      ],
    });
    const nodes = result.ui.nodes as Array<{ id: number; type: string; mode?: number; widgets_values?: unknown[] }>;
    const types = nodes.map((node) => node.type);
    expect(types).toContain("MiniMaxH3ReferenceToVideo");
    expect(types).not.toContain("LoraLoaderModelOnly");
    const prompt = String(nodes.find((node) => node.id === 14)?.widgets_values?.[0]);
    for (const section of ["subject_definitions:", "summary:", "retention_analysis:", "detailed_description:", "overall_soundscape:", "non_diegetic_music:"]) {
      expect(prompt).toContain(section);
    }
    expect(prompt).toContain("<Subject 1> is 独孤剑尘, whose appearance comes from <Picture 2>");
    const byId = (id: number) => nodes.find((node) => node.id === id);
    expect(byId(9)?.mode).toBe(0);
    expect(byId(110)?.mode).toBe(0);
    expect(byId(111)?.mode).toBe(0);
    expect(byId(110)?.widgets_values?.[0]).toBe("my-shot-h3-ref-role-001.jpg");
    expect(byId(112)?.mode).toBe(4);
    expect(byId(113)?.mode).toBe(4);
    expect(String(byId(4)?.widgets_values?.[0])).toBe("video/漫影/chapter-001/sb-chapter-001-001/ref-ambient");
    expect(result.name).toBe("MY-单镜视频Ref2VA · 第一章 雨夜 · S01");
  });

  it("keeps the conditioning/latent/clip wiring intact (09-14 实弹发现的连线断流回归锁)", () => {
    const result = buildShotH3RefWorkflow({ shot: makeShot(), chapterId: "chapter-001", chapterLabel: "第一章 雨夜", refs: [] });
    const nodes = result.ui.nodes as Array<{
      id: number;
      type: string;
      inputs?: Array<{ name: string; link: number | null }>;
    }>;
    const inputLink = (id: number, name: string) =>
      nodes.find((node) => node.id === id)?.inputs?.find((input) => input.name === name)?.link;
    expect(inputLink(33, "conditioning")).not.toBeNull();
    expect(inputLink(26, "latent_image")).not.toBeNull();
    for (const name of ["clip", "vae", "prompt", "width", "height", "length", "ref_images.ref_image_0"]) {
      expect(inputLink(16, name)).not.toBeNull();
    }
  });
});
