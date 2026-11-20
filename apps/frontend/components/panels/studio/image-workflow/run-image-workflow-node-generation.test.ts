// @vitest-environment jsdom
/**
 * 分镜工作流节点生图核心的换线正典传输边界测试(1116,PRD §五.3/§4.5):
 * 单镜 hook 与面板批量串行 hook 共用本核心——分镜请求 prompt=体裁化句
 * (零槽=t2i 主体句/有槽=i2i 指令体),负面退役,参考按 §4.5 槽位原生直传
 * (storyboard-native-references 契约);非分镜(自由/资产)链零变化。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  // 1120 件一发车校验走 buildChapterAssetRows(真实 store 恒有该字段;空表=
  // 行集空,在档绑定必失效的可测形态)
  entityExtractions: [] as Array<Record<string, unknown>>,
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
  // 1120 根修用例注入 assets 桥 mock;clearAllMocks 清调用不清实现,桥态
  // 必须显式复位防泄漏到后续用例(桥 null=其余用例的默认形态)。
  afterEach(() => {
    assetsBridgeState.bridge = null;
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

  it("1120 血缘门误杀根修:节点钉非主图(直读≠行级主图)时两路同字节,不再「含来源外图片」", async () => {
    // 复刻 1120 分镜 3 实录:资产参考节点钉 asset-file:// 阶段图;桥上
    // readUrlDataUrl(直读钉选图)与 readImageDataUrl(折叠行级主图)返回不同
    // 字节。旧形态=来源集折叠主图/槽位直读钉选→两路分叉→门必拒;根修后
    // 两路共用 resolveManagedReferenceUrl(直读优先)→同字节→过门。
    const pinned = "data:image/png;base64,stageview";
    const mainImg = "data:image/png;base64,rowmain";
    const managedUrl = "asset-file://audio/../assets/role/s12-view.png";
    assetsBridgeState.bridge = {
      readUrlDataUrl: vi.fn().mockResolvedValue(pinned),
      readImageDataUrl: vi.fn().mockResolvedValue(mainImg),
    };
    const graph = {
      id: "pinned-asset-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [
        { id: "ref-1", type: "reference", title: "角色1", imageUrl: managedUrl, continuityOrder: 1,
          source: { kind: "asset", assetType: "character", id: "asset-pin" } },
        { id: "gen-1", type: "generated", title: "成图", prompt: "单幅剧情", aspectRatio: "16:9" },
      ],
      edges: [{ source: "ref-1", target: "gen-1" }],
    } as ImageWorkflowGraph;
    const workflow = await import("@/lib/studio/image-workflow");
    vi.mocked(workflow.buildImageWorkflowGenerationRequest).mockImplementationOnce(realRequest.buildImageWorkflowGenerationRequest);
    vi.mocked(workflow.assertImageWorkflowContinuityCapability).mockImplementationOnce(realRequest.assertImageWorkflowContinuityCapability);
    await expect(runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" }))
      .resolves.toEqual({ imageUrl: "project-file://w/1.png" });
    const { aiManager } = await import("@/lib/ai/ai-manager");
    const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    // 直读优先:传输与来源集同为钉选图字节(旧行为主图不在任何一侧)
    expect(sent.referenceImages).toEqual([pinned]);
    const transport = vi.mocked(workflow.assertImageWorkflowContinuityCapability).mock.calls[0][1];
    expect(transport?.sourceReferenceImages).toEqual([pinned]);
    expect(transport?.slots[0]?.sourceUrl).toBe(pinned);
    // 折叠回读兜底未被触达(直读已命中)
    const bridge = assetsBridgeState.bridge as { readImageDataUrl: ReturnType<typeof vi.fn> };
    expect(bridge.readImageDataUrl).not.toHaveBeenCalled();
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

describe("1120 件一:发车校验(在档 assetBindings 失效=拒发+例外清单,禁静默)", () => {
  beforeEach(() => {
    // 上一个 describe 的 beforeEach 不跨块:本块自清 mock 计数
    vi.clearAllMocks();
  });

  it("绑定行不存在(id+name 双落空)=装配前拒发+binding-invalid 落例外清单", async () => {
    const { useStoryboardBindingStore } = await import("../storyboard-asset-binding");
    useStoryboardBindingStore.setState({ runsByChapter: {} });
    studioState.storyboards = [
      storyboardShot({
        // 1120 复核②起发车校验先核镜阵容(绑定名须出自 associateAssetsNames
        // ——生产写路 bindShotWithMatch 恒如此);阵容在档+行删=id+name 双落空
        associateAssetsNames: ["金水河旧码头"],
        assetBindings: [{ assetId: "scene-gone", name: "金水河旧码头", kind: "scene", slot: 1 }],
      }),
    ];
    const { aiManager } = await import("@/lib/ai/ai-manager");
    try {
      await expect(
        runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" }),
      ).rejects.toThrow("分镜绑定失效");
      expect(aiManager.generateImage).not.toHaveBeenCalled();
      const report = useStoryboardBindingStore.getState().runsByChapter["chapter-001"]?.report;
      expect(report?.exceptions[0]).toMatchObject({
        storyboardId: "sb-1",
        status: "binding-invalid",
        statusLabel: "绑定失效",
      });
      expect(report?.exceptions[0]?.detail).toContain("资产行不存在");
    } finally {
      // 还原共享 mock 态,不影响同文件其余用例
      studioState.storyboards = [storyboardShot()];
    }
  });

  it("assetBindings 缺席(旧章)=校验放行,既有正典传输行为不变", async () => {
    const { aiManager } = await import("@/lib/ai/ai-manager");
    await expect(
      runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" }),
    ).resolves.toEqual({ imageUrl: "project-file://w/1.png" });
    expect(aiManager.generateImage).toHaveBeenCalledTimes(1);
  });
});

// ─── 1120 件三:A/B 并轨开关(storyboardPromptMode;默认 canonical 零变化) ──────────────

describe("1120 件三:A/B 并轨开关(identity-injection 设计卡全文注入)", () => {
  /** 带可见角色名单的镜(身份段经桥解析;无 actionIn=videoDesc 原文保留)。 */
  const shotWithCast = (partial: Partial<StoryboardItem> = {}): StoryboardItem =>
    storyboardShot({
      shotSemantics: {
        sceneViewpointId: "", personFree: false,
        visibleCharacters: [{ name: "独孤剑尘", position: "", orientation: "", actionIn: "", actionOut: "" }],
        visibleProps: [],
        actionIn: "", actionOut: "",
      },
      ...partial,
    });
  /** 资产桥:独孤剑尘设计卡(prompt 列含正典洗版会剔的排版语料)。 */
  const cardBridge = () => ({
    getByName: vi.fn(async () => ({
      prompt: "宽方厚重脸，浓眉压眼，身着米白色及膝粗布短袍，同一画面并排四视图",
    })),
  });
  const setPromptMode = (mode: "identity-injection" | undefined): void => {
    const config = studioState.workflowConfig as Record<string, unknown>;
    if (mode) config.storyboardPromptMode = mode;
    else delete config.storyboardPromptMode;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    assetsBridgeState.bridge = null;
    sceneState.scenes = [{ id: "scene-dock", name: "金水河码头", location: "金水河码头", projectId: "dao-project" }];
    studioState.storyboards = [shotWithCast()];
    setPromptMode(undefined);
  });

  it("canonical(缺省默认值):身份段白名单提取后织入五项序首位,无参考块——默认路径形态不变", async () => {
    assetsBridgeState.bridge = cardBridge();
    const { aiManager } = await import("@/lib/ai/ai-manager");
    await runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" });
    const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    expect(sent.prompt).toContain("宽方厚重脸");
    // 正典洗版:排版语料(并排四视图)剔除;无「参考 N：」块
    expect(sent.prompt).not.toContain("并排");
    expect(sent.prompt).not.toContain("参考 1：");
  });

  it("identity-injection:主体句零身份段+「参考 N:<全文>」块(设计卡全文不洗版,块面 lint 豁免)", async () => {
    setPromptMode("identity-injection");
    assetsBridgeState.bridge = cardBridge();
    const { aiManager } = await import("@/lib/ai/ai-manager");
    await runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" });
    const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    // 基底=零身份段主体句:首位=动作槽(videoDesc),身份段不在五项序首位
    expect(sent.prompt.startsWith("独孤剑尘立于金水河码头")).toBe(true);
    // 参考块=设计卡全文逐字(含正典洗版会剔的「并排四视图」);块面在场仍过
    // 体裁门=身份段相关 lint 断言豁免的直接证据(并排若入 lint 必 sheet-format 拒发)
    expect(sent.prompt).toContain("参考 1：宽方厚重脸，浓眉压眼，身着米白色及膝粗布短袍，同一画面并排四视图");
    // 锚词断言(场景/时辰/主角名)按终稿全文照常通过
    expect(sent.prompt).toContain("金水河码头");
    expect(sent.prompt).toContain("夜");
  });

  it("混合镜绑定在档:块 N=角色实际传输槽号(恒 image_1),与 assetBindings 写路 slot 解耦", async () => {
    setPromptMode("identity-injection");
    assetsBridgeState.bridge = cardBridge();
    // 绑定在档=写路序(场景 slot1→角色 slot2,collectStoryboardAssetBindings
    // 全类型序);提取批次行有三库图=件一发车校验放行(绑定有效形态)。
    studioState.storyboards = [shotWithCast({
      // 1120 复核②镜阵容一致性:绑定名出自 associateAssetsNames(生产写路不变式)
      associateAssetsNames: ["金水河码头", "独孤剑尘"],
      assetBindings: [
        { assetId: "scene-dock", name: "金水河码头", kind: "scene", slot: 1 },
        { assetId: "role-1", name: "独孤剑尘", kind: "character", slot: 2 },
      ],
    })];
    studioState.entityExtractions = [{
      id: "batch-1", episodeId: "chapter-001",
      characters: [{ characterId: "role-1", name: "独孤剑尘", aliases: [] }],
      scenes: [{ sceneId: "scene-dock", name: "金水河码头" }],
      props: [],
    }];
    characterState.characters = [{ name: "独孤剑尘", projectId: "dao-project", thumbnailUrl: "data:image/png;base64,roleRow" }];
    sceneState.scenes = [{
      id: "scene-dock", name: "金水河码头", location: "金水河码头", projectId: "dao-project",
      referenceImage: "data:image/png;base64,sceneRow",
    }];
    // 图内参考:场景节点 continuityOrder 在前——传输槽仍角色=image_1(§4.5
    // 角色优先),与绑定 slot/节点序都不同源,对账面拉满。
    const sceneRef = {
      id: "ref-scene", type: "reference" as const, title: "金水河码头",
      imageUrl: "data:image/png;base64,sceneCard", continuityOrder: 1, continuityVersionId: "scene-v1",
      source: { kind: "asset" as const, assetType: "scene" as const, id: "scene-dock" },
    };
    const roleRef = {
      id: "ref-role", type: "reference" as const, title: "独孤剑尘",
      imageUrl: "data:image/png;base64,roleCard", continuityOrder: 2, continuityVersionId: "role-v1",
      source: { kind: "asset" as const, assetType: "character" as const, id: "role-1" },
    };
    const mixedGraph = {
      id: "mixed-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [sceneRef, roleRef, { id: "gen-1", type: "generated", title: "成图", prompt: "单幅剧情", aspectRatio: "16:9" }],
      edges: [{ source: sceneRef.id, target: "gen-1" }, { source: roleRef.id, target: "gen-1" }],
    } as ImageWorkflowGraph;
    const { aiManager } = await import("@/lib/ai/ai-manager");
    try {
      await expect(
        runImageWorkflowNodeGeneration(mixedGraph, "gen-1", { addMaterial: () => "mat-1" }),
      ).resolves.toEqual({ imageUrl: "project-file://w/1.png" });
      const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
      // 传输槽序=角色 image_1→场景 image_2(与节点 continuityOrder/绑定 slot 均无关)
      expect(sent.referenceImages).toEqual(["data:image/png;base64,roleCard", "data:image/png;base64,sceneCard"]);
      // 块编号与送模参考图逐槽对账:独孤剑尘设计卡=参考 1(非绑定 slot2——
      // 旧实现按绑定 slot 会写「参考 2」而 image_2 实为场景图,指鹿为马)
      expect(sent.prompt).toContain("参考 1：宽方厚重脸，浓眉压眼，身着米白色及膝粗布短袍，同一画面并排四视图");
      expect(sent.prompt).not.toContain("参考 2：宽方厚重脸");
      // 与指令 <imageN> 点名同槽不矛盾:image1=角色身份,image2=场景来源
      expect(sent.prompt).toContain("<image1>为独孤剑尘的身份来源");
      expect(sent.prompt).toContain("<image2>为金水河码头的场景来源");
    } finally {
      // 还原共享 mock 态(件一同款纪律),不影响同文件其余用例
      studioState.storyboards = [shotWithCast()];
      studioState.entityExtractions = [];
      characterState.characters = [];
      sceneState.scenes = [{ id: "scene-dock", name: "金水河码头", location: "金水河码头", projectId: "dao-project" }];
    }
  });

  it("锚词断言两模式都保留:identity-injection 下场景锚断链仍拒发(门A 不豁免)", async () => {
    setPromptMode("identity-injection");
    assetsBridgeState.bridge = cardBridge();
    sceneState.scenes = [];
    const { aiManager } = await import("@/lib/ai/ai-manager");
    await expect(
      runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" }),
    ).rejects.toThrow("剧情锚词断言");
    expect(aiManager.generateImage).not.toHaveBeenCalled();
  });

  it("lint 豁免只限注入块面:基底(零身份段主体句)违规仍拒发(体裁门 fail-closed)", async () => {
    setPromptMode("identity-injection");
    assetsBridgeState.bridge = cardBridge();
    studioState.storyboards = [shotWithCast({ videoDesc: "独孤剑尘立于金水河码头，胶片感照亮脸和手。" })];
    const { aiManager } = await import("@/lib/ai/ai-manager");
    await expect(
      runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" }),
    ).rejects.toThrow("体裁断言");
    expect(aiManager.generateImage).not.toHaveBeenCalled();
  });
});

