import { describe, expect, it } from "vitest";
import { useSClassStore } from "./sclass-store";

const options = () => useSClassStore.persist.getOptions() as {
  name?: string;
  partialize?: (state: ReturnType<typeof useSClassStore.getState>) => unknown;
  merge?: (persisted: unknown, current: ReturnType<typeof useSClassStore.getState>) => ReturnType<typeof useSClassStore.getState>;
};

describe("sclass persistence characterization", () => {
  it("keeps the project-scoped key and persists only the active project", () => {
    const configured = options();
    expect(configured.name).toBe("mystudio-sclass-store");

    const persisted = configured.partialize?.({
      ...useSClassStore.getState(),
      activeProjectId: "p1",
      projects: {
        p1: { marker: "active" },
        p2: { marker: "other" },
      },
      selectedGroupId: "transient-group",
      generationMode: "single",
    } as never) as { activeProjectId: string; projectData: unknown; generationMode: string };

    expect(persisted).toEqual({
      activeProjectId: "p1",
      projectData: { marker: "active" },
      generationMode: "single",
    });
    expect(JSON.stringify(persisted)).not.toContain("other");
    expect(JSON.stringify(persisted)).not.toContain("transient-group");
  });

  it("persists null project data when no project is active", () => {
    const configured = options();

    const persisted = configured.partialize?.({
      ...useSClassStore.getState(),
      activeProjectId: null,
      projects: {
        p1: { marker: "inactive" },
      },
      selectedGroupId: "transient-group",
      generationMode: "group",
    } as never) as { activeProjectId: null; projectData: unknown; generationMode: string };

    expect(persisted).toEqual({
      activeProjectId: null,
      projectData: null,
      generationMode: "group",
    });
    expect(JSON.stringify(persisted)).not.toContain("inactive");
    expect(JSON.stringify(persisted)).not.toContain("transient-group");
  });

  it("merges current per-project data and removes legacy config fields", () => {
    const configured = options();
    const current = { ...useSClassStore.getState(), activeProjectId: null, projects: {} };
    const merged = configured.merge?.({
      activeProjectId: "p1",
      generationMode: "single",
      projectData: {
        config: { defaultDuration: 8, concurrency: 2, aspectRatio: "16:9", resolution: "720p" },
        editorPrefs: { activeTab: "trailer" },
      },
    }, current as never) as ReturnType<typeof useSClassStore.getState>;

    expect(merged.activeProjectId).toBe("p1");
    expect(merged.generationMode).toBe("single");
    expect(merged.projects["p1"]?.config).toEqual({ defaultDuration: 8, concurrency: 2 });
    expect(merged.projects["p1"]?.editorPrefs.activeTab).toBe("trailer");
  });

  it("merges legacy project maps while preserving the current shell", () => {
    const configured = options();
    const current = { ...useSClassStore.getState(), activeProjectId: "current" };
    const merged = configured.merge?.({ projects: { legacy: { config: { concurrency: 3 } } } }, current as never) as ReturnType<typeof useSClassStore.getState>;

    expect(merged.activeProjectId).toBe("current");
    expect(merged.projects["legacy"]?.config).toEqual({ defaultDuration: 10, concurrency: 3 });
  });
});
