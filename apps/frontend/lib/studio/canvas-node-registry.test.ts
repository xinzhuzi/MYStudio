import { describe, expect, it } from "vitest";
import {
  canvasMiniMapNodeToken,
  getCanvasNodeEntry,
  listCanvasNodeDefinitions,
} from "./canvas-node-registry";

describe("canvas-node-registry:image-workflow 面", () => {
  it("四类型注册齐(含无衣物通用化),三要素(几何来源/动作/输出资源)完整", () => {
    const definitions = listCanvasNodeDefinitions("image-workflow");
    expect(definitions.map((d) => d.typeId).sort()).toEqual([
      "generated",
      "prompt",
      "reference",
      "uncloth",
    ]);
    for (const definition of definitions) {
      expect(definition.label.length).toBeGreaterThan(0);
      expect(definition.actions.length).toBeGreaterThan(0);
      expect(definition.outputs.length).toBeGreaterThan(0);
      expect(["primary", "info", "success", "warning", "accent"]).toContain(definition.miniMapToken);
    }
  });

  it("getCanvasNodeEntry 查询与缺省回退", () => {
    expect(getCanvasNodeEntry("image-workflow", "prompt")?.label).toBe("提示词节点");
    expect(getCanvasNodeEntry("image-workflow", "uncloth")?.label).toBe("无衣物节点");
    expect(getCanvasNodeEntry("image-workflow", "nope")).toBeUndefined();
  });

  it("未注册类型的小地图色 token 回退 accent;类型→token 语义映射", () => {
    expect(canvasMiniMapNodeToken("nope")).toBe("accent");
    expect(canvasMiniMapNodeToken("generated")).toBe("primary");
    expect(canvasMiniMapNodeToken("prompt")).toBe("info");
    expect(canvasMiniMapNodeToken("reference")).toBe("success");
    expect(canvasMiniMapNodeToken("uncloth")).toBe("warning");
  });
});
