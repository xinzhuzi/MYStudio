import { describe, expect, it } from "vitest";
// 先触发注册(模块加载),再查询 lib 注册表
import "./workflow-node-registry";
import {
  canvasMiniMapNodeToken,
  getCanvasNodeEntry,
  listCanvasNodeDefinitions,
} from "@/lib/studio/canvas-node-registry";
import { PRODUCTION_FLOW_NODE_IDS } from "./workflow-node-model-schema";

describe("生产流面注册(canvas-node-registry)", () => {
  it("生产流节点全部注册,声明宽度来自布局常量单源", () => {
    const definitions = listCanvasNodeDefinitions("production-flow");
    expect(definitions.map((d) => d.typeId)).toEqual([...PRODUCTION_FLOW_NODE_IDS]);
    for (const definition of definitions) {
      expect(definition.defaultSize?.width).toBeGreaterThan(0);
      expect(definition.surface).toBe("production-flow");
    }
  });

  it("注册后小地图类型 token 可查(生产流=warning)", () => {
    const first = PRODUCTION_FLOW_NODE_IDS[0];
    expect(canvasMiniMapNodeToken(first)).toBe("warning");
    expect(getCanvasNodeEntry("production-flow", first)?.typeId).toBe(first);
  });
});
