import { afterEach, describe, expect, it } from "vitest";
import { getImageStorageBridge } from "./image-storage";

describe("getImageStorageBridge", () => {
  afterEach(() => { delete (globalThis as { window?: unknown }).window; });
  it("returns undefined without window", () => { expect(getImageStorageBridge()).toBeUndefined(); });
  it("returns the exact preload bridge", () => {
    const bridge = { getAbsolutePath: async () => null } as unknown as Window["imageStorage"];
    Object.defineProperty(globalThis, "window", { configurable: true, value: { imageStorage: bridge } });
    expect(getImageStorageBridge()).toBe(bridge);
  });
});
