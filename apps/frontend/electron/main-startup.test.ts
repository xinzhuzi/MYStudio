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
});
