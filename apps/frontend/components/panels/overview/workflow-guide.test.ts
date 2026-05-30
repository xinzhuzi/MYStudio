import { describe, expect, it } from "vitest";
import { OVERVIEW_WORKFLOW_GUIDE } from "./workflow-guide";

describe("overview workflow guide", () => {
  it("introduces the full Manying workflow from novel import to export", () => {
    expect(OVERVIEW_WORKFLOW_GUIDE.title).toBe("漫影工作室标准工作流");
    expect(OVERVIEW_WORKFLOW_GUIDE.summary).toContain("小说");
    expect(OVERVIEW_WORKFLOW_GUIDE.summary).toContain("成片");
    expect(OVERVIEW_WORKFLOW_GUIDE.steps.map((step) => step.title)).toEqual([
      "风格与导演选择",
      "小说导入",
      "事件分析",
      "剧本策划",
      "实体提取",
      "分镜拆解",
      "一致性资产",
      "音色分配",
      "生图与生视频",
      "剪辑成片",
    ]);
  });

  it("lets users browse all art styles in assets (default style library)", () => {
    expect(OVERVIEW_WORKFLOW_GUIDE.primaryAction).toMatchObject({
      label: "查看所有风格",
      targetTab: "assets",
    });
  });
});
