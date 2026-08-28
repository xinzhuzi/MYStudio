import { describe, expect, it } from "vitest";
import {
  GPT_IMAGE_SIZE_MAP,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  parseImageSize,
} from "@/lib/ai/image-size-presets";
import { classifyImageResolution, toResolutionProbeSrc } from "@/lib/image-resolution";

describe("classifyImageResolution", () => {
  it.each(IMAGE_ASPECT_RATIOS.flatMap((aspect) =>
    IMAGE_RESOLUTIONS.map((resolution) => ({ aspect, resolution })),
  ))(
    "maps preset $aspect $resolution back to its tier",
    ({ aspect, resolution }) => {
      const size = parseImageSize(GPT_IMAGE_SIZE_MAP[aspect][resolution]);
      expect(size).toBeDefined();
      expect(classifyImageResolution(size!.width, size!.height)).toBe(resolution);
    },
  );

  it.each([
    [699, 699, null],
    [700, 500, "1K"],
    [1280, 720, "1K"],
    [1672, 941, "1K"], // 供应商自选尺寸(gpt-image-2 chat 通道,08-28 实弹)
    [1920, 1080, "1K"], // 1080p 归 1K(行业叫法对齐)
    [1999, 1999, "1K"],
    [2000, 1125, "2K"],
    [2048, 2048, "2K"],
    [2799, 1200, "2K"],
    [2800, 1350, "4K"],
    [2880, 2880, "4K"],
    [4096, 4096, "4K"],
    [200, 200, null], // sips 资产缩略图
    [720, 1280, "1K"], // 竖图按长边
    [1280, 720, "1K"],
    [5120, 2880, "4K"], // 1K×4 超分
  ])("classifies %dx%d as %s", (width, height, expected) => {
    expect(classifyImageResolution(width, height)).toBe(expected);
  });

  it.each([
    ["invalid", NaN],
    ["zero width", 0],
    ["negative", -1024],
    ["non-finite", Number.POSITIVE_INFINITY],
  ])("returns null for %s", (_label, width) => {
    expect(classifyImageResolution(width, 1024)).toBeNull();
    expect(classifyImageResolution(1024, width)).toBeNull();
  });
});

describe("toResolutionProbeSrc", () => {
  it.each([
    ["asset-file://a/b.png?thumb=1", "asset-file://a/b.png"],
    ["asset-file://a/b.png?thumb=1&x=2", "asset-file://a/b.png?x=2"],
    ["asset-file://a/b.png?x=2&thumb=1", "asset-file://a/b.png?x=2"],
    ["asset-file://a/b.png?x=2&thumb=1&y=3", "asset-file://a/b.png?x=2&y=3"],
    ["asset-file://a/b.png", "asset-file://a/b.png"],
    ["project-file://p/x.png?thumb=1#frag", "project-file://p/x.png#frag"],
    ["https://host/i.png?size=thumb", "https://host/i.png?size=thumb"],
    ["", ""],
  ])("probes %s via %s", (input, expected) => {
    expect(toResolutionProbeSrc(input)).toBe(expected);
  });
});
