import { describe, expect, it } from "vitest";
import { parseImageHeaderSize } from "./image-header-size";

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR 长度 13
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function jpegBytes(width: number, height: number): Uint8Array {
  // SOI + 标准 JFIF APP0(段长 16=长度域2+负载14) + SOF0(高在前、宽在后)
  const bytes = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0, length 16
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x02, // version
    0x01, // units
    0x00, 0x01, 0x00, 0x01, // densities
    0x00, 0x00, // thumbnail
    0xff, 0xc0, 0x00, 0x11, // SOF0, length 17
    0x08, // precision
    0x00, 0x00, 0x00, 0x00, // height @25-26, width @27-28
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint16(25, height, false);
  view.setUint16(27, width, false);
  return bytes;
}

function gifBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00, 0x00, 0x00,
  ]);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bytes;
}

function webpLosslessBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00], 0); // RIFF
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
  bytes.set([0x00, 0x00, 0x00, 0x00], 16); // 块长
  bytes[20] = 0x2f;
  const bits = ((height - 1) << 14) | (width - 1);
  new DataView(bytes.buffer).setUint32(21, bits >>> 0, true);
  return bytes;
}

function webpExtendedBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  bytes.set([0x0a, 0x00, 0x00, 0x00], 16);
  bytes[20] = 0x00; // flags
  bytes[21] = 0x00;
  bytes[22] = 0x00;
  bytes[23] = 0x00;
  const view = new DataView(bytes.buffer);
  view.setUint8(24, (width - 1) & 0xff);
  view.setUint8(25, ((width - 1) >> 8) & 0xff);
  view.setUint8(26, ((width - 1) >> 16) & 0xff);
  view.setUint8(27, (height - 1) & 0xff);
  view.setUint8(28, ((height - 1) >> 8) & 0xff);
  view.setUint8(29, ((height - 1) >> 16) & 0xff);
  return bytes;
}

function bmpBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(26);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  const view = new DataView(bytes.buffer);
  view.setUint32(18, width, true);
  view.setUint32(22, height, true);
  return bytes;
}

describe("parseImageHeaderSize", () => {
  it("parses PNG IHDR dimensions (4K)", () => {
    expect(parseImageHeaderSize(pngBytes(3840, 2160))).toEqual({ width: 3840, height: 2160 });
  });

  it("parses JPEG SOF0 dimensions", () => {
    expect(parseImageHeaderSize(jpegBytes(2016, 1536))).toEqual({ width: 2016, height: 1536 });
  });

  it("parses GIF logical screen dimensions", () => {
    expect(parseImageHeaderSize(gifBytes(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it("parses WebP lossless dimensions", () => {
    expect(parseImageHeaderSize(webpLosslessBytes(1280, 720))).toEqual({ width: 1280, height: 720 });
  });

  it("parses WebP extended (VP8X) canvas dimensions", () => {
    expect(parseImageHeaderSize(webpExtendedBytes(3840, 2160))).toEqual({ width: 3840, height: 2160 });
  });

  it("parses BMP dimensions", () => {
    expect(parseImageHeaderSize(bmpBytes(1024, 768))).toEqual({ width: 1024, height: 768 });
  });

  it("returns null for non-image bytes", () => {
    expect(parseImageHeaderSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull();
    expect(parseImageHeaderSize(new TextEncoder().encode("hello world, not an image at all"))).toBeNull();
  });

  it("returns null for truncated headers", () => {
    expect(parseImageHeaderSize(pngBytes(10, 10).subarray(0, 10))).toBeNull();
    expect(parseImageHeaderSize(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it("returns null when PNG IHDR block is missing", () => {
    const bytes = pngBytes(10, 10);
    bytes.set([0x49, 0x48, 0x44, 0x52].map((b) => b ^ 0xff), 12);
    expect(parseImageHeaderSize(bytes)).toBeNull();
  });
});
