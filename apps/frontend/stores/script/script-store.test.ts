import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(async () => null),
  removeItem: vi.fn(async () => undefined),
  setItem: vi.fn(async () => undefined),
}));

vi.mock("@/lib/storage/project-storage", () => ({
  createProjectScopedStorage: () => ({
    getItem: mocks.getItem,
    removeItem: mocks.removeItem,
    setItem: mocks.setItem,
  }),
}));

import type { ScriptStorePersistenceState } from "./script-store-persistence";
import { selectActiveScriptProject, useScriptStore } from "./script-store";
import {
  createDefaultScriptProjectData,
  defaultCalibrationState,
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

  it("uses the canonical calibration defaults for new projects", () => {
    expect(createDefaultScriptProjectData().calibrationState).toEqual(defaultCalibrationState());
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

describe("active script project selector", () => {
  it("returns null when no project is active", () => {
    expect(
      selectActiveScriptProject({ activeProjectId: null, projects: {} }),
    ).toBeNull();
  });

  it("returns null when the active project is missing", () => {
    expect(
      selectActiveScriptProject({
        activeProjectId: "missing",
        projects: {},
      }),
    ).toBeNull();
  });

  it("returns the active project without cloning it", () => {
    const project = createDefaultScriptProjectData();
    expect(
      selectActiveScriptProject({
        activeProjectId: "active",
        projects: { active: project },
      }),
    ).toBe(project);
  });

  it("derives fallback seriesMeta by stripping the EP suffix from pipeline scriptData title", () => {
    const project = createDefaultScriptProjectData();
    project.scriptData = {
      title: "道劫 EP01：断剑夜访道口镇",
      language: "中文",
      characters: [],
      scenes: [],
      episodes: [],
      storyParagraphs: [],
    };
    const selected = selectActiveScriptProject({
      activeProjectId: "active",
      projects: { active: project },
    });
    expect(selected?.seriesMeta).toEqual({ title: "道劫", characters: [] });
  });

  it("derives fallback seriesMeta from the rawScript heading when scriptData is absent", () => {
    const project = createDefaultScriptProjectData();
    project.rawScript = "# 道劫 第1集：断剑夜访\n\n正文";
    const selected = selectActiveScriptProject({
      activeProjectId: "active",
      projects: { active: project },
    });
    expect(selected?.seriesMeta?.title).toBe("道劫");
  });

  it("keeps empty projects on the guide branch (no derived meta)", () => {
    const project = createDefaultScriptProjectData();
    const selected = selectActiveScriptProject({
      activeProjectId: "active",
      projects: { active: project },
    });
    expect(selected?.seriesMeta).toBeNull();
  });
});

describe("seriesMeta fallback persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetScriptStore();
  });

  afterEach(resetScriptStore);

  it("updateSeriesMeta persists on first edit using the derived base", () => {
    const project = createDefaultScriptProjectData();
    project.scriptData = {
      title: "道劫 EP01：断剑夜访道口镇",
      language: "中文",
      characters: [],
      scenes: [],
      episodes: [],
      storyParagraphs: [],
    };
    useScriptStore.setState({ activeProjectId: "p1", projects: { p1: project } });

    useScriptStore.getState().updateSeriesMeta("p1", { logline: "少年逆袭" });

    const saved = useScriptStore.getState().projects.p1?.seriesMeta;
    expect(saved).toEqual({ title: "道劫", characters: [], logline: "少年逆袭" });
  });
});
