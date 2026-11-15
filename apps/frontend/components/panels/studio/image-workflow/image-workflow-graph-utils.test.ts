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
  ensureStoryboardAssetReferences,
  findLinkedPromptNodeForGenerated,
  focusNodeIdsForGenerated,
  imageWorkflowTargetKey,
  matchesStoryboardOpenContext,
  nextNodePosition,
  resolveActionGeneratedNode,
  resolveGenerationTargetNodeId,
  splitImageMaterialsByOrigin,
  healStoryboardPromptForCast,
  stripStoryboardPromptStyleWords,
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
    expect(nextNodePosition(graph, "generated").x).toBe(760);
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

describe("ensureStoryboardAssetReferences (L3 资产维度+集差/替换, 11-15)", () => {
  const refs = [
    { imageUrl: "file:///assets/dock.png", title: "金水河码头", assetType: "scene" as const, assetId: "scene-1" },
    { imageUrl: "file:///assets/zhao.png", title: "监工赵四", assetType: "character" as const, assetId: "role-1" },
    { imageUrl: "file:///assets/whip.png", title: "青盐鞭", assetType: "prop" as const, assetId: "tool-1" },
  ];
  /** 图内仅杂参考(当前分镜参考图=storyboard 源)零资产参考——旧门下永久粘死的形态 */
  function makeGraph() {
    return {
      id: "wf-l3", name: "L3", target: { kind: "storyboard", id: "sb-1" },
      nodes: [
        {
          id: "src-ref", type: "reference", title: "当前分镜参考图",
          imageUrl: "project-file://demo/old.png",
          source: { kind: "storyboard", id: "sb-1" }, position: { x: 80, y: 40 },
        },
        { id: "p1", type: "prompt", prompt: "【画面】赵四扬鞭", position: { x: 80, y: 520 } },
        { id: "g1", type: "generated", title: "分镜 1 成图", position: { x: 760, y: 40 } },
      ],
      edges: [{ id: "src-ref->g1", source: "src-ref", target: "g1" }],
    } as never;
  }
  const assetRefNodes = (graph: ReturnType<typeof ensureStoryboardAssetReferences>) =>
    graph.nodes.filter(
      (node): node is Extract<typeof node, { type: "reference" }> =>
        node.type === "reference" && node.source?.kind === "asset",
    );
  const promptOf = (graph: ReturnType<typeof ensureStoryboardAssetReferences>) =>
    graph.nodes.find((node) => node.type === "prompt")?.prompt ?? "";

  it("① 图内仅杂参考零资产参考 → 补挂触发(旧「任一 reference 即返回」门已退役)", () => {
    const graph = makeGraph();
    const ensured = ensureStoryboardAssetReferences(graph, refs);
    expect(ensured).not.toBe(graph);
    const assetRefs = assetRefNodes(ensured);
    expect(assetRefs.map((node) => node.title)).toEqual(["金水河码头", "监工赵四", "青盐鞭"]);
    expect(assetRefs.map((node) => node.continuityOrder)).toEqual([1, 2, 3]);
    // 杂参考恒保留,其既有连线不丢
    const srcRef = ensured.nodes.find((node) => node.id === "src-ref");
    expect(srcRef?.type).toBe("reference");
    expect(ensured.edges.some((edge) => edge.source === "src-ref" && edge.target === "g1")).toBe(true);
    // 新资产参考全部连向成图
    for (const node of assetRefs) {
      expect(ensured.edges.some((edge) => edge.source === node.id && edge.target === "g1")).toBe(true);
    }
    // @图N 头段随最终参考序重写(装配门禁联动)
    expect(promptOf(ensured)).toContain("@图1 为金水河码头场景");
    expect(promptOf(ensured)).toContain("@图2 为监工赵四角色");
    expect(promptOf(ensured)).toContain("@图3 为青盐鞭道具");
  });

  it("② 图内资产参考集≠现镜解析集 → 替换对齐(旧资产参考清出、杂参考保留)", () => {
    const base = ensureStoryboardAssetReferences(makeGraph(), [refs[0]]);
    const oldRef = base.nodes.find((node) => node.title === "金水河码头");
    expect(oldRef?.type).toBe("reference");
    const nextRefs = [
      { imageUrl: "file:///assets/dock2.png", title: "金水河码头·新代", assetType: "scene" as const, assetId: "scene-2" },
      refs[1]!, refs[2]!,
    ];
    const ensured = ensureStoryboardAssetReferences(base, nextRefs);
    expect(assetRefNodes(ensured).map((node) => node.title)).toEqual(["金水河码头·新代", "监工赵四", "青盐鞭"]);
    // 旧资产参考节点及其边确实清出
    expect(ensured.nodes.some((node) => node.id === oldRef!.id)).toBe(false);
    expect(ensured.edges.some((edge) => edge.source === oldRef!.id)).toBe(false);
    // 杂参考保留
    expect(ensured.nodes.some((node) => node.id === "src-ref")).toBe(true);
    // 头段按新集重写,旧头段不复存
    expect(promptOf(ensured)).toContain("@图1 为金水河码头·新代场景");
    expect(promptOf(ensured)).not.toContain("金水河码头场景；");
  });

  it("③ 资产参考齐备一致 → 幂等原样返回", () => {
    const first = ensureStoryboardAssetReferences(makeGraph(), refs);
    expect(ensureStoryboardAssetReferences(first, refs)).toBe(first);
  });
});

