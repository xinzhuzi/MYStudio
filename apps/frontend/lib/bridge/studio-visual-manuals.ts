/** Renderer-side adapter for the optional Electron studio-visual-manuals preload bridge. */
export type StudioVisualManualsBridge = NonNullable<Window["studioVisualManuals"]>;

export function getStudioVisualManualsBridge(): StudioVisualManualsBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.studioVisualManuals;
}
