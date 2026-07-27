import { Audio } from "@remotion/media";
import { Sequence } from "remotion";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const SILENCE_DURATION_MS = 100;
const SILENT_STEREO_WAV_URL = createSilentStereoWavUrl();

export function SilentAudioTrack({
  durationInFrames,
}: {
  durationInFrames: number;
}): React.ReactElement {
  return (
    <Sequence durationInFrames={durationInFrames} layout="none">
      <Audio src={SILENT_STEREO_WAV_URL} loop />
    </Sequence>
  );
}

function createSilentStereoWavUrl(): string {
  const sampleCount = Math.round((SAMPLE_RATE * SILENCE_DURATION_MS) / 1_000);
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const dataLength = sampleCount * CHANNELS * bytesPerSample;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(bytes, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNELS * bytesPerSample, true);
  view.setUint16(32, CHANNELS * bytesPerSample, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataLength, true);

  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}
