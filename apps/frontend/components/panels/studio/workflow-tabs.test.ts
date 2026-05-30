import { describe, expect, it } from "vitest";
import { WORKFLOW_TABS } from "./index";

describe("studio workflow tabs", () => {
  it("keeps model configuration out of the workflow navigation", () => {
    expect(WORKFLOW_TABS.map((tab) => tab.value)).toEqual([
      "manuals",
      "novel",
      "skill",
      "script",
      "storyboard",
      "workbench",
    ]);
    expect(WORKFLOW_TABS.some((tab) => tab.label === "配置中心")).toBe(false);
  });
});
