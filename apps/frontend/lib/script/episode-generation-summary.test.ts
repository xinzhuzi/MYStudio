import { describe, expect, it } from "vitest";
import { summarizeEpisodeGeneration } from "./episode-generation-summary";

describe("summarizeEpisodeGeneration", () => {
  it("returns an empty summary", () => {
    expect(summarizeEpisodeGeneration([])).toEqual({
      total: 0,
      completed: 0,
      generating: 0,
      idle: 0,
      error: 0,
    });
  });

  it("counts every generation state", () => {
    expect(summarizeEpisodeGeneration([
      { shotGenerationStatus: "completed" },
      { shotGenerationStatus: "completed" },
      { shotGenerationStatus: "generating" },
      { shotGenerationStatus: "idle" },
      { shotGenerationStatus: "error" },
    ])).toEqual({
      total: 5,
      completed: 2,
      generating: 1,
      idle: 1,
      error: 1,
    });
  });
});
