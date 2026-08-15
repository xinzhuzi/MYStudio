/** Renderer-side adapter for the optional Electron project-folder preload bridge. */
export type ProjectFolderBridge = NonNullable<Window["projectFolder"]>;

export function getProjectFolderBridge(): ProjectFolderBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.projectFolder;
}
