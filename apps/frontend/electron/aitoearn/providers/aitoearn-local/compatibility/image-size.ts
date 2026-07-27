type ImageDimensions = { width: number; height: number; type?: string };

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xc3;
    if (isFrame && offset + 8 < buffer.length) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), type: "jpg" };
    }
    offset += 2 + length;
  }
  return null;
}

export default function imageSize(buffer: Buffer): ImageDimensions {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), type: "png" };
  }
  const jpeg = readJpegDimensions(buffer);
  if (jpeg) return jpeg;
  throw new Error("无法读取图片尺寸");
}
