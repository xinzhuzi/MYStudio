// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { listStudioManualPresets } from "@/lib/studio/manuals";
import { useStudioManualCatalog } from "./useStudioManualCatalog";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "studioSkills");
});

describe("useStudioManualCatalog", () => {
  it("uses the bundled catalog when the optional skills bridge is missing", () => {
    const expectedVisualIds = listStudioManualPresets("visual").map(
      (manual) => manual.id,
    );
    const expectedDirectorIds = listStudioManualPresets("director").map(
      (manual) => manual.id,
    );

    const { result } = renderHook(() => useStudioManualCatalog());

    expect(result.current.visual?.map((manual) => manual.id)).toEqual(
      expectedVisualIds,
    );
    expect(result.current.director?.map((manual) => manual.id)).toEqual(
      expectedDirectorIds,
    );
  });
});
