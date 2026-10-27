import { describe, expect, it, vi } from "vitest";

import apiTemplate from "./h3-shot-template.api.json";
import fasth3ApiTemplate from "./fasth3-shot-template.api.json";
import multisegTemplateJson from "./h3-multiseg-template.json";
import multisegApiTemplate from "./h3-multiseg-template.api.json";
import { H3_WORKFLOW_RECIPES, batchDispatchableH3Recipes } from "./h3-workflow-recipes";
import {
  DEFAULT_H3_RECIPE_ID,
  assertH3TemplateIntegrity,
  buildShotH3ApiWorkflow,
  buildShotH3ApiWorkflowForRecipe,
  buildShotH3MultisegApiWorkflow,
  buildShotH3RefWorkflow,
  buildShotH3Workflow,
  h3ApiTemplateRecipeIds,
  h3BatchDispatchableRecipeIds,
  resolveH3ShotTimeoutS,
} from "./h3-shot-video-workflow";

const api = apiTemplate as unknown as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const fasth3Api = fasth3ApiTemplate as unknown as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const multisegApi = multisegApiTemplate as unknown as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const multisegTemplate = multisegTemplateJson as { nodes: Array<{ id: number; type: string; mode?: number; widgets_values?: unknown[]; inputs?: Array<{ name: string; link: number | null }> }> };

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

describe.each([
  ["I2V", buildShotH3Workflow],
  ["Ref2VA", (input: Parameters<typeof buildShotH3Workflow>[0]) => buildShotH3RefWorkflow({ ...input, refs: [] })],
] as const)("%s serialized widget contract", (_name, build) => {
  it("keeps resolution identical for positional and named consumers", () => {
    const { ui } = build({ shot: makeShot(), chapterId: "chapter-001", chapterLabel: "第一章" });
    const nodes = ui.nodes as Array<{ type: string; widgets_values: unknown[]; widgets_values_named: Record<string, unknown> }>;
    const selector = nodes.find((node) => node.type === "ResolutionSelector")!;
    expect(selector.widgets_values_named).toMatchObject({
      aspect_ratio: selector.widgets_values[0],
      megapixels: selector.widgets_values[1],
      multiple: selector.widgets_values[2],
    });
    expect(selector.widgets_values_named.megapixels).toBe(0.98);
  });

  it("keeps preview model selection identical for both consumers", () => {
    const { ui } = build({ shot: makeShot(), chapterId: "chapter-001", chapterLabel: "第一章" });
    const nodes = ui.nodes as Array<{ type: string; widgets_values: unknown[]; widgets_values_named: Record<string, unknown> }>;
    const preview = nodes.find((node) => node.type === "ModelPreviewOverrideKJ")!;
    expect(preview.widgets_values_named.tiny_vae).toBe(preview.widgets_values[5]);
  });
});

