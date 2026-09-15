// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";

import { shotPreview2Name, shotPreviewName } from "@/lib/assist/image-studio/storyboard-overview-comfy";
import type { StoryboardItem } from "@/types/studio";

function shot(id: string, index: number, episodeId = "chapter-001", overrides: Partial<StoryboardItem> = {}): StoryboardItem {
  return {
    id,
    episodeId,
    index,
    duration: 2,
    videoDesc: `第${index}镜`,
    ...overrides,
  } as StoryboardItem;
}

describe("分镜缩略图命名契约(09-15 零实体存留件)", () => {
  it("主帧名按 shot id 净化;视频镜/无图镜=空串", () => {
    const withImage = shot("scene:S 01/02", 1, "chapter-001", { mediaRef: { kind: "image", path: "p.png" } as never });
    expect(shotPreviewName(withImage)).toBe("my-shot-scene_S_01_02.jpg");
    expect(shotPreviewName(shot("a", 1, "e", { mediaRef: { kind: "video", path: "v.mp4" } as never }))).toBe("");
    expect(shotPreviewName(shot("a", 1))).toBe("");
  });

  it("双帧(09-14 用户裁定:每镜多张图都上屏):帧2 名 -k2.jpg;无帧2=空串", () => {
    const withImage = shot("scene:S 01/02", 1, "chapter-001", { mediaRef: { kind: "image", path: "p.png" } as never });
    expect(shotPreview2Name({ ...withImage, keyframes: [
      { mediaRef: withImage.mediaRef },
      { mediaRef: { kind: "image", path: "project-file://b.png" } },
    ] } as never)).toBe("my-shot-scene_S_01_02-k2.jpg");
    expect(shotPreview2Name(withImage as never)).toBe("");
  });
});
