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

  it("keeps studio manual seeds free of desktop junk and transient files", () => {
    const source = readFileSync(new URL("./electron-builder.yml", import.meta.url), "utf8");
    const studioManualsStart = source.indexOf("  - from: frontend/assets/studio-manuals");
    const asarStart = source.indexOf("\nasar:");
    const studioManualsResource = source.slice(studioManualsStart, asarStart);

    expect(studioManualsResource).toContain('"!**/.DS_Store"');
    expect(studioManualsResource).toContain('"!**/__MACOSX/**"');
    expect(studioManualsResource).toContain('"!**/.cache/**"');
    expect(studioManualsResource).toContain('"!**/*.tmp"');
    expect(studioManualsResource).toContain('"!**/*.bak"');
    expect(studioManualsResource).toContain('"!**/*.map"');
    expect(studioManualsResource).toContain('"!**/*.tsbuildinfo"');
  });
});
