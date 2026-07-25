import type { DirectorStore } from "./director-store-types";

export type DirectorStoryboardActions = Pick<
  DirectorStore,
  "setStoryboardImage" | "setStoryboardStatus" | "setStoryboardError" | "setProjectFolderId"
>;

type SetDirectorState = (partial: Partial<DirectorStore>) => void;
type GetDirectorState = () => DirectorStore;

export function createDirectorStoryboardActions(
  set: SetDirectorState,
  get: GetDirectorState,
): DirectorStoryboardActions {
  return {
    setStoryboardImage: (imageUrl, mediaId) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...projects[activeProjectId],
            storyboardImage: imageUrl,
            storyboardImageMediaId: mediaId ?? null,
          },
        },
      });
    },

    setStoryboardStatus: (status) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...projects[activeProjectId], storyboardStatus: status },
        },
      });
    },

    setProjectFolderId: (folderId) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      set({
        projects: {
          ...projects,
          [activeProjectId]: { ...projects[activeProjectId], projectFolderId: folderId },
        },
      });
    },

    setStoryboardError: (error) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const currentProject = projects[activeProjectId];
      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...currentProject,
            storyboardError: error,
            storyboardStatus: error ? "error" : currentProject?.storyboardStatus || "idle",
          },
        },
      });
    },
  };
}
