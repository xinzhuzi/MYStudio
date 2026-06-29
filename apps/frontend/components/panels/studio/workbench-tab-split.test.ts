import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("WorkbenchTab split boundaries", () => {
  it("keeps the workbench track card extracted from the tab container", () => {
    const tabSource = readFileSync(
      "frontend/components/panels/studio/WorkbenchTab.tsx",
      "utf8",
    );
    const cardSource = readFileSync(
      "frontend/components/panels/studio/WorkbenchTrackCard.tsx",
      "utf8",
    );

    expect(tabSource).toContain('from "./WorkbenchTrackCard"');
    expect(tabSource).not.toContain("<CardHeader");
    expect(tabSource).not.toContain("<CardContent");
    expect(cardSource).toContain("export function WorkbenchTrackCard");
    expect(cardSource).toContain("<CardHeader");
    expect(cardSource).toContain("<CardContent");
  });
});
