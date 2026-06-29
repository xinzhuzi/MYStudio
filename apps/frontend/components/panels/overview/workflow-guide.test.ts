import { describe, expect, it } from "vitest";
import { OVERVIEW_WORKFLOW_GUIDE } from "./workflow-guide";

describe("overview workflow guide", () => {
  it("keeps the project overview focused on entry actions", () => {
    expect(OVERVIEW_WORKFLOW_GUIDE.title).toBe("开始制作");
    expect(OVERVIEW_WORKFLOW_GUIDE.summary).toContain("工作流");
    expect(OVERVIEW_WORKFLOW_GUIDE.summary).toContain("当前章节");
    expect(OVERVIEW_WORKFLOW_GUIDE.summary).not.toContain(
      "小说导入后按章节逐章制作",
    );
  });

  it("sends users into the workflow first", () => {
    expect(OVERVIEW_WORKFLOW_GUIDE.primaryAction).toMatchObject({
      label: "进入工作流",
      targetTab: "studio",
    });
  });

  it("keeps the asset library as the secondary entry", () => {
    expect(OVERVIEW_WORKFLOW_GUIDE.secondaryAction).toMatchObject({
      label: "查看资产库",
      targetTab: "assets",
    });
  });

  it("keeps the overview stage cards available outside the node canvas", () => {
    expect(OVERVIEW_WORKFLOW_GUIDE.stages.map((stage) => stage.title)).toEqual([
      "风格与导演",
      "小说导入",
      "策划编剧",
      "剧本资产提取",
      "剧本资产管理",
      "分镜视频生成",
      "视频工作台",
    ]);
    expect(
      OVERVIEW_WORKFLOW_GUIDE.stages.every((stage) => stage.summary.length > 0),
    ).toBe(true);
  });

  it("maps each overview stage card to a workflow tab", () => {
    expect(
      OVERVIEW_WORKFLOW_GUIDE.stages.map((stage) => stage.targetStage),
    ).toEqual([
      "manuals",
      "novel",
      "script",
      "assets",
      "generation",
      "storyboard",
      "workbench",
    ]);
  });
});
