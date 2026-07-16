import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(async () => null),
  removeItem: vi.fn(async () => undefined),
  setItem: vi.fn(async () => undefined),
}));

vi.mock("@/lib/project-storage", () => ({
  createProjectScopedStorage: () => ({
    getItem: mocks.getItem,
    removeItem: mocks.removeItem,
    setItem: mocks.setItem,
  }),
}));

import type { ScriptStorePersistenceState } from "./script-store-persistence";
import { useScriptStore } from "./script-store";
import {
  createDefaultScriptProjectData,
  mergeScriptStoreState,
  normalizeScriptProjectData,
  partializeScriptStoreState,
  flushRecoveredCharactersToDisk,
} from "./script-store-persistence";

function resetScriptStore() {
  useScriptStore.setState({ activeProjectId: null, projects: {} });
}

describe("script store defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetScriptStore();
  });

  afterEach(resetScriptStore);

  it("initializes new projects with the canonical Chinese script language", () => {
    useScriptStore.getState().ensureProject("project-default-language");

    expect(useScriptStore.getState().projects["project-default-language"]?.language).toBe("中文");
  });

  it("persists only the active project with the legacy-compatible store key", () => {
    const current = {
      activeProjectId: "project-active",
      projects: {
        "project-active": createDefaultScriptProjectData(),
        "project-other": createDefaultScriptProjectData(),
      },
      setScriptData: vi.fn(),
    } satisfies ScriptStorePersistenceState;

    expect(partializeScriptStoreState(current)).toEqual({
      activeProjectId: "project-active",
      projectData: current.projects["project-active"],
    });
    expect(useScriptStore.persist.getOptions().name).toBe("mystudio-script-store");
  });

  it("merges modern project data without dropping other projects", () => {
    const current = {
      activeProjectId: "project-current",
      projects: {
        "project-current": createDefaultScriptProjectData(),
      },
      setScriptData: vi.fn(),
    } satisfies ScriptStorePersistenceState;

    const merged = mergeScriptStoreState(
      {
        activeProjectId: "project-restored",
        projectData: { rawScript: "restored script" },
      },
      current,
    );

    expect(merged.activeProjectId).toBe("project-restored");
    expect(merged.projects["project-current"]).toBe(current.projects["project-current"]);
    expect(merged.projects["project-restored"]).toMatchObject({
      rawScript: "restored script",
      language: "中文",
      targetDuration: "60s",
      promptLanguage: "zh",
    });
  });

  it("keeps current state when persisted data has no active project", () => {
    const current = {
      activeProjectId: "project-current",
      projects: { "project-current": createDefaultScriptProjectData() },
      setScriptData: vi.fn(),
    } satisfies ScriptStorePersistenceState;

    expect(mergeScriptStoreState({ activeProjectId: null }, current)).toBe(current);
    expect(mergeScriptStoreState(null, current)).toBe(current);
  });

  it("normalizes legacy projects and flushes recovered series characters", () => {
    const normalized = normalizeScriptProjectData("project-recovered", {
      scriptData: {
        title: "Recovered",
        language: "中文",
        characters: [],
        scenes: [],
        episodes: [],
        storyParagraphs: [],
      },
      seriesMeta: {
        title: "Series",
        characters: [{ id: "", name: "  主角  ", tags: ["#主角", "#主角"] }],
      },
      calibrationState: { pendingFilteredCharacters: null },
    });
    const setScriptData = vi.fn();
    const state = {
      activeProjectId: "project-recovered",
      projects: { "project-recovered": normalized },
      setScriptData,
    } satisfies ScriptStorePersistenceState;

    expect(normalized.inputDraft).toEqual({ mode: "import", idea: "", updatedAt: 0 });
    expect(normalized.scriptData?.characters).toEqual([
      { id: "char_recovered_1", name: "主角", tags: ["#主角"] },
    ]);

    flushRecoveredCharactersToDisk(state);
    expect(setScriptData).toHaveBeenCalledWith("project-recovered", expect.objectContaining({
      characters: normalized.scriptData?.characters,
    }));
  });
});
