import { describe, expect, it } from "vitest";
import { createAssetImageWorkflowGraph } from "@/lib/studio/image-workflow";
import {
  resetExtendedManualContentCache,
  warmExtendedManualFactionData,
  warmExtendedManualStyleTokens,
} from "@/lib/studio/visual-manual-style-tokens";
import { useStudioStore } from "@/stores/studio/studio-store";
import {
  assetWorkflowContextKey,
  createOpenImageWorkflowGraph,
  findLinkedPromptNodeForGenerated,
  focusNodeIdsForGenerated,
  imageWorkflowTargetKey,
  matchesStoryboardOpenContext,
  nextNodePosition,
  resolveActionGeneratedNode,
  resolveGenerationTargetNodeId,
  splitImageMaterialsByOrigin,
} from "./image-workflow-graph-utils";

const context = {
  target: {
    kind: "asset" as const,
    assetType: "character" as const,
    parentId: "character-parent",
    id: "character-derived",
  },
  title: "灰衫入镇态",
  prompt: "水墨国风角色设定",
  sourceImagePath: "project-file://demo/source.png",
  resultImagePath: "project-file://demo/result.png",
  imageWorkflowId: "workflow-derived",
};

describe("image workflow graph utils", () => {
  it("resolves prompt and preferred generated targets without changing graph data", () => {
    const graph = createAssetImageWorkflowGraph(context, "道劫");
    const prompt = graph.nodes.find((node) => node.type === "prompt")!;
    const generated = graph.nodes.find((node) => node.type === "generated")!;

    expect(resolveGenerationTargetNodeId(graph, prompt.id)).toBe(generated.id);
    expect(resolveActionGeneratedNode(graph, prompt.id, null)?.id).toBe(generated.id);
    expect(findLinkedPromptNodeForGenerated(graph, generated.id)?.id).toBe(prompt.id);
    expect(focusNodeIdsForGenerated(graph, generated.id)).toContain(generated.id);
  });

  it("keeps target identity and placement deterministic", () => {
    const graph = createAssetImageWorkflowGraph(context, "道劫");

    expect(imageWorkflowTargetKey(context.target)).toBe(
      "asset:character:character-parent:character-derived",
    );
    expect(assetWorkflowContextKey(context)).toBe(
      "workflow-derived|asset:character:character-parent:character-derived",
    );
    expect(nextNodePosition(graph, "reference").x).toBe(80);
    expect(nextNodePosition(graph, "generated").x).toBe(620);
  });
});

describe("storyboard open-context fingerprint matching", () => {
  const storyboardContext = {
    target: { kind: "storyboard" as const, id: "sb-chapter-001-006" },
    title: "分镜 6",
    prompt: "镜头贴近独孤剑尘右手。",
    storyboardSourceFingerprint: "fp-new-table",
  };

  it("reuses a workflow whose stamp matches the current storyboard fingerprint", () => {
    const graph = createOpenImageWorkflowGraph(storyboardContext, "道劫");
    expect(graph.targetSourceFingerprint).toBe("fp-new-table");
    expect(matchesStoryboardOpenContext(graph, storyboardContext)).toBe(true);
  });

  it("skips same-id workflows from a replaced storyboard generation (no or stale stamp)", () => {
    const staleGraph = {
      ...createOpenImageWorkflowGraph(
        { ...storyboardContext, storyboardSourceFingerprint: undefined },
        "道劫",
      ),
      targetSourceFingerprint: undefined,
    };
    expect(matchesStoryboardOpenContext(staleGraph, storyboardContext)).toBe(false);
    const driftedGraph = {
      ...staleGraph,
      targetSourceFingerprint: "fp-old-43-shot-table",
    };
    expect(matchesStoryboardOpenContext(driftedGraph, storyboardContext)).toBe(false);
  });

  it("falls back to pure target matching when the context carries no fingerprint", () => {
    const graph = createOpenImageWorkflowGraph(
      { ...storyboardContext, storyboardSourceFingerprint: undefined },
      "道劫",
    );
    expect(graph.targetSourceFingerprint).toBeUndefined();
    // 上下文带指纹而图无戳 → 视为上一代遗留,不复用
    expect(matchesStoryboardOpenContext(graph, storyboardContext)).toBe(false);
    // 上下文不带指纹(同目标) → 退化为纯目标匹配,复用
    expect(
      matchesStoryboardOpenContext(graph, {
        target: { kind: "storyboard", id: "sb-chapter-001-006" },
        title: "分镜 6",
      }),
    ).toBe(true);
    // 目标不同 → 恒不复用
    expect(
      matchesStoryboardOpenContext(graph, {
        target: { kind: "storyboard", id: "sb-chapter-001-007" },
        title: "分镜 7",
      }),
    ).toBe(false);
  });
});

