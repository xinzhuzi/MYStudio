import { describe, expect, it } from "vitest";
import { applyLocalTtsRuntimeStatus, canApplyLocalTtsUpdate } from "./local-tts-panel-lifecycle";

describe("LocalTtsPanel lifecycle updates", () => {
  it("accepts updates while mounted and rejects late async completions", () => {
    expect(canApplyLocalTtsUpdate(true)).toBe(true);
    expect(canApplyLocalTtsUpdate(false)).toBe(false);
  });

  it("only applies delayed runtime status while mounted", () => {
    const updates: string[] = [];
    const setStatus = (status: string) => updates.push(status);

    expect(applyLocalTtsRuntimeStatus(true, "running", setStatus)).toBe(true);
    expect(applyLocalTtsRuntimeStatus(false, "stopped", setStatus)).toBe(false);
    expect(updates).toEqual(["running"]);
  });
});
