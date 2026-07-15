import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preprocessLineBreaks: vi.fn(),
  analyzeScriptStructureWithAI: vi.fn(),
  applyAIAnalysis: vi.fn(),
  normalizeScriptFormat: vi.fn(),
  parseFullScript: vi.fn(),
  convertToScriptData: vi.fn(),
  populateSeriesMetaFromImport: vi.fn(),
  exportProjectMetadata: vi.fn(),
  store: {
    setProjectBackground: vi.fn(),
    setEpisodeRawScripts: vi.fn(),
    setScriptData: vi.fn(),
    setRawScript: vi.fn(),
    setParseStatus: vi.fn(),
    setSeriesMeta: vi.fn(),
    setMetadataMarkdown: vi.fn(),
  },
}));

vi.mock("./script-normalizer", () => ({
  preprocessLineBreaks: mocks.preprocessLineBreaks,
  analyzeScriptStructureWithAI: mocks.analyzeScriptStructureWithAI,
  applyAIAnalysis: mocks.applyAIAnalysis,
  normalizeScriptFormat: mocks.normalizeScriptFormat,
}));
vi.mock("./episode-parser", () => ({
  parseFullScript: mocks.parseFullScript,
  convertToScriptData: mocks.convertToScriptData,
}));
vi.mock("./series-meta-sync", () => ({ populateSeriesMetaFromImport: mocks.populateSeriesMetaFromImport }));
vi.mock("./episode-synopsis-service", () => ({ exportProjectMetadata: mocks.exportProjectMetadata }));
vi.mock("@/stores/script-store", () => ({ useScriptStore: { getState: () => mocks.store } }));

import { importFullScript } from "./full-script-import-service";

describe("importFullScript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.preprocessLineBreaks.mockReturnValue({ text: "processed" });
    mocks.analyzeScriptStructureWithAI.mockResolvedValue(null);
    mocks.normalizeScriptFormat.mockReturnValue({ normalized: "normalized", changes: [], aiAnalysis: null });
    mocks.exportProjectMetadata.mockReturnValue("# metadata");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps empty-episode imports out of the store", async () => {
    mocks.parseFullScript.mockReturnValue({ background: {}, episodes: [] });

    const result = await importFullScript("raw", "p1");

    expect(result).toEqual(expect.objectContaining({ success: false, episodes: [] }));
    expect(mocks.store.setScriptData).not.toHaveBeenCalled();
  });

  it("persists the original text, parsed data, series meta, and compatibility background", async () => {
    const background = { title: "剧名", outline: "大纲", characterBios: "人物" };
    const episodes = [{ episodeIndex: 1 }];
    const scriptData = { title: "剧名", scenes: [] };
    mocks.parseFullScript.mockReturnValue({ background, episodes });
    mocks.convertToScriptData.mockReturnValue(scriptData);
    mocks.populateSeriesMetaFromImport.mockReturnValue({ title: "剧名" });

    const result = await importFullScript("raw", "p1", { styleId: "ink", promptLanguage: "zh" });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      background,
      projectBackground: background,
      episodes,
      scriptData,
    }));
    expect(mocks.store.setRawScript).toHaveBeenCalledWith("p1", "raw");
    expect(mocks.store.setParseStatus).toHaveBeenCalledWith("p1", "ready");
    expect(mocks.store.setSeriesMeta).toHaveBeenCalledWith("p1", { title: "剧名" });
    expect(mocks.store.setMetadataMarkdown).toHaveBeenCalledWith("p1", "# metadata");
  });

  it("uses AI structure metadata and returns thrown failures as results", async () => {
    mocks.analyzeScriptStructureWithAI.mockResolvedValue({ era: "古代", genre: "武侠" });
    mocks.applyAIAnalysis.mockReturnValue({
      normalized: "ai-normalized",
      changes: ["AI"],
      aiAnalysis: { era: "古代", genre: "武侠" },
    });
    const background = { title: "剧名", outline: "", characterBios: "" };
    mocks.parseFullScript.mockReturnValue({ background, episodes: [{ episodeIndex: 1 }] });
    mocks.convertToScriptData.mockImplementation(() => {
      throw new Error("convert failed");
    });

    const result = await importFullScript("raw", "p1");

    expect(mocks.normalizeScriptFormat).not.toHaveBeenCalled();
    expect(background).toEqual(expect.objectContaining({ era: "古代", genre: "武侠" }));
    expect(result).toEqual(expect.objectContaining({ success: false, error: "convert failed" }));
  });
});
