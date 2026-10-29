import { describe, expect, it } from "vitest";
import { encodeOrderedSpeechWav } from "./storyboard-speech-wav";
const buffer = (values: number[], rate = 24000) => ({ numberOfChannels: 1, length: values.length, sampleRate: rate, getChannelData: () => Float32Array.from(values) });
describe("ordered speech PCM WAV", () => {
  it("writes actual ordered mono PCM16 samples without tails or silence", () => {
    const bytes = encodeOrderedSpeechWav([buffer([0.5, -0.5]), buffer([1, -1])]);
    const view = new DataView(bytes);
    expect(new TextDecoder().decode(new Uint8Array(bytes, 0, 4))).toBe("RIFF");
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(40, true)).toBe(8);
    expect([44, 46, 48, 50].map(i => view.getInt16(i, true))).toEqual([16384, -16384, 32767, -32768]);
  });
  it("downmixes channels deliberately and rejects rate mismatch, empty and invalid data", () => {
    const stereo = { ...buffer([0.5]), numberOfChannels: 2, getChannelData: (c: number) => Float32Array.from([c ? -0.5 : 0.5]) };
    expect(new DataView(encodeOrderedSpeechWav([stereo])).getInt16(44, true)).toBe(0);
    for (const buffers of [[], [buffer([])], [buffer([NaN])], [buffer([1], 1), buffer([1], 2)]]) expect(() => encodeOrderedSpeechWav(buffers)).toThrow();
  });
});
