import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readPanelSource(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function getFunctionSource(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("merged generation cancellation wiring", () => {
  it("passes the Director signal through request, polling, and writeback guards", () => {
    const generation = readPanelSource("./storyboard-merged-page-generation.ts");

    expect(generation).toMatch(
      /aiManager\.imageGrid\(\{[\s\S]*?signal,[\s\S]*?\}\)/,
    );
    expect(generation).toMatch(/pollImageTaskUrl\(\{[\s\S]*?signal,/);
    expect(generation.match(/signal\.throwIfAborted\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("keeps S-Class merged cancellation separate from quad-grid generation", () => {
    const source = readPanelSource("../sclass/sclass-scenes.tsx");
    const mergedGeneration = getFunctionSource(source, "const handleMergedGenerate", "const handleGenerateEndFrameImage");
    const mergedPageAdapter = readPanelSource("../sclass/sclass-merged-page-generation.ts");
    const quadGridSource = readPanelSource("../sclass/use-sclass-quad-grid-controller.ts");
    const quadGridGeneration = getFunctionSource(quadGridSource, "const handleQuadGridGenerate", "return { getCharacterReferenceImages");

    expect(mergedGeneration).toContain("createSClassMergedPageGenerator({");
    expect(mergedPageAdapter).toMatch(
      /aiManager\.imageGrid\(\{[\s\S]*?signal,[\s\S]*?\}\)/,
    );
    expect(mergedPageAdapter).toContain("pollImageTaskUrl({");
    expect(mergedPageAdapter.match(/signal\.throwIfAborted\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(quadGridGeneration).not.toContain("mergedSignal");
  });
});
