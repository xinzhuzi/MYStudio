// @vitest-environment jsdom
/**
 * 分镜工作流节点生图核心的换线正典传输边界测试(1116,PRD §五.3/§4.5):
 * 单镜 hook 与面板批量串行 hook 共用本核心——分镜请求 prompt=体裁化句
 * (零槽=t2i 主体句/有槽=i2i 指令体),负面退役,参考按 §4.5 槽位原生直传
 * (storyboard-native-references 契约);非分镜(自由/资产)链零变化。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./storyboard-canonical-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storyboard-canonical-context")>();
  return { ...actual, cropSlotReferenceToSinglePose: vi.fn(async (dataUrl: string) => dataUrl) };
});import { cropSlotReferenceToSinglePose } from "./storyboard-canonical-context";
import { runImageWorkflowNodeGeneration } from "./run-image-workflow-node-generation";
import type { ImageWorkflowGraph, StoryboardItem } from "@/types/studio";
import * as realRequest from "@/lib/studio/image-workflow/request";

const { saveImage } = vi.hoisted(() => ({
  saveImage: vi.fn().mockResolvedValue({ success: true, url: "project-file://w/1.png", size: 10 }),
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { generateImage: vi.fn().mockResolvedValue({ url: "https://cdn.example/frame.png", mediaId: "m1" }) },
}));
vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => ({
    saveImage,
  }),
}));
const assetsBridgeState = vi.hoisted(() => ({ bridge: null as Record<string, unknown> | null }));
vi.mock("@/lib/bridge/studio-assets", () => ({
  getStudioAssetsBridge: () => assetsBridgeState.bridge,
}));
// ── 1117 C2 门A 场景/时辰锚:场景库注入(金水河码头),主角锚走 identities 回落=空桥。 ──
const sceneState = vi.hoisted(() => ({
  scenes: [{ id: "scene-dock", name: "金水河码头", location: "金水河码头", projectId: "dao-project" }] as Array<Record<string, unknown>>,
}));
vi.mock("@/stores/library/scene-store", () => ({
  useSceneStore: { getState: () => sceneState },
}));
const characterState = vi.hoisted(() => ({ characters: [] as Array<Record<string, unknown>> }));
vi.mock("@/stores/library/character-library-store", () => ({
  useCharacterLibraryStore: { getState: () => characterState },
}));
vi.mock("@/lib/studio/image-workflow", () => ({
  assertImageWorkflowContinuityCapability: vi.fn(),
  buildImageWorkflowGenerationRequest: vi.fn().mockReturnValue({
    prompt: "【画面】独孤剑尘立于金水河码头，夜雨，按剑远眺。【构图】中景。",
    model: "gpt-image-2",
    aspectRatio: "16:9",
    resolution: "2K",
    negativePrompt: "watermark",
    referenceImages: [],
  }),
  setGeneratedImageResult: vi.fn().mockImplementation((graph) => graph),
  updateImageWorkflowNode: vi.fn().mockImplementation((graph) => graph),
}));
vi.mock("@/lib/assist/image-studio/run-uncloth", () => ({
  runUnclothChain: vi.fn().mockResolvedValue({
    imageUrl: "project-file://media/ai-image/2026-09/uncloth_x_1.png",
    mediaId: "media-unc-1",
  }),
}));
vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: { getState: () => ({ activeProjectId: "dao-project" }) },
}));

function storyboardShot(partial: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id: "sb-1", episodeId: "chapter-001", index: 1, trackKey: "001-1", trackId: "",
    duration: 6, prompt: "独孤剑尘立于金水河码头，夜雨，按剑远眺。",
    videoDesc: "独孤剑尘立于金水河码头，夜雨，按剑远眺。",
    assetIds: [], state: "idle",
    ...partial,
  } as StoryboardItem;
}
const studioState = {
  workflowConfig: { visualManualId: "daojie_ink_guofeng" },
  storyboards: [storyboardShot()],
  imageWorkflows: [],
  agentWorkData: [],
  upsertImageWorkflow: vi.fn(),
};
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: { getState: () => studioState },
}));

const storyboardGraph = {
  id: "wf-1", target: { kind: "storyboard", id: "sb-1" }, nodes: [], edges: [],
} as never;
const freedomGraph = { id: "wf-2", target: { kind: "freedom" }, nodes: [], edges: [] } as never;

describe("版本参考经真实 builder 和能力门的分镜原生多参考传输", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([1, 2, 3])("%i 张带版本角色参考:§4.5 槽位原生直传(主角=槽1,超额裁出),过 native 契约门", async (count) => {
    const refs = Array.from({ length: count }, (_, index) => ({
      id: `ref-${index}`, type: "reference", title: `角色${index + 1}`,
      imageUrl: `data:image/png;base64,ref${index}`, continuityOrder: index + 1,
      continuityVersionId: `version-${index}`, source: { kind: "asset", assetType: "character", id: `asset-${index}` },
    }));
    const graph = {
      id: "version-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [...refs, { id: "gen-1", type: "generated", title: "成图", prompt: "单幅剧情", aspectRatio: "16:9" }],
      edges: [...refs].reverse().map((ref) => ({ source: ref.id, target: "gen-1" })),
    } as ImageWorkflowGraph;
    const workflow = await import("@/lib/studio/image-workflow");
    vi.mocked(workflow.buildImageWorkflowGenerationRequest).mockImplementationOnce(realRequest.buildImageWorkflowGenerationRequest);
    vi.mocked(workflow.assertImageWorkflowContinuityCapability).mockImplementationOnce(realRequest.assertImageWorkflowContinuityCapability);
    await expect(runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" })).resolves.toEqual({ imageUrl: "project-file://w/1.png" });
    const { aiManager } = await import("@/lib/ai/ai-manager");
    const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    expect(sent.model).toBe("qwen-image-2-1");
    // 原生多参考:槽位图按 §4.5 序直传,不塌拼板
    expect(sent.referenceImages).toEqual(refs.map((ref) => ref.imageUrl));
    expect(workflow.assertImageWorkflowContinuityCapability).toHaveBeenCalledWith(
      expect.objectContaining({ model: sent.model, referenceImages: sent.referenceImages }),
      expect.objectContaining({ kind: "storyboard-native-references" }),
    );
    if (count >= 2) {
      expect(sent.prompt).toContain("<image1>为角色1的身份来源");
      expect(sent.prompt).toContain(`<image${count}>为角色${count}的身份来源`);
    } else {
      expect(sent.prompt).toContain("参考图中的角色1为身份来源");
      expect(sent.prompt).not.toMatch(/<image\d+>/);
    }
  });

  it("版本场景资产与上游成图(前帧)经真实 builder 完整传输:场景=槽1,前帧=槽2", async () => {
    const sources = ["data:image/png;base64,ref", "data:image/png;base64,prior"];
    const graph = {
      id: "versioned-upstream-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [
        { id: "ref-1", type: "reference", title: "场景", imageUrl: sources[0], continuityOrder: 1,
          continuityVersionId: "scene-v1", source: { kind: "asset", assetType: "scene", id: "scene" } },
        { id: "prior", type: "generated", title: "首帧", resultUrl: sources[1] },
        { id: "gen-1", type: "generated", title: "次帧", prompt: "单幅剧情", aspectRatio: "16:9" },
      ],
      edges: [{ source: "prior", target: "gen-1" }, { source: "ref-1", target: "gen-1" }],
    } as ImageWorkflowGraph;
    const actual = realRequest.buildImageWorkflowGenerationRequest(graph, "gen-1");
    expect(actual.referenceImages).toEqual(sources);
    expect(actual.orderedReferenceManifest.map((ref) => ref.order)).toEqual([1, Number.MAX_SAFE_INTEGER]);
    expect(actual.continuityRequired).toBe(true);
    expect(actual.previousApprovedFrameIncluded).toBe(true);
    const workflow = await import("@/lib/studio/image-workflow");
    vi.mocked(workflow.buildImageWorkflowGenerationRequest).mockImplementationOnce(realRequest.buildImageWorkflowGenerationRequest);
    vi.mocked(workflow.assertImageWorkflowContinuityCapability).mockImplementationOnce(realRequest.assertImageWorkflowContinuityCapability);
    await expect(runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" }))
      .resolves.toEqual({ imageUrl: "project-file://w/1.png" });
    const { aiManager } = await import("@/lib/ai/ai-manager");
    expect(aiManager.generateImage).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    // 无角色镜:场景顶槽1(171 主参考位),前帧槽2(N=2 标签点名)
    expect(sent.referenceImages).toEqual(sources);
    expect(sent.prompt).toContain("<image1>为场景的场景来源");
    expect(sent.prompt).toContain("<image2>为上一帧画面的上一帧画面来源");
    expect(workflow.assertImageWorkflowContinuityCapability).toHaveBeenCalledWith(
      expect.objectContaining({ orderedReferenceManifest: actual.orderedReferenceManifest, continuityRequired: true, previousApprovedFrameIncluded: true }),
      expect.objectContaining({
        kind: "storyboard-native-references", imageUrls: sources, sourceReferenceImages: sources,
        slots: [
          // 1117 残项①:槽携带 sourceUrl 血缘(场景=解析原图自身,前帧同)
          { slot: 1, role: "scene", title: "场景", imageUrl: sources[0], sourceUrl: sources[0] },
          { slot: 2, role: "previous-frame", title: "上一帧画面", imageUrl: sources[1], sourceUrl: sources[1] },
        ],
      }),
    );
  });

  it("能力门异常拒绝生成与所有保存写回", async () => {
    const workflow = await import("@/lib/studio/image-workflow");
    vi.mocked(workflow.assertImageWorkflowContinuityCapability).mockImplementationOnce(() => { throw new Error("门异常"); });
    const { aiManager } = await import("@/lib/ai/ai-manager");
    const addMaterial = vi.fn();
    // 带角色参考才有传输契约门路径
    const graph = {
      id: "gate-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [
        { id: "ref-1", type: "reference", title: "角色1", imageUrl: "data:image/png;base64,r1", continuityOrder: 1, source: { kind: "asset", assetType: "character", id: "a1" } },
        { id: "gen-1", type: "generated", title: "成图", prompt: "p", aspectRatio: "16:9" },
      ],
      edges: [{ source: "ref-1", target: "gen-1" }],
    } as ImageWorkflowGraph;
    await expect(runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial })).rejects.toThrow("门异常");
    expect(aiManager.generateImage).not.toHaveBeenCalled();
    expect(saveImage).not.toHaveBeenCalled();
    expect(addMaterial).not.toHaveBeenCalled();
    expect(studioState.upsertImageWorkflow).not.toHaveBeenCalled();
  });

  it("零参考分镜走 t2i 主体句直传,契约按零参考形态核", async () => {
    const workflow = await import("@/lib/studio/image-workflow");
    const { aiManager } = await import("@/lib/ai/ai-manager");
    await runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" });
    const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    expect(sent.referenceImages).toEqual([]);
    expect(sent.prompt).toContain("独孤剑尘立于金水河码头");
    expect(sent.prompt).not.toMatch(/<image\d+>/);
    expect(workflow.assertImageWorkflowContinuityCapability).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: "qwen-image-2-1", referenceImages: [], continuityRequired: false }),
    );
  });
});

describe("runImageWorkflowNodeGeneration 分镜正典传输边界(1116 换线)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("分镜零参考:prompt=正典主体句(不写风格词/无【画面】段),负面退役,raw 直传", async () => {
    const { aiManager } = await import("@/lib/ai/ai-manager");
    const result = await runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", {
      addMaterial: () => "mat-1",
    });
    expect(result.imageUrl).toBe("project-file://w/1.png");
    const params = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    expect(params.model).toBe("qwen-image-2-1");
    expect(params.extraParams?.template).toBeUndefined();
    expect(params.extraParams?.base_type).toBe("分镜剧情图");
    expect(aiManager.generateImage).toHaveBeenCalledTimes(1);
    expect(params.promptPolicy).toBe("raw");
    expect(params.prompt).toContain("独孤剑尘立于金水河码头");
    // App 层装配退役:手册风格 token/【画面】段/负面全部不再由 App 携带
    expect(params.prompt).not.toContain("【画面】");
    expect(params.prompt).not.toContain("gongbi");
    expect(params.negativePrompt).toBeUndefined();
  });

  it("单姿裁切失败=丢槽并重排 <imageN>(宁缺勿染,禁整卡入参考)", async () => {
    const graph = {
      id: "crop-drop-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [
        { id: "ref-c1", type: "reference", title: "赵四", imageUrl: "data:image/png;base64,card-banner", continuityOrder: 1, source: { kind: "asset", assetType: "character", id: "asset-c1" } },
        { id: "ref-s1", type: "reference", title: "码头", imageUrl: "data:image/png;base64,scene", continuityOrder: 1, source: { kind: "asset", assetType: "scene", id: "asset-s1" } },
        { id: "ref-c2", type: "reference", title: "管事", imageUrl: "data:image/png;base64,char2", continuityOrder: 2, source: { kind: "asset", assetType: "character", id: "asset-c2" } },
        { id: "gen-1", type: "generated", title: "成图", prompt: "p", aspectRatio: "16:9" },
      ],
      edges: ["ref-c1", "ref-s1", "ref-c2"].map((source) => ({ source, target: "gen-1" })),
    } as ImageWorkflowGraph;
    const workflow = await import("@/lib/studio/image-workflow");
    vi.mocked(workflow.buildImageWorkflowGenerationRequest).mockImplementationOnce(realRequest.buildImageWorkflowGenerationRequest);
    vi.mocked(workflow.assertImageWorkflowContinuityCapability).mockImplementationOnce(realRequest.assertImageWorkflowContinuityCapability);
    const crop = vi.mocked(cropSlotReferenceToSinglePose);
    crop.mockReset();
    crop.mockImplementation(async (dataUrl: string) => (dataUrl.endsWith("card-banner") ? null : dataUrl));
    const { aiManager } = await import("@/lib/ai/ai-manager");
    await runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" });
    const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    // 主角横幅卡裁不出 → 丢槽;场景/次角色补位并按新槽号点名
    expect(sent.referenceImages).toEqual(["data:image/png;base64,scene", "data:image/png;base64,char2"]);
    expect(sent.prompt).toContain("<image1>为码头的场景来源");
    expect(sent.prompt).toContain("<image2>为管事的身份来源");
    expect(sent.prompt).not.toContain("<image3>");
    expect(sent.prompt).not.toContain("赵四");
  });

  it("分镜参考(纯道具镜)道具不入图:槽位空走 t2i,道具走指令文字", async () => {
    const graph = {
      id: "prop-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [
        { id: "ref-1", type: "reference", title: "铁链", imageUrl: "data:image/png;base64,chain", continuityOrder: 1, source: { kind: "asset", assetType: "prop", id: "tool-1" } },
        { id: "gen-1", type: "generated", title: "成图", prompt: "p", aspectRatio: "16:9" },
      ],
      edges: [{ source: "ref-1", target: "gen-1" }],
    } as ImageWorkflowGraph;
    const workflow = await import("@/lib/studio/image-workflow");
    vi.mocked(workflow.buildImageWorkflowGenerationRequest).mockImplementationOnce(realRequest.buildImageWorkflowGenerationRequest);
    vi.mocked(workflow.assertImageWorkflowContinuityCapability).mockImplementationOnce(realRequest.assertImageWorkflowContinuityCapability);
    const { aiManager } = await import("@/lib/ai/ai-manager");
    await runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" });
    const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    expect(sent.referenceImages).toEqual([]);
    expect(sent.prompt).not.toMatch(/<image\d+>/);
  });

  it("分镜主体句带画风词在体裁断言处 fail-closed,不触发 generateImage", async () => {
    // 1117 注:工笔/白描系词在主体句出口已剥(f076d13e),此钉改用剥词表外的
    // 写实族词(胶片感)——lint REALISM 族拦截路径保持可测。
    studioState.storyboards = [storyboardShot({ videoDesc: "独孤剑尘立于金水河码头，胶片感照亮脸和手。" })];
    try {
      const { aiManager } = await import("@/lib/ai/ai-manager");
      await expect(
        runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" }),
      ).rejects.toThrow("体裁断言");
      expect(aiManager.generateImage).not.toHaveBeenCalled();
    } finally {
      studioState.storyboards = [storyboardShot()];
    }
  });

  it("非分镜(自由)工作流不走正典装配,即使手册为道劫", async () => {
    const { aiManager } = await import("@/lib/ai/ai-manager");
    await runImageWorkflowNodeGeneration(freedomGraph, "gen-1", { addMaterial: () => "mat-1" });
    const params = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    expect(params.model).toBe("gpt-image-2"); // 自由工作流透传节点模型
    expect(params.promptPolicy).toBeUndefined();
    expect(params.negativePrompt).toBe("watermark");
  });

  it("生成期间来源改变时拒绝项目保存、材料和图写回", async () => {
    const { aiManager } = await import("@/lib/ai/ai-manager");
    let current = true;
    vi.mocked(aiManager.generateImage).mockImplementationOnce(async () => {
      current = false;
      return { url: "https://cdn.example/late.png" } as never;
    });
    const addMaterial = vi.fn(() => "mat-1");
    await expect(runImageWorkflowNodeGeneration(freedomGraph, "gen-1", {
      addMaterial,
      assertStillCurrent: () => { if (!current) throw new Error("来源已变化"); },
    })).rejects.toThrow("来源已变化");
    expect(saveImage).not.toHaveBeenCalled();
    expect(addMaterial).not.toHaveBeenCalled();
    expect(studioState.upsertImageWorkflow).not.toHaveBeenCalled();
  });

  it("项目保存等待期间来源改变时拒绝材料和图写回", async () => {
    let current = true;
    saveImage.mockImplementationOnce(async () => {
      current = false;
      return { success: true, url: "project-file://w/late.png", size: 10 };
    });
    const addMaterial = vi.fn(() => "mat-1");
    await expect(runImageWorkflowNodeGeneration(freedomGraph, "gen-1", {
      addMaterial, assertStillCurrent: () => { if (!current) throw new Error("来源已变化"); },
    })).rejects.toThrow("来源已变化");
    expect(addMaterial).not.toHaveBeenCalled();
    expect(studioState.upsertImageWorkflow).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: "asset-wf", target: { kind: "asset" }, nodes: [], edges: [] } as never, ["data:image/png;base64,one"]],
    [freedomGraph, ["data:image/png;base64,one", "data:image/png;base64,two"]],
  ])("非分镜单/多参考保持原数组", async (graph, referenceImages) => {
    const { buildImageWorkflowGenerationRequest } = await import("@/lib/studio/image-workflow");
    const { aiManager } = await import("@/lib/ai/ai-manager");
    vi.mocked(buildImageWorkflowGenerationRequest).mockReturnValueOnce({
      prompt: "原提示词", model: "gpt-image-2", aspectRatio: "16:9", referenceImages,
    } as never);
    await runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" });
    const params = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    expect(params.referenceImages).toEqual(referenceImages);
    expect(params.prompt).toBe("原提示词");
  });

  it("分镜场景+角色参考:角色恒槽1、场景槽2,§4.5 序原生直传", async () => {
    const graph = {
      id: "slot-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [
        { id: "scene", type: "reference", title: "码头", imageUrl: "data:image/png;base64,scene", continuityOrder: 1, source: { kind: "asset", assetType: "scene" } },
        { id: "hero", type: "reference", title: "独孤剑尘", imageUrl: "data:image/png;base64,hero", continuityOrder: 2, source: { kind: "asset", assetType: "character" } },
        { id: "gen-1", type: "generated", title: "成图", prompt: "p", aspectRatio: "16:9" },
      ],
      edges: [{ source: "hero", target: "gen-1" }, { source: "scene", target: "gen-1" }],
    } as never;
    const { aiManager } = await import("@/lib/ai/ai-manager");
    await runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" });
    const params = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    // 挂载序场景在前,槽位映射后角色=槽1(171 主参考位)
    expect(params.referenceImages).toEqual(["data:image/png;base64,hero", "data:image/png;base64,scene"]);
    expect(params.prompt).toContain("<image1>为独孤剑尘的身份来源");
    expect(params.prompt).toContain("<image2>为码头的场景来源");
  });
});

describe("runImageWorkflowNodeGeneration 无衣物链分流(09-04 通用化)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const unclothChainGraph = {
    id: "wf-unc",
    target: { kind: "freedom" },
    nodes: [
      { id: "ref-1", type: "reference", title: "参考", imageUrl: "project-file://a.png", position: { x: 80, y: 100 } },
      { id: "unc-1", type: "uncloth", title: "无衣物", prompt: "重绘提示词", position: { x: 80, y: 600 } },
      { id: "gen-1", type: "generated", title: "成图", position: { x: 760, y: 120 } },
    ],
    edges: [
      { id: "e1", source: "ref-1", target: "unc-1" },
      { id: "e2", source: "unc-1", target: "gen-1" },
    ],
  } as never;

  it("链齐备:执行 uncloth 管线(双分割+两遍),不走普通 t2i/i2i 通道", async () => {
    const { runUnclothChain } = await import("@/lib/assist/image-studio/run-uncloth");
    const { aiManager } = await import("@/lib/ai/ai-manager");

    const result = await runImageWorkflowNodeGeneration(unclothChainGraph, "gen-1", {
      addMaterial: () => "mat-1",
    });

    expect(result.imageUrl).toBe("project-file://media/ai-image/2026-09/uncloth_x_1.png");
    expect(runUnclothChain).toHaveBeenCalledTimes(1);
    // 管线收到链组装结果:输入图=参考图,文本=uncloth.prompt
    const request = vi.mocked(runUnclothChain).mock.calls[0][0];
    expect(request.inputImageUrl).toBe("project-file://a.png");
    expect(request.prompt).toBe("重绘提示词");
    expect(aiManager.generateImage).not.toHaveBeenCalled();
    // 结果回写走 store 最新代(成图+uncloth 回显)
    expect(studioState.upsertImageWorkflow).toHaveBeenCalledTimes(1);
  });

  it("无 uncloth 上游:照走普通生成链(不误伤既有路径)", async () => {
    const { runUnclothChain } = await import("@/lib/assist/image-studio/run-uncloth");
    const { aiManager } = await import("@/lib/ai/ai-manager");

    await runImageWorkflowNodeGeneration(freedomGraph, "gen-1", { addMaterial: () => "mat-1" });

    expect(runUnclothChain).not.toHaveBeenCalled();
    expect(aiManager.generateImage).toHaveBeenCalledTimes(1);
  });

  it("uncloth 返回前来源变化时拒绝旁路图写回", async () => {
    const { runUnclothChain } = await import("@/lib/assist/image-studio/run-uncloth");
    let current = true;
    vi.mocked(runUnclothChain).mockImplementationOnce(async (_request, assertStillCurrent) => {
      expect(assertStillCurrent).toBeTypeOf("function");
      current = false;
      assertStillCurrent?.();
      return { imageUrl: "project-file://old/late.png" };
    });
    await expect(runImageWorkflowNodeGeneration(unclothChainGraph, "gen-1", {
      addMaterial: () => "mat-1",
      assertStillCurrent: () => { if (!current) throw new Error("来源已变化"); },
    })).rejects.toThrow("来源已变化");
    expect(studioState.upsertImageWorkflow).not.toHaveBeenCalled();
  });
});

// ─── 1117 C2:断点C(URL 直读优先)/门A 锚词拒发/丢槽重排后复验 ──────────────

describe("runImageWorkflowNodeGeneration 1117 C2(断点C/门A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assetsBridgeState.bridge = null;
  });

  it("断点C:槽图 URL 直读优先——图库单姿真身直传,assetId 行级主图仅兜底", async () => {
    assetsBridgeState.bridge = {
      readUrlDataUrl: vi.fn(async (url: string) =>
        url === "asset-file://role/晏燎/元婴期_正视图_v1.png"
          ? "data:image/png;base64,GALLERY-PORTRAIT" : null),
      readImageDataUrl: vi.fn(async () => "data:image/png;base64,ROW-MAIN-FACE"),
    };
    studioState.storyboards = [storyboardShot({
      videoDesc: "独孤剑尘立于金水河码头，夜雨，按剑远眺。",
    })];
    const graph = {
      id: "breakpoint-c-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [
        { id: "ref-1", type: "reference", title: "独孤剑尘",
          imageUrl: "asset-file://role/晏燎/元婴期_正视图_v1.png", continuityOrder: 1,
          source: { kind: "asset", assetType: "character", id: "asset-y" } },
        { id: "gen-1", type: "generated", title: "成图", prompt: "p", aspectRatio: "16:9" },
      ],
      edges: [{ source: "ref-1", target: "gen-1" }],
    } as ImageWorkflowGraph;
    const { aiManager } = await import("@/lib/ai/ai-manager");
    await runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" });
    const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    // 真身=节点选中 URL 的直读结果(图库单姿),非 assetId 折叠回读的行级主图
    expect(sent.referenceImages).toEqual(["data:image/png;base64,GALLERY-PORTRAIT"]);
    expect(assetsBridgeState.bridge?.readUrlDataUrl).toHaveBeenCalledWith("asset-file://role/晏燎/元婴期_正视图_v1.png");
    expect(assetsBridgeState.bridge?.readImageDataUrl).not.toHaveBeenCalled();
    studioState.storyboards = [storyboardShot()];
  });

  it("断点C 兜底:URL 直读失败(桥缺席域外)回落 assetId 行级主图", async () => {
    assetsBridgeState.bridge = {
      readUrlDataUrl: vi.fn(async () => null),
      readImageDataUrl: vi.fn(async () => "data:image/png;base64,ROW-MAIN-FACE"),
    };
    const graph = {
      id: "fallback-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [
        { id: "ref-1", type: "reference", title: "独孤剑尘",
          imageUrl: "file:///outside/role.png", continuityOrder: 1,
          source: { kind: "asset", assetType: "character", id: "asset-y" } },
        { id: "gen-1", type: "generated", title: "成图", prompt: "p", aspectRatio: "16:9" },
      ],
      edges: [{ source: "ref-1", target: "gen-1" }],
    } as ImageWorkflowGraph;
    const { aiManager } = await import("@/lib/ai/ai-manager");
    await runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" });
    const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    expect(sent.referenceImages).toEqual(["data:image/png;base64,ROW-MAIN-FACE"]);
  });

  it("门A:场景锚未解析=拒发 throw(诊断留痕),不触发 generateImage", async () => {
    // 场景库清空+文本无可探针场景 → 五级序全断(时辰:夜雨仍在 videoDesc)
    sceneState.scenes = [];
    try {
      const { aiManager } = await import("@/lib/ai/ai-manager");
      await expect(
        runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" }),
      ).rejects.toThrow("剧情锚词断言");
      expect(aiManager.generateImage).not.toHaveBeenCalled();
    } finally {
      sceneState.scenes = [{ id: "scene-dock", name: "金水河码头", location: "金水河码头", projectId: "dao-project" }];
    }
  });

  it("门A:锚在 400 缺席=拒发(场景行在库而主体句无场景名)", async () => {
    // 场景行名换成 videoDesc 不含的长名——探针/字段全断走不进主体句
    sceneState.scenes = [{ id: "scene-x", name: "灵矿坑道葬玉", location: "灵矿坑道葬玉", projectId: "dao-project" }];
    try {
      const { aiManager } = await import("@/lib/ai/ai-manager");
      await expect(
        runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" }),
      ).rejects.toThrow("场景锚未解析");
      expect(aiManager.generateImage).not.toHaveBeenCalled();
    } finally {
      sceneState.scenes = [{ id: "scene-dock", name: "金水河码头", location: "金水河码头", projectId: "dao-project" }];
    }
  });

  it("门A 复验:丢槽重排后的终稿仍过锚词门(主角锚随存活槽重取)", async () => {
    sceneState.scenes = [{ id: "scene-dock", name: "金水河码头", location: "金水河码头", projectId: "dao-project" }];
    const graph = {
      id: "drop-recheck-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [
        { id: "ref-c1", type: "reference", title: "独孤剑尘", imageUrl: "data:image/png;base64,card-banner", continuityOrder: 1, source: { kind: "asset", assetType: "character", id: "asset-c1" } },
        { id: "ref-s1", type: "reference", title: "金水河码头", imageUrl: "data:image/png;base64,scene", continuityOrder: 1, source: { kind: "asset", assetType: "scene", id: "asset-s1" } },
        { id: "gen-1", type: "generated", title: "成图", prompt: "p", aspectRatio: "16:9" },
      ],
      edges: ["ref-c1", "ref-s1"].map((source) => ({ source, target: "gen-1" })),
    } as ImageWorkflowGraph;
    const crop = vi.mocked(cropSlotReferenceToSinglePose);
    crop.mockReset();
    crop.mockImplementation(async (dataUrl: string) => (dataUrl.endsWith("card-banner") ? null : dataUrl));
    const { aiManager } = await import("@/lib/ai/ai-manager");
    // 主角卡裁切丢槽后:场景顶槽1,场景锚仍在 400(sceneText 恒在主体句)→复验过
    await expect(
      runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" }),
    ).resolves.toEqual({ imageUrl: "project-file://w/1.png" });
    const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    expect(sent.prompt).toContain("金水河码头");
    // N=1 自然指称(09 §二:单图禁标签),场景来源点名在
    expect(sent.prompt).toContain("参考图中的金水河码头为场景来源");
  });
});
