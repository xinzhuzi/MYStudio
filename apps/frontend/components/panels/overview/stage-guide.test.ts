import { describe, expect, it } from "vitest";
import { OVERVIEW_STAGE_GUIDE } from "./stage-guide";
import { WORKFLOW_TABS } from "@/components/panels/studio/workflow-tabs";

describe("overview stage guide", () => {
  it("mirrors the canonical workflow stage list 1:1 (id, label, icon, order)", () => {
    expect(OVERVIEW_STAGE_GUIDE.map((s) => s.id)).toEqual(
      WORKFLOW_TABS.map((t) => t.value),
    );
    expect(OVERVIEW_STAGE_GUIDE.map((s) => s.label)).toEqual(
      WORKFLOW_TABS.map((t) => t.label),
    );
    OVERVIEW_STAGE_GUIDE.forEach((stage, i) => {
      expect(stage.Icon).toBe(WORKFLOW_TABS[i].Icon);
    });
  });

  it("gives every stage a non-empty description", () => {
    expect(OVERVIEW_STAGE_GUIDE.length).toBeGreaterThan(0);
    for (const stage of OVERVIEW_STAGE_GUIDE) {
      expect(stage.description.trim().length).toBeGreaterThan(8);
    }
  });
});
