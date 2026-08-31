import { describe, expect, it } from "vitest";
import {
  canvasMiniMapNodeColor,
  getCanvasNodeEntry,
  listCanvasNodeEntrys,
} from "./canvas-node-registry";

describe("canvas-node-registry:image-workflow 面", () => {
  it("三类型注册齐,三要素(几何来源/动作/输出资源)完整", () => {
    const definitions = listCanvasNodeEntrys("image-workflow");
    expect(definitions.map((d) => d.typeId).sort()).toEqual([
      "generated",
      "prompt",
      "reference",
    ]);
    for (const definition of definitions) {
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.actions.length).toBeGreaterThan(0);
      expect(definition.outputs.length).toBeGreaterThan(0);
      expect(definition.miniMapColor).toMatch(/^hsl/);
    }
  });

  it("getCanvasNodeEntry 查询与缺省回退", () => {
    expect(getCanvasNodeEntry("image-workflow", "prompt")?.label).toBe("提示词节点");
    expect(getCanvasNodeEntry("image-workflow", "nope")).toBeUndefined();
  });

  it("未注册类型的小地图色回退 accent", () => {
    expect(canvasMiniMapNodeColor("nope")).toBe("hsl(var(--accent))");
    expect(canvasMiniMapNodeColor("generated")).toBe("hsl(var(--primary))");
  });
});
