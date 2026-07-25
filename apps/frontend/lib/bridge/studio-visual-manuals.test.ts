import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getStudioVisualManualsBridge,
  type StudioVisualManualsBridge,
} from "./studio-visual-manuals";

describe("getStudioVisualManualsBridge", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("returns no bridge when the renderer window is unavailable", () => {
    expect(getStudioVisualManualsBridge()).toBeUndefined();
  });

  it("returns no bridge when the preload surface is unavailable", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
    });

    expect(getStudioVisualManualsBridge()).toBeUndefined();
  });

  it("returns the exact preload bridge without reshaping its contract", async () => {
    const bridge: StudioVisualManualsBridge = {
      list: vi.fn(async () => []),
      read: vi.fn(async () => ({ success: false, error: "read failed" })),
      write: vi.fn(async () => ({ success: true })),
      writeImages: vi.fn(async () => {
        throw new Error("write images failed");
      }),
      create: vi.fn(async () => ({ success: false, error: "create failed" })),
      duplicate: vi.fn(async () => ({ success: true })),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { studioVisualManuals: bridge },
    });

    const returnedBridge = getStudioVisualManualsBridge();
    expect(returnedBridge).toBe(bridge);
    if (!returnedBridge) throw new Error("expected studio visual manuals bridge");

    await expect(returnedBridge.list({ refresh: true })).resolves.toEqual([]);
    expect(bridge.list).toHaveBeenCalledWith({ refresh: true });

    await expect(returnedBridge.read("manual-id")).resolves.toEqual({
      success: false,
      error: "read failed",
    });
    expect(bridge.read).toHaveBeenCalledWith("manual-id");

    const writePayload = {
      name: "Manual",
      modules: [{ value: "prefix", content: "content" }],
    };
    await expect(returnedBridge.write("manual-id", writePayload)).resolves.toEqual({ success: true });
    expect(bridge.write).toHaveBeenCalledWith("manual-id", writePayload);

    const imagePayload = {
      images: [{ name: "reference.png", dataUrl: "data:image/png;base64,AA==" }],
    };
    await expect(returnedBridge.writeImages("manual-id", imagePayload)).rejects.toThrow(
      "write images failed",
    );
    expect(bridge.writeImages).toHaveBeenCalledWith("manual-id", imagePayload);

    const createPayload = { name: "Manual", stylePath: "manual-id" };
    await expect(returnedBridge.create(createPayload)).resolves.toEqual({
      success: false,
      error: "create failed",
    });
    expect(bridge.create).toHaveBeenCalledWith(createPayload);

    const duplicatePayload = {
      sourceStylePath: "source-id",
      name: "Manual Copy",
      stylePath: "manual-copy",
      projectId: "project-id",
    };
    await expect(returnedBridge.duplicate(duplicatePayload)).resolves.toEqual({ success: true });
    expect(bridge.duplicate).toHaveBeenCalledWith(duplicatePayload);
  });

  it("keeps consumers behind the shared accessor", () => {
    const consumerPaths = [
      "frontend/components/panels/assets/CustomStylesGrid.tsx",
      "frontend/components/panels/assets/DefaultStylesGrid.tsx",
      "frontend/components/panels/assets/VisualManualEditorDialog.tsx",
      "frontend/components/panels/studio/useStudioManualCatalog.ts",
      "frontend/lib/ai/prompt-polisher.ts",
    ];

    for (const consumerPath of consumerPaths) {
      const source = readFileSync(join(process.cwd(), consumerPath), "utf8");
      expect(source, consumerPath).toContain("getStudioVisualManualsBridge");
      expect(source, consumerPath).not.toContain("window.studioVisualManuals");
    }
  });
});
