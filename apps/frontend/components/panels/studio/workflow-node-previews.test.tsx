// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetFlowCard, StoryboardGridPreview } from "./WorkflowNodePreviews";
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
    expect(previewsSource).not.toContain('theme="dark"');
    expect(previewsSource).not.toContain("node.previewLines.map((line, index)");
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
    expect(canvasSource).toContain('color: "hsl(var(--foreground))"');
    expect(canvasSource).toContain('stroke: "hsl(var(--foreground))"');
    expect(canvasSource).toContain('Background color="hsl(var(--border))"');
    expect(canvasSource).not.toContain('Background color="rgba(255,255,255,0.055)"');
    expect(canvasSource).not.toContain('color: "#0f0f0f"');
    expect(canvasSource).not.toContain('stroke: "#0f0f0f"');
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

  it("renders derived asset nodes with Toonflow-style type, state, and queue fields", () => {
    const previewsSource = readLocalSource("WorkflowNodePreviews.tsx");

    expect(previewsSource).toContain("asset-derive-summary");
    expect(previewsSource).toContain("card.runtimeType");
    expect(previewsSource).toContain("card.generationState");
    expect(previewsSource).toContain("parentAssetId");
    expect(previewsSource).toContain("生成提示");
    expect(previewsSource).toContain("缺父资产");
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
    expect(previewsSource).toContain("flowId:");
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
