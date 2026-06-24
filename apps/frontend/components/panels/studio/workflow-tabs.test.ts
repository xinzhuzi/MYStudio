import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WORKFLOW_TABS, resolveVisibleWorkflowStage } from "./index";

describe("studio workflow tabs", () => {
  it("keeps model configuration out of the workflow navigation", () => {
    expect(WORKFLOW_TABS.map((tab) => tab.value)).toEqual([
      "manuals",
      "novel",
      "script",
      "assets",
      "generation",
      "storyboard",
      "workbench",
    ]);
    expect(WORKFLOW_TABS.map((tab) => tab.label)).toEqual([
      "风格与导演",
      "小说导入",
      "策划编剧",
      "剧本资产",
      "ProductionAgent",
      "分镜面板",
      "视频工作台",
    ]);
    expect(WORKFLOW_TABS.some((tab) => tab.label === "配置中心")).toBe(false);
    expect(WORKFLOW_TABS.some((tab) => tab.value === "skill")).toBe(false);
  });

  it("falls back to the first visible workflow tab for hidden or stale persisted stages", () => {
    expect(resolveVisibleWorkflowStage("generation")).toBe("generation");
    expect(resolveVisibleWorkflowStage("skill")).toBe("manuals");
    expect(resolveVisibleWorkflowStage("unknown-stage")).toBe("manuals");
    expect(resolveVisibleWorkflowStage(undefined)).toBe("manuals");
  });

  it("does not keep the removed Skill conversation implementation mounted", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./index.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).not.toContain('TabsContent value="skill"');
    expect(source).not.toContain("function SkillTab");
    expect(source).not.toContain("Skill 对话任务");
    expect(source).not.toContain("lastContextPackage");
    expect(source).not.toContain("handleBuildContext");
    expect(source).not.toContain("agentDraft");
  });

  it("does not keep removed Skill context preview state in the studio store", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("../../../stores/studio-store.ts", import.meta.url),
      ),
      "utf8",
    );

    expect(source).not.toContain("lastContextPackage");
    expect(source).not.toContain("buildContext");
    expect(source).not.toContain("buildSkillContextPackage");
  });

  it("renders Toonflow-style nodes inside the ProductionAgent workspace", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./index.tsx", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("WorkflowNodeCanvas");
    expect(source).toContain("PRODUCTION_FLOW_NODES");
    expect(source).toContain("PRODUCTION_FLOW_EDGES");
    expect(source).toContain("workflow-node-canvas");
    expect(source).toContain("workflow-node-connector");
    for (const node of [
      "script",
      "scriptPlan",
      "assets",
      "storyboardTable",
      "storyboard",
      "workbench",
    ]) {
      expect(source).toContain(`data-flow-node={tab.value}`);
      expect(source).toContain(`value: "${node}"`);
    }
    for (const edge of [
      '["script", "scriptPlan"]',
      '["script", "assets"]',
      '["scriptPlan", "storyboardTable"]',
      '["storyboardTable", "storyboard"]',
      '["storyboard", "workbench"]',
    ]) {
      expect(source).toContain(edge);
    }
    expect(source).toContain("data-flow-edge={`${fromKey}->${toKey}`}");
    expect(source).toContain("ProductionAgent 节点工作区");
    expect(source).toContain("scriptPlan");
    expect(source).toContain("storyboardTable");
    expect(source).toContain("setCanvasZoom");
    expect(source).toContain("缩小");
    expect(source).toContain("放大");
    expect(source).toContain("适配画布");
    expect(source).not.toContain("activeValue={activeWorkflowTab}");
  });
});
