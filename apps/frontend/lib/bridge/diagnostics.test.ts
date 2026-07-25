import { afterEach, describe, expect, it } from "vitest";
import { getDiagnosticsBridge } from "./diagnostics";

describe("getDiagnosticsBridge", () => {
  afterEach(() => { delete (globalThis as { window?: unknown }).window; });
  it("returns undefined without window", () => { expect(getDiagnosticsBridge()).toBeUndefined(); });
  it("returns the exact preload bridge", () => {
    const bridge = { getInfo: async () => ({}) } as unknown as Window["diagnosticsLog"];
    Object.defineProperty(globalThis, "window", { configurable: true, value: { diagnosticsLog: bridge } });
    expect(getDiagnosticsBridge()).toBe(bridge);
  });
});
