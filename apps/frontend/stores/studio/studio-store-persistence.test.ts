import { describe, expect, it } from "vitest";
import {
  migrateStudioWorkflowState,
  normalizeWorkflowConfig,
  STUDIO_WORKFLOW_PERSIST_VERSION,
  STUDIO_WORKFLOW_STORAGE_KEY,
} from "./studio-store-persistence";

describe("studio workflow persistence contract", () => {
  it("keeps the stable storage key and version", () => {
    expect(STUDIO_WORKFLOW_STORAGE_KEY).toBe("studio-workflow-store");
    expect(STUDIO_WORKFLOW_PERSIST_VERSION).toBe(10);
  });

  it("normalizes legacy manual ids without changing other config", () => {
    expect(normalizeWorkflowConfig({
      visualManualId: "2D_chinese_guofeng",
      directorManualId: "Xianxia_fantasy",
      episodeDurationMin: 5,
    })).toEqual({ episodeDurationMin: 5, visualManualId: undefined, directorManualId: undefined });
  });

  it("fills missing persisted collections and preserves non-objects", () => {
    expect(migrateStudioWorkflowState(null)).toBeNull();
    const migrated = migrateStudioWorkflowState({ workflowConfig: undefined }) as Record<string, unknown>;
    expect(migrated.entityExtractions).toEqual([]);
    expect(migrated.continuityAssetVersions).toEqual([]);
    expect(migrated.workflowConfig).toEqual({ visualManualId: undefined, directorManualId: undefined });
  });

  it("normalizes sourceBible to a string with empty default", () => {
    const migrated = migrateStudioWorkflowState({
      sourceBible: "# 原著圣经\n## 一句话主线\n主线内容",
    }) as Record<string, unknown>;
    expect(migrated.sourceBible).toBe("# 原著圣经\n## 一句话主线\n主线内容");

    const defaulted = migrateStudioWorkflowState({ sourceBible: 123 }) as Record<string, unknown>;
    expect(defaulted.sourceBible).toBe("");

    const missing = migrateStudioWorkflowState({}) as Record<string, unknown>;
    expect(missing.sourceBible).toBe("");
  });
});
