import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("workflow node component boundaries", () => {
  it("keeps node shell and preview renderers outside the canvas module", () => {
    const canvasSource = readFileSync(
      fileURLToPath(new URL("./WorkflowNodeCanvas.tsx", import.meta.url)),
      "utf8",
    );
    const productionNodeSource = readFileSync(
      fileURLToPath(new URL("./WorkflowProductionNode.tsx", import.meta.url)),
      "utf8",
    );
    const previewsSource = readFileSync(
      fileURLToPath(new URL("./WorkflowNodePreviews.tsx", import.meta.url)),
      "utf8",
    );

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
    const previewsSource = readFileSync(
      fileURLToPath(new URL("./WorkflowNodePreviews.tsx", import.meta.url)),
      "utf8",
    );

    expect(previewsSource).toContain('import { MdPreview } from "md-editor-rt"');
    expect(previewsSource).toContain("modelValue={buildPreviewMarkdown(node)}");
    expect(previewsSource).toContain("md-editor-preview-transparent");
    expect(previewsSource).toContain("function buildPreviewMarkdown");
    expect(previewsSource).not.toContain("node.previewLines.map((line, index)");
  });

  it("routes video workbench nodes to a structured lane preview instead of compact text", () => {
    const productionNodeSource = readFileSync(
      fileURLToPath(new URL("./WorkflowProductionNode.tsx", import.meta.url)),
      "utf8",
    );
    const previewsSource = readFileSync(
      fileURLToPath(new URL("./WorkflowNodePreviews.tsx", import.meta.url)),
      "utf8",
    );

    expect(productionNodeSource).toContain('previewKind === "workbench-lanes"');
    expect(productionNodeSource).toContain("<WorkbenchLanePreview node={data.node} />");
    expect(previewsSource).toContain("workbench-lane-preview");
    expect(previewsSource).toContain("node.workbenchTracks");
    expect(previewsSource).toContain("selectedVideoPath");
    expect(previewsSource).toContain("最终导出");
  });

  it("renders derived asset nodes with Toonflow-style type, state, and queue fields", () => {
    const previewsSource = readFileSync(
      fileURLToPath(new URL("./WorkflowNodePreviews.tsx", import.meta.url)),
      "utf8",
    );

    expect(previewsSource).toContain("asset-derive-summary");
    expect(previewsSource).toContain("card.runtimeType");
    expect(previewsSource).toContain("card.generationState");
    expect(previewsSource).toContain("parentAssetId");
    expect(previewsSource).toContain("生成提示");
    expect(previewsSource).toContain("缺父资产");
  });
});
