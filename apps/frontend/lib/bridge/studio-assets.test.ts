import { afterEach, describe, expect, it } from "vitest";
import { getStudioAssetsBridge } from "./studio-assets";

describe("getStudioAssetsBridge", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("returns no bridge when the renderer window is unavailable", () => {
    expect(getStudioAssetsBridge()).toBeUndefined();
  });

  it("returns the preload bridge without reshaping its contract", () => {
    const bridge = { get: async () => null } as unknown as Window["studioAssets"];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { studioAssets: bridge },
    });

    expect(getStudioAssetsBridge()).toBe(bridge);
  });
});
