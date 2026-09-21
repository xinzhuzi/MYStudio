import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it } from "vitest";

const setup = transpileModule(
  readFileSync(new URL("./vitest.setup.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ScriptTarget.ES2022 } },
).outputText;

describe("Vitest storage initialization", () => {
  it("does not access Node's native localStorage getter", () => {
    const globals: Record<string, unknown> = {};
    let nativeReads = 0;
    Object.defineProperty(globals, "localStorage", {
      configurable: true,
      get() {
        nativeReads += 1;
        throw new Error("native localStorage requires a file path");
      },
    });

    expect(() => runInNewContext(setup, globals)).not.toThrow();
    expect(nativeReads).toBe(0);
    const storage = globals.localStorage as Storage;
    storage.setItem("test-key", "value");
    expect(storage.getItem("test-key")).toBe("value");
    expect(storage.length).toBe(1);
    storage.clear();
    expect(storage.length).toBe(0);
  });

  it("preserves the browser environment's storage instance", () => {
    const storage = { getItem() {}, setItem() {}, removeItem() {} };
    // Vitest aliases window to global, but leaves existing Node keys in place.
    const globals: Record<string, unknown> = { jsdom: { window: { localStorage: storage } } };
    globals.window = globals;
    let nativeReads = 0;
    Object.defineProperty(globals, "localStorage", {
      configurable: true,
      get() {
        nativeReads += 1;
        return undefined;
      },
    });

    runInNewContext(setup, globals);

    expect(nativeReads).toBe(0);
    expect(globals.localStorage).toBe(storage);
  });
});
