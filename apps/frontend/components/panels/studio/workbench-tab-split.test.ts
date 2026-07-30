import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("WorkbenchTab split boundaries", () => {
  it("keeps the native Studio host free of legacy track-card rendering", () => {
    const tabSource = readFileSync(
      "frontend/components/panels/studio/WorkbenchTab.tsx",
      "utf8",
    );
    expect(tabSource).not.toContain('from "./WorkbenchTrackCard"');
    expect(tabSource).not.toContain("<CardHeader");
    expect(tabSource).not.toContain("<CardContent");
  });
});
