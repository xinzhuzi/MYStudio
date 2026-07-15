// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SceneGenerationPrefs } from "@/stores/scene-store";
import { useGenerationPreferences } from "./use-generation-preferences";

const defaults: SceneGenerationPrefs = {
  generationMode: "single",
  contactSheetLayout: "3x3",
  contactSheetAspectRatio: "16:9",
  orthographicAspectRatio: "16:9",
};

describe("useGenerationPreferences", () => {
  it("persists local preference changes through the project-scoped store action", () => {
    const setGenerationPrefs = vi.fn();
    const { result } = renderHook(() => useGenerationPreferences(defaults, setGenerationPrefs));

    act(() => {
      result.current.setGenerationMode("contact-sheet");
      result.current.setContactSheetLayout("2x2");
      result.current.setContactSheetAspectRatio("9:16");
    });

    expect(setGenerationPrefs).toHaveBeenLastCalledWith({
      generationMode: "contact-sheet",
      contactSheetLayout: "2x2",
      contactSheetAspectRatio: "9:16",
      orthographicAspectRatio: "16:9",
    });
  });

  it("resynchronizes local controls when project preferences change", () => {
    const setGenerationPrefs = vi.fn();
    const { result, rerender } = renderHook(
      ({ prefs }) => useGenerationPreferences(prefs, setGenerationPrefs),
      { initialProps: { prefs: defaults } },
    );

    rerender({
      prefs: {
        generationMode: "orthographic",
        contactSheetLayout: "2x2",
        contactSheetAspectRatio: "9:16",
        orthographicAspectRatio: "9:16",
      },
    });

    expect(result.current.generationMode).toBe("orthographic");
    expect(result.current.orthographicAspectRatio).toBe("9:16");
  });
});
