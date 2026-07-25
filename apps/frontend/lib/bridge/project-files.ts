/** Renderer-side adapter for the optional Electron project-files preload bridge. */
export type ProjectFilesBridge = NonNullable<Window["projectFiles"]>;

export function getProjectFilesBridge(): ProjectFilesBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.projectFiles;
}
