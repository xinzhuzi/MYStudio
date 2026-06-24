import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(new URL("./renderer/index.html", import.meta.url), "utf8");

describe("renderer startup shell", () => {
  it("uses a non-white startup background before bundled CSS loads", () => {
    expect(indexHtml).toContain("<style>");
    expect(indexHtml).toContain("background: #17191c");
    expect(indexHtml).toContain(":root.light");
    expect(indexHtml).toContain("background: #f2efe3");
    expect(indexHtml).toContain('<body style="margin: 0; background: #17191c;">');
    expect(indexHtml).toContain('<div id="root" style="min-height: 100vh; background: #17191c;">');
  });
});
