/** Renderer-side adapter for the optional Electron studio-assets preload bridge. */
export type StudioAssetsBridge = NonNullable<Window["studioAssets"]>;

export function getStudioAssetsBridge(): StudioAssetsBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.studioAssets;
}
