/** Renderer-side adapter for the optional Electron file-storage preload bridge. */
export type FileStorageBridge = NonNullable<Window["fileStorage"]>;

export function getFileStorageBridge(): FileStorageBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.fileStorage;
}
