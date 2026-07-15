import { useEffect, useState } from "react";
import {
  buildAudioWaveformCacheKey,
  downsampleAudioPeaks,
  loadCachedAudioWaveform,
} from "@/lib/studio/editing/audio-waveform";
import type { EditingClip } from "@/types/editing";
import { toPreviewSrc } from "./WorkbenchTrackCard";

export type AudioWaveformState =
  | { status: "idle" | "loading" | "error"; peaks: number[] }
  | { status: "ready"; peaks: number[] };

export function useAudioWaveform(clip?: EditingClip, bucketCount = 48) {
  const [state, setState] = useState<AudioWaveformState>({ status: "idle", peaks: [] });

  useEffect(() => {
    const sourcePath = clip?.source.path;
    if (!clip || !sourcePath) {
      setState({ status: "idle", peaks: [] });
      return undefined;
    }
    let active = true;
    const key = buildAudioWaveformCacheKey(clip, bucketCount);
    setState({ status: "loading", peaks: [] });
    void loadCachedAudioWaveform(key, () => decodeAudioPeaks(toPreviewSrc(sourcePath), bucketCount))
      .then((peaks) => {
        if (active) setState({ status: "ready", peaks });
      })
      .catch(() => {
        if (active) setState({ status: "error", peaks: [] });
      });
    return () => {
      active = false;
    };
  }, [bucketCount, clip]);

  return state;
}

async function decodeAudioPeaks(source: string, bucketCount: number) {
  if (typeof AudioContext === "undefined") throw new Error("Web Audio 不可用");
  const response = await fetch(source);
  if (!response.ok) throw new Error(`音频读取失败: ${response.status}`);
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    return downsampleAudioPeaks(channels, bucketCount);
  } finally {
    await context.close();
  }
}
