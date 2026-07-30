import { describe, expect, it } from "vitest";
import type { EditingProjectV1 } from "@/types/editing";
import type { ChapterStudioProjectionInput } from "./chapter-studio-projection";
import { applyChapterStudioProjectionToEditingProject } from "./chapter-studio-writeback";

describe("Studio writeback revision base", () => {
  it("only accepts the immediately previous persisted revision", () => {
    const project = validProject();
    const projection = validProjection();
    const result = applyChapterStudioProjectionToEditingProject({ project, projection, now: 2 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.project.revision).toBe(project.revision + 1);
  });

  it("rejects a projection whose shot set contains a duplicate", () => {
    const projection = validProjection();
    projection.clips.push({ ...projection.clips[0]! });
    projection.durationInFrames = 60;
    projection.clips[0]!.transitionAfter = { type: "cut", durationInFrames: 0 };
    const result = applyChapterStudioProjectionToEditingProject({
      project: validProject(),
      projection,
      now: 2,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.some((issue) => issue.path === "clips[1].shotId")).toBe(true);
  });
});

describe("chapter Studio writeback", () => {
  it("rejects crop edits because EditingClip has no crop persistence semantics", () => {
    const projection = validProjection();
    projection.clips[0]!.crop = { x: 10, y: 0, width: 1070, height: 1920 };

    const result = applyChapterStudioProjectionToEditingProject({
      project: validProject(),
      projection,
      now: 2,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual({
        path: "clips[0].crop",
        message: "EditingClip 尚无 crop 持久化语义，拒绝丢弃 Studio crop 修改",
      });
    }
  });

  it("does not claim crop was persisted for the supported full-frame projection", () => {
    const result = applyChapterStudioProjectionToEditingProject({
      project: validProject(),
      projection: validProjection(),
      now: 2,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.changedFields).not.toContain("crop");
  });
});

function validProjection(): ChapterStudioProjectionInput {
  return {
    schemaVersion: 1,
    projectId: "project-a",
    chapterId: "chapter-1",
    editingProjectId: "editing-1",
    editingRevision: 1,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 30,
    clips: [{
      shotId: "shot-1",
      src: "http://127.0.0.1:4200/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/shot-1",
      durationInFrames: 30,
      trimBeforeFrames: 0,
      crop: { x: 0, y: 0, width: 1080, height: 1920 },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      volume: 1,
      subtitle: "",
    }],
  };
}

function validProject(): EditingProjectV1 {
  return {
    schemaVersion: 1,
    id: "editing-1",
    projectId: "project-a",
    episodeId: "chapter-1",
    name: "Chapter 1",
    revision: 1,
    sourceSnapshotHash: "snapshot-1",
    createdBy: "auto",
    manuallyEdited: false,
    stale: false,
    renderSettings: {
      width: 1080,
      height: 1920,
      fps: 30,
      codec: "h264",
      subtitleMode: "none",
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
    },
    tracks: [{
      id: "track-video",
      kind: "video",
      name: "Visual",
      order: 0,
      clipIds: ["clip-1"],
      muted: false,
      locked: false,
    }],
    clips: [{
      id: "clip-1",
      trackId: "track-video",
      name: "Shot 1",
      source: {
        kind: "storyboardVideo",
        path: "project-file://shot-1.mp4",
        evidence: { storyboardId: "shot-1" },
      },
      startUs: 0,
      durationUs: 1_000_000,
      trimStartUs: 0,
      speed: 1,
      volume: 1,
      muted: false,
    }],
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
