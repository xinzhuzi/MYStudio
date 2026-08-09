import { describe, expect, it } from "vitest";
import {
  blockVideoWorkflowStage,
  resumeVideoWorkflowStage,
  transitionVideoWorkflowStage,
} from "./stage-machine";

describe("video workflow stage machine", () => {
  it("advances only through the locked stage order", () => {
    expect(transitionVideoWorkflowStage("preparing", "aligning")).toEqual({ success: true, stage: "aligning" });
    expect(transitionVideoWorkflowStage("preparing", "editing").success).toBe(false);
    expect(transitionVideoWorkflowStage("ready", "preparing").success).toBe(false);
  });

  it("blocks a chapter and resumes from the failed stage explicitly", () => {
    expect(blockVideoWorkflowStage("previewing")).toEqual({ success: true, stage: "blocked" });
    expect(transitionVideoWorkflowStage("blocked", "previewing").success).toBe(false);
    expect(resumeVideoWorkflowStage("previewing")).toEqual({ success: true, stage: "previewing" });
    expect(resumeVideoWorkflowStage("ready").success).toBe(false);
  });
});
