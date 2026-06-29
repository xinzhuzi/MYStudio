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
    expect(previewsSource).toContain("export function toPreviewSrc");
  });
});
