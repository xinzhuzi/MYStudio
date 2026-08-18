import { describe, expect, it } from "vitest";
import {
  FALLBACK_ROOT_STAGE,
  PROJECT_ROOT_LAYOUT,
  classifyProjectRootStage,
  sharedBucketLabel,
  sharedResourceBucketId,
} from "./project-layout";

describe("project-layout(根目录布局契约表)", () => {
  it("每个已知根映射到管线 stage,深层路径按首段命中", () => {
    expect(classifyProjectRootStage("novel/chapters/chapter-001.md")).toBe("novel");
    expect(classifyProjectRootStage("workflow-images/chapter-001/flow-x/gen.png")).toBe("image");
    expect(classifyProjectRootStage("workflow-images/assets/prop/a.png")).toBe("image");
    expect(classifyProjectRootStage("remotion/outputs/shots/chapter-001/s01/current.mp4")).toBe("remotion");
    expect(classifyProjectRootStage("exports/chapter-001/final.mp4")).toBe("export");
    expect(classifyProjectRootStage("video-use/chapter-001/r3/a.json")).toBe("production");
    expect(classifyProjectRootStage("hyperframes/chapter-001/seg.mp4")).toBe("production");
    expect(classifyProjectRootStage("continuity-bibles/chapter-001/v5/b.json")).toBe("storyboard");
    expect(classifyProjectRootStage("assets/files/character/a.png")).toBe("assets");
    expect(classifyProjectRootStage("store/studio-workflow/chapters/chapter-001.json")).toBe("project-store");
  });

  it("未知根/根级文件兜底 media-library(历史行为不变)", () => {
    expect(classifyProjectRootStage("scripts/run.py")).toBe(FALLBACK_ROOT_STAGE);
    expect(classifyProjectRootStage("random-dir/x.png")).toBe("media-library");
    expect(classifyProjectRootStage("characters.json")).toBe("media-library");
  });

  it("公共资源分组:仅 assets/store,章作用域根不产生 shared 桶", () => {
    expect(sharedResourceBucketId("assets/files/a.png")).toBe("shared:assets");
    expect(sharedResourceBucketId("store/characters.json")).toBe("shared:store");
    expect(sharedResourceBucketId("store/studio-workflow/chapters/chapter-001.json")).toBe("shared:store");
    expect(sharedResourceBucketId("workflow-images/chapter-001/a.png")).toBeNull();
    expect(sharedResourceBucketId("remotion/x")).toBeNull();
    expect(sharedBucketLabel("shared:assets")).toBe("设定集素材");
    expect(sharedBucketLabel("shared:store")).toBe("项目存储");
    expect(sharedBucketLabel("chapter-001")).toBeNull();
  });

  it("契约表自检:sharedLabel 存在当且仅当非章作用域", () => {
    for (const [root, entry] of Object.entries(PROJECT_ROOT_LAYOUT)) {
      expect(entry.chapterScoped === !entry.sharedLabel, `${root} 的 sharedLabel/chapterScoped 互斥`).toBe(true);
    }
  });
});
