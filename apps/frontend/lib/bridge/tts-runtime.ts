/** Renderer-side adapter for the optional Electron TTS runtime preload bridge. */
export type TtsRuntimeBridge = NonNullable<Window["ttsRuntime"]>;

export function getTtsRuntimeBridge(): TtsRuntimeBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.ttsRuntime;
}
