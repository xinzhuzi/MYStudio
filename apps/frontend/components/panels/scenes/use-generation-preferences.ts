import { useEffect, useState } from "react";
import type { SceneGenerationPrefs } from "@/stores/scene-store";

export type GenerationMode = SceneGenerationPrefs["generationMode"];

export function useGenerationPreferences(
  generationPrefs: SceneGenerationPrefs,
  setGenerationPrefs: (prefs: Partial<SceneGenerationPrefs>) => void,
) {
  const [generationMode, setGenerationMode] = useState(generationPrefs.generationMode);
  const [contactSheetLayout, setContactSheetLayout] = useState(generationPrefs.contactSheetLayout);
  const [contactSheetAspectRatio, setContactSheetAspectRatio] = useState(
    generationPrefs.contactSheetAspectRatio,
  );
  const [orthographicAspectRatio, setOrthographicAspectRatio] = useState(
    generationPrefs.orthographicAspectRatio,
  );

  useEffect(() => {
    setGenerationMode(generationPrefs.generationMode);
    setContactSheetLayout(generationPrefs.contactSheetLayout);
    setContactSheetAspectRatio(generationPrefs.contactSheetAspectRatio);
    setOrthographicAspectRatio(generationPrefs.orthographicAspectRatio);
  }, [
    generationPrefs.generationMode,
    generationPrefs.contactSheetLayout,
    generationPrefs.contactSheetAspectRatio,
    generationPrefs.orthographicAspectRatio,
  ]);

  useEffect(() => {
    setGenerationPrefs({
      generationMode,
      contactSheetLayout,
      contactSheetAspectRatio,
      orthographicAspectRatio,
    });
  }, [
    contactSheetAspectRatio,
    contactSheetLayout,
    generationMode,
    orthographicAspectRatio,
    setGenerationPrefs,
  ]);

  return {
    generationMode,
    setGenerationMode,
    contactSheetLayout,
    setContactSheetLayout,
    contactSheetAspectRatio,
    setContactSheetAspectRatio,
    orthographicAspectRatio,
    setOrthographicAspectRatio,
  };
}
