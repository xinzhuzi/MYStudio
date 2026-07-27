const TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

export default function crc32(input: Buffer | string) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ TABLE[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}
