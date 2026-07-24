import type { DirectorStore } from "./director-store-types";

export type DirectorTrailerActions = Pick<
  DirectorStore,
  "setTrailerDuration" | "setTrailerScenes" | "setTrailerConfig" | "clearTrailer"
>;

type SetDirectorState = (partial: Partial<DirectorStore>) => void;
type GetDirectorState = () => DirectorStore;

export function createDirectorTrailerActions(
  set: SetDirectorState,
  get: GetDirectorState,
): DirectorTrailerActions {
  return {
    setTrailerDuration: (duration) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...project,
            trailerConfig: { ...project.trailerConfig, duration },
          },
        },
      });
      console.log("[DirectorStore] Trailer duration set to:", duration);
    },

    setTrailerScenes: (scenes) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...project,
            trailerScenes: scenes,
            trailerConfig: {
              ...project.trailerConfig,
              generatedAt: Date.now(),
              status: "completed",
            },
          },
        },
      });
      console.log("[DirectorStore] Trailer scenes set:", scenes.length, "scenes");
    },

    setTrailerConfig: (config) => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...project,
            trailerConfig: { ...project.trailerConfig, ...config },
          },
        },
      });
      console.log("[DirectorStore] Trailer config updated:", config);
    },

    clearTrailer: () => {
      const { activeProjectId, projects } = get();
      if (!activeProjectId) return;
      const project = projects[activeProjectId];
      set({
        projects: {
          ...projects,
          [activeProjectId]: {
            ...project,
            trailerConfig: { duration: 30, shotIds: [], status: "idle" },
            trailerScenes: [],
          },
        },
      });
      console.log("[DirectorStore] Trailer cleared");
    },
  };
}
