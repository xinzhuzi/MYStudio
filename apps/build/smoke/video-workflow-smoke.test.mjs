import { describe, expect, it } from "vitest";
import { evaluateVideoWorkflowStatus } from "./video-workflow-smoke.mjs";

function status(videoUse = {}, overrides = {}) {
  const checkedAt = 100;
  const base = (pluginId, displayName) => ({
    schemaVersion: 1,
    pluginId,
    displayName,
    sourceUrl: "https://example.invalid",
    sourceCommit: "a".repeat(40),
    license: "MIT",
    appVersion: "0.0.0",
    pluginVersion: "1",
    runtimeState: "ready",
    checkedAt,
    dependencies: {},
  });
  return {
    schemaVersion: 1,
    checkedAt,
    plugins: [
      base("remotion", "Remotion"),
      { ...base("video-use", "video-use"), ...videoUse },
      base("hyperframes", "HyperFrames"),
      { ...base("seedance-prompt", "Seedance Prompt Skill"), runtimeState: "deferred" },
    ].map((plugin) => ({ ...plugin, ...(overrides[plugin.pluginId] || {}) })),
  };
}

describe("video-workflow read-only smoke status", () => {
  it("reports exact alignment-model-missing and remains fail-closed", () => {
    const result = evaluateVideoWorkflowStatus(status({ runtimeState: "blocked", runtimeCode: "alignment-model-missing", message: "模型缺失" }));
    expect(result).toMatchObject({ ok: false, state: "blocked", code: "alignment-model-missing" });
    expect(result.mutatingCalls).toBeUndefined();
  });

  it("accepts only all four ready plugin states", () => {
    expect(evaluateVideoWorkflowStatus(status()).ok).toBe(true);
    expect(evaluateVideoWorkflowStatus(status({}, { hyperframes: { runtimeState: "needs-runtime" } })).ok).toBe(false);
  });

  it("rejects malformed or incomplete status without attempting a mutation", () => {
    const result = evaluateVideoWorkflowStatus({ schemaVersion: 1, checkedAt: 1, plugins: [] });
    expect(result.ok).toBe(false);
    expect(result.state).toBe("invalid");
    expect(result.issues.some((issue) => issue.code === "status.plugin-missing")).toBe(true);
  });
});
