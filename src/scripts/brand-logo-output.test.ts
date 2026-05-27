import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const logoPath = fileURLToPath(new URL("../assets/brand/logo.png", import.meta.url));
const dragonSourcePath = fileURLToPath(new URL("../assets/brand/dragon-emblem-source.png", import.meta.url));

type Pixel = [number, number, number, number];

async function readPixel(x: number, y: number): Promise<Pixel> {
  const { data, info } = await sharp(logoPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const index = (y * info.width + x) * info.channels;
  return Array.from(data.slice(index, index + 4)) as Pixel;
}

function isGoldPixel([red, green, blue, alpha]: Pixel) {
  return alpha > 200 && red > 130 && green > 80 && red > blue * 1.35 && green > blue * 1.1;
}

describe("generated brand logo", () => {
  it("removes the outer gold ring while preserving the dragon ribbon", async () => {
    const formerRingPixels = await Promise.all([
      readPixel(512, 84),
      readPixel(118, 410),
      readPixel(906, 410),
      readPixel(512, 944),
    ]);

    expect(formerRingPixels.some(isGoldPixel)).toBe(false);
    expect(isGoldPixel(await readPixel(250, 790))).toBe(true);
  });
});

describe("transparent dragon source", () => {
  it("has real transparent edges instead of baked checkerboard pixels", async () => {
    const { data, info } = await sharp(dragonSourcePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const edgePoints = [
      [0, 0],
      [Math.floor(info.width * 0.08), 0],
      [info.width - 1, 0],
      [0, info.height - 1],
      [info.width - 1, info.height - 1],
      [0, Math.floor(info.height / 2)],
      [info.width - 1, Math.floor(info.height / 2)],
      [Math.floor(info.width / 2), info.height - 1],
    ];

    const edgeAlphas = edgePoints.map(([x, y]) => {
      const index = (y * info.width + x) * info.channels;
      return data[index + 3];
    });

    expect(edgeAlphas).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
