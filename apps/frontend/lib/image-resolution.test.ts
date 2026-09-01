import { describe, expect, it } from "vitest";
import { toResolutionProbeSrc } from "@/lib/image-resolution";

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
