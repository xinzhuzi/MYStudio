import { describe, expect, it } from "vitest";
import {
  buildDaojiePaletteModuleText,
  buildDaojiePaletteSelectionCatalog,
  DAOJIE_PALETTE_CANON,
  getDaojiePaletteScheme,
  parseDaojiePaletteSelectionResponse,
  prefilterDaojiePaletteSchemes,
  resolveDaojiePaletteScheme,
} from "./daojie-palette";

describe("Daojie palette canon (MA ma-gongbi-palette-v1 镜像)", () => {
  it("ships all 42 colors, 24 schemes (8 per track) and 12 factions × 3 tracks", () => {
    expect(DAOJIE_PALETTE_CANON.colors).toHaveLength(42);
    expect(DAOJIE_PALETTE_CANON.schemes).toHaveLength(24);
    for (const track of ["person", "scene", "prop"] as const) {
      expect(DAOJIE_PALETTE_CANON.schemes.filter((scheme) => scheme.track === track)).toHaveLength(8);
    }
    expect(Object.keys(DAOJIE_PALETTE_CANON.factions)).toHaveLength(12);
    for (const faction of Object.values(DAOJIE_PALETTE_CANON.factions)) {
      expect(Object.keys(faction.tracks).sort()).toEqual(["person", "prop", "scene"]);
    }
    const xuanzhi = DAOJIE_PALETTE_CANON.colors.find((color) => color.colorId === "paper.01");
    expect(xuanzhi?.name).toBe("宣纸白");
    expect(xuanzhi?.hex).toBe("#F5F0E8");
  });

  it("来源 SHA 已登记且可被同步守护重算", () => {
    expect(DAOJIE_PALETTE_CANON.sources).toHaveLength(2);
    for (const source of DAOJIE_PALETTE_CANON.sources) {
      expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe("Daojie palette module text (MA _palette_module 逐字同构)", () => {
  it("builds the MA golden recipe for person.02 朱砂法脉", () => {
    const scheme = getDaojiePaletteScheme("person.02")!;
    expect(scheme.name).toBe("朱砂法脉");
    expect(buildDaojiePaletteModuleText(scheme)).toBe(
      "配料方案（朱砂法脉）：底色用米白；墨线用浓墨；主色用朱砂；辅色用赭石；点睛色用暗金。职责色服从 Source facts，不覆盖已核验的主体颜色与材质事实。",
    );
  });

  it("resolves schemes with MA semantics: unknown or cross-track fail closed", () => {
    expect(resolveDaojiePaletteScheme("scene.01", "scene").name).toBeTruthy();
    expect(() => resolveDaojiePaletteScheme("person.99", "person")).toThrow(/unknown/);
    // person.02 属 person 轨,用在 scene 轨必须拒绝,不得静默换轨
    expect(() => resolveDaojiePaletteScheme("person.02", "scene")).toThrow(/crosses tracks/);
  });
});

describe("Daojie palette auto-selection", () => {
  it("prefilters schemes by suitable/name keyword overlap, deterministic on ties", () => {
    const hits = prefilterDaojiePaletteSchemes({
      runtimeTrack: "character",
      name: "焚香仪式中的符修",
      description: "主持仪式、绘制符箓、战斗焦点人物",
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.scheme.schemeId).toBe("person.02");
    expect(prefilterDaojiePaletteSchemes({
      runtimeTrack: "prop",
      name: "无关键词命中",
      description: "完全无关描述",
    })).toHaveLength(0);
  });

  it("catalog lists exactly the 8 schemes of the requested track", () => {
    const catalog = buildDaojiePaletteSelectionCatalog("prop");
    expect(catalog.split("\n")).toHaveLength(8);
    expect(catalog).toContain("prop.01");
  });

  it("parses LLM selection strictly: valid id kept, unknown/cross-track/null rejected to null", () => {
    expect(parseDaojiePaletteSelectionResponse('{"schemeId": "scene.03"}', "scene")).toBe("scene.03");
    expect(parseDaojiePaletteSelectionResponse('{"schemeId": null}', "scene")).toBeNull();
    expect(parseDaojiePaletteSelectionResponse("模型闲聊没有 JSON", "scene")).toBeNull();
    expect(parseDaojiePaletteSelectionResponse('{"schemeId": "person.02"}', "scene")).toBeNull();
    expect(parseDaojiePaletteSelectionResponse('{"schemeId": "person.99"}', "person")).toBeNull();
  });
});
