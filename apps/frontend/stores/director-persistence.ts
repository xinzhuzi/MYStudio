import type { GenerationConfig } from "@opencut/ai-core";
import { normalizeDirectorProjectData } from "./director-project-defaults";
import type { DirectorProjectData, DirectorStore, SplitScene } from "./director-store";

export interface DirectorPersistedState {
  activeProjectId: string | null;
  projectData: DirectorProjectData | null;
  config: GenerationConfig;
}

const stripBase64 = (value: string | null | undefined): string | null | undefined => {
  if (!value) return value;
  return value.startsWith("data:") ? "" : value;
};

const stripSceneBase64 = (scene: SplitScene): SplitScene => ({
  ...scene,
  imageDataUrl: stripBase64(scene.imageDataUrl) ?? "",
  endFrameImageUrl: stripBase64(scene.endFrameImageUrl) as string | null,
  sceneReferenceImage: stripBase64(scene.sceneReferenceImage) as string | undefined,
  endFrameSceneReferenceImage: stripBase64(scene.endFrameSceneReferenceImage) as string | undefined,
});

export function partializeDirectorStore(state: DirectorStore): DirectorPersistedState {
  const project = state.activeProjectId ? state.projects[state.activeProjectId] : undefined;
  const projectData = project ? {
    ...project,
    storyboardImage: stripBase64(project.storyboardImage) ?? null,
    splitScenes: project.splitScenes.map(stripSceneBase64),
    trailerScenes: project.trailerScenes.map(stripSceneBase64),
  } : null;
  return { activeProjectId: state.activeProjectId, projectData, config: state.config };
}

export function mergeDirectorStore(persisted: unknown, current: DirectorStore): DirectorStore {
  if (!persisted || typeof persisted !== "object") return current;
  const data = persisted as Record<string, unknown>;
  if (data.projects && typeof data.projects === "object") {
    const normalizedProjects: Record<string, DirectorProjectData> = {};
    for (const [projectId, projectData] of Object.entries(data.projects)) {
      normalizedProjects[projectId] = normalizeDirectorProjectData(projectData);
    }
    return { ...current, ...data, projects: normalizedProjects } as DirectorStore;
  }

  const updates: DirectorStore = { ...current };
  if (data.config) updates.config = data.config as GenerationConfig;
  if (typeof data.activeProjectId === "string") updates.activeProjectId = data.activeProjectId;
  if (typeof data.activeProjectId === "string" && data.projectData) {
    updates.projects = {
      ...current.projects,
      [data.activeProjectId]: normalizeDirectorProjectData(data.projectData),
    };
  }
  return updates;
}
