import { describe, expect, it } from "vitest";
import { OVERVIEW_WORKFLOW_GUIDE } from "./workflow-guide";

describe("overview workflow guide", () => {
  it("introduces the full Manying workflow from novel import to export", () => {
    expect(OVERVIEW_WORKFLOW_GUIDE.title).toBe("漫影工作室基础工作流");
    expect(OVERVIEW_WORKFLOW_GUIDE.summary).toContain("小说");
    expect(OVERVIEW_WORKFLOW_GUIDE.summary).toContain("成片");
    expect(OVERVIEW_WORKFLOW_GUIDE.steps.map((step) => step.title)).toEqual([
      "小说导入",
      "上下文整理",
      "剧本策划",
      "分镜设计",
      "素材管理",
      "制作剪辑",
      "合成导出",
    ]);
  });

  it("starts users in the studio workflow instead of the old script import flow", () => {
    expect(OVERVIEW_WORKFLOW_GUIDE.primaryAction).toMatchObject({
      label: "导入小说",
      targetTab: "studio",
    });
  });
});
