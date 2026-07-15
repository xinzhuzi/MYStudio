import type { EditingClip } from "@/types/editing";

const waveformCache = new Map<string, Promise<number[]>>();

export function downsampleAudioPeaks(
  channels: readonly Float32Array[],
  bucketCount: number,
) {
  if (!Number.isSafeInteger(bucketCount) || bucketCount <= 0 || channels.length === 0) return [];
  const sampleCount = Math.max(...channels.map((channel) => channel.length));
  if (sampleCount === 0) return Array.from({ length: bucketCount }, () => 0);
  const peaks = Array.from({ length: bucketCount }, (_, bucketIndex) => {
    const start = Math.floor((bucketIndex * sampleCount) / bucketCount);
    const end = Math.max(start + 1, Math.floor(((bucketIndex + 1) * sampleCount) / bucketCount));
    let peak = 0;
    for (const channel of channels) {
      for (let sampleIndex = start; sampleIndex < Math.min(end, channel.length); sampleIndex += 1) {
        peak = Math.max(peak, Math.abs(channel[sampleIndex] ?? 0));
      }
    }
    return peak;
  });
  const maximum = Math.max(...peaks);
  return maximum > 0 ? peaks.map((peak) => Number((peak / maximum).toFixed(6))) : peaks;
}

export function buildAudioWaveformCacheKey(clip: EditingClip, bucketCount = 48) {
  const evidence = clip.source.evidence;
  const source = evidence.sourceFingerprint
    ? `fingerprint:${evidence.sourceFingerprint}`
    : evidence.mediaId
      ? `media:${evidence.mediaId}:${evidence.outputVersion ?? 0}`
      : `path:${clip.source.path ?? clip.id}`;
  return `${source}:${bucketCount}`;
}

export function loadCachedAudioWaveform(
  key: string,
  loader: () => Promise<number[]>,
) {
  const existing = waveformCache.get(key);
  if (existing) return existing;
  const pending = loader().catch((error) => {
    waveformCache.delete(key);
    throw error;
  });
  waveformCache.set(key, pending);
  return pending;
}

export function clearAudioWaveformCache() {
  waveformCache.clear();
}
