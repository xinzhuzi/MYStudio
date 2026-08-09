import { describe, expect, it } from "vitest";
import { assertProjectMediaDeleteAllowed } from "./media-store";

describe("media deletion boundary", () => {
  it("blocks project-owned media from bypassing the artifact plan", () => {
    expect(() => assertProjectMediaDeleteAllowed({ projectId: "project-1", ephemeral: false }))
      .toThrow("project-owned media must be deleted through the artifact plan");
  });

  it("allows ephemeral or unscoped media cleanup", () => {
    expect(() => assertProjectMediaDeleteAllowed({ projectId: "project-1", ephemeral: true })).not.toThrow();
    expect(() => assertProjectMediaDeleteAllowed(undefined)).not.toThrow();
  });
});
