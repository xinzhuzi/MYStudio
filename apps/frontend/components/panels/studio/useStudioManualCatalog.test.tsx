// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { listStudioManualPresets } from "@/lib/studio/manuals";
import { useStudioManualCatalog } from "./useStudioManualCatalog";

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "studioSkills");
  Reflect.deleteProperty(window, "studioVisualManuals");
  Reflect.deleteProperty(window, "projectFiles");
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

  it("merges project skills on top of stored skills (project file wins by path)", async () => {
    (window as any).studioSkills = {
      list: async () => [{ relativePath: "story_skills/Daojie_xianxia/README.md" }],
      readText: async () => ({
        success: true,
        content: "# 道劫(存储侧旧版)\n\n旧内容",
      }),
    };
    (window as any).studioVisualManuals = { list: async () => [] };
    (window as any).projectFiles = {
      list: async ({ relativePath }: { relativePath: string }) =>
        relativePath === "skills"
          ? { success: true, files: ["story_skills/Daojie_xianxia/README.md"] }
          : { success: true, files: [] },
      readText: async () => ({
        success: true,
        text: "# 道劫 · 水墨修仙(项目侧真源)\n\n晏燎五系剑圣",
      }),
    };
    const { useProjectStore } = await import("@/stores/project/project-store");
    useProjectStore.setState({ activeProjectId: "proj-1" });

    const { result } = renderHook(() => useStudioManualCatalog());
    await new Promise((resolve) => setTimeout(resolve, 50));
    const daojie = result.current.director?.find(
      (manual) => manual.id === "Daojie_xianxia",
    );
    expect(daojie?.modules.README).toContain("项目侧真源");
    expect(daojie?.modules.README).not.toContain("旧内容");
  });
});
