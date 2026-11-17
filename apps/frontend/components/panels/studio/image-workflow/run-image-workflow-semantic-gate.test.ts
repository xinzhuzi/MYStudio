// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 出口语义门(1117 十三刀A)行为锁:S12/S4/S9/S16 实录病灶机器化——
 * ①override 与生成器同门(十刀时代门在 else 分支,人工覆盖整门绕过);
 * ②衍生移动弧「{名}，(动)…至…」无「正在」字样,并入动作句计数;
 * ③单动作句/衣着从句不误拦(十一刀 13 镜误拦教训)。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyMock = any;

function installBridge(): { probe: AnyMock; run: AnyMock } {
  const full = {
    probe: vi.fn(async () => ({ status: "ready" })),
    run: vi.fn(async () => ({ status: "accepted", checks: { character_ok: true, clone_ok: true }, reasons: [] })),
  };
  (window as unknown as { vlmReview?: unknown }).vlmReview = full;
  return full;
}

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
// 行对象必须跨 getState 稳定(工厂每次 getState 不能新建,override 注入才存活)。
const { storyboardRow } = vi.hoisted(() => ({
  storyboardRow: {
    id: "sb-1", videoDesc: "正文", prompt: "正文",
    shotSemantics: { visibleCharacters: [{ name: "独孤剑尘" }] },
  },
}));
vi.mock("@/stores/studio/studio-store", () => ({
  useStudioStore: {
    getState: () => ({
      upsertImageWorkflow: vi.fn(), imageWorkflows: [],
      storyboards: [storyboardRow],
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
    referenceImages: [],
    orderedReferenceManifest: [],
    continuityRequired: false,
    previousApprovedFrameIncluded: false,
  })),
  collapseTransparentNodes: vi.fn((graph: unknown) => graph),
  setGeneratedImageResult: vi.fn(),
}));
vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { generateImage: vi.fn(async () => ({ imageUrl: "data:image/png;base64,x" })) },
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
import { buildStoryboardCanonicalTransportInput } from "./storyboard-canonical-context";
import type { ImageWorkflowGraph } from "@/types/studio";

const ARCS12_SNIPPET =
  "独孤剑尘正在起身离排缓步向后；独孤剑尘，起身离排缓步向后至停驻第四排末，回眸凝望角落";

function makeGraph(): ImageWorkflowGraph {
  return {
    id: "wf-1",
    name: "测试流",
    target: { kind: "storyboard", id: "sb-1" },
    nodes: [{
      id: "gen-1", type: "generated", title: "成图", prompt: "正文",
      aspectRatio: "16:9", position: { x: 0, y: 0 }, status: "idle", createdAt: 0, updatedAt: 0,
    } as ImageWorkflowGraph["nodes"][number]],
    edges: [],
    createdAt: 0,
    updatedAt: 0,
  } as unknown as ImageWorkflowGraph;
}

const runInput = { operationId: "t", addMaterial: vi.fn(() => `mat-${Date.now()}`) } as never;

function setStoryboardRow(patch: Record<string, unknown>): void {
  Object.assign(storyboardRow, patch);
}

afterEach(() => {
  delete (window as unknown as { vlmReview?: unknown }).vlmReview;
  vi.mocked(buildStoryboardCanonicalTransportInput).mockReset();
  vi.mocked(buildStoryboardCanonicalTransportInput).mockImplementation(async () => ({
    instruction: { genre: "t2i" as const, prompt: "体裁化主体句。", slots: [] },
    mapping: { slots: [], dropped: [] },
  }) as never);
  vi.restoreAllMocks();
});

describe("出口语义门(十三刀A:override 同门+弧式第二动作句)", () => {
  it("① override 双动作(正在+衍生弧) → 拒发 action-split(S12 实录形态)", async () => {
    installBridge();
    setStoryboardRow({ promptOverride: ARCS12_SNIPPET });
    await expect(
      runImageWorkflowNodeGeneration(makeGraph(), "gen-1", runInput),
    ).rejects.toThrow(/语义门.*action-split:独孤剑尘×2/);
  });

  it("② 生成器双动作(正在+衍生弧) → 同样拒发(弧式并入计数)", async () => {
    installBridge();
    vi.mocked(buildStoryboardCanonicalTransportInput).mockImplementation(async () => ({
      instruction: { genre: "t2i" as const, prompt: ARCS12_SNIPPET, slots: [] },
      mapping: { slots: [], dropped: [] },
    }) as never);
    await expect(
      runImageWorkflowNodeGeneration(makeGraph(), "gen-1", runInput),
    ).rejects.toThrow(/语义门.*action-split:独孤剑尘×2/);
  });

  it("③ override 单动作句+衣着从句 → 过门不误拦(十一刀教训)", async () => {
    installBridge();
    setStoryboardRow({
      promptOverride: "独孤剑尘，身着一袭洗到发白的灰色剑袍；独孤剑尘正在起身离排缓步向后",
    });
    const result = await runImageWorkflowNodeGeneration(makeGraph(), "gen-1", runInput);
    expect(result.imageUrl).toContain("project-file://");
  });

  it("④ override 多姿势明示(两种持法) → 拒发 multi-posture", async () => {
    installBridge();
    setStoryboardRow({ promptOverride: "蛇皮鞭两种持法(搭肩/绕肩)，各画一遍" });
    await expect(
      runImageWorkflowNodeGeneration(makeGraph(), "gen-1", runInput),
    ).rejects.toThrow(/语义门.*multi-posture/);
  });
});
