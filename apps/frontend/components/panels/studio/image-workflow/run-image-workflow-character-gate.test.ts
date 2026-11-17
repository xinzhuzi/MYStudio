// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 人物一致性硬闸门(08-30)行为锁:通过 mock window.vlmReview 与
 * projectFiles/aiManager,驱动 runImageWorkflowNodeGeneration 的落库后
 * 闸门路径。六情形:①模型未就绪→放行+warn 留痕;②无角色参考→1117 十三刀B
 * 起仍过门(零参考克隆检测),审核正常→放行;③character_ok=false→拦截;
 * ④审核异常→放行;⑤clone_ok=false→拦截(抛「画面克隆未过」);
 * ⑥模型未就绪→落 character-gate-skipped 留痕(不再静默)。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyMock = any;

function installBridge(bridge: { probe?: AnyMock; run?: AnyMock } | null): { probe: AnyMock; run: AnyMock } | undefined {
  const full = {
    probe: bridge?.probe ?? vi.fn(async () => ({ status: "ready" })),
    run: bridge?.run ?? vi.fn(async () => ({ status: "accepted", checks: { character_ok: true }, reasons: [] })),
  };
  (window as unknown as { vlmReview?: unknown }).vlmReview = full;
  return full;
}

// 1116 换线:拼板模块已退役(参考按 §4.5 槽位原生直传)——闸门 4 测意图=分流
// 逻辑,非传输像素;分镜正典装配按零参考形态桩化(体裁路由=t2i 直通)。
vi.mock("@/components/panels/studio/image-workflow/storyboard-canonical-context", () => ({
  buildStoryboardCanonicalTransportInput: vi.fn(async () => ({
    instruction: { genre: "t2i" as const, prompt: "体裁化主体句。", slots: [] },
    mapping: { slots: [], dropped: [] },
  })),
}));
vi.mock("@/lib/studio/image-workflow-references", () => ({
  prepareImageWorkflowReferenceImages: vi.fn(async (urls: string[]) => urls),
}));
vi.mock("@/lib/bridge/studio-assets", () => ({
  getStudioAssetsBridge: () => undefined,
}));
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: {
    getState: () => ({
      upsertImageWorkflow: vi.fn(), imageWorkflows: [],
      storyboards: [{ id: "sb-1", videoDesc: "正文", prompt: "正文" }],
    }),
  },
}));
vi.mock("@/lib/studio/image-workflow", () => ({
  assertImageWorkflowContinuityCapability: vi.fn(),
  buildImageWorkflowGenerationRequest: vi.fn(() => ({
    prompt: "正文",
    model: undefined,
    aspectRatio: "16:9",
    resolution: undefined,
    negativePrompt: undefined,
    referenceImages: ["project-file://p1/assets/role/kuli.png"],
    orderedReferenceManifest: [],
    continuityRequired: false,
    previousApprovedFrameIncluded: false,
  })),
  // 09-09 角色门塌缩对齐:identity 穿透(无透明节点时原样返回)
  collapseTransparentNodes: vi.fn((graph: unknown) => graph),
  setGeneratedImageResult: vi.fn(),
}));
vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    generateImage: vi.fn(async () => ({ imageUrl: "data:image/png;base64,x" })),
  },
}));
vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => ({
    saveImage: vi.fn(async () => ({ success: true, url: "project-file://p1/workflow-images/chapter-001/wf1/gen-1.png" })),
    readAsBase64: vi.fn(async () => "data:image/png;base64,eHg="),
  }),
}));
vi.mock("@/lib/ai/image-auto-denoise", () => ({
  maybeAutoDenoiseUrl: vi.fn(async (url: string) => url),
}));
vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: { getState: () => ({ activeProjectId: "p1" }) },
}));
vi.mock("@/lib/studio/visual-manual-style-tokens", () => ({
  withActiveVisualManualStoryboardStyleTokens: (prompt: string) => prompt,
  isExtendedVisualManualPromptActive: () => false,
  compileActiveDaojieStoryboardFramePrompt: vi.fn(async (p: string) => p),
  getExtendedStoryboardFactionData: () => ({ members: {}, palette: {} }),
}));
vi.mock("@/lib/diagnostics/logger", () => ({
  createOperationId: (name: string) => `op-${name}`,
  logEvent: vi.fn(async () => undefined),
}));

import { runImageWorkflowNodeGeneration } from "./run-image-workflow-node-generation";
import type { ImageWorkflowGraph } from "@/types/studio";

