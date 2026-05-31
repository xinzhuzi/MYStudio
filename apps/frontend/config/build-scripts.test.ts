import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appsRoot = resolve(__dirname, "../..");

function readBuildFile(relativePath: string) {
  return readFileSync(resolve(appsRoot, relativePath), "utf8");
}

describe("desktop build scripts", () => {
  it("use the current frontend build paths", () => {
    const source = readBuildFile("build/build-desktop.mjs");

    expect(source).toContain("'frontend', 'config', 'electron-builder.yml'");
    expect(source).toContain("'frontend', 'config', 'electron-vite.config.ts'");
    expect(source).toContain("'frontend', 'assets', 'brand'");
    expect(source).toContain("'frontend', 'scripts', 'generate-icon.mjs'");
    expect(source).not.toContain("src/config");
    expect(source).not.toContain("src/assets");
    expect(source).not.toContain("src/scripts");
  });

  it("does not install Python into backend during setup", () => {
    const setupSh = readBuildFile("build/setup.sh");
    const setupWin = readBuildFile("build/setup-win.ps1");

    for (const source of [setupSh, setupWin]) {
      expect(source).not.toContain("backend/python");
      expect(source).not.toContain("setup_python");
      expect(source).not.toContain("python-build-standalone");
      expect(source).not.toContain("pip install");
    }
  });

  it("routes mac helper through the current build script path", () => {
    const source = readBuildFile("build/build-mac.sh");

    expect(source).toContain("node ./build/build-desktop.mjs --mac");
    expect(source).not.toContain("./src/build/build-desktop.mjs");
    expect(source).not.toContain("SCRIPT_DIR/../..");
  });

  it("generates icons from the current frontend assets directory", () => {
    const source = readBuildFile("frontend/scripts/generate-icon.mjs");

    expect(source).toContain("'..'");
    expect(source).toContain("'assets', 'brand'");
    expect(source).toContain("frontend/assets/brand/manying-studio-logo.png");
    expect(source).not.toContain("'src', 'assets', 'brand'");
  });
});
