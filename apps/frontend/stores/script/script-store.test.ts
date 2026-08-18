import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(async (_key: string): Promise<string | null> => null),
  removeItem: vi.fn(async (_key: string): Promise<void> => undefined),
  setItem: vi.fn(async (_key: string, _value: string): Promise<void> => undefined),
}));

vi.mock("@/lib/storage/project-storage", () => ({
  // 按实例名前缀路由(剧本/legacy script/overview 三实例共用同一 mocks)
  createProjectScopedStorage: (storeName: string) => ({
    getItem: (name: string) => mocks.getItem(`${storeName}::${name}`),
    removeItem: (name: string) => mocks.removeItem(`${storeName}::${name}`),
    setItem: (name: string, value: string) => mocks.setItem(`${storeName}::${name}`, value),
  }),
}));

import type { ScriptStorePersistenceState } from "./script-store-persistence";
import { selectActiveScriptProject, useScriptStore } from "./script-store";
import {
  createDefaultScriptProjectData,
  createScriptScopedJsonStorage,
  defaultCalibrationState,
  mergeScriptStoreState,
  normalizeScriptProjectData,
  partializeScriptStoreState,
  flushRecoveredCharactersToDisk,
} from "./script-store-persistence";

function resetScriptStore() {
  useScriptStore.setState({ activeProjectId: null, projects: {} });
}

// clearAllMocks 不清 mockImplementation:个别用例(如 disk full 注入)的抛错实现会
// 残留污染后续用例,经 zustand persist 的 setState 保存泄漏成 unhandled rejection。
afterEach(() => {
  mocks.getItem.mockImplementation(async () => null);
  mocks.setItem.mockImplementation(async () => undefined);
  mocks.removeItem.mockImplementation(async () => undefined);
});

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

  it("returns a referentially stable derived object across calls (render-loop guard)", () => {
    // 回归:选择器每次返回新引用会让 useSyncExternalStore 判定快照变化,
    // 无限重渲染打满主线程(installed smoke CDP 超时根因)。
    const project = createDefaultScriptProjectData();
    project.scriptData = {
      title: "道劫 EP01：断剑夜访道口镇",
      language: "中文",
      characters: [],
      scenes: [],
      episodes: [],
      storyParagraphs: [],
    };
    const state = { activeProjectId: "active", projects: { active: project } };
    expect(selectActiveScriptProject(state)).toBe(selectActiveScriptProject(state));
  });
});

