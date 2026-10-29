import { decodeAudioFileBytes, type AudioBufferLike } from "./music-analysis";

/** Ordered PCM16 mono concatenation, no added gap or tail. Mixed rates fail explicitly. */
export function encodeOrderedSpeechWav(parts: AudioBufferLike[]): ArrayBuffer {
  if (!parts.length) throw new Error("声音片段为空");
  const rate = parts[0].sampleRate;
  if (!Number.isInteger(rate) || rate <= 0) throw new Error("声音采样率无效");
  let length = 0;
  for (const part of parts) {
    if (part.sampleRate !== rate) throw new Error("声音片段采样率不一致");
    if (!Number.isSafeInteger(part.length) || part.length <= 0 || !Number.isInteger(part.numberOfChannels) || part.numberOfChannels < 1) throw new Error("声音片段无效");
    length += part.length;
  }
  if (!Number.isSafeInteger(length) || length * 2 > 0xffffffff - 36) throw new Error("声音片段过大");
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const tag = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  tag(0, "RIFF"); view.setUint32(4, 36 + length * 2, true); tag(8, "WAVE");
  tag(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, "data"); view.setUint32(40, length * 2, true);
  let cursor = 44;
  for (const part of parts) {
    const channels = Array.from({ length: part.numberOfChannels }, (_, c) => part.getChannelData(c));
    if (channels.some((data) => data.length !== part.length)) throw new Error("声音声道长度不匹配");
    for (let i = 0; i < part.length; i++) {
      let sample = 0;
      for (const channel of channels) {
        if (!Number.isFinite(channel[i])) throw new Error("声音包含非有限样本");
        sample += channel[i] / channels.length;
      }
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(cursor, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      cursor += 2;
    }
  }
  return bytes;
}

export async function composeOrderedSpeechAudio(parts: ArrayBuffer[]): Promise<ArrayBuffer> {
  const decoded: AudioBufferLike[] = [];
  for (const bytes of parts) {
    if (!bytes.byteLength) throw new Error("声音片段为空");
    decoded.push(await decodeAudioFileBytes(new Uint8Array(bytes)));
  }
  return encodeOrderedSpeechWav(decoded);
}
