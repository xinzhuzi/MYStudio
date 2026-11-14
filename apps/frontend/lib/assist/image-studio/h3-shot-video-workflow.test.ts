import { describe, expect, it, vi } from "vitest";

import apiTemplate from "./h3-shot-template.api.json";
import fasth3ApiTemplate from "./fasth3-shot-template.api.json";
import multisegTemplateJson from "./h3-multiseg-template.json";
import multisegApiTemplate from "./h3-multiseg-template.api.json";
import { H3_WORKFLOW_RECIPES, batchDispatchableH3Recipes } from "./h3-workflow-recipes";
import {
  DEFAULT_H3_RECIPE_ID,
  assertH3TemplateIntegrity, SANCAI_CANVAS_ANCHORS,
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

describe("my-pika-fl2v-24 派发回归(1112 深读实雷修:生成器=131 非 16)", () => {
  it("端到端组装不抛错且 131 生成器宽高直填(480p=608×352)", () => {
    const result = buildShotH3ApiWorkflowForRecipe("my-pika-fl2v-24", {
      shot: makeShot(),
      chapterId: "chapter-001",
      chapterLabel: "第一章 雨夜",
      originProjectId: "project-a",
      resolutionTier: "480p",
    });
    expect(result.apiGraph["131"]).toMatchObject({ class_type: "MiniMaxH3ImageToVideo" });
    expect(result.apiGraph["131"].inputs.width).toBe(608);
    expect(result.apiGraph["131"].inputs.height).toBe(352);
    expect(String(result.apiGraph["4"].inputs.filename_prefix).split("/")).toHaveLength(5);
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

  it("ready 件必备 apiTemplate+myShot 锚+非空 resolutionTiers(r2v 件免 myShot——1101 直投禁令,回收走五段前缀+result 回流)", () => {
    for (const recipe of H3_WORKFLOW_RECIPES) {
      if (recipe.status !== "ready") continue;
      expect(recipe.apiTemplate).toBeTruthy();
      if (recipe.inputMode !== "r2v") {
        expect(recipe.anchors?.myShot).toBeTruthy();
      } else {
        expect(recipe.anchors?.savePrefix).toBeTruthy(); // r2v 回收锚=五段前缀
      }
      expect(recipe.resolutionTiers.length).toBeGreaterThan(0);
    }
  });

  it("批量可派发集合只含 ready 件(unverified/needs-unfreeze/cloud-paid 一律不入;multiseg 二期升级 ready)", () => {
    const batch = batchDispatchableH3Recipes();
    expect(batch.map((recipe) => recipe.id)).toEqual(["my-h3-i2v-31", "my-pika-fl2v-24", "my-pika-ref2v-20", "my-h3-multiseg", "my-h3-sancai-r2v", "my-h3-sancai-i2v"]);
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
  it("缺省走 i2v-31 模板对(1114 换装后:lcm/CLIPLoader+awq 在场,FastH3 件不在)", () => {
    const result = buildShotH3ApiWorkflow({ shot: makeShot(), chapterId: "c", chapterLabel: "章" });
    expect(DEFAULT_H3_RECIPE_ID).toBe("my-h3-i2v-31");
    expect(result.apiGraph["29"].inputs.sampler_name).toBe("lcm");
    expect(result.apiGraph["21"].class_type).toBe("CLIPLoader");
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

// ── Pika ref2va 主力线(1101;my-pika-ref2v-20 专用组装器)────────────────────

describe("Windows Pika ref2va 主力线通道(1101)", () => {
  it("分派器走 r2v 通道:Pika 契约件在场+参考槽注入+六段式提示词", () => {
    const result = buildShotH3ApiWorkflowForRecipe("my-pika-ref2v-20", {
      shot: makeShot(),
      chapterId: "chapter-001",
      chapterLabel: "第一章",
      firstFrameB64: "aGVsbG8=",
      refs: [
        { name: "林昭", kind: "character", imageName: "char-linzhao.png" },
        { name: "石桥", kind: "scene", imageName: "scene-bridge.png" },
      ],
    } as never);
    expect(result.apiGraph["16"].class_type).toBe("MiniMaxH3ReferenceToVideo");
    expect(String(result.apiGraph["14"].inputs.value)).toContain("subject_definitions:");
    expect(result.apiGraph["16"].inputs).toMatchObject({
      "ref_images.ref_image_0": ["9", 0],
      "ref_images.ref_image_1": ["110", 0],
    });
    expect(result.apiGraph["110"].inputs.image).toBe("char-linzhao.png");
    expect(result.apiGraph["111"].inputs.image).toBe("scene-bridge.png");
    expect(result.images).toEqual([{ key: "9.image", name: expect.any(String), b64: "aGVsbG8=" }]);
  });

  it("零 refs:Pika 契约件只挂 ref_image_0(分镜帧)且六段式有缺省 Subject", () => {
    const result = buildShotH3ApiWorkflowForRecipe("my-pika-ref2v-20", {
      shot: makeShot(), chapterId: "c", chapterLabel: "章",
    } as never);
    expect(result.apiGraph["16"].inputs["ref_images.ref_image_0"]).toEqual(["9", 0]);
    for (const dead of ["111", "112", "113"]) {
      expect(result.apiGraph[dead]).toBeUndefined();
    }
    expect(String(result.apiGraph["14"].inputs.value)).toContain("subject_definitions:");
  });

  it("静态契约:Pika ref2va API 件 20 节点+ReferenceToVideo+五槽+audio_vae 接 ReferenceToVideo", () => {
    const result = buildShotH3ApiWorkflowForRecipe("my-pika-ref2v-20", { shot: makeShot(), chapterId: "c", chapterLabel: "章" } as never);
    expect(Object.keys(result.apiGraph)).toHaveLength(20);
    expect(result.apiGraph["16"].inputs["audio_vae"]).toEqual(["120", 0]);
    expect(result.apiGraph["121"].inputs.vae).toEqual(["120", 0]);
    expect(result.apiGraph["127"].inputs.unet_name).toBe("Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors"); // 1105 换芯:ref2va 底模同迁 Cobijada(与 backend 三处 contract 同口径)
    expect(result.apiGraph["145"].inputs.lora_name).toBe("pika_h3_flex_ref2va_comfy_bf16.safetensors"); // ref2va 母体顶层平铺,LoRA=145(≠fl2va 子图 134)
  });

  it("recipe my-pika-ref2v-20 在册(1101 实弹 173.9s 后升 ready;inputMode=r2v)", () => {
    const recipe = H3_WORKFLOW_RECIPES.find((item) => item.id === "my-pika-ref2v-20");
    expect(recipe).toMatchObject({ inputMode: "r2v", status: "ready" });
    expect(h3BatchDispatchableRecipeIds()).toContain("my-pika-ref2v-20");
    expect(batchDispatchableH3Recipes().some((item) => item.id === "my-pika-ref2v-20")).toBe(true);
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

// ── 1112 recavsr-mainline:三采两段档(AR 阶梯/段A 段B 组装/分派/超时)──────────────────────

import sancaiTemplateJson from "./h3-three-stage-template.json";
import sancaiApiTemplateJson from "./h3-three-stage-template.api.json";
import {
  applySancaiStageBSource,
  buildShotH3SancaiApiWorkflow,
  computeSancaiResolutionLadder,
  h3BatchDispatchableRecipeIds as sancaiDispatchable,
  parseImageSizeFromB64,
  resolveH3ShotTimeoutS as resolveTimeout,
  resolveSancaiStageTimeoutS,
  sancaiAnnotatedVideoRef,
} from "./h3-shot-video-workflow";

const sancaiApi = sancaiApiTemplateJson as unknown as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const sancaiTemplate = sancaiTemplateJson as { nodes: Array<{ id: number; type: string; mode?: number }> };

/** 最小 PNG 头 b64(仅签名+IHDR,parseImageSizeFromB64 只读固定偏移)。 */
const PNG_960_544 = "iVBORw0KGgoAAAANSUhEUgAAA8AAAAIgCAIAAADFh5f6AAAAAElFTkSuQmCC";
const PNG_736_736 = "iVBORw0KGgoAAAANSUhEUgAAAuAAAALgCAIAAABavFVeAAAAAElFTkSuQmCC";

describe("computeSancaiResolutionLadder(Note103 法则②判例)", () => {
  it("16:9(960×544 输入)→960×544→1440×832", () => {
    const ladder = computeSancaiResolutionLadder(960, 544);
    expect(ladder).toEqual({ w1: 960, h1: 544, w2: 1440, h2: 832 });
  });
  it("1:1(736×736 输入)→736²→1088²", () => {
    const ladder = computeSancaiResolutionLadder(736, 736);
    expect(ladder).toEqual({ w1: 736, h1: 736, w2: 1088, h2: 1088 });
  });
  it("竖图(544×960 输入,9:16)镜像:544×960→832×1440", () => {
    const ladder = computeSancaiResolutionLadder(544, 960);
    expect(ladder).toEqual({ w1: 544, h1: 960, w2: 832, h2: 1440 });
  });
  it("非正数拒绝(禁猜尺寸)", () => {
    expect(() => computeSancaiResolutionLadder(0, 100)).toThrow("正数");
    expect(() => computeSancaiResolutionLadder(Number.NaN, 100)).toThrow("正数");
  });
});

describe("parseImageSizeFromB64(PNG 头纯函数)", () => {
  it("PNG IHDR 固定偏移读宽高(含 data: 前缀与换行容错)", () => {
    expect(parseImageSizeFromB64(PNG_960_544)).toEqual({ width: 960, height: 544 });
    expect(parseImageSizeFromB64(`data:image/png;base64,${PNG_736_736}\n`)).toEqual({ width: 736, height: 736 });
  });
  it("非 PNG/JPEG 流返回 null", () => {
    expect(parseImageSizeFromB64("Zm9rZQ==")).toBeNull();
    expect(parseImageSizeFromB64("")).toBeNull();
  });
});

describe("buildShotH3SancaiApiWorkflow(三采两段组装)", () => {
  it("i2v 臂:段A 无三采链/219=true/AR 阶梯四处;段B 300 空源+339.video←300+MyShot 连 340", () => {
    const result = buildShotH3SancaiApiWorkflow({
      shot: makeShot() as never,
      chapterId: "chapter-001",
      chapterLabel: "第一章",
      firstFrameB64: "QUJD",
      r2v: false,
      frameWidth: 960,
      frameHeight: 544,
    });
    const stageA = result.apiGraph;
    expect(stageA["4001"]).toBeUndefined();
    expect(stageA["4002"]).toBeUndefined();
    expect(stageA["4003"]).toBeUndefined();
    expect(stageA["53"]).toBeUndefined(); // 阶梯直填后 22 按需旁路删除
    expect(stageA["1061"]!.inputs.value).toBe(true); // wire 真相:true→on_true=220 i2v
    expect(stageA["2001"]!.inputs.width).toBe(960);
    expect(stageA["2001"]!.inputs.height).toBe(544);
    expect(stageA["2002"]!.inputs.width).toBe(960);
    expect(stageA["2002"]!.inputs.height).toBe(544);
    expect(stageA["3031"]!.inputs.width).toBe(1440);
    expect(stageA["3031"]!.inputs.height).toBe(832);
    expect(stageA["3002"]!.inputs["mode.width"]).toBe(1440);
    expect(stageA["3002"]!.inputs["mode.height"]).toBe(832);
    // i2v 臂 110-113 分镜帧补位满槽(208 恒消费 ref_image_1..4)
    for (const id of ["11", "12", "13", "14"]) {
      expect(stageA[id]!.inputs.image).toBe(stageA["1"]!.inputs.image);
    }
    expect(result.images).toEqual([{ key: "1.image", name: expect.any(String), b64: "QUJD" }]);
    // 段B 形状
    const stageB = result.stageBGraph;
    expect(Object.keys(stageB).sort()).toEqual(["300", "3061", "4001", "4002", "4003"]);
    expect(stageB["300"]!.class_type).toBe("LoadVideo");
    expect(stageB["300"]!.inputs.file).toBe("");
    expect(stageB["4002"]!.inputs.video).toEqual(["300", 0]);
    expect(stageB["4003"]!.inputs.video).toEqual(["4002", 0]);
    expect(stageB["4003"]!.inputs.filename_prefix).toBe(stageA["3071"]!.inputs.filename_prefix);
    expect(stageB["3061"]!.class_type).toBe("MyShot");
    expect(stageB["3061"]!.inputs.video).toEqual(["4003", 0]);
    expect(stageB["3061"]!.inputs.shot_id).toBe("sb-chapter-001-001");
    // 段A 前缀五段(subfolder 恒四段过 consumer 白名单)
    expect(String(stageA["3071"]!.inputs.filename_prefix)).toMatch(/^video\/漫影\/chapter-001\/sb-chapter-001-001\/[A-Za-z0-9._-]+$/);
    // uiWorkflow=画布档(MyShot properties 三键在场,段B extraPngInfo 复用)
    const uiNodes = (result.uiWorkflow as { nodes: Array<{ id: number; properties?: Record<string, unknown> }> }).nodes;
    const myShot = uiNodes.find((node) => node.id === 3061);
    expect(myShot?.properties?.myOriginProjectId).toBe("");
    expect(myShot?.properties?.myOriginEpisodeId).toBe("chapter-001");
  });

  it("r2v 臂:219=false;refs 按序占 110-111,余槽分镜帧补位", () => {
    const result = buildShotH3SancaiApiWorkflow({
      shot: makeShot() as never,
      chapterId: "chapter-001",
      chapterLabel: "第一章",
      r2v: true,
      refs: [
        { name: "角色A", kind: "character", imageName: "ref-a.jpg" },
        { name: "场景B", kind: "scene", imageName: "ref-b.jpg" },
      ],
      frameWidth: 736,
      frameHeight: 736,
    });
    const stageA = result.apiGraph;
    expect(stageA["1061"]!.inputs.value).toBe(false); // false→on_false=16 r2v
    expect(stageA["11"]!.inputs.image).toBe("ref-a.jpg");
    expect(stageA["12"]!.inputs.image).toBe("ref-b.jpg");
    expect(stageA["13"]!.inputs.image).toBe(stageA["1"]!.inputs.image);
    expect(stageA["14"]!.inputs.image).toBe(stageA["1"]!.inputs.image);
    // 1:1 阶梯判例
    expect(stageA["2001"]!.inputs.width).toBe(736);
    expect(stageA["3031"]!.inputs.width).toBe(1088);
  });

  it("applySancaiStageBSource 回填零拷贝注解名(段A 终档→段B 300.file)", () => {
    const result = buildShotH3SancaiApiWorkflow({
      shot: makeShot() as never,
      chapterId: "chapter-001",
      chapterLabel: "第一章",
      frameWidth: 960,
      frameHeight: 544,
    });
    applySancaiStageBSource(result.stageBGraph, { filename: "ambient_00002_.mp4", subfolder: "video/漫影/chapter-001/a" });
    expect(result.stageBGraph["300"]!.inputs.file).toBe("video/漫影/chapter-001/a/ambient_00002_.mp4 [output]");
    expect(sancaiAnnotatedVideoRef({ filename: "x.mp4", subfolder: "" })).toBe("x.mp4 [output]");
  });
});

describe("三采分派与超时(1112 recavsr-mainline)", () => {
  it("注册表:my-h3-sancai-r2v/i2v 在册 ready,锚字段全在 API 母体", () => {
    for (const id of ["my-h3-sancai-r2v", "my-h3-sancai-i2v"]) {
      const recipe = H3_WORKFLOW_RECIPES.find((item) => item.id === id);
      expect(recipe).toMatchObject({ status: "ready" });
      expect(["sancai-r2v", "sancai-i2v"]).toContain(recipe!.inputMode);
      const anchors = recipe!.anchors!;
      for (const field of [anchors.prompt, anchors.seconds, anchors.firstFrame, anchors.savePrefix, ...(anchors.resolution ?? [])]) {
        const [nodeId, key] = field!.split(".");
        expect(sancaiApi[nodeId]?.inputs[key], field).not.toBeUndefined();
      }
    }
    expect(sancaiDispatchable()).toContain("my-h3-sancai-r2v");
    expect(sancaiDispatchable()).toContain("my-h3-sancai-i2v");
  });

  it("1114 千位段编号后:sancai 母体过自家锚集(默认 REQUIRED_NODES 属 pika 族)", () => {
    expect(() => assertH3TemplateIntegrity(sancaiTemplate, SANCAI_CANVAS_ANCHORS.required)).not.toThrow();
  });

  it("分派器:sancai 族走两段组装(带 stageBGraph);缺像素宽高拒派发", () => {
    const ok = buildShotH3ApiWorkflowForRecipe("my-h3-sancai-i2v", {
      shot: makeShot() as never,
      chapterId: "chapter-001",
      chapterLabel: "第一章",
      frameWidth: 960,
      frameHeight: 544,
    } as never) as { stageBGraph?: unknown };
    expect(ok.stageBGraph).toBeTruthy();
    expect(() => buildShotH3ApiWorkflowForRecipe("my-h3-sancai-r2v", {
      shot: makeShot() as never,
      chapterId: "chapter-001",
      chapterLabel: "第一章",
    } as never)).toThrow("首帧像素宽高");
  });

  it("超时:三采两段档 900s/300s;resolveH3ShotTimeoutS 三采=段A 档", () => {
    expect(resolveSancaiStageTimeoutS()).toEqual({ stageA: 900, stageB: 300 });
    expect(resolveTimeout("my-h3-sancai-r2v", 10)).toBe(900);
    expect(resolveTimeout("my-h3-sancai-i2v", 10, "480p")).toBe(900);
  });
});

describe("buildShotH3SancaiApiWorkflow 1113 火力扩展(8卡+尾帧+参考视频)", () => {
  it("r2v 满配:110-113/341-344 逐槽注入(1114 自适应后 7 异卡+帧=8 预算,第8卡帧补位),尾帧/视频缺省摘除", () => {
    const result = buildShotH3SancaiApiWorkflow({
      shot: makeShot() as never,
      chapterId: "chapter-001",
      chapterLabel: "第一章",
      r2v: true,
      refs: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
        name: `资产${i}`, kind: i === 8 ? ("scene" as const) : ("character" as const), imageName: `ref-${i}.jpg`,
      })),
      frameWidth: 960,
      frameHeight: 544,
    });
    const a = result.apiGraph;
    const ids = ["11", "12", "13", "14", "15", "16", "17", "18"];
    ids.forEach((id, i) => {
      if (i < 7) expect(a[id]!.inputs.image).toBe(`ref-${i + 1}.jpg`);
    });
    expect(a["18"]!.inputs.image).toBe(a["1"]!.inputs.image); // 第8异图超预算被截→帧补位
    for (const nid of ["2001", "3031"]) {
      expect(a[nid]!.inputs["ref_images.ref_image_5"]).toEqual(["15", 0]);
      expect(a[nid]!.inputs["ref_images.ref_image_8"]).toEqual(["18", 0]);
    }
    // 尾帧/视频缺省:345/346 摘除 + 槽键删除(禁空喂占位)
    expect(a["31"]).toBeUndefined();
    expect(a["41"]).toBeUndefined();
    expect(a["2002"]!.inputs.last_frame).toBeUndefined();
    expect(a["2001"]!.inputs["ref_videos.ref_video_0"]).toBeUndefined();
  });

  it("1114 自适应:异图(帧+参考去重)≤4 保 max(1110 定律原面);重复图不占预算", () => {
    const few = buildShotH3SancaiApiWorkflow({
      shot: makeShot() as never, chapterId: "chapter-001", chapterLabel: "第一章",
      r2v: true, frameWidth: 960, frameHeight: 544,
      refs: [{ name: "A", kind: "character", imageName: "r1.jpg" }, { name: "B", kind: "scene", imageName: "r2.jpg" }],
    });
    expect(few.apiGraph["2001"]!.inputs.ref_image_size).toBe("max");
    expect(few.apiGraph["3031"]!.inputs.ref_image_size).toBe("max");
    // 8 槽全填但仅 2 异图 → 仍 max 且全注入
    const dup = buildShotH3SancaiApiWorkflow({
      shot: makeShot() as never, chapterId: "chapter-001", chapterLabel: "第一章",
      r2v: true, frameWidth: 960, frameHeight: 544,
      refs: Array.from({ length: 8 }, (_, i) => ({ name: `x${i}`, kind: "character" as const, imageName: i % 2 ? "a.jpg" : "b.jpg" })),
    });
    expect(dup.apiGraph["2001"]!.inputs.ref_image_size).toBe("max");
    expect(dup.apiGraph["18"]!.inputs.image).toBe("a.jpg"); // 第8张(i=7,奇)=a.jpg
  });

  it("1114 自适应:5+ 异图降 match(实测 9 异图/大参考数×max=引擎原生崩)", () => {
    const many = buildShotH3SancaiApiWorkflow({
      shot: makeShot() as never, chapterId: "chapter-001", chapterLabel: "第一章",
      r2v: true, frameWidth: 960, frameHeight: 544,
      refs: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ name: `x${i}`, kind: "character" as const, imageName: `d${i}.jpg` })),
    });
    expect(many.apiGraph["2001"]!.inputs.ref_image_size).toBe("match");
    expect(many.apiGraph["3031"]!.inputs.ref_image_size).toBe("match");
    expect(many.apiGraph["17"]!.inputs.image).toBe("d7.jpg");
    expect(many.apiGraph["18"]!.inputs.image).toBe(many.apiGraph["1"]!.inputs.image);
  });

  it("endFrame 有=345 注入+last_frame 保持;i2v 满槽=8 卡全分镜帧补位", () => {
    const result = buildShotH3SancaiApiWorkflow({
      shot: makeShot() as never,
      chapterId: "chapter-001",
      chapterLabel: "第一章",
      firstFrameB64: "QUJD",
      r2v: false,
      endFrame: "end-frame.jpg",
      frameWidth: 960,
      frameHeight: 544,
    });
    const a = result.apiGraph;
    expect(a["31"]!.inputs.image).toBe("end-frame.jpg");
    expect(a["2002"]!.inputs.last_frame).toEqual(["31", 0]);
    for (const id of ["11", "12", "13", "14", "15", "16", "17", "18"]) {
      expect(a[id]!.inputs.image).toBe(a["1"]!.inputs.image); // i2v 补位满槽
    }
  });

  it("videoRef 有=346 注入 file+16.ref_videos 槽保持", () => {
    const result = buildShotH3SancaiApiWorkflow({
      shot: makeShot() as never,
      chapterId: "chapter-001",
      chapterLabel: "第一章",
      r2v: true,
      videoRef: "motion-ref.mp4",
      refs: [{ name: "角色A", kind: "character", imageName: "ref-a.jpg" }],
      frameWidth: 960,
      frameHeight: 544,
    });
    const a = result.apiGraph;
    expect(a["41"]!.inputs.file).toBe("motion-ref.mp4");
    expect(a["42"]!.inputs.video).toEqual(["41", 0]); // VIDEO→IMAGE 桥
    expect(a["2001"]!.inputs["ref_videos.ref_video_0"]).toEqual(["42", 0]);
  });
});
