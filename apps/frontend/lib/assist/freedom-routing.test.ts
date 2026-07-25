import { describe, expect, it } from "vitest";
import {
  detectFreedomImageRoute,
  detectFreedomVideoRoute,
  getImageEndpointPaths,
  getUnifiedEndpointPaths,
} from "./freedom-routing";

describe("freedom routing", () => {
  it("preserves image route precedence", () => {
    expect(detectFreedomImageRoute("plain", ["midjourney"])).toBe("midjourney");
    expect(detectFreedomImageRoute("kling-image-v2", ["openai"])).toBe("kling_image");
    expect(detectFreedomImageRoute("org/model", ["org/model异步"])).toBe("replicate");
    expect(detectFreedomImageRoute("gpt-image-2", ["openai"])).toBe("openai_images");
  });

  it("preserves video metadata precedence and model fallback", () => {
    expect(detectFreedomVideoRoute("wan", ["文生视频", "异步"])).toBe("kling");
    expect(detectFreedomVideoRoute("plain", ["org/model异步"])).toBe("replicate");
    expect(detectFreedomVideoRoute("doubao-seedance-1", [])).toBe("volc");
    expect(detectFreedomVideoRoute("sora-2", [])).toBe("openai_official");
  });

  it("maps provider-specific submit and polling paths", () => {
    const image = getImageEndpointPaths(["vidu生图"]);
    expect(image.submit).toBe("/ent/v2/reference2image");
    expect(image.poll("task-1")).toBe("/ent/v2/task?task_id=task-1");
    const video = getUnifiedEndpointPaths(["海螺视频生成"]);
    expect(video.submit).toBe("/minimax/v1/video_generation");
    expect(video.poll("task-2")).toBe("/minimax/v1/query/video_generation?task_id=task-2");
  });
});
