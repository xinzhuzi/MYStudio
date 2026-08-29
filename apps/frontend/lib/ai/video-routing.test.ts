import { describe, expect, it } from "vitest";
import { detectFreedomVideoRoute, getUnifiedEndpointPaths } from "./freedom-routing";

describe("freedom video routing", () => {
  it("preserves video metadata precedence and model fallback", () => {
    expect(detectFreedomVideoRoute("wan", ["文生视频", "异步"])).toBe("kling");
    expect(detectFreedomVideoRoute("plain", ["org/model异步"])).toBe("replicate");
    expect(detectFreedomVideoRoute("doubao-seedance-1", [])).toBe("volc");
    expect(detectFreedomVideoRoute("sora-2", [])).toBe("openai_official");
  });

  it("maps provider-specific video submit and polling paths", () => {
    const video = getUnifiedEndpointPaths(["海螺视频生成"]);
    expect(video.submit).toBe("/minimax/v1/video_generation");
    expect(video.poll("task-2")).toBe("/minimax/v1/query/video_generation?task_id=task-2");
  });
});
