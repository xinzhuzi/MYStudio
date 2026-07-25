import { afterEach, describe, expect, it } from "vitest";
import {
  getTtsRuntimeBridge,
  type TtsRuntimeBridge,
} from "./tts-runtime";

describe("getTtsRuntimeBridge", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("returns no bridge when the renderer window is unavailable", () => {
    expect(getTtsRuntimeBridge()).toBeUndefined();
  });

  it("returns the preload bridge without reshaping its contract", () => {
    const bridge = {
      status: async () => ({
        installed: true,
        running: false,
        port: 39001,
        baseUrl: "http://127.0.0.1:39001",
      }),
    } as TtsRuntimeBridge;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { ttsRuntime: bridge },
    });

    expect(getTtsRuntimeBridge()).toBe(bridge);
  });
});
