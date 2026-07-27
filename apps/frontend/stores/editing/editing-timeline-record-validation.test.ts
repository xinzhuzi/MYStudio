import { describe, expect, it } from "vitest";
import type {
  EditingProjectV1,
  TimelineRenderRecord,
} from "@/types/editing";
import { validateTimelineRecordProjectMatch } from "./editing-timeline-record-validation";

const project = {
  projectId: "project-1",
  episodeId: "episode-1",
  sourceSnapshotHash: "snapshot-1",
  revision: 3,
} as EditingProjectV1;

const record = (overrides: Partial<TimelineRenderRecord> = {}) => ({
  projectId: "project-1",
  episodeId: "episode-1",
  editingProjectId: "editing-1",
  editingRevision: 3,
  sourceSnapshotHash: "snapshot-1",
  completedAt: 10,
  evidence: {} as TimelineRenderRecord["evidence"],
  ...overrides,
});

describe("timeline render record project validation", () => {
  it("checks application scope before project existence", () => {
    expect(validateTimelineRecordProjectMatch(null, undefined, record(), false)).toMatchObject({
      code: "editing.persistence.render_record_scope",
      path: "$.projectId",
    });
    expect(validateTimelineRecordProjectMatch("project-2", undefined, record(), false)).toMatchObject({
      code: "editing.persistence.render_record_scope",
    });
    expect(validateTimelineRecordProjectMatch("project-1", undefined, record(), false)).toMatchObject({
      code: "editing.persistence.render_record_project",
      path: "$.editingProjectId",
    });
  });

  it.each([
    ["episodeId", { episodeId: "episode-2" }],
    ["sourceSnapshotHash", { sourceSnapshotHash: "snapshot-2" }],
    ["future revision", { editingRevision: 4 }],
  ] as const)("rejects %s mismatch", (_label, overrides) => {
    expect(validateTimelineRecordProjectMatch("project-1", project, record(overrides), false)).toMatchObject({
      code: "editing.persistence.render_record_mismatch",
      path: "$",
    });
  });

  it("rejects a project record from another application project", () => {
    expect(validateTimelineRecordProjectMatch(
      "project-1",
      { ...project, projectId: "project-2" },
      record(),
      false,
    )).toMatchObject({
      code: "editing.persistence.render_record_mismatch",
      path: "$",
    });
  });

  it("allows historical revisions during hydration but requires current revision on save", () => {
    expect(validateTimelineRecordProjectMatch(
      "project-1",
      project,
      record({ editingRevision: 2 }),
      false,
    )).toBeUndefined();
    expect(validateTimelineRecordProjectMatch(
      "project-1",
      project,
      record({ editingRevision: 2 }),
      true,
    )).toMatchObject({ code: "editing.persistence.render_record_mismatch" });
    expect(validateTimelineRecordProjectMatch("project-1", project, record(), true)).toBeUndefined();
  });
});
