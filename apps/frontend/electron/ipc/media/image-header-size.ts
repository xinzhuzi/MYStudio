// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 图片文件头像素尺寸解析(纯函数,零解码)。
 *
 * 供 `image-probe-size` IPC 使用:分辨率角标只需要宽高,读文件头几十字节
 * 即可,绝不为了量尺寸把整张多 MB 原图拉进渲染层解码(82 张 4K 同发曾把
 * 主进程与渲染层一起冻死)。解析不出(格式未知/头部截断)返回 null,
 * 由调用方决定回退策略。
 */

export interface ImageHeaderSize {
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function readU16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readU32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let result = "";
  for (let i = 0; i < length; i += 1) result += String.fromCharCode(bytes[offset + i]);
  return result;
}

function parsePngSize(bytes: Uint8Array): ImageHeaderSize | null {
  // IHDR 必为首块:长度 13 + "IHDR" + 宽(16..20) + 高(20..24)
  if (asciiAt(bytes, 12, 4) !== "IHDR") return null;
  const width = readU32be(bytes, 16);
  const height = readU32be(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function parseJpegSize(bytes: Uint8Array): ImageHeaderSize | null {
  // 扫 SOF0~SOF15(剔 C4/DHT、C8/JPG、CC/DAC):高在段内 +5、宽在 +7
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1; // 填充字节
      continue;
    }
    // 无长度段的独立标记:SOI/EOI/RST/TEM
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) return null; // 进入扫描数据仍未遇 SOF,放弃
    const segmentLength = readU16be(bytes, offset + 2);
    if (segmentLength < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = readU16be(bytes, offset + 5);
      const width = readU16be(bytes, offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function parseGifSize(bytes: Uint8Array): ImageHeaderSize | null {
  const width = readU16le(bytes, 6);
  const height = readU16le(bytes, 8);
  return width > 0 && height > 0 ? { width, height } : null;
}

function parseBmpSize(bytes: Uint8Array): ImageHeaderSize | null {
  const width = readU32le(bytes, 18);
  const height = Math.abs(readU32le(bytes, 22)); // 负高=自顶向下位图
  return width > 0 && height > 0 ? { width, height } : null;
}

function parseWebpSize(bytes: Uint8Array): ImageHeaderSize | null {
  const chunkTag = asciiAt(bytes, 12, 4);
  if (chunkTag === "VP8 ") {
    // 有损:帧标记 3B + 同步码 9D 01 2A,随后 14bit 宽/14bit 高(低 2bit 是缩放)
    const width = readU16le(bytes, 26) & 0x3fff;
    const height = readU16le(bytes, 28) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunkTag === "VP8L") {
    // 无损:0x2f 签名 + 4B 位域(14bit 宽-1 / 14bit 高-1)
    const bits = readU32le(bytes, 21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunkTag === "VP8X") {
    // 扩展:4B 标志 + 3B 画布宽-1 + 3B 画布高-1
    const width = readU24le(bytes, 24) + 1;
    const height = readU24le(bytes, 27) + 1;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

export function parseImageHeaderSize(bytes: Uint8Array): ImageHeaderSize | null {
  if (bytes.length >= 24 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return parsePngSize(bytes);
  }
  if (bytes.length >= 11 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return parseJpegSize(bytes);
  }
  if (bytes.length >= 10 && asciiAt(bytes, 0, 4) === "GIF8") {
    return parseGifSize(bytes);
  }
  if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return parseBmpSize(bytes);
  }
  if (bytes.length >= 30 && asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") {
    return parseWebpSize(bytes);
  }
  return null;
}
