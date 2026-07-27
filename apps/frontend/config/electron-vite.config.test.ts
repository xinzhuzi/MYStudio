// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const configSource = readFileSync(
  new URL("./electron-vite.config.ts", import.meta.url),
  "utf8",
);

describe("Electron Vite Remotion entries", () => {
  it("shares the rendering alias across main, preload, and renderer builds", () => {
    expect(configSource).toContain("'@rendering': path.resolve(frontendRoot, 'electron/rendering')");
    expect(configSource).toContain("main: {\n    resolve: { alias: sharedAlias }");
    expect(configSource).toContain("preload: {\n    resolve: { alias: sharedAlias }");
    expect(configSource).toContain("renderer: {");
    expect(configSource).toContain("resolve: {\n      alias: sharedAlias");
  });

  it("emits the browser utility worker with a deterministic CJS name", () => {
    expect(configSource).toContain("'remotion-browser-worker': path.resolve(");
    expect(configSource).toContain("'frontend/electron/rendering/plugins/remotion/browser/remotion-browser-worker.ts'");
    expect(configSource).toContain("'remotion-render-worker': path.resolve(");
    expect(configSource).toContain("'frontend/electron/rendering/plugins/remotion/renderer/remotion-render-worker-entry.ts'");
    expect(configSource).toContain("entryFileNames: '[name].cjs'");
  });
});
