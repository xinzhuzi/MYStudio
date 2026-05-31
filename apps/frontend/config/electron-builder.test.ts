import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("electron-builder TTS packaging", () => {
  it("keeps backend source in extraResources without bundling Python runtime", () => {
    const source = readFileSync(new URL("./electron-builder.yml", import.meta.url), "utf8");

    expect(source).toContain("from: backend");
    expect(source).toContain('to: backend');
    expect(source).toContain('"**/*"');
    expect(source).toContain('"!python/**"');
    expect(source).toContain('"!venv/**"');
    expect(source).toContain('"!**/__pycache__/**"');
  });
});
