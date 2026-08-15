/** Renderer-side adapter for the optional Electron project-folder preload bridge. */
export type ProjectFolderBridge = NonNullable<Window["projectFolder"]>;

/**
 * Bridge surface (phase 1: prepare/rename/remove/status; phase 2:
 * move/cancelMove/importFolder/onMoveProgress). The window type is the single
 * source of truth — `Window["projectFolder"]` intersects the main-process
 * contract with the phase-2 move/import surface declared in types/electron.d.ts.
 */
export function getProjectFolderBridge(): ProjectFolderBridge | undefined {
  // Non-Electron environments have no preload bridge: return undefined so
  // callers degrade gracefully (onMoveProgress etc. are simply unreachable).
  if (typeof window === "undefined") return undefined;
  return window.projectFolder;
}
