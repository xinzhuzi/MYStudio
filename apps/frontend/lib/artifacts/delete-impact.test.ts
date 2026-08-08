import { describe, it, expect } from "vitest";
import { getDeleteImpact, getArtifactDeleteImpact } from "./delete-impact";
import type { DeletePolicy } from "@/types/artifacts";

describe("getDeleteImpact", () => {
  it("maps exclusive-downstream to safe (does not disturb flow)", () => {
    const impact = getDeleteImpact("delete-exclusive-downstream");
    expect(impact.level).toBe("safe");
    expect(impact.disturbsFlow).toBe(false);
    expect(impact.label).toBe("可删");
  });

  it("maps shared reference to impactful", () => {
    const impact = getDeleteImpact("retain-shared-reference");
    expect(impact.level).toBe("impactful");
    expect(impact.disturbsFlow).toBe(true);
    expect(impact.label).toBe("影响流程");
  });

  it("maps protected base asset to protected", () => {
    const impact = getDeleteImpact("protected-base-asset");
    expect(impact.level).toBe("protected");
    expect(impact.disturbsFlow).toBe(true);
  });

  it("maps both blocker policies to blocked", () => {
    expect(getDeleteImpact("blocker-missing-ownership").level).toBe("blocked");
    expect(getDeleteImpact("blocker-running-job").level).toBe("blocked");
  });

  it("defaults unknown / missing policy to blocked (safest)", () => {
    expect(getDeleteImpact(undefined).level).toBe("blocked");
    expect(getDeleteImpact(null).level).toBe("blocked");
    expect(getDeleteImpact("unknown-policy" as DeletePolicy).level).toBe("blocked");
  });

  it("always provides an icon component", () => {
    for (const policy of [
      "delete-exclusive-downstream",
      "retain-shared-reference",
      "protected-base-asset",
      "blocker-missing-ownership",
    ] as DeletePolicy[]) {
      const impact = getDeleteImpact(policy);
      expect(impact.icon).toBeDefined();
      // lucide icons render as forward-ref components (object), not plain
      // functions — just assert it's a renderable component.
      expect(impact.icon).toBeTruthy();
      expect(impact.className.length).toBeGreaterThan(0);
      expect(impact.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("getArtifactDeleteImpact", () => {
  it("classifies a scan-origin backup (physicalRefs type backup) as backup level", () => {
    const impact = getArtifactDeleteImpact({
      deletePolicy: "delete-exclusive-downstream",
      stage: "backup",
      kind: "media-file",
      physicalRefs: [{ type: "backup", path: "studio-workflow-store.json.bak-20260716T120000" }],
    });
    expect(impact.level).toBe("backup");
    expect(impact.disturbsFlow).toBe(false);
    expect(impact.label).toBe("可清理备份");
  });

  it("classifies a top-level project config (blocker + project-file ref, no slash) as projectConfig", () => {
    const impact = getArtifactDeleteImpact({
      deletePolicy: "blocker-missing-ownership",
      kind: "media-file",
      physicalRefs: [{ type: "project-file", path: "characters.json" }],
    });
    expect(impact.level).toBe("projectConfig");
    expect(impact.label).toBe("项目配置");
  });

  it("falls back to blocked for sub-directory config (path contains slash)", () => {
    const impact = getArtifactDeleteImpact({
      deletePolicy: "blocker-missing-ownership",
      kind: "media-file",
      physicalRefs: [{ type: "project-file", path: "remotion/project.json.json" }],
    });
    expect(impact.level).toBe("blocked");
  });

  it("does NOT misclassify a dependency-graph backup-block (no type:backup ref) as backup", () => {
    // Synthetic blocker rows from artifact-dependency-graph.ts use
    // stage:"backup" + kind:"media-file" but carry NO type:"backup" ref —
    // they must fall through to "blocked", not "backup".
    const impact = getArtifactDeleteImpact({
      deletePolicy: "blocker-missing-ownership",
      stage: "backup",
      kind: "media-file",
      physicalRefs: [],
    });
    expect(impact.level).toBe("blocked");
  });

  it("delegates to policy mapping for a normal exclusive-downstream artifact", () => {
    const impact = getArtifactDeleteImpact({
      deletePolicy: "delete-exclusive-downstream",
      kind: "novel-chapter",
      physicalRefs: [{ type: "project-file", path: "chapters/chapter-001.json" }],
    });
    expect(impact.level).toBe("safe");
  });
});
