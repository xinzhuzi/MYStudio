import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SplitScene } from "@/stores/director/director-store";
import { filterTrailerScenes } from "../storyboard-scenes-utils";
import { filterSClassTrailerScenes } from "./sclass-scenes-utils";

const scene = (id: number, sceneName?: string) => ({ id, sceneName } as SplitScene);
const sclassRoot = dirname(fileURLToPath(import.meta.url));

describe("sclass-scenes-utils facade", () => {
  it("re-exports filterTrailerScenes under the sclass alias", () => {
    expect(filterSClassTrailerScenes).toBe(filterTrailerScenes);
    expect(readFileSync(join(sclassRoot, "sclass-scenes-utils.ts"), "utf8").trim()).toBe(
      'export { filterTrailerScenes as filterSClassTrailerScenes } from "../storyboard-scenes-utils";',
    );
  });
});

describe("filterSClassTrailerScenes", () => {
  it("selects scenes whose names contain the trailer marker", () => {
    expect(filterSClassTrailerScenes([
      scene(1, "预告片·开场"),
      scene(2, "正片·第一幕"),
      scene(3, "角色预告片"),
      scene(4),
    ]).map(({ id }) => id)).toEqual([1, 3]);
  });

  it("returns an empty list without mutating the input when no marker exists", () => {
    const scenes = [scene(1, "正片")];
    expect(filterSClassTrailerScenes(scenes)).toEqual([]);
    expect(scenes).toHaveLength(1);
  });
});
