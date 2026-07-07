import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("AssetsTab split boundaries", () => {
  it("keeps batch card rendering outside the data orchestration tab", () => {
    const tabSource = readFileSync(
      fileURLToPath(new URL("./AssetsTab.tsx", import.meta.url)),
      "utf8",
    );
    const cardSource = readFileSync(
      fileURLToPath(new URL("./AssetsBatchCard.tsx", import.meta.url)),
      "utf8",
    );

    expect(tabSource).toContain('from "./AssetsBatchCard"');
    expect(tabSource).not.toContain("const renderCat =");
    expect(cardSource).toContain("export function AssetsBatchCard");
    expect(cardSource).toContain("创建缺失资产");
    expect(cardSource).toContain("剧本内容");
  });

  it("does not list the independent asset library outside explicit management mode", () => {
    const tabSource = readFileSync(
      fileURLToPath(new URL("./AssetsTab.tsx", import.meta.url)),
      "utf8",
    );

    expect(tabSource).toContain('mode?: "extract" | "manage"');
    expect(tabSource).toContain('const mode = props.mode ?? "extract"');
    expect(tabSource).toContain('if (mode !== "manage") return;');
    expect(tabSource).toContain("sa.list({ type: t, limit: 99999 })");
  });
});
