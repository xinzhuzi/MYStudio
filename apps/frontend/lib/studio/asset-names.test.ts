import { describe, expect, it } from "vitest";
import {
  assetNameMatchesQuery,
  cleanAssetNameSegment,
  formatAssetName,
  getPrimaryAssetName,
  getSecondaryAssetNames,
  parseAssetNames,
} from "./asset-names";

describe("asset names", () => {
  it("uses the first semicolon-separated name as the primary name", () => {
    expect(parseAssetNames("铜钱;铜币;古钱")).toEqual({
      rawName: "铜钱;铜币;古钱",
      primaryName: "铜钱",
      secondaryNames: ["铜币", "古钱"],
      allNames: ["铜钱", "铜币", "古钱"],
    });
  });

  it("accepts Chinese semicolons and drops duplicate aliases", () => {
    expect(getPrimaryAssetName("紫金通宝；紫金钱；紫金钱")).toBe("紫金通宝");
    expect(getSecondaryAssetNames("紫金通宝；紫金钱；紫金钱")).toEqual(["紫金钱"]);
  });

  it("accepts English and Chinese commas as alias separators", () => {
    expect(parseAssetNames("李先生,管事,教书先生").allNames).toEqual([
      "李先生",
      "管事",
      "教书先生",
    ]);
    expect(getPrimaryAssetName("李先生，管事")).toBe("李先生");
    expect(getSecondaryAssetNames("李先生，管事")).toEqual(["管事"]);
  });

  it("accepts mixed separators and matches any comma-separated alias", () => {
    expect(parseAssetNames("铜钱，铜币;古钱").allNames).toEqual(["铜钱", "铜币", "古钱"]);
    expect(assetNameMatchesQuery("李先生，管事", "管事")).toBe(true);
    expect(assetNameMatchesQuery("李先生,管事", "李先生")).toBe(true);
    expect(assetNameMatchesQuery("李先生；管事，教书先生", "教书先生")).toBe(true);
  });

  it("formats primary and secondary names into the asset-library name field", () => {
    expect(formatAssetName("铜钱", ["铜币", "古钱", "铜钱"])).toBe("铜钱;铜币;古钱");
  });

  it("cleans file paths and media extensions before matching names", () => {
    expect(cleanAssetNameSegment("/tmp/mystudio-fixtures/音频/少年旁白_穿过雨夜.wav")).toBe("少年旁白_穿过雨夜");
    expect(assetNameMatchesQuery("少年旁白_穿过雨夜.wav;少年音色", "少年音色")).toBe(true);
    expect(assetNameMatchesQuery("铜钱;铜币;古钱", "铜币")).toBe(true);
    expect(assetNameMatchesQuery("铜钱;铜币;古钱", "铜")).toBe(false);
  });
});
