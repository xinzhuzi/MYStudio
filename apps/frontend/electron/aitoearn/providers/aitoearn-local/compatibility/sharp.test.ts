import { describe, expect, it } from "vitest";

import sharp from "./sharp";

function buildPng(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer, 0);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function buildJpeg(width: number, height: number): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08]),
    (() => {
      const size = Buffer.alloc(4);
      size.writeUInt16BE(height, 0);
      size.writeUInt16BE(width, 2);
      return size;
    })(),
    Buffer.alloc(8),
  ]);
}

describe("sharp compatibility shim", () => {
  it("reads PNG dimensions without loading the native sharp module", async () => {
    const metadata = await sharp(buildPng(1080, 1920)).metadata();

    expect(metadata).toEqual({ width: 1080, height: 1920, format: "png" });
  });

  it("reads JPEG dimensions", async () => {
    const metadata = await sharp(buildJpeg(720, 1280)).metadata();

    expect(metadata.width).toBe(720);
    expect(metadata.height).toBe(1280);
    expect(metadata.format).toBe("jpg");
  });

  it("rejects unsupported buffers instead of returning zeroed dimensions", async () => {
    await expect(sharp(Buffer.alloc(64)).metadata()).rejects.toThrow(
      "无法读取图片尺寸",
    );
  });
});
