import { describe, expect, it } from "vitest";
import { mapRuntimeAssetRowForTest } from "./studio-runtime-assets";

describe("studio runtime Toonflow asset mapping", () => {
  it("keeps derived asset parent and flow identifiers from Toonflow sqlite rows", () => {
    const item = mapRuntimeAssetRowForTest(
      {
        id: 3230,
        assetsId: 2521,
        name: "晨雾版",
        type: "scene",
        prompt: "foggy street variation",
        describe: "道口镇街口晨雾状态",
        filePath: "/1/assets/scene/fog.png",
        state: "已完成",
        flowId: 1,
        childrenCount: 0,
      },
      "scene",
    );

    expect(item).toMatchObject({
      id: "toonflow-db:3230",
      source: "toonflow-runtime",
      type: "scene",
      name: "晨雾版",
      previewUrl: "toonflow-asset://oss/1/assets/scene/fog.png",
      imageWorkflowId: "1",
      parentAssetId: "toonflow-db:2521",
      toonflowAssetId: 3230,
      toonflowParentAssetId: 2521,
    });
  });
});
