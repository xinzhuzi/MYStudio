// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from "vitest";

import { normalizeH3DurationUs } from "@/lib/studio/h3-duration-us";

describe("normalizeH3DurationUs(h3DurationUs 真实时长守卫)", () => {
  it("正整数微秒原样通过", () => {
    expect(normalizeH3DurationUs(1)).toBe(1);
    expect(normalizeH3DurationUs(5_166_666)).toBe(5_166_666);
  });

  it.each([
    0,
    -1,
    -5_166_666,
    5.5,
    5_166_666.0001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    "5166666",
    null,
    undefined,
    true,
  ])("非法值 %p 一律拒绝为 undefined(不得写入分镜)", (value) => {
    expect(normalizeH3DurationUs(value)).toBeUndefined();
  });
});
