// @vitest-environment jsdom
/**
 * 分镜工作流节点生图核心的道劫编译边界测试:
 * 单镜 hook 与面板批量串行 hook(5edd0ee)共用本核心,道劫分镜帧必须
 * 经 ma-gongbi-v1 编译(唯一 Avoid+800 门)后以 raw 直传 generateImage。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetExtendedManualContentCache,
  warmExtendedManualStyleTokens,
} from "@/lib/studio/visual-manual-style-tokens";
import { runImageWorkflowNodeGeneration } from "./run-image-workflow-node-generation";

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { generateImage: vi.fn().mockResolvedValue({ url: "https://cdn.example/frame.png", mediaId: "m1" }) },
}));
vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => ({
    saveImage: vi.fn().mockResolvedValue({ success: true, url: "project-file://w/1.png", size: 10 }),
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

describe("runImageWorkflowNodeGeneration 道劫分镜编译边界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExtendedManualContentCache();
  });

  it("道劫手册:分镜帧编译为 raw providerPrompt(唯一 Avoid),负面不再分离传输", async () => {
    studioState.workflowConfig = { visualManualId: "daojie_ink_guofeng" };
    await warmExtendedManualStyleTokens(DAOJIE_MANUAL);
    const { aiManager } = await import("@/lib/ai/ai-manager");

    const result = await runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", {
      addMaterial: () => "mat-1",
    });

    expect(result.imageUrl).toBe("project-file://w/1.png");
    const params = vi.mocked(aiManager.generateImage).mock.calls[0][0];
    expect(params.promptPolicy).toBe("raw");
    expect(params.negativePrompt).toBeUndefined();
    expect(params.prompt).toContain("【画面】独孤剑尘立于金水河码头");
    expect(params.prompt).toContain("Chinese ink wash painting style");
    expect(params.prompt.match(/Avoid:/g)).toHaveLength(1);
    expect(params.prompt).toContain("watermark");
  });

  it("非道劫手册:保持 enhanced 传输与分离负面", async () => {
    studioState.workflowConfig = { visualManualId: "2d_shonen" };
    const { aiManager } = await import("@/lib/ai/ai-manager");

    await runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" });

    const params = vi.mocked(aiManager.generateImage).mock.calls[0][0];
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
    expect(params.promptPolicy).toBeUndefined();
    expect(params.negativePrompt).toBe("watermark");
  });

  it("分镜帧超 800 字符在网络前 fail-closed,不触发 generateImage", async () => {
    studioState.workflowConfig = { visualManualId: "daojie_ink_guofeng" };
    await warmExtendedManualStyleTokens(DAOJIE_MANUAL);
    const { buildImageWorkflowGenerationRequest } = await import("@/lib/studio/image-workflow");
    vi.mocked(buildImageWorkflowGenerationRequest).mockReturnValueOnce({
      prompt: "工笔长卷细节描写。".repeat(120),
      model: "gpt-image-2",
      aspectRatio: "16:9",
      resolution: "2K",
      negativePrompt: "",
      referenceImages: [],
    } as never);
    const { aiManager } = await import("@/lib/ai/ai-manager");

    await expect(
      runImageWorkflowNodeGeneration(storyboardGraph, "gen-1", { addMaterial: () => "mat-1" }),
    ).rejects.toThrow("800");
    expect(aiManager.generateImage).not.toHaveBeenCalled();
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
});
