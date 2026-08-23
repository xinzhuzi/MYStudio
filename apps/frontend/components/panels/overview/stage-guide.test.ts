import { describe, expect, it } from "vitest";
import { OVERVIEW_STAGE_GUIDE } from "./stage-guide";
import { WORKFLOW_TABS } from "@/components/panels/studio/workflow-tabs";

describe("overview stage guide", () => {
  it("mirrors the canonical workflow stage list except the enter-only storyboard panel view", () => {
    // 分镜面板=节点图「进入」专属(唯一入口裁定),概览阶段卡不列
    const visible = WORKFLOW_TABS.filter(({ value }) => value !== "storyboardPanel");
    expect(OVERVIEW_STAGE_GUIDE.map((s) => s.id)).toEqual(visible.map((t) => t.value));
    expect(OVERVIEW_STAGE_GUIDE.map((s) => s.label)).toEqual(visible.map((t) => t.label));
    expect(OVERVIEW_STAGE_GUIDE.some((s) => s.id === "storyboardPanel")).toBe(false);
  });

  it("gives every stage a non-empty description", () => {
    expect(OVERVIEW_STAGE_GUIDE.length).toBeGreaterThan(0);
    for (const stage of OVERVIEW_STAGE_GUIDE) {
      expect(stage.description.trim().length).toBeGreaterThan(8);
    }
  });
});
