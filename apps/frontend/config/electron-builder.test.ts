import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("electron-builder TTS packaging", () => {
  it("packages the fixed Remotion bundle and unpacks the arm64 compositor", () => {
    const source = readFileSync(new URL("./electron-builder.yml", import.meta.url), "utf8");

    expect(source).toContain("from: .cache/remotion-bundle");
    expect(source).toContain("to: remotion-bundle");
    expect(source.match(/^\u0020{2}- from: \.cache\/remotion-bundle$/gm)).toHaveLength(1);
    const remotionBundleStart = source.indexOf("  - from: .cache/remotion-bundle");
    const backendResourceStart = source.indexOf("  - from: backend");
    const remotionBundleResource = source.slice(remotionBundleStart, backendResourceStart);
    expect(remotionBundleResource).toContain('"**/*"');
    expect(remotionBundleResource).not.toContain('"!**/*.map"');
    expect(source).toContain('"node_modules/@remotion/compositor-darwin-arm64/**"');
    expect(source).not.toContain("Headless Shell");
  });

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

  it("does not bundle Daojie-specific content manuals into the desktop app", () => {
    const source = readFileSync(new URL("./electron-builder.yml", import.meta.url), "utf8");
    const studioManualsStart = source.indexOf("  - from: frontend/assets/studio-manuals");
    const asarStart = source.indexOf("\nasar:");
    const studioManualsResource = source.slice(studioManualsStart, asarStart);

    expect(studioManualsResource).toContain('"!art_skills/daojie_ink_guofeng/**"');
    expect(studioManualsResource).toContain('"!story_skills/Daojie_xianxia/**"');
  });
});
