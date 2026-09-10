import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SAVE_STATUS_COPY } from "./ProjectHeader";

describe("ProjectHeader copy", () => {
  it("uses Chinese save status labels", () => {
    expect(SAVE_STATUS_COPY).toEqual({
      saved: "已保存",
      saving: "保存中...",
      unsaved: "未保存",
    });
  });

  it("wires chrome arrows to navigation history instead of direct dashboard exit", () => {
    const headerSource = readFileSync(
      fileURLToPath(new URL("./ProjectHeader.tsx", import.meta.url)),
      "utf8",
    );
    const layoutSource = readFileSync(
      fileURLToPath(new URL("./Layout.tsx", import.meta.url)),
      "utf8",
    );

    expect(headerSource).toContain("goBack");
    expect(headerSource).toContain("goForward");
    expect(headerSource).toContain("canGoBack()");
    expect(headerSource).toContain("canGoForward()");
    expect(layoutSource).not.toContain("setInProject(false)");
    expect(layoutSource).not.toContain("onBack=");
  });
});