describe("healStoryboardPromptForCast (R18 存量自愈)", () => {
  const OLD_PROMPT = "@图1 为金水塾馆场景\n【构图】适用：谈判。要点：只有角色 A 与 B；画幅 16:9 双人中景。\n【画面】三人同框";
  function makeGraph(prompt: string) {
    return {
      id: "wf-1", name: "t", target: { kind: "storyboard", id: "sb-1" }, nodes: [
        { id: "p1", type: "prompt", prompt },
        { id: "g1", type: "generated" },
      ], edges: [],
    } as never;
  }
  it("老流双人约束按 3 人改写", () => {
    const healed = healStoryboardPromptForCast(makeGraph(OLD_PROMPT), ["独孤剑尘", "女孩", "男孩"]);
    const p = (healed.nodes[0] as { prompt: string }).prompt;
    expect(p).toContain("共3名角色同框");
    expect(p).not.toContain("只有角色 A 与 B");
  });
  it("n=2/缺省/已治愈:幂等原样返回", () => {
    const g = makeGraph(OLD_PROMPT);
    expect(healStoryboardPromptForCast(g, ["甲", "乙"])).toBe(g);
    expect(healStoryboardPromptForCast(g)).toBe(g);
    const healed = healStoryboardPromptForCast(g, ["独孤剑尘", "女孩", "男孩"]);
    expect(healStoryboardPromptForCast(healed, ["独孤剑尘", "女孩", "男孩"])).toBe(healed);
  });
});

describe("storyboard graph-level style-word strip (1115 A 裁补·复用镜实证)", () => {
  const ctx = {
    target: { kind: "storyboard" as const, id: "sb-chapter-001-008" },
    title: "分镜 8",
    prompt: "独孤剑尘随人流行进、视线平直不停步。",
    storyboardSourceFingerprint: "fp-s08",
  };

  it("图内存量 prompt 节点带工笔样板文 → 剥净;干净图幂等不动", () => {
    const raw = createOpenImageWorkflowGraph(ctx, "道劫");
    // 模拟复用流:图内 prompt 节点携带未剥样板文(首轮 11:41 绑定形态)
    const dirty = {
      ...raw,
      nodes: raw.nodes.map((node) =>
        node.type === "prompt" && node.prompt
          ? {
              ...node,
              prompt: `${node.prompt}\n【构图】行进途中擦肩而过;背景具体道具(灯/卷轴/门框/雨帘);工笔线描照亮脸和手。画幅 16:9 双人中景。`,
            }
          : node,
      ),
    };
    const stripped = stripStoryboardPromptStyleWords(dirty);
    expect(stripped).not.toBe(dirty);
    for (const node of stripped.nodes) {
      if (node.type === "prompt" && node.prompt) {
        for (const word of ["工笔", "白描", "连环画", "厚涂", "赛璐璐", "photorealistic"]) {
          expect(node.prompt.includes(word), `残留画风词 ${word}`).toBe(false);
        }
        expect(node.prompt).toContain("照亮脸和手");
      }
    }
    // 幂等:再剥不动
    expect(stripStoryboardPromptStyleWords(stripped)).toBe(stripped);
    // 非分镜图零触碰
    const assetGraph = createAssetImageWorkflowGraph(context, "道劫");
    expect(stripStoryboardPromptStyleWords(assetGraph)).toBe(assetGraph);
  });
});
