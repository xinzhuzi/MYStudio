import { describe, expect, it } from "vitest";
import { detectFreedomImageRoute, getImageEndpointPaths } from "./image-routing";

describe("image routing", () => {
  it("preserves image route precedence", () => {
    expect(detectFreedomImageRoute("plain", ["midjourney"])).toBe("midjourney");
    expect(detectFreedomImageRoute("kling-image-v2", ["openai"])).toBe("kling_image");
    expect(detectFreedomImageRoute("org/model", ["org/model异步"])).toBe("replicate");
    expect(detectFreedomImageRoute("gpt-image-2", ["openai"])).toBe("openai_images");
  });

  it("maps provider-specific image submit and polling paths", () => {
    const image = getImageEndpointPaths(["vidu生图"]);
    expect(image.submit).toBe("/ent/v2/reference2image");
    expect(image.poll("task-1")).toBe("/ent/v2/task?task_id=task-1");
  });
});
