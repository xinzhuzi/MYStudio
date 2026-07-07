import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ScriptTab split boundaries", () => {
  it("keeps the script editor dialog extracted from the tab container", () => {
    const tabSource = readFileSync(
      "frontend/components/panels/studio/ScriptTab.tsx",
      "utf8",
    );
    const dialogSource = readFileSync(
      "frontend/components/panels/studio/ScriptEditorDialog.tsx",
      "utf8",
    );

    expect(tabSource).toContain('from "./ScriptEditorDialog"');
    expect(tabSource).not.toContain('DialogContent className="flex h-[88vh]');
    expect(tabSource).not.toContain("MdEditor");
    expect(dialogSource).toContain("export function ScriptEditorDialog");
    expect(dialogSource).toContain("MdEditor");
    expect(dialogSource).toContain("useThemeStore");
    expect(dialogSource).toContain("theme={theme}");
    expect(dialogSource).not.toContain('theme="dark"');
  });
});
