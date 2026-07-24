import type { TtsModelRow } from "@/types/tts";

export interface ModelProgressEvent {
  model_name: string;
  current: number;
  total: number;
  progress: number;
  filename?: string;
  status: "idle" | "downloading" | "complete" | "error" | string;
  error?: string;
}

export type LocalTtsModelState = "loaded" | "downloading" | "downloaded" | "failed" | "missing";

export function getLocalTtsModelState(
  row: TtsModelRow,
  progress?: ModelProgressEvent,
): LocalTtsModelState {
  if (row.loaded) return "loaded";
  if (row.downloading) return "downloading";
  if (row.downloaded) return "downloaded";
  if (progress?.status === "downloading") return "downloading";
  if (progress?.status === "complete") return "downloaded";
  if (progress?.status === "error") return "failed";
  return "missing";
}
