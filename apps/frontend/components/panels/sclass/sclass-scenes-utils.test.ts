import { describe, expect, it } from "vitest";
import type { SplitScene } from "@/stores/director-store";
import { filterSClassTrailerScenes } from "./sclass-scenes-utils";

const scene = (id: number, sceneName?: string) => ({ id, sceneName } as SplitScene);

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
