import { describe, expect, it } from "vitest";
import {
  CROP_DEFAULT,
  CROP_MIN,
  moveCropRect,
  resizeCropRect,
  simplestRatio,
  cropPixelSize,
  type NormRect,
} from "./crop-geometry";

const BOX = { width: 600, height: 400 };

describe("moveCropRect", () => {
  it("平移并 clamp 在界内", () => {
    const r: NormRect = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };
    const moved = moveCropRect(r, 0.1, 0.1);
    expect(moved.x).toBeCloseTo(0.3);
    expect(moved.y).toBeCloseTo(0.3);
    expect(moved.width).toBe(0.5);
    // 左上越界 → 贴 0
    expect(moveCropRect(r, -1, -1)).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
    // 右下越界 → 贴 1-尺寸
    expect(moveCropRect(r, 1, 1)).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  });
});

describe("resizeCropRect 自由比例", () => {
  it("se 手柄:右下扩张", () => {
    const r: NormRect = { x: 0.1, y: 0.1, width: 0.4, height: 0.4 };
    expect(resizeCropRect(r, "se", 0.1, 0.05, false, BOX)).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.45 });
  });
  it("nw 手柄:左上收缩,x/y 随动", () => {
    const r: NormRect = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };
    const next = resizeCropRect(r, "nw", 0.1, 0.1, false, BOX);
    expect(next.x).toBeCloseTo(0.3);
    expect(next.y).toBeCloseTo(0.3);
    expect(next.width).toBeCloseTo(0.4);
    expect(next.height).toBeCloseTo(0.4);
  });
  it("尺寸下限 CROP_MIN 兜底", () => {
    const r: NormRect = { x: 0.2, y: 0.2, width: 0.2, height: 0.2 };
    const next = resizeCropRect(r, "se", -0.5, -0.5, false, BOX);
    expect(next.width).toBe(CROP_MIN);
    expect(next.height).toBe(CROP_MIN);
  });
});

describe("resizeCropRect 锁比例", () => {
  it("locked:按显示像素等比(se 手柄放大)", () => {
    const r: NormRect = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
    // w*600=300, h*400=200 → size 基准 300;扩 0.1 归一化宽(60px)后:
    // next.w=0.6*600=360, next.h=0.5*400=200 → size=360 → h=360/400=0.9
    const next = resizeCropRect(r, "se", 0.1, 0, true, BOX);
    expect(next.width).toBeCloseTo(0.6);
    expect(next.height).toBeCloseTo(0.9);
    expect(next.width * BOX.width).toBeCloseTo(next.height * BOX.height);
  });
});

describe("cropPixelSize / simplestRatio", () => {
  it("像素尺寸取整", () => {
    expect(cropPixelSize({ x: 0, y: 0, width: 0.5, height: 0.25 }, { width: 1000, height: 800 }))
      .toEqual({ width: 500, height: 200 });
  });
  it("比例最简化", () => {
    expect(simplestRatio(500, 200)).toBe("5:2");
    expect(simplestRatio(768, 768)).toBe("1:1");
    expect(simplestRatio(600, 800)).toBe("3:4");
  });
});

describe("CROP_DEFAULT 合法性", () => {
  it("默认框在界内且不小于下限", () => {
    expect(CROP_DEFAULT.x + CROP_DEFAULT.width).toBeLessThanOrEqual(1);
    expect(CROP_DEFAULT.y + CROP_DEFAULT.height).toBeLessThanOrEqual(1);
    expect(CROP_DEFAULT.width).toBeGreaterThanOrEqual(CROP_MIN);
  });
});
