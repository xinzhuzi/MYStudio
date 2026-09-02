// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";
import type { ImageWorkflowGeneratedNode } from "@/types/studio";
import { effectiveBatchImages } from "./image-studio-batch";

function node(overrides: Partial<ImageWorkflowGeneratedNode>): ImageWorkflowGeneratedNode {
  return {
    id: "gen-1",
    type: "generated",
    title: "生成图",
    prompt: "",
    aspectRatio: "16:9",
    status: "ready",
    position: { x: 0, y: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("effectiveBatchImages 不变量", () => {
  it("批量组且 resultUrl 是组内主图:整组生效", () => {
    const images = ["local-image://ai-image/a.png", "local-image://ai-image/b.png"];
    expect(
      effectiveBatchImages(node({ resultUrl: images[0], imageBatch: { images, primaryIndex: 0 } })),
    ).toEqual(images);
  });

  it("超分后 resultUrl 换轨 up4x-:回落单图,陈旧组不冒充", () => {
    const images = ["local-image://ai-image/a.png", "local-image://ai-image/b.png"];
    expect(
      effectiveBatchImages(node({
        resultUrl: "local-image://ai-image/up4x-123.png",
        imageBatch: { images, primaryIndex: 0 },
      })),
    ).toEqual(["local-image://ai-image/up4x-123.png"]);
  });

  it("无 batch:回落 [resultUrl];无 resultUrl:空数组", () => {
    expect(effectiveBatchImages(node({ resultUrl: "local-image://ai-image/x.png" }))).toEqual([
      "local-image://ai-image/x.png",
    ]);
    expect(effectiveBatchImages(node({ status: "idle" }))).toEqual([]);
  });
});
