import type { SplitScene } from "@/stores/director/director-store";
import { describe, expect, it } from "vitest";
import { filterTrailerScenes } from "./storyboard-scenes-utils";

function scene(sceneName: string): SplitScene {
  return { sceneName } as unknown as SplitScene;
}

describe("filterTrailerScenes", () => {
  it("keeps only scenes marked as trailers and preserves their order", () => {
    const trailerOne = scene("预告片·码头");
    const ordinary = scene("码头·夜");
    const trailerTwo = scene("预告片·客栈");

    expect(filterTrailerScenes([trailerOne, ordinary, trailerTwo]))
      .toEqual([trailerOne, trailerTwo]);
  });

  it("treats an empty scene name as an ordinary scene", () => {
    expect(filterTrailerScenes([scene(""), scene("正片")])).toEqual([]);
  });
});
