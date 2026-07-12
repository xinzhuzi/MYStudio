// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProductionFlowNode,
  type ProductionNodeData,
} from "./WorkflowProductionNode";
import {
  AssetDerivationPreview,
  AssetFlowCard,
  StoryboardGridPreview,
  StoryboardTablePreview,
  buildPreviewMarkdown,
} from "./WorkflowNodePreviews";
import type {
  ProductionFlowAssetCard,
  ProductionFlowNodeModel,
} from "./workflow-node-model";

afterEach(cleanup);

function readLocalSource(filename: string) {
  return readFileSync(
    resolve(process.cwd(), "frontend/components/panels/studio", filename),
    "utf8",
  );
}

describe("workflow node component boundaries", () => {
  it("keeps node shell and preview renderers outside the canvas module", () => {
    const canvasSource = readLocalSource("WorkflowNodeCanvas.tsx");
    const productionNodeSource = readLocalSource("WorkflowProductionNode.tsx");
    const previewsSource = readLocalSource("WorkflowNodePreviews.tsx");

    expect(canvasSource).toContain("import { ProductionFlowNode }");
    expect(canvasSource).not.toContain("function ProductionFlowNode");
    expect(canvasSource).not.toContain("function NodeSkillDisclosure");
    expect(canvasSource).not.toContain("function TextPreview");
    expect(canvasSource).not.toContain("function AssetDerivationPreview");
    expect(canvasSource).not.toContain("function StoryboardTablePreview");
    expect(canvasSource).not.toContain("function StoryboardGridPreview");

    expect(productionNodeSource).toContain("export function ProductionFlowNode");
    expect(productionNodeSource).toContain("function NodeSkillDisclosure");
    expect(productionNodeSource).toContain("data-flow-node-id={data.node.id}");
    expect(productionNodeSource).toContain("data.onStageChange(data.node.targetStage)");
    expect(productionNodeSource).toContain("data.onNodeAction?.({");

    expect(previewsSource).toContain("export function TextPreview");
    expect(previewsSource).toContain("export function AssetDerivationPreview");
    expect(previewsSource).toContain("export function StoryboardTablePreview");
    expect(previewsSource).toContain("export function StoryboardGridPreview");
    expect(previewsSource).toContain("export function WorkbenchLanePreview");
    expect(previewsSource).toContain("export function toPreviewSrc");
  });

  it("renders text node previews with the same markdown preview surface as the script stage", () => {
    const previewsSource = readLocalSource("WorkflowNodePreviews.tsx");

    expect(previewsSource).toContain('import { MdPreview } from "md-editor-rt"');
    expect(previewsSource).toContain("modelValue={buildPreviewMarkdown(node)}");
    expect(previewsSource).toContain("useThemeStore");
    expect(previewsSource).toContain("theme={theme}");
    expect(previewsSource).toContain("md-editor-preview-transparent");
    expect(previewsSource).toContain("rounded-md px-3 py-2");
    expect(previewsSource).toContain("function buildPreviewMarkdown");
    expect(previewsSource).not.toContain("border border-border bg-muted/25");
    expect(previewsSource).not.toContain('theme="dark"');
    expect(previewsSource).not.toContain("node.previewLines.map((line, index)");
  });

  it("keeps script, director plan, and storyboard table previews free of nested frames", () => {
    const productionNodeSource = readLocalSource("WorkflowProductionNode.tsx");
    const previewsSource = readLocalSource("WorkflowNodePreviews.tsx");

    expect(productionNodeSource).toContain("const UNFRAMED_PREVIEW_NODE_IDS");
    expect(productionNodeSource).toContain('"script",');
    expect(productionNodeSource).toContain('"scriptPlan",');
    expect(productionNodeSource).toContain('"storyboardTable",');
    expect(previewsSource).toContain(
      'node.id === "scriptPlan" &&\n          "py-3',
    );
    expect(previewsSource).toContain(
      "nodrag nowheel max-h-[430px] overflow-auto overscroll-contain rounded-md bg-muted/10",
    );
    expect(previewsSource).not.toContain("rounded border border-border bg-card");
    expect(previewsSource).not.toContain("border border-border bg-muted/25");
  });

  it("unwraps Toonflow scriptPlan tags before markdown preview rendering", () => {
    const markdown = buildPreviewMarkdown({
      id: "scriptPlan",
      label: "导演规划",
      description: "",
      status: "ready",
      metrics: [],
      previewTitle: "导演规划",
      previewLines: [
        "<scriptPlan>",
        "### 场次规划",
        "| 场 | 说明 |",
        "|---|---|",
        "| Sc1 | 雨夜压迫 |",
        "</scriptPlan>",
      ],
      targetStage: "storyboard",
    });

    expect(markdown).toContain("### 场次规划");
    expect(markdown).toContain("| Sc1 | 雨夜压迫 |");
    expect(markdown).not.toContain("<scriptPlan>");
    expect(markdown).not.toContain("</scriptPlan>");
  });

  it("keeps production workflow chrome tied to theme tokens", () => {
    const productionNodeSource = readLocalSource("WorkflowProductionNode.tsx");
    const canvasSource = readLocalSource("WorkflowNodeCanvas.tsx");

    expect(productionNodeSource).toContain("bg-card/95");
    expect(productionNodeSource).toContain("text-card-foreground");
    expect(productionNodeSource).toContain("border-border");
    expect(productionNodeSource).toContain("bg-muted/20");
    expect(productionNodeSource).not.toContain("border-white/");
    expect(productionNodeSource).not.toContain("bg-black/");
    expect(productionNodeSource).not.toContain("bg-white/[");
    expect(productionNodeSource).not.toContain("text-zinc-");
    expect(canvasSource).toContain('const PRODUCTION_EDGE_COLOR = "hsl(var(--primary))"');
    expect(canvasSource).toContain("markerEnd: { type: MarkerType.ArrowClosed, color: PRODUCTION_EDGE_COLOR }");
    expect(canvasSource).toContain("style: { stroke: PRODUCTION_EDGE_COLOR");
    expect(canvasSource).toContain('Background color="hsl(var(--border))"');
    expect(canvasSource).not.toContain('Background color="rgba(255,255,255,0.055)"');
    expect(canvasSource).not.toContain('color: "#0f0f0f"');
    expect(canvasSource).not.toContain('stroke: "#0f0f0f"');
  });

  it("replaces a running node action button with a clear status surface", async () => {
    let resolveAction: (() => void) | undefined;
    const onNodeAction = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const node = {
      id: "scriptPlan",
      label: "导演规划",
      description: "导演规划节点",
      status: "ready",
      metrics: [],
      previewTitle: "导演规划",
      previewLines: ["### 规划"],
      targetStage: "storyboard",
      actions: [
        {
          id: "generate-director-plan",
          label: "生成导演规划",
          targetStage: "storyboard",
          promptPlaceholder: "给导演规划补充要求",
        },
      ],
    } satisfies ProductionFlowNodeModel;
    const props = {
      id: "script-plan-node",
      type: "productionFlow",
      selected: false,
      dragging: false,
      zIndex: 0,
      isConnectable: false,
      xPos: 0,
      yPos: 0,
      data: {
        node,
        onStageChange: vi.fn(),
        onNodeAction,
      } satisfies ProductionNodeData,
    } as unknown as Parameters<typeof ProductionFlowNode>[0];

    render(
      <ReactFlowProvider>
        <ProductionFlowNode {...props} />
      </ReactFlowProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "生成导演规划" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("正在生成中，请稍候"),
    );
    expect(screen.getByText(/生成期间不能重复提交/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "生成导演规划" })).toBeNull();

    resolveAction?.();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "生成导演规划" })).toBeTruthy(),
    );
  });

  it("renders script character count beside the script node title", () => {
    const node = {
      id: "script",
      label: "剧本",
      description: "剧本节点",
      status: "ready",
      metrics: ["3046 字"],
      previewTitle: "剧本内容",
      previewLines: ["正文"],
      targetStage: "script",
    } satisfies ProductionFlowNodeModel;
    const props = {
      id: "script-node",
      type: "productionFlow",
      selected: false,
      dragging: false,
      zIndex: 0,
      isConnectable: false,
      xPos: 0,
      yPos: 0,
      data: {
        node,
        onStageChange: vi.fn(),
      } satisfies ProductionNodeData,
    } as unknown as Parameters<typeof ProductionFlowNode>[0];

    const { container } = render(
      <ReactFlowProvider>
        <ProductionFlowNode {...props} />
      </ReactFlowProvider>,
    );

    expect(container.querySelector(".workflow-node-titlebar")?.textContent).toContain(
      "剧本3046 字",
    );
    expect(screen.getAllByText("3046 字")).toHaveLength(1);
  });

  it("hides director plan and storyboard table count metrics from compact node headers", () => {
    const nodes = [
      {
        id: "scriptPlan",
        label: "导演规划",
        description: "导演规划节点",
        status: "ready",
        metrics: ["1 份规划"],
        previewTitle: "导演规划",
        previewLines: ["### 规划"],
        targetStage: "storyboard",
      },
      {
        id: "storyboardTable",
        label: "分镜表",
        description: "分镜表节点",
        status: "ready",
        metrics: ["1 份分镜表"],
        previewTitle: "分镜表",
        previewLines: ["| 镜头 | 内容 |"],
        targetStage: "storyboard",
      },
    ] satisfies ProductionFlowNodeModel[];

    render(
      <ReactFlowProvider>
        {nodes.map((node) => (
          <ProductionFlowNode
            key={node.id}
            {...({
              id: `${node.id}-node`,
              type: "productionFlow",
              selected: false,
              dragging: false,
              zIndex: 0,
              isConnectable: false,
              xPos: 0,
              yPos: 0,
              data: {
                node,
                onStageChange: vi.fn(),
              } satisfies ProductionNodeData,
            } as unknown as Parameters<typeof ProductionFlowNode>[0])}
          />
        ))}
      </ReactFlowProvider>,
    );

    expect(screen.queryByText("1 份规划")).toBeNull();
    expect(screen.queryByText("1 份分镜表")).toBeNull();
  });

  it("routes video workbench nodes to a structured lane preview instead of compact text", () => {
    const productionNodeSource = readLocalSource("WorkflowProductionNode.tsx");
    const previewsSource = readLocalSource("WorkflowNodePreviews.tsx");

    expect(productionNodeSource).toContain('previewKind === "workbench-lanes"');
    expect(productionNodeSource).toContain("<WorkbenchLanePreview node={data.node} />");
    expect(previewsSource).toContain("workbench-lane-preview");
    expect(previewsSource).toContain("node.workbenchTracks");
    expect(previewsSource).toContain("selectedVideoPath");
    expect(previewsSource).toContain("最终导出");
  });

  it("renders derived asset nodes with Toonflow-style type and keeps technical ids machine-readable", () => {
    const previewsSource = readLocalSource("WorkflowNodePreviews.tsx");

    expect(previewsSource).toContain("asset-derive-summary");
    expect(previewsSource).toContain("导演预划");
    expect(previewsSource).toContain("已有衍生");
    expect(previewsSource).not.toContain("已关联父资产");
    expect(previewsSource).toContain("card.runtimeType");
    expect(previewsSource).toContain("card.generationState");
    expect(previewsSource).toContain("data-parent-asset-id");
    expect(previewsSource).toContain("data-asset-generation-state");
    expect(previewsSource).not.toContain("parentAssetId: {card.parentAssetId}");
    expect(previewsSource).not.toContain("flowId: {card.imageWorkflowId}");
    expect(previewsSource).toContain("生成提示");
    expect(previewsSource).toContain("缺父资产");
  });

  it("renders derived asset summary with separated plan and existing counts", () => {
    const node: ProductionFlowNodeModel = {
      id: "assets",
      label: "衍生资产",
      description: "资产状态图。",
      status: "ready",
      metrics: [],
      previewTitle: "衍生资产",
      previewLines: [],
      previewKind: "asset-derivation",
      targetStage: "assets",
      assetSummary: {
        planned: 0,
        existing: 3,
        linked: 3,
        completed: 3,
        missingParent: 0,
      },
      assetGroups: [
        {
          source: {
            id: "char-1",
            name: "独孤剑尘",
            typeLabel: "角色",
            runtimeType: "role",
            generationState: "已完成",
            isDerived: false,
          },
          derived: [
            {
              id: "char-1-grey",
              name: "灰衫入镇态",
              typeLabel: "角色",
              runtimeType: "role",
              parentAssetId: "char-1",
              generationState: "已完成",
              isDerived: true,
            },
          ],
        },
        {
          source: {
            id: "scene-1",
            name: "悦来客栈",
            typeLabel: "场景",
            runtimeType: "scene",
            generationState: "已完成",
            isDerived: false,
          },
          derived: [
            {
              id: "scene-1-room",
              name: "斗室夜谈态",
              typeLabel: "场景",
              runtimeType: "scene",
              parentAssetId: "scene-1",
              generationState: "已完成",
              isDerived: true,
            },
          ],
        },
        {
          source: {
            id: "prop-1",
            name: "归元断剑",
            typeLabel: "道具",
            runtimeType: "tool",
            generationState: "已完成",
            isDerived: false,
          },
          derived: [
            {
              id: "prop-1-half",
              name: "半截出鞘态",
              typeLabel: "道具",
              runtimeType: "tool",
              parentAssetId: "prop-1",
              generationState: "已完成",
              isDerived: true,
            },
          ],
        },
      ],
    };

    render(<AssetDerivationPreview node={node} />);

    expect(screen.getByText("导演预划")).toBeTruthy();
    expect(screen.getByText("已有衍生")).toBeTruthy();
    expect(screen.getByText("已完成图片")).toBeTruthy();
    expect(screen.queryByText("已关联父资产")).toBeNull();
    expect(screen.getByRole("button", { name: "人物 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "场景 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "道具 1" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "场景 1" }));
    expect(screen.getByText("悦来客栈")).toBeTruthy();
    expect(screen.queryByText("独孤剑尘")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "道具 1" }));
    expect(screen.getByText("归元断剑")).toBeTruthy();
    expect(screen.queryByText("悦来客栈")).toBeNull();
  });

  it("opens real derived asset cards in a Toonflow-style image workflow", () => {
    const previewsSource = readLocalSource("WorkflowNodePreviews.tsx");
    const productionNodeSource = readLocalSource("WorkflowProductionNode.tsx");
    const canvasSource = readLocalSource("WorkflowNodeCanvas.tsx");
    const viewModelSource = readLocalSource("useStudioViewModel.ts");
    const indexSource = readLocalSource("index.tsx");

    expect(previewsSource).toContain("onOpenAssetImageWorkflow");
    expect(previewsSource).toContain("进入图片工作流");
    expect(previewsSource).toContain("card.imageWorkflowTarget");
    expect(previewsSource).toContain("card.sourceImagePath");
    expect(previewsSource).toContain("card.imageWorkflowId");
    expect(previewsSource).toContain("card.mediaPath");
    expect(previewsSource).toContain("data-asset-workflow-image-id");
    expect(previewsSource).toContain("data-storyboard-workflow-image-id");
    expect(productionNodeSource).toContain("onOpenAssetImageWorkflow={data.onOpenAssetImageWorkflow}");
    expect(canvasSource).toContain("onOpenAssetImageWorkflow");
    expect(viewModelSource).toContain("openAssetImageWorkflow");
    expect(viewModelSource).toContain('handleStageChange("imageWorkflow")');
    expect(indexSource).toContain("initialAssetContext={viewModel.assetImageWorkflowContext}");
  });

  it("passes the derived asset image workflow context when the card button is clicked", () => {
    const onOpenAssetImageWorkflow = vi.fn();
    const card: ProductionFlowAssetCard = {
      id: "scene-night",
      name: "夜景版",
      typeLabel: "场景",
      runtimeType: "scene",
      mediaPath: "project-file://daojie/assets/scenes/night.png",
      prompt: "水墨国风义庄夜景",
      parentAssetId: "scene-base",
      reason: "日景转夜景",
      generationState: "已完成",
      isDerived: true,
      sourceImagePath: "project-file://daojie/assets/scenes/base.png",
      imageWorkflowId: "asset-flow-scene-night",
      imageWorkflowTarget: {
        kind: "asset",
        assetType: "scene",
        parentId: "scene-base",
        id: "scene-night",
      },
    };

    render(
      <AssetFlowCard
        card={card}
        onOpenAssetImageWorkflow={onOpenAssetImageWorkflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /进入图片工作流/ }));

    expect(onOpenAssetImageWorkflow).toHaveBeenCalledWith({
      target: {
        kind: "asset",
        assetType: "scene",
        parentId: "scene-base",
        id: "scene-night",
      },
      title: "夜景版",
      prompt: "水墨国风义庄夜景",
      sourceImagePath: "project-file://daojie/assets/scenes/base.png",
      resultImagePath: "project-file://daojie/assets/scenes/night.png",
      imageWorkflowId: "asset-flow-scene-night",
      sourceStage: "storyboard",
      sourceStageLabel: "分镜视频生成",
      sourceLabel: "衍生资产 · 夜景版",
    });
  });

  it("hides completed-state and technical ids from derived asset card copy", () => {
    const card: ProductionFlowAssetCard = {
      id: "scene-night",
      name: "夜景版",
      typeLabel: "场景",
      runtimeType: "scene",
      mediaPath: "project-file://daojie/assets/scenes/night.png",
      prompt: "水墨国风义庄夜景",
      parentAssetId: "scene-base",
      reason: "日景转夜景",
      generationState: "已完成",
      isDerived: true,
      sourceImagePath: "project-file://daojie/assets/scenes/base.png",
      imageWorkflowId: "asset-flow-scene-night",
      imageWorkflowTarget: {
        kind: "asset",
        assetType: "scene",
        parentId: "scene-base",
        id: "scene-night",
      },
    };

    const { container } = render(<AssetFlowCard card={card} />);

    expect(screen.queryByText("已完成")).toBeNull();
    expect(screen.queryByText(/parentAssetId/)).toBeNull();
    expect(screen.queryByText(/flowId/)).toBeNull();
    expect(container.querySelector('[data-parent-asset-id="scene-base"]')).toBeTruthy();
    expect(container.querySelector('[data-asset-generation-state="已完成"]')).toBeTruthy();
    expect(container.querySelector('[data-asset-workflow-id="asset-flow-scene-night"]')).toBeTruthy();
  });

  it("opens the derived asset image workflow when the asset image itself is clicked", () => {
    const onOpenAssetImageWorkflow = vi.fn();
    const card: ProductionFlowAssetCard = {
      id: "scene-night",
      name: "夜景版",
      typeLabel: "场景",
      runtimeType: "scene",
      mediaPath: "project-file://daojie/assets/scenes/night.png",
      prompt: "水墨国风义庄夜景",
      parentAssetId: "scene-base",
      reason: "日景转夜景",
      generationState: "已完成",
      isDerived: true,
      sourceImagePath: "project-file://daojie/assets/scenes/base.png",
      imageWorkflowId: "asset-flow-scene-night",
      imageWorkflowTarget: {
        kind: "asset",
        assetType: "scene",
        parentId: "scene-base",
        id: "scene-night",
      },
    };

    render(
      <AssetFlowCard
        card={card}
        onOpenAssetImageWorkflow={onOpenAssetImageWorkflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /打开夜景版图片工作流/ }));

    expect(onOpenAssetImageWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      title: "夜景版",
      sourceImagePath: "project-file://daojie/assets/scenes/base.png",
      resultImagePath: "project-file://daojie/assets/scenes/night.png",
      imageWorkflowId: "asset-flow-scene-night",
      sourceLabel: "衍生资产 · 夜景版",
    }));
  });

  it("opens an existing derived image workflow even when the parent reference image is missing", () => {
    const onOpenAssetImageWorkflow = vi.fn();
    const card: ProductionFlowAssetCard = {
      id: "scene-night",
      name: "夜景版",
      typeLabel: "场景",
      runtimeType: "scene",
      mediaPath: "project-file://daojie/assets/scenes/night.png",
      prompt: "水墨国风义庄夜景",
      parentAssetId: "scene-base",
      reason: "日景转夜景",
      generationState: "已完成",
      isDerived: true,
      imageWorkflowId: "asset-flow-scene-night",
      imageWorkflowTarget: {
        kind: "asset",
        assetType: "scene",
        parentId: "scene-base",
        id: "scene-night",
      },
    };

    render(
      <AssetFlowCard
        card={card}
        onOpenAssetImageWorkflow={onOpenAssetImageWorkflow}
      />,
    );

    expect(screen.getByText("缺父资产图")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /进入图片工作流/ }));
    expect(onOpenAssetImageWorkflow).toHaveBeenCalledWith({
      target: {
        kind: "asset",
        assetType: "scene",
        parentId: "scene-base",
        id: "scene-night",
      },
      title: "夜景版",
      prompt: "水墨国风义庄夜景",
      sourceImagePath: undefined,
      resultImagePath: "project-file://daojie/assets/scenes/night.png",
      imageWorkflowId: "asset-flow-scene-night",
      sourceStage: "storyboard",
      sourceStageLabel: "分镜视频生成",
      sourceLabel: "衍生资产 · 夜景版",
    });
  });

  it("opens generated storyboard image tiles in their image workflow", () => {
    const onOpenImageWorkflow = vi.fn();
    const node = {
      id: "storyboard",
      label: "分镜面板",
      description: "分镜图、台词、配音与视频节点绑定。",
      status: "ready",
      metrics: ["1 个分镜"],
      previewTitle: "分镜面板",
      previewLines: [],
      previewKind: "storyboard-grid",
      targetStage: "storyboard",
      storyboardTiles: [
        {
          id: "sb-1",
          index: 1,
          mediaPath: "project-file://dao/storyboard-images/shot-001.png",
          title: "矿场醒来",
          lines: "旁白：他睁开眼。",
          state: "ready",
          imageWorkflowId: "storyboard-flow-1",
        },
      ],
    } satisfies ProductionFlowNodeModel;

    render(
      <StoryboardGridPreview
        node={node}
        onOpenImageWorkflow={onOpenImageWorkflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /进入分镜图片工作流/ }));

    expect(onOpenImageWorkflow).toHaveBeenCalledWith({
      target: { kind: "storyboard", id: "sb-1" },
      title: "分镜 1",
      prompt: "矿场醒来",
      sourceImagePath: "project-file://dao/storyboard-images/shot-001.png",
      resultImagePath: "project-file://dao/storyboard-images/shot-001.png",
      imageWorkflowId: "storyboard-flow-1",
      sourceStage: "storyboard",
      sourceStageLabel: "分镜视频生成",
      sourceLabel: "分镜成图 · 分镜 1",
    });
  });

  it("renders all 43 storyboard image tiles and keeps the last tile workflow entry clickable", () => {
    const onOpenImageWorkflow = vi.fn();
    const node = {
      id: "storyboard",
      label: "分镜面板",
      description: "分镜图、台词、配音与视频节点绑定。",
      status: "ready",
      metrics: ["43 个分镜", "43 个画面"],
      previewTitle: "分镜面板",
      previewLines: [],
      previewKind: "storyboard-grid",
      targetStage: "storyboard",
      storyboardTiles: Array.from({ length: 43 }, (_, index) => {
        const shot = index + 1;
        return {
          id: `sb-${shot}`,
          index: shot,
          mediaPath: `project-file://dao/storyboard-images/shot-${String(shot).padStart(3, "0")}.png`,
          title: `第${shot}镜画面`,
          lines: `旁白：第${shot}镜`,
          state: "ready" as const,
          imageWorkflowId: `storyboard-flow-${shot}`,
        };
      }),
    } satisfies ProductionFlowNodeModel;

    render(
      <StoryboardGridPreview
        node={node}
        onOpenImageWorkflow={onOpenImageWorkflow}
      />,
    );

    expect(screen.getByText("S43")).toBeTruthy();
    expect(screen.getByText("第43镜画面")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /打开分镜 43 图片工作流/ }));

    expect(onOpenImageWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: "storyboard", id: "sb-43" },
      title: "分镜 43",
      imageWorkflowId: "storyboard-flow-43",
      sourceLabel: "分镜成图 · 分镜 43",
    }));
  });

  it("renders all 43 storyboard table rows inside the table preview", () => {
    const node = {
      id: "storyboardTable",
      label: "分镜表",
      description: "按导演规划拆出镜头表。",
      status: "ready",
      metrics: [],
      previewTitle: "分镜表",
      previewLines: [],
      previewKind: "table",
      targetStage: "storyboard",
      tableRows: Array.from({ length: 43 }, (_, index) => {
        const shot = index + 1;
        return {
          index: shot,
          title: `第${shot}镜画面`,
          titleEn: `shot-${String(shot).padStart(3, "0")}`,
          description: `第${shot}镜完整画面描述`,
          scene: "道口镇",
          associateAssetsNames: ["独孤剑尘", "道口镇"],
          duration: 4,
          shotSize: "中景",
          cameraMove: "缓推",
          action: `第${shot}镜动作`,
          orientation: "面朝右",
          spatialRelation: "独孤在前",
          emotion: "压迫",
          lines: `旁白：第${shot}镜`,
          sound: "风声",
          associateAssetsIds: ["char-dugu", "scene-town"],
        };
      }),
    } satisfies ProductionFlowNodeModel;

    render(<StoryboardTablePreview node={node} />);

    expect(screen.getByText("第43镜画面")).toBeTruthy();
    expect(screen.getByText("第43镜完整画面描述")).toBeTruthy();
    expect(screen.getAllByText("道口镇").length).toBeGreaterThan(1);
  });

  it("opens a storyboard image workflow when the storyboard image itself is clicked", () => {
    const onOpenImageWorkflow = vi.fn();
    const node = {
      id: "storyboard",
      label: "分镜面板",
      description: "分镜图、台词、配音与视频节点绑定。",
      status: "ready",
      metrics: ["1 个分镜"],
      previewTitle: "分镜面板",
      previewLines: [],
      previewKind: "storyboard-grid",
      targetStage: "storyboard",
      storyboardTiles: [
        {
          id: "sb-1",
          index: 1,
          mediaPath: "project-file://dao/storyboard-images/shot-001.png",
          title: "矿场醒来",
          lines: "旁白：他睁开眼。",
          state: "ready",
          imageWorkflowId: "storyboard-flow-1",
        },
      ],
    } satisfies ProductionFlowNodeModel;

    render(
      <StoryboardGridPreview
        node={node}
        onOpenImageWorkflow={onOpenImageWorkflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /打开分镜 1 图片工作流/ }));

    expect(onOpenImageWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: "storyboard", id: "sb-1" },
      title: "分镜 1",
      resultImagePath: "project-file://dao/storyboard-images/shot-001.png",
      imageWorkflowId: "storyboard-flow-1",
      sourceLabel: "分镜成图 · 分镜 1",
    }));
  });

  it("opens existing storyboard images even when older data has no workflow id", () => {
    const onOpenImageWorkflow = vi.fn();
    const node = {
      id: "storyboard",
      label: "分镜面板",
      description: "分镜图、台词、配音与视频节点绑定。",
      status: "ready",
      metrics: ["1 个分镜"],
      previewTitle: "分镜面板",
      previewLines: [],
      previewKind: "storyboard-grid",
      targetStage: "storyboard",
      storyboardTiles: [
        {
          id: "sb-legacy-1",
          index: 1,
          mediaPath: "project-file://dao/exports/chapter-001/toonflow_frames/shot-001.png",
          title: "赤练蛇皮鞭撕开河雾",
          state: "ready",
        },
      ],
    } satisfies ProductionFlowNodeModel;

    render(
      <StoryboardGridPreview
        node={node}
        onOpenImageWorkflow={onOpenImageWorkflow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /进入分镜图片工作流/ }));

    expect(onOpenImageWorkflow).toHaveBeenCalledWith({
      target: { kind: "storyboard", id: "sb-legacy-1" },
      title: "分镜 1",
      prompt: "赤练蛇皮鞭撕开河雾",
      sourceImagePath: "project-file://dao/exports/chapter-001/toonflow_frames/shot-001.png",
      resultImagePath: "project-file://dao/exports/chapter-001/toonflow_frames/shot-001.png",
      imageWorkflowId: undefined,
      sourceStage: "storyboard",
      sourceStageLabel: "分镜视频生成",
      sourceLabel: "分镜成图 · 分镜 1",
    });
  });

  it("opens a generated derived asset image workflow even when parent image and workflow id are missing", () => {
    const onOpenAssetImageWorkflow = vi.fn();
    const card: ProductionFlowAssetCard = {
      id: "scene-night",
      name: "夜景版",
      typeLabel: "场景",
      runtimeType: "scene",
      mediaPath: "project-file://daojie/assets/scenes/night.png",
      prompt: "水墨国风义庄夜景",
      parentAssetId: "scene-base",
      reason: "日景转夜景",
      generationState: "已完成",
      isDerived: true,
      imageWorkflowTarget: {
        kind: "asset",
        assetType: "scene",
        parentId: "scene-base",
        id: "scene-night",
      },
    };

    render(
      <AssetFlowCard
        card={card}
        onOpenAssetImageWorkflow={onOpenAssetImageWorkflow}
      />,
    );

    expect(screen.getByText("缺父资产图")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /进入图片工作流/ }));
    expect(onOpenAssetImageWorkflow).toHaveBeenCalledWith({
      target: {
        kind: "asset",
        assetType: "scene",
        parentId: "scene-base",
        id: "scene-night",
      },
      title: "夜景版",
      prompt: "水墨国风义庄夜景",
      sourceImagePath: undefined,
      resultImagePath: "project-file://daojie/assets/scenes/night.png",
      imageWorkflowId: undefined,
      sourceStage: "storyboard",
      sourceStageLabel: "分镜视频生成",
      sourceLabel: "衍生资产 · 夜景版",
    });
  });
});