describe("buildShotH3Workflow", () => {
  it("captures origin in the queued anchor without changing widget positions", () => {
    for (const build of [buildShotH3Workflow, (input: Parameters<typeof buildShotH3Workflow>[0]) => buildShotH3RefWorkflow({ ...input, refs: [] })]) {
      const result = build({ shot: makeShot(), chapterId: "chapter-001", chapterLabel: "章", originProjectId: "project-a" });
      const anchor = (result.ui.nodes as Array<{ id: number; properties: Record<string, unknown> }>).find((node) => node.id === 100);
      expect(anchor?.properties.myOriginProjectId).toBe("project-a");
      expect(anchor?.properties.myOriginEpisodeId).toBe("chapter-001");
      expect(nodeWidgets(result.ui, 100)).toHaveLength(4);
    }
  });
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

describe("h3-shot-template.api.json 契约(PRD §5.1,1027 API 化脚本产物)", () => {
  it("API 节点数=27(31 UI 节点 − 4 MarkdownNote;MarkdownNote 为 UI 专属节点不在 object_info)", () => {
    expect(Object.keys(api)).toHaveLength(27);
    expect(Object.keys(api).map(Number).sort((a, b) => a - b)).toEqual([
      2, 3, 4, 6, 7, 8, 9, 13, 14, 16, 17, 20, 21, 22, 23, 26, 29, 33, 34, 36, 37, 40, 41, 42, 43, 48, 100,
    ]);
  });

  it("锚字段在位且类型对(实锚:14 文本锚=value 非 text;20.value 为 number)", () => {
    expect(api["14"].class_type).toBe("PrimitiveStringMultiline");
    expect(api["14"].inputs.value).toEqual(expect.any(String));
    expect(api["20"].class_type).toBe("PrimitiveFloat");
    expect(api["20"].inputs.value).toEqual(expect.any(Number));
    expect(api["9"].class_type).toBe("LoadImage");
    expect(api["9"].inputs.image).toEqual(expect.any(String));
    expect(api["4"].class_type).toBe("SaveVideo");
    expect(api["4"].inputs.filename_prefix).toEqual(expect.any(String));
    expect(api["100"].class_type).toBe("MyShot");
    expect(api["16"].class_type).toBe("MiniMaxH3ImageToVideo");
  });

  it("生成链与回收链在位:16 吃 14/9/23,MyShot video 直连 SaveVideo(组装器 connectVideoWriteback 同源)", () => {
    expect(api["16"].inputs.prompt).toEqual(["14", 0]);
    expect(api["16"].inputs.first_frame).toEqual(["9", 0]);
    expect(api["16"].inputs.length).toEqual(["23", 1]);
    expect("width" in api["16"].inputs).toBe(true);
    expect("height" in api["16"].inputs).toBe(true);
    expect(api["100"].inputs.video).toEqual(["4", 0]);
    for (const key of ["shot_id", "label", "description", "media_status"]) {
      expect(key in api["100"].inputs).toBe(true);
    }
  });
});

describe("buildShotH3ApiWorkflow(PRD §5.2 C3 标量出厂直填,通道B 批量派发真身)", () => {  it("apiGraph 出厂直填与画布档逐字同源(prompt/prefix/imageName/MyShot 四字段/report)", () => {
    const result = buildShotH3ApiWorkflow({ shot: makeShot(), chapterId: "chapter-001", chapterLabel: "第一章 雨夜", originProjectId: "project-a" });
    const uiNodes = result.uiWorkflow.nodes as Array<{ id: number; widgets_values?: unknown[]; properties?: Record<string, unknown> }>;
    const uiWidget = (id: number) => uiNodes.find((node) => node.id === id)?.widgets_values?.[0];

    expect(result.apiGraph["14"].inputs.value).toBe(uiWidget(14));
    expect(String(result.apiGraph["14"].inputs.value)).toContain("integrated_multimodal_description:");
    expect(result.apiGraph["20"].inputs.value).toBe(124 / 24);
    expect(typeof result.apiGraph["20"].inputs.value).toBe("number");
    expect(result.apiGraph["4"].inputs.filename_prefix).toBe("video/漫影/chapter-001/sb-chapter-001-001/ambient");
    expect(String(result.apiGraph["4"].inputs.filename_prefix).split("/")).toHaveLength(5);
    expect(result.apiGraph["9"].inputs.image).toBe("my-shot-h3-sb-chapter-001-001.jpg");
    expect(result.apiGraph["100"].inputs).toMatchObject({
      shot_id: "sb-chapter-001-001",
      label: "S01",
      description: "雨夜中的石桥",
      media_status: "图✓",
      video: ["4", 0],
    });
    expect(result.report).toMatchObject({ shot: 1, frames: 124, policy: "ambient" });
    // uiWorkflow=画布档同源 UI 图,MyShot properties 三键已注入(直接作 extraPngInfo.workflow 附件)
    expect(uiNodes.find((node) => node.id === 100)?.properties).toMatchObject({
      myOriginProjectId: "project-a",
      myPreview: "my-shot-h3-sb-chapter-001-001.jpg",
      myOriginEpisodeId: "chapter-001",
    });
  });

  it("宽高随档直填:缺省 960p=1344×768,480p=608×352(覆盖出厂 ResolutionSelector link,N11)", () => {
    const nine = buildShotH3ApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章" });
    expect(nine.apiGraph["16"].inputs.width).toBe(1344);
    expect(nine.apiGraph["16"].inputs.height).toBe(768);
    const four = buildShotH3ApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章", resolutionTier: "480p" });
    expect(four.apiGraph["16"].inputs.width).toBe(608);
    expect(four.apiGraph["16"].inputs.height).toBe(352);
    // 克隆出厂:两次组装互不污染
    expect(nine.apiGraph["16"].inputs.width).toBe(1344);
  });

  it("images 通道:带 b64 恰一项 9.image;无 b64 空数组且 9 节点填占位名", () => {
    const withB64 = buildShotH3ApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章", firstFrameB64: "aGVsbG8=" });
    expect(withB64.images).toEqual([{ key: "9.image", name: "my-shot-h3-sb-chapter-001-001.jpg", b64: "aGVsbG8=" }]);
    const noB64 = buildShotH3ApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章" });
    expect(noB64.images).toEqual([]);
    expect(noB64.apiGraph["9"].inputs.image).toBe("my-shot-h3-sb-chapter-001-001.jpg");
  });

  it("文案自检门失败抛大白话错误(mock 改写环节吞词,同画布档口径)", async () => {
    vi.resetModules();
    vi.doMock("./h3-shot-prompt", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./h3-shot-prompt")>();
      return {
        ...actual,
        buildShotH3Prompt: () => ({ prompt: "integrated_multimodal_description: 场景描述(台词被改写环节吞掉)", seconds: 5, lengthFrames: 124 }),
      };
    });
    try {
      const { buildShotH3ApiWorkflow: buildMocked } = await import("./h3-shot-video-workflow");
      const shot = makeShot({ lines: "甲：先走。", index: 3 });
      expect(() => buildMocked({ shot, chapterId: "chapter-001", chapterLabel: "第一章", policy: "full" })).toThrow(/文案逐字自检未通过.*S03.*「先走。」/);
    } finally {
      vi.doUnmock("./h3-shot-prompt");
    }
  });
});

describe("H3 工作流注册表(PRD §4,可切换核心;C1 二态+resolutionTiers 数组)", () => {
  it("id 唯一", () => {
    const ids = H3_WORKFLOW_RECIPES.map((recipe) => recipe.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ready 件必备 apiTemplate+myShot 锚+非空 resolutionTiers", () => {
    for (const recipe of H3_WORKFLOW_RECIPES) {
      if (recipe.status !== "ready") continue;
      expect(recipe.apiTemplate).toBeTruthy();
      expect(recipe.anchors?.myShot).toBeTruthy();
      expect(recipe.resolutionTiers.length).toBeGreaterThan(0);
    }
  });

  it("批量可派发集合只含 ready 件(unverified/needs-unfreeze/cloud-paid 一律不入;multiseg 二期升级 ready)", () => {
    const batch = batchDispatchableH3Recipes();
    expect(batch.map((recipe) => recipe.id)).toEqual(["my-h3-i2v-31", "my-h3-multiseg"]);
    for (const excluded of ["guding-480p-direct", "guding-960p-refine", "official-i2v-480p", "my-fasth3-i2v-27", "my-fasth3-t2v-26", "api-flf2v-480p", "api-r2v-480p", "api-t2v-480p"]) {
      expect(batch.some((recipe) => recipe.id === excluded)).toBe(false);
    }
  });

  it("首发件锚=object_info 实锚(14.value 非 text;漂移即红)", () => {
    const ready = H3_WORKFLOW_RECIPES.find((recipe) => recipe.id === "my-h3-i2v-31");
    expect(ready?.anchors).toMatchObject({
      prompt: "14.value",
      seconds: "20.value",
      firstFrame: "9.image",
      resolution: ["16.width", "16.height"],
      savePrefix: "4.filename_prefix",
      myShot: "100",
    });
  });

  it("注入层硬门(§4.3.1):ready 件锚字段全部在 API 图中", () => {
    const ready = H3_WORKFLOW_RECIPES.find((recipe) => recipe.id === "my-h3-i2v-31")!;
    const anchors = ready.anchors!;
    const fields = [anchors.prompt, anchors.seconds, anchors.firstFrame, anchors.savePrefix, ...(anchors.resolution ?? [])].filter(
      (field): field is string => Boolean(field),
    );
    for (const field of fields) {
      const [nodeId, key] = field.split(".");
      expect(api[nodeId]?.inputs[key], field).not.toBeUndefined();
    }
    expect(api[anchors.myShot!].class_type).toBe("MyShot");
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

describe("voiceMood 音色锚透传 (10-11 D1,主会话已授权最小透传)", () => {
  it.each([
    ["I2V", buildShotH3Workflow],
    ["Ref2VA", (input: Parameters<typeof buildShotH3Workflow>[0]) => buildShotH3RefWorkflow({ ...input, refs: [] })],
  ] as const)("%s 透传 voiceMood 到 prompt says 行;缺省无锚", (_name, build) => {
    const shot = makeShot({ lines: "甲：先走。" });
    const withMood = build({ shot, chapterId: "chapter-001", chapterLabel: "第一章", policy: "full", voiceMood: "克制" });
    expect(String(nodeWidgets(withMood.ui, 14)[0])).toContain("says in a 克制 tone");
    const noMood = build({ shot, chapterId: "chapter-001", chapterLabel: "第一章", policy: "full" });
    expect(String(nodeWidgets(noMood.ui, 14)[0])).not.toContain("says in a");
  });
});

describe("文案逐字自检门接线 (参考_文案逐字自检门.md §一,10-01-a7)", () => {
  const linedShot = () => makeShot({ lines: "甲：先走。\n旁白：雨声盖过脚步。", index: 3 });

  it("full 档天然逐字:I2V 与 Ref2VA 组装均过门不误拦", () => {
    expect(() => buildShotH3Workflow({ shot: linedShot(), chapterId: "chapter-001", chapterLabel: "第一章", policy: "full" })).not.toThrow();
    expect(() => buildShotH3RefWorkflow({ shot: linedShot(), chapterId: "chapter-001", chapterLabel: "第一章", policy: "full", refs: [] })).not.toThrow();
  });

  it("ambient/bare 档台词走 TTS 线不进 prompt,清单为空不拦", () => {
    expect(() => buildShotH3Workflow({ shot: linedShot(), chapterId: "chapter-001", chapterLabel: "第一章", policy: "ambient" })).not.toThrow();
    expect(() => buildShotH3Workflow({ shot: linedShot(), chapterId: "chapter-001", chapterLabel: "第一章", policy: "bare" })).not.toThrow();
  });

  it("缺席即阻断派发:抛大白话中文错误指名缺哪几条(模拟改写环节吞词)", async () => {
    // 模拟未来 LLM 改写链把台词吞掉:builder 返回的 prompt 缺计划台词
    vi.resetModules();
    vi.doMock("./h3-shot-prompt", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./h3-shot-prompt")>();
      return {
        ...actual,
        buildShotH3Prompt: () => ({ prompt: "integrated_multimodal_description: 场景描述(台词被改写环节吞掉)", seconds: 5, lengthFrames: 124 }),
        buildShotH3RefPrompt: () => ({ prompt: "detailed_description: [Shot 1] 场景描述(台词被改写环节吞掉)", seconds: 5, lengthFrames: 124 }),
      };
    });
    try {
      const { buildShotH3Workflow: buildMocked, buildShotH3RefWorkflow: buildRefMocked } = await import("./h3-shot-video-workflow");
      const input = { shot: linedShot(), chapterId: "chapter-001", chapterLabel: "第一章", policy: "full" as const };
      // 10-11 口径:计划清单=角色行 only(旁白行归外挂 TTS 不入清单),缺席指名只含角色行
      expect(() => buildMocked(input)).toThrow(/文案逐字自检未通过.*S03.*「先走。」/);
      expect(() => buildMocked(input)).not.toThrow(/雨声盖过脚步/);
      expect(() => buildRefMocked({ ...input, refs: [] })).toThrow(/文案逐字自检未通过/);
    } finally {
      vi.doUnmock("./h3-shot-prompt");
    }
  });
});

describe("Windows FastH3 主线通道(10-27 windows-fasth3-mainline W10 配方化)", () => {
  it("缺省零变:不带 recipeId 走旧 H3 模板对(euler/CLIPLoaderGGUF 在场,FastH3 件不在)", () => {
    const result = buildShotH3ApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章" });
    expect(DEFAULT_H3_RECIPE_ID).toBe("my-h3-i2v-31");
    expect(result.apiGraph["29"].inputs.sampler_name).toBe("euler");
    expect(result.apiGraph["21"].class_type).toBe("CLIPLoaderGGUF");
    expect(result.apiGraph["43"].class_type).toBe("SolAttnPatch");
  });

  it("recipeId=my-fasth3-i2v-27 选 FastH3 模板对:换芯件在场+旧线退役件零回潮", () => {
    const result = buildShotH3ApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章", recipeId: "my-fasth3-i2v-27" });
    expect(Object.keys(result.apiGraph)).toHaveLength(23);
    expect(result.apiGraph["29"].inputs.sampler_name).toBe("res_multistep");
    expect(result.apiGraph["21"].class_type).toBe("CLIPLoader");
    expect(result.apiGraph["21"].inputs.clip_name).toBe("qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors");
    expect(result.apiGraph["40"].inputs.attention).toBe("comfy kitchen attention");
    expect(result.apiGraph["43"].class_type).toBe("BlockSparseAttention");
    expect(result.apiGraph["43"].inputs).toMatchObject({ selection: "vsa", "selection.keep_percent": 10 });
    for (const retired of ["3", "17", "41", "48"]) {
      expect(result.apiGraph[retired]).toBeUndefined();
    }
  });

  it("FastH3 锚注入与旧线同构:提示词/秒/前缀/首帧/MyShot/宽高档位直填全在位", () => {
    const result = buildShotH3ApiWorkflow({
      shot: makeShot(),
      chapterId: "chapter-001",
      chapterLabel: "第一章 雨夜",
      originProjectId: "project-a",
      firstFrameB64: "aGVsbG8=",
      recipeId: "my-fasth3-i2v-27",
    });
    expect(String(result.apiGraph["14"].inputs.value)).toContain("integrated_multimodal_description:");
    expect(result.apiGraph["20"].inputs.value).toBe(124 / 24);
    expect(result.apiGraph["4"].inputs.filename_prefix).toBe("video/漫影/chapter-001/sb-chapter-001-001/ambient");
    expect(result.apiGraph["9"].inputs.image).toBe("my-shot-h3-sb-chapter-001-001.jpg");
    expect(result.images).toEqual([{ key: "9.image", name: "my-shot-h3-sb-chapter-001-001.jpg", b64: "aGVsbG8=" }]);
    expect(result.apiGraph["100"].inputs).toMatchObject({
      shot_id: "sb-chapter-001-001", label: "S01", description: "雨夜中的石桥", media_status: "图✓", video: ["4", 0],
    });
    // 缺省 960p 档直填 16.width/height(覆盖出厂 ResolutionSelector link,N11 同款)
    expect(result.apiGraph["16"].inputs.width).toBe(1344);
    expect(result.apiGraph["16"].inputs.height).toBe(768);
    const low = buildShotH3ApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章", recipeId: "my-fasth3-i2v-27", resolutionTier: "480p" });
    expect(low.apiGraph["16"].inputs.width).toBe(608);
    expect(low.apiGraph["16"].inputs.height).toBe(352);
  });

  it("uiWorkflow 附件=FastH3 画布档(回收链 extraPngInfo 与实际派发图同源)", () => {
    const result = buildShotH3ApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章", originProjectId: "project-a", recipeId: "my-fasth3-i2v-27" });
    const nodes = result.uiWorkflow.nodes as Array<{ id: number; type: string; properties?: Record<string, unknown>; widgets_values?: unknown[]; inputs?: Array<{ name?: string }> }>;
    const types = nodes.map((node) => node.type);
    expect(types).toContain("BlockSparseAttention");
    expect(types).not.toContain("SolAttnPatch");
    expect(types).not.toContain("ModelPreviewOverrideKJ");
    expect(nodes).toHaveLength(27); // 4 说明 Note 保留(UI 专属,API 化跳过)
    // 组装时补的 SaveVideo→MyShot 回收连线在画布附件里同源在场
    const anchor = nodes.find((node) => node.id === 100);
    expect(anchor?.inputs?.[0]?.name).toBe("video");
    expect(anchor?.properties).toMatchObject({ myOriginProjectId: "project-a" });
  });

  it("未知 recipeId 抛大白话(禁静默回缺省模板)", () => {
    expect(() => buildShotH3ApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章", recipeId: "my-fasth3-t2v-26" }))
      .toThrow(/未知 H3 工作流配方:my-fasth3-t2v-26/);
  });

  it("注册表↔bundle 模板对一致性:凡带 apiTemplate 的注册条目都可派发,反之不虚挂(§14.1.4 起 multiseg 走专用组装器,并入统一可派发集)", () => {
    const dispatchable = new Set(h3BatchDispatchableRecipeIds());
    for (const recipe of H3_WORKFLOW_RECIPES) {
      if (recipe.apiTemplate) expect(dispatchable.has(recipe.id), recipe.id).toBe(true);
    }
    expect(dispatchable.has("my-h3-i2v-31")).toBe(true);
    expect(dispatchable.has("my-fasth3-i2v-27")).toBe(true);
    expect(dispatchable.has("my-h3-multiseg")).toBe(true); // 分段组装器件(不在 i2v 模板对表,经 ForRecipe 分派)
    // 模板对表自身不虚挂:i2v 族 pair id 恒在注册表在册
    for (const id of h3ApiTemplateRecipeIds()) {
      expect(H3_WORKFLOW_RECIPES.some((recipe) => recipe.id === id), id).toBe(true);
    }
  });

  it("fasth3-shot-template.api.json 静态契约:锚与生成链在位(与后端接线契约测试同口径)", () => {
    expect(Object.keys(fasth3Api)).toHaveLength(23);
    expect(fasth3Api["16"].inputs.prompt).toEqual(["14", 0]);
    expect(fasth3Api["16"].inputs.first_frame).toEqual(["9", 0]);
    expect(fasth3Api["16"].inputs.length).toEqual(["23", 1]);
    expect(fasth3Api["100"].inputs.video).toEqual(["4", 0]);
  });
});

// ── multiseg 适配(PRD 10-27 §14.1;my-h3-multiseg needs-adaptation→ready)──────────────────────

describe("h3-multiseg-template.api.json 契约(PRD §14.1.2,--preset multiseg 脚本产物)", () => {
  it("API 节点数=14(12+2 四针适配:9 LoadImage+103 MyShot;无 note 类,UI 节点全进)", () => {
    expect(Object.keys(multisegApi)).toHaveLength(14);
    expect(Object.keys(multisegApi).map(Number).sort((a, b) => a - b)).toEqual([2, 4, 6, 7, 9, 13, 21, 34, 36, 41, 100, 101, 102, 103]);
  });

  it("锚断言全中(§14.1.2 ②:与 1025 multiseg 实弹手写 API 图逐键同形)", () => {
    expect(multisegApi["100"].class_type).toBe("H3Parameter");
    expect(multisegApi["100"].inputs.long_prompt).toEqual(expect.any(String));
    expect(multisegApi["100"].inputs.width).toBe(960);
    expect(multisegApi["100"].inputs.height).toBe(544);
    expect(multisegApi["100"].inputs.clip_tag).toBe("段1");
    expect(multisegApi["100"].inputs.fps).toBe(24);
    expect(multisegApi["4"].inputs.filename_prefix).toBe("video/漫影/chapter-001/shot-001/ambient");
    expect(String(multisegApi["4"].inputs.filename_prefix).split("/")).toHaveLength(5);
    expect(multisegApi["9"].class_type).toBe("LoadImage");
    expect(multisegApi["9"].inputs.image).toEqual(expect.any(String));
    expect(multisegApi["103"].class_type).toBe("MyShot");
    expect(multisegApi["103"].inputs.video).toEqual(["4", 0]);
    for (const key of ["shot_id", "label", "description", "media_status"]) {
      expect(key in multisegApi["103"].inputs).toBe(true);
    }
    expect(multisegApi["101"].class_type).toBe("H3AutoContextSampler");
    expect(multisegApi["101"].inputs.first_frame).toEqual(["9", 0]);
    expect(multisegApi["101"].inputs.parameter).toEqual(["100", 0]);
  });

  it("适配 UI 件 h3-multiseg-template.json:四针出厂(双旁路 mode=4/占位五段前缀/连线 15+16/repo 原厂值保真)", () => {
    const nodes = multisegTemplate.nodes as Array<{ id: number; type: string; mode?: number; widgets_values?: unknown[]; inputs?: Array<{ name: string; link: number | null }> }>;
    expect(nodes).toHaveLength(14);
    const byId = (id: number) => nodes.find((node) => node.id === id)!;
    expect(byId(9).type).toBe("LoadImage");
    expect(byId(9).mode).toBe(4); // 双旁路出厂:画布直开不执行占位首帧(防污染)
    expect(byId(103).type).toBe("MyShot");
    expect(byId(103).mode).toBe(4); // 双旁路出厂:画布直开不执行占位 MyShot(防污染收件箱)
    expect(byId(103).widgets_values?.[0]).toBe("shot-001");
    expect(byId(4).widgets_values?.[0]).toBe("video/漫影/chapter-001/shot-001/ambient");
    expect(byId(101).inputs?.find((input) => input.name === "first_frame")?.link).toBe(15);
    expect(byId(103).inputs?.find((input) => input.name === "video")?.link).toBe(16);
    // repo 原厂值保真(§14.1.1「其余出厂值全保原厂」抽钉)
    expect(byId(100).widgets_values?.[6]).toBe(960);
    expect(byId(100).widgets_values?.[9]).toBe(24);
  });
});

describe("buildShotH3MultisegApiWorkflow(PRD §14.1.4,一份组装产两形态)", () => {
  it("apiGraph 直填:100.long_prompt 逐字/宽高 960×544 原厂/9.image 派生名/4 五段前缀/103 MyShot 四字段+video 直连", () => {
    const result = buildShotH3MultisegApiWorkflow({ shot: makeShot(), chapterId: "chapter-001", chapterLabel: "第一章 雨夜", originProjectId: "project-a" });
    expect(result.apiGraph["100"].class_type).toBe("H3Parameter");
    expect(String(result.apiGraph["100"].inputs.long_prompt)).toContain("段1:");
    expect(String(result.apiGraph["100"].inputs.long_prompt)).toContain("[Shot 1] 雨夜中的石桥");
    expect(String(result.apiGraph["100"].inputs.long_prompt)).toContain("overall_soundscape:");
    expect(result.apiGraph["100"].inputs.width).toBe(960);
    expect(result.apiGraph["100"].inputs.height).toBe(544);
    expect(result.apiGraph["9"].inputs.image).toBe("my-shot-h3-sb-chapter-001-001.jpg");
    expect(result.apiGraph["4"].inputs.filename_prefix).toBe("video/漫影/chapter-001/sb-chapter-001-001/ambient");
    expect(String(result.apiGraph["4"].inputs.filename_prefix).split("/")).toHaveLength(5);
    expect(result.apiGraph["103"].inputs).toMatchObject({
      shot_id: "sb-chapter-001-001",
      label: "S01",
      description: "雨夜中的石桥",
      media_status: "图✓",
      video: ["4", 0],
    });
    // 首帧潜空间锚与参数组连线在 API 图出厂在场(适配针1/针2)
    expect(result.apiGraph["101"].inputs.first_frame).toEqual(["9", 0]);
    expect(result.apiGraph["101"].inputs.parameter).toEqual(["100", 0]);
    // report:总帧=Σ段新增帧,秒=totalSeconds(multiseg 无 seconds 锚,时长在分段文本内)
    expect(result.report.shot).toBe(1);
    expect(result.report.frames).toBe(124); // 5s→单段 17×7+5
    expect(result.report.seconds).toBeCloseTo(124 / 24, 6);
  });

  it("uiWorkflow:103 properties 三键+9/103 激活 mode=0(适配模板出厂旁路,组装时激活)+克隆出厂互不污染", () => {
    const first = buildShotH3MultisegApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章", originProjectId: "project-a" });
    const nodes = first.uiWorkflow.nodes as Array<{ id: number; type: string; mode?: number; properties?: Record<string, unknown> }>;
    const byId = (id: number) => nodes.find((node) => node.id === id)!;
    expect(byId(9).mode).toBe(0);
    expect(byId(103).mode).toBe(0);
    expect(byId(103).properties).toMatchObject({
      myOriginProjectId: "project-a",
      myPreview: "my-shot-h3-sb-chapter-001-001.jpg",
      myOriginEpisodeId: "c",
    });
    // 两次组装互不污染(克隆出厂)
    const second = buildShotH3MultisegApiWorkflow({ shot: makeShot({ id: "sb-x-2", index: 2, videoDesc: "雪岭孤城" }), chapterId: "c2", chapterLabel: "章" });
    expect(first.apiGraph["103"].inputs.shot_id).toBe("sb-chapter-001-001");
    expect(second.apiGraph["103"].inputs.shot_id).toBe("sb-x-2");
    expect(String(first.apiGraph["100"].inputs.long_prompt)).toContain("雨夜中的石桥");
    expect(String(second.apiGraph["100"].inputs.long_prompt)).toContain("雪岭孤城");
  });

  it("images 通道:带 b64 恰一项 9.image;无 b64 空数组", () => {
    const withB64 = buildShotH3MultisegApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章", firstFrameB64: "aGVsbG8=" });
    expect(withB64.images).toEqual([{ key: "9.image", name: "my-shot-h3-sb-chapter-001-001.jpg", b64: "aGVsbG8=" }]);
    const noB64 = buildShotH3MultisegApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章" });
    expect(noB64.images).toEqual([]);
  });

  it("480p 档拒派(M5:multiseg 恒 960×544 模板原厂,非档位裁剪属画质议题候令)", () => {
    expect(() => buildShotH3MultisegApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章", resolutionTier: "480p" }))
      .toThrow(/my-h3-multiseg 暂只支持 960p/);
  });

  it("文案自检门失败抛大白话(mock 吞词,同 i2v 同门同文案)", async () => {
    vi.resetModules();
    vi.doMock("./h3-shot-prompt", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./h3-shot-prompt")>();
      return {
        ...actual,
        buildShotH3MultisegPrompt: () => ({
          longPrompt: "段1:5.167秒\n[Shot 1] 场景描述(台词被改写环节吞掉)",
          segments: [{ index: 1, frames: 124, secondsText: "5.167", text: "[Shot 1] 场景描述" }],
          totalSeconds: 124 / 24,
          soundscape: "Quiet ambience matching the scene.",
        }),
      };
    });
    try {
      const { buildShotH3MultisegApiWorkflow: buildMocked } = await import("./h3-shot-video-workflow");
      const shot = makeShot({ lines: "甲：先走。", index: 3 });
      expect(() => buildMocked({ shot, chapterId: "chapter-001", chapterLabel: "第一章", policy: "full" })).toThrow(/文案逐字自检未通过.*S03.*「先走。」/);
    } finally {
      vi.doUnmock("./h3-shot-prompt");
    }
  });
});

describe("buildShotH3ApiWorkflowForRecipe 分派三态 + resolveH3ShotTimeoutS 三态(§14.1.4)", () => {
  it("i2v-31→旧路径(与直调 buildShotH3ApiWorkflow 同形);multiseg→分段路径;未知 id 抛错", () => {
    const viaFor = buildShotH3ApiWorkflowForRecipe("my-h3-i2v-31", { shot: makeShot(), chapterId: "c", chapterLabel: "章" });
    const direct = buildShotH3ApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章" });
    expect(viaFor.apiGraph).toEqual(direct.apiGraph);
    expect(viaFor.report).toEqual(direct.report);

    const multiseg = buildShotH3ApiWorkflowForRecipe("my-h3-multiseg", { shot: makeShot(), chapterId: "c", chapterLabel: "章" });
    expect(multiseg.apiGraph["100"].class_type).toBe("H3Parameter");

    expect(() => buildShotH3ApiWorkflowForRecipe("my-h3-multiseg-不存在", { shot: makeShot(), chapterId: "c", chapterLabel: "章" }))
      .toThrow(/未知 H3 工作流配方/);
  });

  it("resolveH3ShotTimeoutS:i2v 族=档位表现状不动(480p=900/960p=2700);multiseg=600+ceil(秒)×300 clamp 14400", () => {
    expect(resolveH3ShotTimeoutS("my-h3-i2v-31", 5, "480p")).toBe(900);
    expect(resolveH3ShotTimeoutS("my-h3-i2v-31", 5, "960p")).toBe(2700);
    expect(resolveH3ShotTimeoutS("my-h3-i2v-31", 5)).toBe(2700); // 缺省档=960p
    expect(resolveH3ShotTimeoutS("my-h3-multiseg", 20)).toBe(600 + 20 * 300);
    expect(resolveH3ShotTimeoutS("my-h3-multiseg", 5.2)).toBe(600 + 6 * 300); // ceil 秒
    expect(resolveH3ShotTimeoutS("my-h3-multiseg", 40)).toBe(12600); // 40s 顶≈12600s+冷启余量
    expect(resolveH3ShotTimeoutS("my-h3-multiseg", 60)).toBe(14400); // clamp 上限
    expect(() => resolveH3ShotTimeoutS("no-such-recipe", 5)).toThrow(/未知 H3 工作流配方/);
  });

  it("multiseg 注册表断言(§14.1.6):status=ready+apiTemplate+anchors 全+batchDispatchable 含之", () => {
    const recipe = H3_WORKFLOW_RECIPES.find((item) => item.id === "my-h3-multiseg");
    expect(recipe?.status).toBe("ready");
    expect(recipe?.apiTemplate).toBe("./h3-multiseg-template.api.json");
    expect(recipe?.anchors).toMatchObject({
      prompt: "100.long_prompt",
      firstFrame: "9.image",
      resolution: ["100.width", "100.height"],
      savePrefix: "4.filename_prefix",
      myShot: "103",
    });
    expect(recipe?.anchors?.seconds).toBeUndefined(); // multiseg 无 seconds 锚(时长在分段文本内)
    expect(batchDispatchableH3Recipes().some((item) => item.id === "my-h3-multiseg")).toBe(true);
    // id 唯一不回归
    const ids = H3_WORKFLOW_RECIPES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("注入层硬门(§4.3.1)扩展到 multiseg:recipe 锚字段全部在 multiseg API 图中", () => {
    const recipe = H3_WORKFLOW_RECIPES.find((item) => item.id === "my-h3-multiseg")!;
    const anchors = recipe.anchors!;
    const fields = [anchors.prompt, anchors.firstFrame, anchors.savePrefix, ...(anchors.resolution ?? [])];
    for (const field of fields) {
      expect(field).toBeTruthy();
      const [nodeId, key] = field!.split(".");
      expect(multisegApi[nodeId]?.inputs[key], field).not.toBeUndefined();
    }
    expect(multisegApi[anchors.myShot!].class_type).toBe("MyShot");
  });
});
