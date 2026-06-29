// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ManualsTab } from "./ManualsTab";
import type { StudioManualPreset } from "@/types/studio";

(globalThis as any).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

(globalThis as any).matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

afterEach(cleanup);

function manual(
  id: string,
  kind: StudioManualPreset["kind"],
  name: string,
): StudioManualPreset {
  return {
    id,
    kind,
    name,
    modules: {},
    images: [],
    builtin: true,
    source: "bundled",
    completenessScore: 1,
    moduleCount: 0,
    imageCount: 0,
  };
}

describe("ManualsTab", () => {
  it("renders project config and visual/director manual choices", () => {
    render(
      <ManualsTab
        workflowConfig={{
          visualManualId: "ink",
          directorManualId: "narrative",
        }}
        setWorkflowConfig={vi.fn()}
        manualCatalog={{
          visual: [manual("ink", "visual", "水墨国风")],
          director: [manual("narrative", "director", "叙事导演")],
        }}
      />,
    );

    expect(screen.getByText("项目配置")).toBeTruthy();
    expect(screen.getByText("视觉手册（画风）")).toBeTruthy();
    expect(screen.getByText("导演手册")).toBeTruthy();
    expect(screen.getByText("水墨国风")).toBeTruthy();
    expect(screen.getByText("叙事导演")).toBeTruthy();
  });

  it("loads studio manual catalogs through the split hook", () => {
    const indexSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/index.tsx",
      ),
      "utf8",
    );
    const viewModelSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useStudioViewModel.ts",
      ),
      "utf8",
    );
    const hookSource = readFileSync(
      join(
        process.cwd(),
        "frontend/components/panels/studio/useStudioManualCatalog.ts",
      ),
      "utf8",
    );

    expect(indexSource).toContain("useStudioViewModel");
    expect(indexSource).not.toContain("useStudioManualCatalog");
    expect(viewModelSource).toContain("useStudioManualCatalog");
    expect(indexSource).not.toContain("listStudioManualPresets");
    expect(indexSource).not.toContain("buildStudioManualsFromSkillFiles");
    expect(indexSource).not.toContain("studioSkills.list");
    expect(hookSource).toContain("listStudioManualPresets");
    expect(hookSource).toContain("buildStudioManualsFromSkillFiles");
    expect(hookSource).toContain("isManualSkillMarkdownPath");
  });
});
