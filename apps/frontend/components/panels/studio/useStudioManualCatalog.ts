import { useEffect, useMemo, useState } from "react";
import {
  buildStudioManualsFromSkillFiles,
  listStudioManualPresets,
  type StudioManualCatalog,
  type StudioManualSkillOverrideFile,
} from "@/lib/studio/manuals";

export function useStudioManualCatalog() {
  const bundledManualCatalog = useMemo<StudioManualCatalog>(
    () => ({
      visual: listStudioManualPresets("visual"),
      director: listStudioManualPresets("director"),
    }),
    [],
  );
  const [storedManualCatalog, setStoredManualCatalog] =
    useState<StudioManualCatalog | null>(null);
  const usesStoredManualCatalog =
    typeof window !== "undefined" && Boolean(window.studioSkills?.list);
  const manualCatalog =
    storedManualCatalog ??
    (usesStoredManualCatalog ? {} : bundledManualCatalog);

  useEffect(() => {
    const studioSkills = window.studioSkills;
    if (!studioSkills?.list || !studioSkills.readText) return;
    let cancelled = false;
    const loadStoredManualCatalog = async () => {
      try {
        const [files, visualManuals] = await Promise.all([
          studioSkills.list(),
          window.studioVisualManuals?.list?.() ?? Promise.resolve([]),
        ]);
        const manualFiles = files.filter((file) =>
          isManualSkillMarkdownPath(file.relativePath),
        );
        const loaded = await Promise.all(
          manualFiles.map(async (file) => {
            const result = await studioSkills.readText(file.relativePath);
            if (!result.success) return null;
            return {
              relativePath: file.relativePath,
              content: result.content ?? "",
            } satisfies StudioManualSkillOverrideFile;
          }),
        );
        const skillFiles = loaded.filter(
          (file): file is StudioManualSkillOverrideFile => Boolean(file),
        );
        const imagesByManualId = Object.fromEntries(
          visualManuals.map((manual) => [
            manual.stylePath,
            manual.images.map((image) => image.url),
          ]),
        );
        if (!cancelled) {
          setStoredManualCatalog({
            visual: buildStudioManualsFromSkillFiles("visual", skillFiles, {
              imagesByManualId,
            }),
            director: buildStudioManualsFromSkillFiles("director", skillFiles),
          });
        }
      } catch (error) {
        console.warn(
          "[StudioView] Failed to load stored manual catalog:",
          error,
        );
      }
    };
    void loadStoredManualCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  return manualCatalog;
}

export function isManualSkillMarkdownPath(relativePath: string) {
  return (
    relativePath.endsWith(".md") &&
    (relativePath.startsWith("art_skills/") ||
      relativePath.startsWith("story_skills/"))
  );
}
