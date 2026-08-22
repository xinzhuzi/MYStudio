import { useEffect, useMemo, useState } from "react";
import { getStudioSkillsBridge } from "@/lib/bridge/studio-skills";
import { getStudioVisualManualsBridge } from "@/lib/bridge/studio-visual-manuals";
import { getProjectFilesBridge } from "@/lib/bridge/project-files";
import { useProjectStore } from "@/stores/project/project-store";
import { warmExtendedManualStyleTokens } from "@/lib/studio/visual-manual-style-tokens";
import {
  buildStudioManualsFromSkillFiles,
  listStudioManualPresets,
  type StudioManualCatalog,
  type StudioManualSkillOverrideFile,
} from "@/lib/studio/manuals";

export function useStudioManualCatalog() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const bundledManualCatalog = useMemo<StudioManualCatalog>(
    () => ({
      visual: listStudioManualPresets("visual"),
      director: listStudioManualPresets("director"),
    }),
    [],
  );
  const [storedManualCatalog, setStoredManualCatalog] =
    useState<StudioManualCatalog | null>(null);
  const usesStoredManualCatalog = Boolean(getStudioSkillsBridge()?.list);
  const manualCatalog =
    storedManualCatalog ??
    (usesStoredManualCatalog ? {} : bundledManualCatalog);

  useEffect(() => {
    const studioSkills = getStudioSkillsBridge();
    if (!studioSkills?.list || !studioSkills?.readText) return;
    const studioVisualManuals = getStudioVisualManualsBridge();
    const projectFiles = getProjectFilesBridge();
    let cancelled = false;
    const loadStoredManualCatalog = async () => {
      try {
        const [files, visualManuals] = await Promise.all([
          studioSkills.list(),
          studioVisualManuals?.list?.() ?? Promise.resolve([]),
        ]);
        const skillFiles = files
          .filter((file) => isManualSkillMarkdownPath(file.relativePath))
          .map((file) => ({ relativePath: file.relativePath, content: "" }));
        // 读取存储侧内容(userData/skills,应用种子同步+应用内编辑)
        const storedLoaded = await Promise.all(
          skillFiles.map(async (file) => {
            const result = await studioSkills.readText(file.relativePath);
            if (!result.success) return null;
            return {
              relativePath: file.relativePath,
              content: result.content ?? "",
            } satisfies StudioManualSkillOverrideFile;
          }),
        );
        const merged = new Map(
          storedLoaded
            .filter((file): file is StudioManualSkillOverrideFile => Boolean(file))
            .map((file) => [file.relativePath, file]),
        );
        // 项目侧真源(2026-08-22 裁定:项目专属手册放 <项目根>/skills/):
        // 项目文件覆盖存储侧同路径文件——改项目里的手册文件即生效,无需重打包
        if (activeProjectId && projectFiles?.list && projectFiles?.readText) {
          const listed = await projectFiles.list({
            projectId: activeProjectId,
            relativePath: "skills",
          });
          if (listed.success) {
            const projectMdFiles = (listed.files ?? []).filter(isManualSkillMarkdownPath);
            const projectLoaded = await Promise.all(
              projectMdFiles.map(async (relativePath) => {
                const result = await projectFiles.readText!({
                  projectId: activeProjectId,
                  relativePath,
                });
                if (!result.success) return null;
                return {
                  relativePath,
                  content: result.text ?? "",
                } satisfies StudioManualSkillOverrideFile;
              }),
            );
            for (const file of projectLoaded) {
              if (file) merged.set(file.relativePath, file);
            }
          }
        }
        const imagesByManualId = Object.fromEntries(
          visualManuals.map((manual) => [
            manual.stylePath,
            manual.images.map((image) => image.url),
          ]),
        );
        if (!cancelled) {
          // 项目/存储手册合并完成后预热分镜风格锁 token(运行时读取道劫 art_storyboard_video)
          void warmExtendedManualStyleTokens();
          setStoredManualCatalog({
            visual: buildStudioManualsFromSkillFiles("visual", [...merged.values()], {
              imagesByManualId,
            }),
            director: buildStudioManualsFromSkillFiles("director", [...merged.values()]),
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
  }, [activeProjectId]);

  return manualCatalog;
}

export function isManualSkillMarkdownPath(relativePath: string) {
  return (
    relativePath.endsWith(".md") &&
    (relativePath.startsWith("art_skills/") ||
      relativePath.startsWith("story_skills/"))
  );
}
