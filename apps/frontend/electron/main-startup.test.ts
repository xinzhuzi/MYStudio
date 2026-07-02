import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("main process startup", () => {
  it("does not auto-start the TTS backend when the app becomes ready", () => {
    const readyBlock = mainSource.slice(
      mainSource.indexOf("app.whenReady().then"),
      mainSource.indexOf("protocol.handle('local-image'"),
    );

    expect(readyBlock).not.toContain("ttsRuntimeController.start()");
  });

  it("keeps the window hidden on a dark background until the first render is ready", () => {
    const windowBlock = mainSource.slice(
      mainSource.indexOf("win = new BrowserWindow"),
      mainSource.indexOf("// Open external links in system browser"),
    );

    expect(windowBlock).toContain("show: false");
    expect(windowBlock).toContain("backgroundColor: '#17191c'");
    expect(windowBlock).toContain("ready-to-show");
    expect(windowBlock).toContain("did-finish-load");
    expect(windowBlock).toContain("showWindow()");
  });

  it("keeps automatic update checks quiet while preserving manual check errors", () => {
    const updaterBlock = mainSource.slice(
      mainSource.indexOf("ipcMain.handle('app-updater-check'"),
      mainSource.indexOf("ipcMain.handle('app-updater-open-link'"),
    );

    expect(updaterBlock).toContain("options?: UpdateCheckOptions");
    expect(updaterBlock).toContain("if (!options?.silent)");
    expect(updaterBlock).toContain("console.error('Failed to check updates:'");
  });

  it("registers project-file protocol for project-scoped workflow assets", () => {
    expect(mainSource).toContain("scheme: 'project-file'");
    expect(mainSource).toContain("protocol.handle('project-file'");
    expect(mainSource).toContain("ipcMain.handle('project-file-write-binary'");
    expect(mainSource).toContain("ipcMain.handle('project-file-save-image'");
    expect(mainSource).toContain("ipcMain.handle('project-file-read-base64'");
    expect(mainSource).toContain("ipcMain.handle('project-file-get-absolute-path'");
  });
});
