/**
 * 裁剪框几何(09-01-extraction-crop):归一化框纯函数,零 React 零 DOM。
 * 交互形态参考 infinite-canvas 的裁剪交互设计(研究档 §二),实现从零(AGPL)。
 */

export interface NormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const CROP_HANDLES: readonly CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const CROP_MIN = 0.06;

export const CROP_DEFAULT: NormRect = { x: 0.12, y: 0.12, width: 0.76, height: 0.76 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampRect(rect: NormRect): NormRect {
  const width = clamp(rect.width, CROP_MIN, 1);
  const height = clamp(rect.height, CROP_MIN, 1);
  return {
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
    width,
    height,
  };
}

/** 框体拖移:归一化增量,越界 clamp */
export function moveCropRect(rect: NormRect, dxN: number, dyN: number): NormRect {
  return clampRect({ ...rect, x: rect.x + dxN, y: rect.y + dyN });
}

/**
 * 手柄 resize:dx/dy 为归一化增量(相对显示盒)。
 * locked=按显示像素等比:目标尺寸取 max(w*boxW, h*boxH) 双向同缩,
 * w/n 手柄回推 x/y 保持对边不动。
 */
export function resizeCropRect(
  rect: NormRect,
  handle: CropHandle,
  dxN: number,
  dyN: number,
  locked: boolean,
  box: { width: number; height: number },
): NormRect {
  const next: NormRect = { ...rect };
  if (handle.includes("e")) next.width = rect.width + dxN;
  if (handle.includes("s")) next.height = rect.height + dyN;
  if (handle.includes("w")) {
    next.x = rect.x + dxN;
    next.width = rect.width - dxN;
  }
  if (handle.includes("n")) {
    next.y = rect.y + dyN;
    next.height = rect.height - dyN;
  }
  if (locked) {
    const size = Math.max(next.width * box.width, next.height * box.height);
    next.width = size / box.width;
    next.height = size / box.height;
    if (handle.includes("w")) next.x = rect.x + rect.width - next.width;
    if (handle.includes("n")) next.y = rect.y + rect.height - next.height;
  }
  return clampRect(next);
}

/** 归一化框 → 目标图整像素尺寸 */
export function cropPixelSize(rect: NormRect, image: { width: number; height: number }): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(rect.width * image.width)),
    height: Math.max(1, Math.round(rect.height * image.height)),
  };
}

/** 最简比例(gcd 化简,"3:4") */
export function simplestRatio(width: number, height: number): string {
  const divisor = gcd(Math.round(width), Math.round(height));
  return `${Math.round(width) / divisor}:${Math.round(height) / divisor}`;
}

function gcd(a: number, b: number): number {
  let x = Math.max(1, Math.abs(Math.round(a)));
  let y = Math.max(1, Math.abs(Math.round(b)));
  while (y) {
    [x, y] = [y, x % y];
  }
  return x;
}
