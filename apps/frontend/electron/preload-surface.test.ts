import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preloadSource = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");

describe("preload IPC surface", () => {
  it("does not expose raw ipcRenderer send/invoke to the renderer", () => {
    expect(preloadSource).not.toContain("exposeInMainWorld('ipcRenderer'");
    expect(preloadSource).toContain("exposeInMainWorld('appEvents'");
  });
});
