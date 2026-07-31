import { describe, expect, it } from "vitest";
import { latestAgentWork } from "./workflow-helpers";

describe("latestAgentWork chapter isolation", () => {
  const records = [
    {
      key: "storyboardTable" as const,
      episodeId: "chapter-1",
      data: "第一章分镜",
      updatedAt: 1,
    },
    {
      key: "storyboardTable" as const,
      episodeId: "chapter-2",
      data: "第二章分镜",
      updatedAt: 2,
    },
  ];

  it("returns the current chapter record when it exists", () => {
    expect(latestAgentWork(records, "storyboardTable", "chapter-1")).toBe("第一章分镜");
  });

  it("does not fall back to another chapter in strict mode", () => {
    expect(
      latestAgentWork(records, "storyboardTable", "chapter-3", {
        allowUnscopedFallback: false,
      }),
    ).toBe("");
  });

  it("keeps legacy unscoped fallback opt-in for non-storyboard callers", () => {
    expect(latestAgentWork(records, "storyboardTable", "chapter-3")).toBe("第二章分镜");
  });
});
