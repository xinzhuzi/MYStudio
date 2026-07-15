import { describe, expect, it } from "vitest";
import type { Scene } from "./scene-store";
import { sanitizeSceneForPersistence } from "./scene-store";

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: "scene-room",
    name: "悦来客栈斗室",
    location: "悦来客栈斗室",
    time: "夜",
    atmosphere: "克制",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("scene persistence", () => {
  it("keeps durable viewpoint metadata and local images while stripping base64 payloads", () => {
    const persisted = sanitizeSceneForPersistence(scene({
      referenceImage: "local-image://scenes/room.png",
      referenceImageBase64: "data:image/png;base64,ref",
      contactSheetImage: "local-image://scenes/room-sheet.png",
      viewpoints: [{
        id: "inn-room-window-axis",
        name: "窗向室内轴线",
        nameEn: "window-to-room axis",
        shotIds: ["sb-20", "sb-21"],
        keyProps: ["木窗", "书案", "床榻"],
        gridIndex: 0,
      }],
      viewpointImages: {
        "inn-room-window-axis": {
          imageUrl: "local-image://scenes/room-window.png",
          imageBase64: "data:image/png;base64,view",
          gridIndex: 0,
        },
        "base64-only": {
          imageUrl: "data:image/png;base64,drop",
          gridIndex: 1,
        },
      },
    }));

    expect(persisted.referenceImageBase64).toBeUndefined();
    expect(persisted.contactSheetImage).toBe("local-image://scenes/room-sheet.png");
    expect(persisted.viewpoints?.[0]?.id).toBe("inn-room-window-axis");
    expect(persisted.viewpointImages).toEqual({
      "inn-room-window-axis": {
        imageUrl: "local-image://scenes/room-window.png",
        gridIndex: 0,
      },
    });
  });
});
