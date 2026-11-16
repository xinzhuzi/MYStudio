import { describe, expect, it } from "vitest";
import { createAssetImageWorkflowGraph } from "@/lib/studio/image-workflow";
import {
  resetExtendedManualContentCache,
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
  migrateStoryboardPromptToCanonical,
  nextNodePosition,
  resolveActionGeneratedNode,
  resolveGenerationTargetNodeId,
  splitImageMaterialsByOrigin,
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

describe("storyboard canonical line build (1116 换线正典)", () => {
  const storyboardContext = {
    target: { kind: "storyboard" as const, id: "sb-chapter-001-001" },
    title: "分镜 1",
    prompt: "船桩压住前景，铁链横穿石板。",
  };

  it("canonicalSubject 在场 → prompt 节点=体裁化主体句,负面不预填,盖 canonicalLine 戳", () => {
    const graph = createOpenImageWorkflowGraph(
      { ...storyboardContext, canonicalSubject: "青年刀修晏燎，玄色劲装束袖束腰；拖链前行，回头看向老苦力，灵矿坑道葬玉，夜，压抑。" },
      "道劫",
    );
    const promptNode = graph.nodes.find((node) => node.type === "prompt")!;
    expect(promptNode.prompt).toContain("青年刀修晏燎，玄色劲装束袖束腰");
    expect(promptNode.prompt).toContain("灵矿坑道葬玉");
    // App 层装配退役:无手册风格 token/无【画面】【构图】段/负面零预填
    expect(promptNode.prompt).not.toContain("【画面】");
    expect(promptNode.prompt).not.toContain("【构图】");
    expect(promptNode.negativePrompt).toBeUndefined();
    expect(graph.assemblyTrace).toMatchObject({ canonicalLine: true });
  });

  it("canonicalSubject 缺席 → 回落裸描述(fail-safe),非分镜目标零变化", async () => {
    await warmExtendedManualStyleTokens(
      "<!-- storyboard-image-style-tokens:start -->\n水墨国风\n<!-- storyboard-image-style-tokens:end -->\n",
    );
    {
      const previous = useStudioStore.getState().workflowConfig;
      useStudioStore.setState({ workflowConfig: { ...previous, visualManualId: "daojie_ink_guofeng" } });
      try {
        const graph = createOpenImageWorkflowGraph(storyboardContext, "道劫");
        const promptNode = graph.nodes.find((node) => node.type === "prompt")!;
        // 换线后手册风格锁不再拼入(风格语义由引擎底座承担)
        expect(promptNode.prompt).toBe("船桩压住前景，铁链横穿石板。");
        expect(promptNode.prompt).not.toContain("水墨国风");
        expect(promptNode.negativePrompt).toBeUndefined();
      } finally {
        useStudioStore.setState({ workflowConfig: previous });
        resetExtendedManualContentCache();
        await warmExtendedManualStyleTokens("");
      }
    }
    const assetGraph = createOpenImageWorkflowGraph(context, "道劫");
    const assetPrompt = assetGraph.nodes.find((node) => node.type === "prompt")!;
    expect(assetPrompt.prompt).toBe("水墨国风角色设定");
    expect(assetPrompt.negativePrompt).toBeUndefined();
  });

  it("资产参考照常挂载(挂载序=continuityOrder 源,槽位映射归传输层)", () => {
    const graph = createOpenImageWorkflowGraph(
      {
        ...storyboardContext,
        canonicalSubject: "皮鞭劈落，剑光交击，矿奴奔逃。",
        assetReferences: [
          { imageUrl: "project-file://dao/scenes/dock.png", title: "金水河码头", assetType: "scene", assetId: "scene-1" },
          { imageUrl: "project-file://dao/roles/zhao.png", title: "监工赵四", assetType: "character", assetId: "role-1" },
        ],
      },
      "道劫",
    );
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
    expect(graph.assemblyTrace).toMatchObject({
      canonicalLine: true,
      assetReferenceTitles: ["金水河码头", "监工赵四"],
    });
  });

  it("migrateStoryboardPromptToCanonical:旧代流改写+盖戳+帧时刻后缀保留,幂等", () => {
    const base = {
      id: "wf-m", name: "m", target: { kind: "storyboard" as const, id: "sb-1" },
      nodes: [
        { id: "p1", type: "prompt" as const, prompt: "@图1 为金水码头场景\n【画面】旧装配体\n\n【本帧时刻·第2/3帧·约6s】晏燎拖链前行" },
        { id: "g1", type: "generated" as const },
      ],
      edges: [],
      createdAt: 0, updatedAt: 0,
    } as never as Parameters<typeof migrateStoryboardPromptToCanonical>[0];
    const canonical = "青年刀修晏燎，玄色劲装束袖束腰；拖链前行。";
    const migrated = migrateStoryboardPromptToCanonical(base, canonical);
    const prompt = (migrated.nodes[0] as { prompt: string }).prompt;
    expect(prompt).toContain(canonical);
    expect(prompt).not.toContain("【画面】旧装配体");
    expect(prompt).toContain("【本帧时刻·第2/3帧·约6s】晏燎拖链前行");
    expect(migrated.assemblyTrace?.canonicalLine).toBe(true);
    // 幂等:再迁移零改动
    expect(migrateStoryboardPromptToCanonical(migrated, canonical)).toBe(migrated);
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
    // 1115 第六病理修:角色/道具绑定句挂单出现守卫(整卡多副本+烧字防线);
    // 场景参考合法横幅不挂守卫
    expect(promptOf(ensured)).toContain(
      "@图2 为监工赵四角色（参考图仅示身份与服装，该角色在画面中仅出现一次；不重现参考图的版式、多视角、背景与任何文字标注）");
    expect(promptOf(ensured)).toContain(
      "@图3 为青盐鞭道具（参考图仅示身份与服装，该道具在画面中仅出现一次；不重现参考图的版式、多视角、背景与任何文字标注）");
    expect(promptOf(ensured)).not.toContain("@图1 为金水河码头场景（");
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