function makeGraph(withCharacterRef: boolean): ImageWorkflowGraph {
  const nodes: ImageWorkflowGraph["nodes"] = [
    {
      id: "gen-1",
      type: "generated",
      title: "成图",
      prompt: "正文",
      aspectRatio: "16:9",
      position: { x: 0, y: 0 },
      status: "idle",
      createdAt: 0,
      updatedAt: 0,
    } as ImageWorkflowGraph["nodes"][number],
  ];
  const edges: ImageWorkflowGraph["edges"] = [];
  if (withCharacterRef) {
    nodes.push({
      id: "ref-1",
      type: "reference",
      title: "老苦力",
      imageUrl: "project-file://p1/assets/role/kuli.png",
      source: { kind: "asset", assetType: "character", id: "a1" },
      position: { x: 0, y: 200 },
      createdAt: 0,
      updatedAt: 0,
    } as unknown as ImageWorkflowGraph["nodes"][number]);
    edges.push({ id: "e1", source: "ref-1", target: "gen-1" });
  }
  return {
    id: "wf-1",
    name: "测试流",
    target: { kind: "storyboard", id: "sb-1" },
    nodes,
    edges,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as ImageWorkflowGraph;
}

afterEach(() => {
  delete (window as unknown as { vlmReview?: unknown }).vlmReview;
  vi.restoreAllMocks();
});

describe("人物一致性硬闸门(runImageWorkflowNodeGeneration)", () => {
  it("① VLM 模型未就绪 → 放行(fail-open)", async () => {
    installBridge({ probe: vi.fn(async (): Promise<{ status: string }> => ({ status: "model-not-downloaded" })) });
    const result = await runImageWorkflowNodeGeneration(makeGraph(true), "gen-1", { operationId: "t", addMaterial: vi.fn(() => `mat-${Date.now()}`) } as never);
    expect(result.imageUrl).toContain("project-file://");
  });

  it("⑥ 模型未就绪 → 落 character-gate-skipped 留痕(十三刀B:禁静默黑灯)", async () => {
    const { logEvent } = await import("@/lib/diagnostics/logger");
    installBridge({ probe: vi.fn(async (): Promise<{ status: string }> => ({ status: "model-not-downloaded" })) });
    await runImageWorkflowNodeGeneration(makeGraph(true), "gen-1", { operationId: "t", addMaterial: vi.fn(() => `mat-${Date.now()}`) } as never);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op-character-gate-skipped", message: expect.stringContaining("skipped") }),
    );
  });

  it("② 无角色类参考图 → 仍过门(零参考克隆检测),审核通过 → 放行(十三刀B)", async () => {
    const bridge = installBridge({
      run: vi.fn(async () => ({ status: "accepted", checks: { clone_ok: true, character_ok: true }, reasons: [] })),
    });
    const result = await runImageWorkflowNodeGeneration(makeGraph(false), "gen-1", { operationId: "t", addMaterial: vi.fn(() => `mat-${Date.now()}`) } as never);
    expect(bridge?.run).toHaveBeenCalledTimes(1);
    expect(result.imageUrl).toContain("project-file://");
  });

  it("③ character_ok=false → 拦截,抛「人物一致性未过」", async () => {
    installBridge({
      run: vi.fn(async () => ({
        status: "rejected",
        checks: { character_ok: false },
        reasons: ["脸型与参考不一致"],
      })),
    });
    await expect(
      runImageWorkflowNodeGeneration(makeGraph(true), "gen-1", { operationId: "t", addMaterial: vi.fn(() => `mat-${Date.now()}`) } as never),
    ).rejects.toThrow(/人物一致性未过.*脸型与参考不一致/);
  });

  it("④ VLM 审核 runtime 异常 → 放行(fail-open)", async () => {
    installBridge({ run: vi.fn(async () => { throw new Error("mlx crashed"); }) });
    const result = await runImageWorkflowNodeGeneration(makeGraph(true), "gen-1", { operationId: "t", addMaterial: vi.fn(() => `mat-${Date.now()}`) } as never);
    expect(result.imageUrl).toContain("project-file://");
  });

  it("⑤ clone_ok=false → 拦截,抛「画面克隆未过」(十三刀B)", async () => {
    installBridge({
      run: vi.fn(async () => ({
        status: "rejected",
        checks: { character_ok: true, clone_ok: false },
        reasons: ["白发男子出现两份"],
      })),
    });
    await expect(
      runImageWorkflowNodeGeneration(makeGraph(false), "gen-1", { operationId: "t", addMaterial: vi.fn(() => `mat-${Date.now()}`) } as never),
    ).rejects.toThrow(/画面克隆未过.*白发男子出现两份/);
  });
});
