// @vitest-environment jsdom
/**
 * 分镜工作流节点生图核心的道劫编译边界测试:
 * 单镜 hook 与面板批量串行 hook(5edd0ee)共用本核心,道劫分镜帧必须
 * 经 ma-gongbi-v1 编译(1600 门)后以 raw 正向专用通道直传 generateImage
 * (prompt 无 Avoid,负面走 negativePrompt 分离传输;providerPrompt 保留为云端传输形态)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetExtendedManualContentCache,
  warmExtendedManualStyleTokens,
} from "@/lib/studio/visual-manual-style-tokens";
import { runImageWorkflowNodeGeneration } from "./run-image-workflow-node-generation";
import type { ImageWorkflowGraph } from "@/types/studio";
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
vi.mock("@/lib/bridge/studio-assets", () => ({
  getStudioAssetsBridge: () => null,
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
const studioState = {
  workflowConfig: { visualManualId: "daojie_ink_guofeng" },
  storyboards: [],
  imageWorkflows: [],
  upsertImageWorkflow: vi.fn(),
};
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: { getState: () => studioState },
}));

const DAOJIE_MANUAL = [
  "<!-- storyboard-image-style-tokens:start -->",
  "Chinese ink wash painting style, gongbi linework",
  "<!-- storyboard-image-style-tokens:end -->",
  "<!-- storyboard-frame-negative:start -->",
  "watermark, low quality",
  "<!-- storyboard-frame-negative:end -->",
].join("\n");

const storyboardGraph = { id: "wf-1", target: { kind: "storyboard" }, nodes: [], edges: [] } as never;
const freedomGraph = { id: "wf-2", target: { kind: "freedom" }, nodes: [], edges: [] } as never;

describe("版本参考经真实 builder 和能力门的分镜传输", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExtendedManualContentCache();
    studioState.workflowConfig = { visualManualId: "2d_shonen" };
  });

  it.each([[1, "qwen-image-2-1", "16:9"], [2, "qwen-image-2-1", "16:9"], [3, "gpt-image-2", "9:16"], [2, "comfyui-bridge", "21:9"]] as const)("%i 张带版本参考，节点模型 %s，画幅%s按最终 Qwen 单图传输过门", async (count, model, aspectRatio) => {
    const refs = Array.from({ length: count }, (_, index) => ({
      id: `ref-${index}`, type: "reference", title: `角色${index + 1}`,
      imageUrl: `data:image/png;base64,ref${index}`, continuityOrder: index + 1,
      continuityVersionId: `version-${index}`, source: { kind: "asset", assetType: "character", id: `asset-${index}` },
    }));
    const graph = {
      id: "version-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [...refs, { id: "gen-1", type: "generated", title: "成图", prompt: "单幅剧情", model, aspectRatio }],
      edges: [...refs].reverse().map((ref) => ({ source: ref.id, target: "gen-1" })),
    } as ImageWorkflowGraph;
    const workflow = await import("@/lib/studio/image-workflow");
    vi.mocked(workflow.buildImageWorkflowGenerationRequest).mockImplementationOnce(realRequest.buildImageWorkflowGenerationRequest);
    vi.mocked(workflow.assertImageWorkflowContinuityCapability).mockImplementationOnce(realRequest.assertImageWorkflowContinuityCapability);
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), measureText: () => ({ width: 22 }),
    } as never);
    const exportImage = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,version-sheet");
    vi.stubGlobal("Image", class {
      naturalWidth = 600; naturalHeight = 800; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    try {
      await expect(runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" })).resolves.toEqual({ imageUrl: "project-file://w/1.png" });
      const { aiManager } = await import("@/lib/ai/ai-manager");
      const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
      expect(sent.model).toBe("qwen-image-2-1");
      expect(sent.referenceImages).toEqual(["data:image/png;base64,version-sheet"]);
      expect(sent.aspectRatio).toBe(aspectRatio);
      const canvas = exportImage.mock.instances[0] as HTMLCanvasElement;
      const [w, h] = aspectRatio.split(":").map(Number);
      expect(canvas.width * h).toBe(canvas.height * w);
      expect(workflow.assertImageWorkflowContinuityCapability).toHaveBeenCalledWith(
        expect.objectContaining({ model: sent.model, referenceImages: sent.referenceImages }),
        expect.objectContaining({ kind: "storyboard-single-image", mappings: refs.map((ref, index) => ({ order: index + 1, imageUrl: ref.imageUrl })) }),
      );
      if (count > 1) refs.forEach((_, index) => expect(sent.prompt).toContain(`图${index + 1}对应拼板第${index + 1}格：角色${index + 1}（角色）`));
    } finally {
      context.mockRestore(); exportImage.mockRestore(); vi.unstubAllGlobals();
    }
  });

  it("版本资产与上游成图经真实 builder、拼板和能力门完整传输", async () => {
    const sources = ["data:image/png;base64,ref", "data:image/png;base64,prior"];
    const graph = {
      id: "versioned-upstream-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [
        { id: "ref-1", type: "reference", title: "场景", imageUrl: sources[0], continuityOrder: 1,
          continuityVersionId: "scene-v1", source: { kind: "asset", assetType: "scene", id: "scene" } },
        { id: "prior", type: "generated", title: "首帧", resultUrl: sources[1] },
        { id: "gen-1", type: "generated", title: "次帧", prompt: "单幅剧情", model: "qwen-image-2-1", aspectRatio: "16:9" },
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
    const drawImage = vi.fn();
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(), drawImage, fillText: vi.fn(), measureText: () => ({ width: 22 }),
    } as never);
    const exported = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,full-sheet");
    const loadedUrls: string[] = [];
    vi.stubGlobal("Image", class {
      naturalWidth = 600; naturalHeight = 800; onload?: () => void;
      set src(value: string) { loadedUrls.push(value); queueMicrotask(() => this.onload?.()); }
    });
    try {
      await expect(runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" }))
        .resolves.toEqual({ imageUrl: "project-file://w/1.png" });
      expect(loadedUrls).toEqual(sources);
      expect(drawImage).toHaveBeenCalledTimes(2);
      const { aiManager } = await import("@/lib/ai/ai-manager");
      expect(aiManager.generateImage).toHaveBeenCalledTimes(1);
      expect(aiManager.generateImage).toHaveBeenCalledWith(expect.objectContaining({
        model: "qwen-image-2-1", referenceImages: ["data:image/png;base64,full-sheet"],
        prompt: expect.stringContaining("图2对应拼板第2格：首帧（上游成图）"),
      }));
      expect(workflow.assertImageWorkflowContinuityCapability).toHaveBeenCalledWith(
        expect.objectContaining({ orderedReferenceManifest: actual.orderedReferenceManifest, continuityRequired: true, previousApprovedFrameIncluded: true }),
        { kind: "storyboard-single-image", imageUrl: "data:image/png;base64,full-sheet", sourceReferenceImages: sources,
          mappings: sources.map((imageUrl, index) => ({ order: index + 1, imageUrl })) },
      );
      expect(actual.orderedReferenceManifest[0].versionId).toBe("scene-v1");
      expect(realRequest.buildImageWorkflowGenerationRequest(graph, "gen-1")).toEqual(actual);
    } finally {
      context.mockRestore(); exported.mockRestore(); vi.unstubAllGlobals();
    }
  });

  it("能力门异常拒绝生成与所有保存写回", async () => {
    const workflow = await import("@/lib/studio/image-workflow");
    vi.mocked(workflow.assertImageWorkflowContinuityCapability).mockImplementationOnce(() => { throw new Error("门异常"); });
    const { aiManager } = await import("@/lib/ai/ai-manager");
    const addMaterial = vi.fn();
    await expect(runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial })).rejects.toThrow("门异常");
    expect(aiManager.generateImage).not.toHaveBeenCalled();
    expect(saveImage).not.toHaveBeenCalled();
    expect(addMaterial).not.toHaveBeenCalled();
    expect(studioState.upsertImageWorkflow).not.toHaveBeenCalled();
  });

  it("零参考和未带版本单参考保持兼容，不启用例外契约", async () => {
    const workflow = await import("@/lib/studio/image-workflow");
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as never);
    const exported = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,padded");
    vi.stubGlobal("Image", class {
      naturalWidth = 600; naturalHeight = 800; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    try { for (const urls of [[], ["data:image/png;base64,plain"]]) {
      vi.mocked(workflow.buildImageWorkflowGenerationRequest).mockReturnValueOnce({
        prompt: "剧情", model: "gpt-image-2", aspectRatio: "16:9", referenceImages: urls,
        orderedReferenceManifest: urls.map((imageUrl) => ({ order: Number.MAX_SAFE_INTEGER, imageUrl })), continuityRequired: false,
      } as never);
      vi.mocked(workflow.assertImageWorkflowContinuityCapability).mockImplementationOnce(realRequest.assertImageWorkflowContinuityCapability);
      await runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" });
      expect(workflow.assertImageWorkflowContinuityCapability).toHaveBeenLastCalledWith(
        expect.objectContaining({ model: "qwen-image-2-1", referenceImages: urls.length ? ["data:image/png;base64,padded"] : [] }), undefined,
      );
    } } finally { context.mockRestore(); exported.mockRestore(); vi.unstubAllGlobals(); }
  });
});

describe("runImageWorkflowNodeGeneration 道劫分镜编译边界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExtendedManualContentCache();
  });

  it("道劫手册:分镜帧编译为 raw 正向专用通道(prompt 无 Avoid,负面走 negativePrompt 分离传输)", async () => {
    studioState.workflowConfig = { visualManualId: "daojie_ink_guofeng" };
    await warmExtendedManualStyleTokens(DAOJIE_MANUAL);
    const { aiManager } = await import("@/lib/ai/ai-manager");

    const result = await runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", {
      addMaterial: () => "mat-1",
    });

    expect(result.imageUrl).toBe("project-file://w/1.png");
    const params = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    // 10-19 用户裁定(B):分镜生图原生走 qwen-image-2-1(K2 桥路由退役)
    expect(params.model).toBe("qwen-image-2-1");
    expect(params.extraParams?.template).toBeUndefined(); // 不再点名桥模板
    expect(aiManager.generateImage).toHaveBeenCalledTimes(1); // 单次直发,无桥回落重试
    expect(params.promptPolicy).toBe("raw");
    expect(params.prompt).toContain("【画面】独孤剑尘立于金水河码头");
    expect(params.prompt).toContain("Chinese ink wash painting style");
    expect(params.prompt.match(/Avoid:/g)).toBeNull();
    expect(params.negativePrompt).toContain("watermark");
    expect(params.negativePrompt).toContain("low quality");
    expect(params.negativePrompt).not.toContain("Avoid:");
  });

  it("非道劫手册:保持 enhanced 传输与分离负面", async () => {
    studioState.workflowConfig = { visualManualId: "2d_shonen" };
    const { aiManager } = await import("@/lib/ai/ai-manager");

    await runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" });

    const params = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    expect(params.model).toBe("qwen-image-2-1"); // 非道劫分镜同走本地 qi21(10-19 B)
    expect(params.extraParams?.template).toBeUndefined();
    expect(params.promptPolicy).toBeUndefined();
    expect(params.negativePrompt).toBe("watermark");
    expect(params.prompt).not.toContain("Avoid:");
  });

  it("非分镜(自由)工作流不进分镜编译,即使手册为道劫", async () => {
    studioState.workflowConfig = { visualManualId: "daojie_ink_guofeng" };
    await warmExtendedManualStyleTokens(DAOJIE_MANUAL);
    const { aiManager } = await import("@/lib/ai/ai-manager");

    await runImageWorkflowNodeGeneration(freedomGraph, "gen-1", { addMaterial: () => "mat-1" });

    const params = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    expect(params.model).toBe("gpt-image-2"); // 自由工作流透传节点模型
    expect(params.promptPolicy).toBeUndefined();
    expect(params.negativePrompt).toBe("watermark");
  });

  it("分镜帧超 1600 字符在网络前 fail-closed,不触发 generateImage", async () => {
    studioState.workflowConfig = { visualManualId: "daojie_ink_guofeng" };
    await warmExtendedManualStyleTokens(DAOJIE_MANUAL);
    const { buildImageWorkflowGenerationRequest } = await import("@/lib/studio/image-workflow");
    vi.mocked(buildImageWorkflowGenerationRequest).mockReturnValueOnce({
      prompt: "工笔长卷细节描写。".repeat(200),
      model: "gpt-image-2",
      aspectRatio: "16:9",
      resolution: "2K",
      negativePrompt: "",
      referenceImages: [],
    } as never);
    const { aiManager } = await import("@/lib/ai/ai-manager");

    await expect(
      runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" }),
    ).rejects.toThrow("1600");
    expect(aiManager.generateImage).not.toHaveBeenCalled();
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
    studioState.workflowConfig = { visualManualId: "2d_shonen" };
    const { buildImageWorkflowGenerationRequest } = await import("@/lib/studio/image-workflow");
    const { aiManager } = await import("@/lib/ai/ai-manager");
    vi.mocked(buildImageWorkflowGenerationRequest).mockReturnValueOnce({
      prompt: "原提示词", model: "gpt-image-2", aspectRatio: "16:9", referenceImages,
    } as never);
    await runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" });
    const params = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    expect(params.referenceImages).toEqual(referenceImages);
    expect(params.prompt).not.toContain("参考拼板映射");
  });

  it.each([1, 2, 3])("分镜%i参考不支持的画幅在模型前拒绝", async (count) => {
    const workflow = await import("@/lib/studio/image-workflow");
    vi.mocked(workflow.buildImageWorkflowGenerationRequest).mockReturnValueOnce({
      prompt: "剧情", model: "gpt-image-2", aspectRatio: "999999999:1", referenceImages: Array(count).fill("ref"),
    } as never);
    const { aiManager } = await import("@/lib/ai/ai-manager");
    await expect(runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" }))
      .rejects.toThrow("画幅");
    expect(aiManager.generateImage).not.toHaveBeenCalled();
    expect(saveImage).not.toHaveBeenCalled();
  });

  it("分镜多参考只发送一张拼板，prompt 保留有序格位映射", async () => {
    studioState.workflowConfig = { visualManualId: "2d_shonen" };
    const { buildImageWorkflowGenerationRequest } = await import("@/lib/studio/image-workflow");
    const { aiManager } = await import("@/lib/ai/ai-manager");
    vi.mocked(buildImageWorkflowGenerationRequest).mockReturnValueOnce({
      prompt: "@图1 为码头场景，@图2 为独孤剑尘角色。单幅剧情。",
      model: "gpt-image-2", aspectRatio: "16:9", referenceImages: ["data:image/png;base64,scene", "data:image/png;base64,hero"],
    } as never);
    const graph = {
      id: "sheet-wf", target: { kind: "storyboard" },
      nodes: [
        { id: "hero", type: "reference", title: "独孤剑尘", imageUrl: "data:image/png;base64,hero", source: { kind: "asset", assetType: "character" } },
        { id: "scene", type: "reference", title: "码头", imageUrl: "data:image/png;base64,scene", source: { kind: "asset", assetType: "scene" } },
      ],
      edges: [{ source: "hero", target: "gen-1" }, { source: "scene", target: "gen-1" }],
    } as never;
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), measureText: () => ({ width: 22 }),
    } as never);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,sheet");
    vi.stubGlobal("Image", class {
      naturalWidth = 600; naturalHeight = 800; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    try {
      await runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" });
      const params = vi.mocked(aiManager.generateImage).mock.calls[0][0];
      expect(params.referenceImages).toEqual(["data:image/png;base64,sheet"]);
      expect(params.prompt).toContain("图1对应拼板第1格：码头（场景）");
      expect(params.prompt).toContain("图2对应拼板第2格：独孤剑尘（角色）");
      expect(params.prompt).toContain("输出为一张完整连续的剧情画面，画面内容仅为场景、角色和道具");
    } finally {
      getContext.mockRestore(); toDataURL.mockRestore(); vi.unstubAllGlobals();
    }
  });
});

describe("runImageWorkflowNodeGeneration 无衣物链分流(09-04 通用化)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExtendedManualContentCache();
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
