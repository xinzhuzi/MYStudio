import { describe, expect, it, vi } from "vitest";

import apiTemplate from "./h3-shot-template.api.json";
import { H3_WORKFLOW_RECIPES, batchDispatchableH3Recipes } from "./h3-workflow-recipes";
import { assertH3TemplateIntegrity, buildShotH3ApiWorkflow, buildShotH3RefWorkflow, buildShotH3Workflow } from "./h3-shot-video-workflow";

const api = apiTemplate as unknown as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

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

describe("buildShotH3ApiWorkflow(PRD §5.2 C3 标量出厂直填,通道B 批量派发真身)", () => {
  it("apiGraph 出厂直填与画布档逐字同源(prompt/prefix/imageName/MyShot 四字段/report)", () => {
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

  it("批量可派发集合只含 ready 件(needs-adaptation/unverified/cloud-paid 一律不入)", () => {
    const batch = batchDispatchableH3Recipes();
    expect(batch.map((recipe) => recipe.id)).toEqual(["my-h3-i2v-31"]);
    for (const excluded of ["my-h3-multiseg", "guding-480p-direct", "guding-960p-refine", "official-i2v-480p", "api-flf2v-480p", "api-r2v-480p", "api-t2v-480p"]) {
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
