import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const events: string[] = [];

  function createScopedStore(name: string) {
    const state = {
      setActiveProjectId: vi.fn((projectId: string) => {
        events.push(`${name}:sync:${projectId}`);
      }),
      ensureProject: vi.fn(),
    };
    return {
      getState: () => state,
      persist: {
        rehydrate: vi.fn(async () => {
          events.push(`${name}:rehydrate`);
        }),
      },
    };
  }

  const projectState = {
    activeProjectId: "project-1" as string | null,
    setActiveProject: vi.fn((projectId: string) => {
      events.push(`project:route:${projectId}`);
      projectState.activeProjectId = projectId;
    }),
  };

  return {
    events,
    projectState,
    projectStore: { getState: () => projectState },
    scriptStore: createScopedStore("script"),
    directorStore: createScopedStore("director"),
    mediaStore: createScopedStore("media"),
    characterStore: createScopedStore("character"),
    sceneStore: createScopedStore("scene"),
    simpleTimelineStore: createScopedStore("simple-timeline"),
    sclassStore: createScopedStore("sclass"),
    ttsStore: createScopedStore("tts"),
    editingStore: createScopedStore("editing"),
  };
});

vi.mock("@/stores/project-store", () => ({
  useProjectStore: mocks.projectStore,
}));
vi.mock("@/stores/script-store", () => ({
  useScriptStore: mocks.scriptStore,
}));
vi.mock("@/stores/director-store", () => ({
  useDirectorStore: mocks.directorStore,
}));
vi.mock("@/stores/media-store", () => ({
  useMediaStore: mocks.mediaStore,
}));
vi.mock("@/stores/character-library-store", () => ({
  useCharacterLibraryStore: mocks.characterStore,
}));
vi.mock("@/stores/scene-store", () => ({
  useSceneStore: mocks.sceneStore,
}));
vi.mock("@/stores/simple-timeline-store", () => ({
  useSimpleTimelineStore: mocks.simpleTimelineStore,
}));
vi.mock("@/stores/sclass-store", () => ({
  useSClassStore: mocks.sclassStore,
}));
vi.mock("@/stores/tts-store", () => ({
  useTtsStore: mocks.ttsStore,
}));
vi.mock("@/stores/editing-store", () => ({
  useEditingStore: mocks.editingStore,
}));

import { switchProject } from "./project-switcher";

describe("switchProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.projectState.activeProjectId = "project-1";
  });

  it("rehydrates editing state before synchronizing its active project", async () => {
    await switchProject("project-2");

    expect(mocks.editingStore.persist.rehydrate).toHaveBeenCalledOnce();
    expect(
      mocks.editingStore.getState().setActiveProjectId,
    ).toHaveBeenCalledWith("project-2");
    expect(mocks.events.indexOf("editing:rehydrate")).toBeLessThan(
      mocks.events.indexOf("editing:sync:project-2"),
    );
  });
});