describe("seriesMeta 独立落盘(overview.json 拆分)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 复位实现:clearAllMocks 不清 mockImplementation(本 describe 内有用例设抛错)
    mocks.setItem.mockImplementation(async () => undefined);
    mocks.removeItem.mockImplementation(async () => undefined);
    mocks.getItem.mockImplementation(async () => null);
    resetScriptStore();
  });

  afterEach(resetScriptStore);

  it("setItem 先写 overview 信封再写剥离后的 script(同一 mock 按调用顺序断言)", async () => {
    const storage = createScriptScopedJsonStorage();
    const before = mocks.setItem.mock.calls.length;
    await storage?.setItem("mystudio-script-store", {
      state: { activeProjectId: "p1", projectData: { ...createDefaultScriptProjectData(), rawScript: "正文", seriesMeta: { title: "道劫", characters: [] } } },
      version: 3,
    });

    const myCalls = mocks.setItem.mock.calls.slice(before);
    expect(myCalls).toHaveLength(2);
    expect(myCalls[0][0]).toBe("overview::mystudio-script-store");
    expect(myCalls[1][0]).toBe("剧本::mystudio-script-store");
    const [overviewWrite, scriptWrite] = myCalls.map((c) => c[1]);
    expect(JSON.parse(overviewWrite)).toEqual({
      state: { activeProjectId: "p1", seriesMeta: { title: "道劫", characters: [] } },
      version: 0,
    });
    const scriptParsed = JSON.parse(scriptWrite);
    expect(scriptParsed.state.projectData.rawScript).toBe("正文");
    expect(scriptParsed.state.projectData.seriesMeta).toBeUndefined();
  });

  it("getItem:overview 的 seriesMeta 优先注入内存形状(消费方零改动)", async () => {
    mocks.getItem.mockImplementation(async (key: string) => {
      if (key.startsWith("剧本::")) return JSON.stringify({ state: { activeProjectId: "p1", projectData: { rawScript: "正文" } }, version: 1 });
      if (key.startsWith("overview::")) return JSON.stringify({ state: { activeProjectId: "p1", seriesMeta: { title: "新名字", characters: [] } }, version: 0 });
      return null;
    });
    const storage = createScriptScopedJsonStorage();
    const parsed = (await storage?.getItem("mystudio-script-store")) as unknown as { state: { projectData: Record<string, unknown> } };
    expect(parsed.state.projectData.seriesMeta).toEqual({ title: "新名字", characters: [] });
    expect(parsed.state.projectData.rawScript).toBe("正文");
  });

  it("getItem:旧布局内嵌 seriesMeta 自动迁移(旁写 overview+重写剥离后的 script)", async () => {
    const legacy = JSON.stringify({
      state: { activeProjectId: "p1", projectData: { rawScript: "正文", seriesMeta: { title: "道劫", characters: [], genre: "仙侠" } } },
      version: 2,
    });
    mocks.getItem.mockImplementation(async (key: string) => (key.startsWith("script::") ? legacy : null));
    const storage = createScriptScopedJsonStorage();
    const before = mocks.setItem.mock.calls.length;
    const parsed = (await storage?.getItem("mystudio-script-store")) as unknown as { state: { projectData: Record<string, unknown> } };
    expect((parsed.state.projectData.seriesMeta as { title: string }).title).toBe("道劫");
    const myCalls = mocks.setItem.mock.calls.slice(before);
    const ovWrite = myCalls.find(([k]) => k.startsWith("overview::"))![1];
    const scriptWrites = myCalls.filter(([k]) => k.startsWith("剧本::")).map((c) => c[1]);
    expect(JSON.parse(ovWrite).state.seriesMeta.genre).toBe("仙侠");
    // 末次剧本写=剥离后(首次为改名迁移的原文复制)
    expect(JSON.parse(scriptWrites.at(-1)!).state.projectData.seriesMeta).toBeUndefined();
    expect(mocks.removeItem).toHaveBeenCalledWith("script::mystudio-script-store");
  });

  it("getItem:overview 写盘抛错不阻断读取,seriesMeta 留在返回值里", async () => {
    const legacy = JSON.stringify({
      state: { activeProjectId: "p1", projectData: { rawScript: "正文", seriesMeta: { title: "道劫", characters: [] } } },
      version: 2,
    });
    mocks.getItem.mockImplementation(async (key: string) => (key.startsWith("script::") ? legacy : null));
    // 只让 overview 写盘抛错(本用例的靶点);全键抛错会连累 afterEach 里 resetScriptStore
    // 触发的 persist 保存,泄漏成 unhandled rejection
    mocks.setItem.mockImplementation(async (key: string) => {
      if (String(key).startsWith("overview::")) throw new Error("disk full");
    });
    const storage = createScriptScopedJsonStorage();
    const parsed = (await storage?.getItem("mystudio-script-store")) as unknown as { state: { projectData: Record<string, unknown> } };
    expect((parsed.state.projectData.seriesMeta as { title: string }).title).toBe("道劫");
  });

  it("剧本文件缺席时 overview 元数据独立载入(解耦:概览不挂靠剧本文件)", async () => {
    mocks.getItem.mockImplementation(async (key: string) =>
      key.startsWith("overview::")
        ? JSON.stringify({ state: { activeProjectId: "p1", seriesMeta: { title: "道劫", characters: [] } }, version: 0 })
        : null,
    );
    const { useProjectStore } = await import("@/stores/project/project-store");
    useProjectStore.setState({ activeProjectId: "p1" });
    const storage = createScriptScopedJsonStorage();
    const parsed = (await storage?.getItem("mystudio-script-store")) as unknown as { state: { projectData: Record<string, unknown>; activeProjectId: string } };
    expect(parsed.state.activeProjectId).toBe("p1");
    expect(parsed.state.projectData.seriesMeta).toEqual({ title: "道劫", characters: [] });
  });

  it("剧本域全空时 setItem 不落盘并清既有文件(空壳不复活)", async () => {
    const storage = createScriptScopedJsonStorage();
    const before = mocks.setItem.mock.calls.length;
    const beforeRm = mocks.removeItem.mock.calls.length;
    await storage?.setItem("mystudio-script-store", {
      state: { activeProjectId: "p1", projectData: { ...createDefaultScriptProjectData(), rawScript: "", scriptData: null, shots: [], episodeRawScripts: [], seriesMeta: { title: "道劫", characters: [] } } },
      version: 0,
    });
    const mySets = mocks.setItem.mock.calls.slice(before);
    // 只写 overview,不写 剧本 键
    expect(mySets.every(([k]) => k.startsWith("overview::"))).toBe(true);
    // 清两个剧本键
    const rms = mocks.removeItem.mock.calls.slice(beforeRm).map(([k]) => k);
    expect(rms).toContain("剧本::mystudio-script-store");
    expect(rms).toContain("script::mystudio-script-store");
  });

  it("removeItem 同时清理两个键(mock 两次)", async () => {
    const storage = createScriptScopedJsonStorage();
    await storage?.removeItem("mystudio-script-store");
    expect(mocks.removeItem).toHaveBeenCalledTimes(3);
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

describe("script scoped storage legacy raw-shape rewrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 复位实现:前序用例可能把 setItem 设为抛错(clearAllMocks 不清实现)
    mocks.setItem.mockImplementation(async () => undefined);
    mocks.removeItem.mockImplementation(async () => undefined);
    mocks.getItem.mockImplementation(async () => null);
    resetScriptStore();
  });

  afterEach(resetScriptStore);

  it("rewraps CLI-written raw ScriptProjectData with the active project id, migrating script.json → 剧本.json", async () => {
    // 回归:CLI 直写的裸形状(无 {state,version} 包装)曾让 persist 读成空态,
    // 后续 set() 把空默认整包写回,真实剧本被覆写(道劫 08-18 事故)
    mocks.getItem.mockImplementation(async (key: string) =>
      key.startsWith("script::")
        ? JSON.stringify({ rawScript: "# 道劫 EP01", scriptData: null, shots: [], parseStatus: "ready" })
        : null);
    const { useProjectStore } = await import("@/stores/project/project-store");
    useProjectStore.setState({ activeProjectId: "p-raw" });

    const storage = createScriptScopedJsonStorage();
    const out = await storage?.getItem("mystudio-script-store");
    expect(out).toEqual({
      state: { activeProjectId: "p-raw", projectData: { rawScript: "# 道劫 EP01", scriptData: null, shots: [], parseStatus: "ready" } },
      version: 0,
    });
    // 改名迁移:内容写到 剧本 键,legacy script 键被删
    expect(mocks.setItem).toHaveBeenCalledWith(
      "剧本::mystudio-script-store",
      expect.stringContaining("# 道劫 EP01"),
    );
    expect(mocks.removeItem).toHaveBeenCalledWith("script::mystudio-script-store");
  });

  it("passes wrapped content through unchanged (migrating legacy script key)", async () => {
    const wrapped = { state: { activeProjectId: "p1", projectData: { rawScript: "x" } }, version: 1 };
    mocks.getItem.mockImplementation(async (key: string) =>
      key.startsWith("script::") ? JSON.stringify(wrapped) : null);
    const storage = createScriptScopedJsonStorage();
    expect(await storage?.getItem("mystudio-script-store")).toEqual(wrapped);
    expect(mocks.setItem).toHaveBeenCalledWith("剧本::mystudio-script-store", JSON.stringify(wrapped));
    expect(mocks.removeItem).toHaveBeenCalledWith("script::mystudio-script-store");
  });
});
