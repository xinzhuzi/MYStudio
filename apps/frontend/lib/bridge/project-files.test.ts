import { afterEach, describe, expect, it } from "vitest";
import {
  getProjectFilesBridge,
  type ProjectFilesBridge,
} from "./project-files";

describe("getProjectFilesBridge", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("returns no bridge when the renderer window is unavailable", () => {
    expect(getProjectFilesBridge()).toBeUndefined();
  });

  it("returns the preload bridge without reshaping its contract", () => {
    const bridge: ProjectFilesBridge = {
      writeText: async () => ({ success: true }),
      writeBinary: async () => ({ success: true }),
      saveImage: async () => ({ success: true }),
      readAsBase64: async () => ({ success: true }),
      getAbsolutePath: async () => null,
      removeText: async () => ({ success: true }),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { projectFiles: bridge },
    });

    expect(getProjectFilesBridge()).toBe(bridge);
  });
});
