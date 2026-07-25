/** Renderer-side adapter for the optional Electron storage-manager preload bridge. */
export type StorageManagerBridge = NonNullable<Window["storageManager"]>;

export function getStorageManagerBridge(): StorageManagerBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.storageManager;
}
