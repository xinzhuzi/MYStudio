import { describe, expect, it } from "vitest";
import {
  assetImageRelativePath,
  chapterScopeForWorkflowTarget,
  safePathSegment,
  workflowImageRelativePath,
} from "./chapter-paths";

describe("chapter-paths(章节作用域路径布局单一事实源)", () => {
  it("workflow-images:分镜工作流按章节落位,无章节维持历史平铺", () => {
    expect(workflowImageRelativePath("storyboard-flow-chapter-001-005", "gen-a.png", "chapter-001")).toBe(
      "workflow-images/chapter-001/storyboard-flow-chapter-001-005/gen-a.png",
    );
    expect(workflowImageRelativePath("image-flow-1", "ref-b.jpg")).toBe(
      "workflow-images/image-flow-1/ref-b.jpg",
    );
    expect(workflowImageRelativePath("Flow / 道劫", "参考 图.PNG")).toBe(
      "workflow-images/flow-道劫/参考-图.png",
    );
  });

  it("章节归属仅对 storyboard 目标且能在分镜表命中的才返回", () => {
    const storyboards = [
      { id: "sb-chapter-001-005", episodeId: "chapter-001" },
      { id: "sb-orphan", episodeId: "" },
    ];
    expect(chapterScopeForWorkflowTarget({ kind: "storyboard", id: "sb-chapter-001-005" }, storyboards)).toBe("chapter-001");
    expect(chapterScopeForWorkflowTarget({ kind: "storyboard", id: "sb-orphan" }, storyboards)).toBeUndefined();
    expect(chapterScopeForWorkflowTarget({ kind: "storyboard", id: "sb-missing" }, storyboards)).toBeUndefined();
    expect(chapterScopeForWorkflowTarget({ kind: "storyboard", id: "sb-chapter-001-005" }, undefined)).toBeUndefined();
    expect(chapterScopeForWorkflowTarget({ kind: "free" }, storyboards)).toBeUndefined();
    expect(chapterScopeForWorkflowTarget(undefined, storyboards)).toBeUndefined();
  });

  it("assets:衍生资产按章落位,基类即使误传 chapterId 也强制共享", () => {
    expect(assetImageRelativePath("prop", "prop-ch1-x-1.png", { chapterId: "chapter-001", isDerivative: true })).toBe(
      "workflow-images/assets/chapter-001/prop/prop-ch1-x-1.png",
    );
    expect(assetImageRelativePath("prop", "prop-parent-x-1.png", { chapterId: "chapter-001", isDerivative: false })).toBe(
      "workflow-images/assets/prop/prop-parent-x-1.png",
    );
    expect(assetImageRelativePath("scene", "s.png", { isDerivative: false })).toBe("workflow-images/assets/scene/s.png");
  });

  it("assets:组合文件名直通不重洗(超长名不得被截断)", () => {
    const longName = `${"a".repeat(90)}-${"b".repeat(90)}-1786812000000.png`;
    expect(assetImageRelativePath("prop", longName, { isDerivative: false })).toBe(
      `workflow-images/assets/prop/${longName}`,
    );
  });

  it("safePathSegment:宽容替换+自定义回退值", () => {
    expect(safePathSegment("Chapter 002")).toBe("chapter-002");
    expect(safePathSegment("***")).toBe("file");
    expect(safePathSegment("***", "asset")).toBe("asset");
  });
});