// ── 1120 交叉复核④:全槽裁失降级零槽 t2i(原空槽数组走 transport 分支硬抛) ────
describe("runImageWorkflowNodeGeneration 1120 复核④(全槽裁失降级路)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 上一 describe 的共享 mock 态复位(件一同款纪律):镜行/提示词模式还原
    studioState.storyboards = [storyboardShot()];
    delete (studioState.workflowConfig as Record<string, unknown>).storyboardPromptMode;
  });

  it("单角色镜唯一槽裁失(全槽裁失)→零槽 t2i 降级:零参考发车,不再「槽位数量不一致(须 1–3 槽)」硬抛", async () => {
    // 单角色镜形态:唯一角色槽(无场景/前帧),横幅卡裁不出单姿=全槽裁失
    const graph = {
      id: "crop-drop-all-wf", target: { kind: "storyboard", id: "sb-1" },
      nodes: [
        { id: "ref-c1", type: "reference", title: "赵四", imageUrl: "data:image/png;base64,card-banner", continuityOrder: 1, source: { kind: "asset", assetType: "character", id: "asset-c1" } },
        { id: "gen-1", type: "generated", title: "成图", prompt: "p", aspectRatio: "16:9" },
      ],
      edges: [{ source: "ref-c1", target: "gen-1" }],
    } as ImageWorkflowGraph;
    const workflow = await import("@/lib/studio/image-workflow");
    vi.mocked(workflow.buildImageWorkflowGenerationRequest).mockImplementationOnce(realRequest.buildImageWorkflowGenerationRequest);
    vi.mocked(workflow.assertImageWorkflowContinuityCapability).mockImplementationOnce(realRequest.assertImageWorkflowContinuityCapability);
    const crop = vi.mocked(cropSlotReferenceToSinglePose);
    crop.mockReset();
    crop.mockImplementation(async () => null); // 唯一角色槽裁失
    const { aiManager } = await import("@/lib/ai/ai-manager");
    // 修前:rebuilt.mapping.slots=[] 仍走 transport 分支,血缘门以 imageUrls=[]
    // 调用→「分镜多参考传输槽位数量不一致(须 1–3 槽)」硬抛(真因=全槽裁失被误导)
    await expect(
      runImageWorkflowNodeGeneration(graph, "gen-1", { addMaterial: () => "mat-1" }),
    ).resolves.toEqual({ imageUrl: "project-file://w/1.png" });
    const sent = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    // 零槽 t2i 降级路:传输零参考+主体句形态(无槽位点名)
    expect(sent.referenceImages).toEqual([]);
    expect(sent.prompt).not.toMatch(/<image\d+>/);
  });
});
