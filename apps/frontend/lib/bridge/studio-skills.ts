/** Renderer-side adapter for the optional Electron studio-skills preload bridge. */
export type StudioSkillsBridge = NonNullable<Window["studioSkills"]>;

export function getStudioSkillsBridge(): StudioSkillsBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.studioSkills;
}