describe("storyboard workflow style-token prefill", () => {
  const storyboardContext = {
    target: { kind: "storyboard" as const, id: "sb-chapter-001-001" },
    title: "分镜 1",
    prompt: "船桩压住前景，铁链横穿石板。",
  };

  it("prefills storyboard prompts with the active visual manual style tokens (visible = sent)", async () => {
    await warmExtendedManualStyleTokens(
      "<!-- storyboard-image-style-tokens:start -->\n水墨国风\n毛笔皴擦\n<!-- storyboard-image-style-tokens:end -->\n",
    );
    const previous = useStudioStore.getState().workflowConfig;
    useStudioStore.setState({ workflowConfig: { ...previous, visualManualId: "daojie_ink_guofeng" } });
    try {
      const graph = createOpenImageWorkflowGraph(storyboardContext, "道劫");
      const promptNode = graph.nodes.find((node) => node.type === "prompt")!;
      expect(promptNode.prompt).toContain("船桩压住前景");
      expect(promptNode.prompt).toContain("水墨国风");
      expect(promptNode.prompt).toContain("毛笔皴擦");
    } finally {
      useStudioStore.setState({ workflowConfig: previous });
      resetExtendedManualContentCache();
      await warmExtendedManualStyleTokens("");
    }
  });

  it("keeps non-storyboard and unstyled-manual prompts untouched", async () => {
    await warmExtendedManualStyleTokens("");
    const assetGraph = createOpenImageWorkflowGraph(context, "道劫");
    const assetPrompt = assetGraph.nodes.find((node) => node.type === "prompt")!;
    expect(assetPrompt.prompt).toBe("水墨国风角色设定");
    expect(assetPrompt.negativePrompt).toBeUndefined();

    const previous = useStudioStore.getState().workflowConfig;
    useStudioStore.setState({ workflowConfig: { ...previous, visualManualId: undefined } });
    try {
      const graph = createOpenImageWorkflowGraph(storyboardContext, "道劫");
      const promptNode = graph.nodes.find((node) => node.type === "prompt")!;
      expect(promptNode.prompt).toBe("船桩压住前景，铁链横穿石板。");
    } finally {
      useStudioStore.setState({ workflowConfig: previous });
    }
  });

  it("assembles structured frame prompts with negative prefill and asset references", async () => {
    await warmExtendedManualStyleTokens([
      "<!-- storyboard-image-style-tokens:start -->",
      "Chinese ink wash painting style",
      "<!-- storyboard-image-style-tokens:end -->",
      "<!-- storyboard-frame-negative:start -->",
      "photorealistic photography, paper-wrinkle texture, watermark",
      "<!-- storyboard-frame-negative:end -->",
      "## 成片模板速查",
      "### 21. 水墨战斗瞬间",
      "适用：动作图、技能击中。要点：劈斩动作方向明确；画幅 16:9 动态中景。",
      "### 07. 国风漫剧电影帧",
      "适用：通用剧情帧。要点：主体明确；画幅 16:9。",
    ].join("\n"));
    const previous = useStudioStore.getState().workflowConfig;
    useStudioStore.setState({ workflowConfig: { ...previous, visualManualId: "daojie_ink_guofeng" } });
    try {
      await warmExtendedManualFactionData([
        "<!-- storyboard-faction-members:start -->",
        '{"监工赵四":"人族","金水河码头":"人族"}',
        "<!-- storyboard-faction-members:end -->",
        "<!-- storyboard-faction-palette:start -->",
        '{"人族":{"person":"底色米白+主色赭石+点睛朱红","scene":"底色米白+主色赭石+点睛藤黄"}}',
        "<!-- storyboard-faction-palette:end -->",
      ].join("\n"));
      const graph = createOpenImageWorkflowGraph(
        {
          ...storyboardContext,
          prompt: "皮鞭劈落，剑光交击，矿奴奔逃。",
          storyboardLines: "赵四：都给我快些！",
          assetReferences: [
            { imageUrl: "project-file://dao/scenes/dock.png", title: "金水河码头", assetType: "scene", assetId: "scene-1" },
            { imageUrl: "project-file://dao/roles/zhao.png", title: "监工赵四", assetType: "character", assetId: "role-1" },
          ],
        },
        "道劫",
      );
      const promptNode = graph.nodes.find((node) => node.type === "prompt")!;
      expect(promptNode.prompt).toContain("【画面】皮鞭劈落");
      expect(promptNode.prompt).toContain("【构图】适用：动作图");
      expect(promptNode.prompt).toContain("【色彩】阵营色彩职责");
      expect(promptNode.prompt).toContain("(人族·人物)底色米白+主色赭石+点睛朱红");
      expect(promptNode.prompt).toContain("(人族·场景)底色米白+主色赭石+点睛藤黄");
      expect(promptNode.prompt).toContain("Chinese ink wash painting style");
      expect(promptNode.negativePrompt).toContain("photorealistic photography");
      expect(promptNode.negativePrompt).toContain("watermark");
      expect(graph.assemblyTrace).toMatchObject({
        manualId: "daojie_ink_guofeng",
        templateId: "21",
        factions: ["人族"],
        negativeApplied: true,
        styleTokenCount: 1,
        assetReferenceTitles: ["金水河码头", "监工赵四"],
      });

      const assetRefs = graph.nodes.filter(
        (node): node is Extract<typeof node, { type: "reference" }> =>
          node.type === "reference"
          && (node.title === "金水河码头" || node.title === "监工赵四"),
      );
      expect(assetRefs).toHaveLength(2);
      expect(assetRefs.map((node) => node.continuityOrder)).toEqual([1, 2]);
      const generated = graph.nodes.find((node) => node.type === "generated")!;
      expect(graph.edges.some((edge) => edge.source === assetRefs[0]!.id && edge.target === generated.id)).toBe(true);
      expect(graph.edges.some((edge) => edge.source === assetRefs[1]!.id && edge.target === generated.id)).toBe(true);
    } finally {
      useStudioStore.setState({ workflowConfig: previous });
      resetExtendedManualContentCache();
      await warmExtendedManualStyleTokens("");
    }
  });
});

describe("splitImageMaterialsByOrigin", () => {
  it("splits palette materials into asset references vs workflow outputs by filename prefix", () => {
    const material = (id: string, localPath: string) =>
      ({ id, name: id, kind: "image", localPath, sourceName: id, size: 1, importedAt: 1 }) as never;
    const { assetReferences, workflowOutputs } = splitImageMaterialsByOrigin([
      material("m1", "project-file://x/assets/ref-abc-1.png"),
      material("m2", "/p/workflow-images/chapter-001/wf1/gen-abc-2.png"),
      material("m3", "/p/workflow-images/chapter-001/wf1/up4x-abc-3.png"),
      material("m4", "uploads/character-sheet.png"),
    ]);
    expect(assetReferences.map((item) => item.id)).toEqual(["m1", "m4"]);
    expect(workflowOutputs.map((item) => item.id)).toEqual(["m2", "m3"]);
  });
});
