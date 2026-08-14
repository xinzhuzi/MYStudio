import { describe, expect, it } from "vitest";
import type { EditingProjectV1 } from "@/types/editing";
import type { VideoUseChapterArtifactV1 } from "@rendering/contracts/video-workflow";
import { projectVideoUseArtifactToEditingProject } from "./editing-project-projection";

const hash = "a".repeat(64);

function project(): EditingProjectV1 {
  return {
    schemaVersion: 1,
    id: "editing-1",
    projectId: "project-1",
    episodeId: "chapter-1",
    name: "chapter",
    revision: 1,
    sourceSnapshotHash: hash,
    createdBy: "auto",
    manuallyEdited: false,
    stale: false,
    renderSettings: { width: 1080, height: 1920, fps: 30, codec: "h264", subtitleMode: "burn-in", loudnessLufs: -14, truePeakDbtp: -1.5 },
    tracks: [
      { id: "video", kind: "video", name: "video", order: 0, clipIds: ["old-1"], muted: false, locked: false },
      { id: "subtitles", kind: "text", name: "字幕", order: 1, clipIds: ["old-subtitle"], muted: false, locked: false },
    ],
    clips: [
      { id: "old-1", trackId: "video", name: "old", source: { kind: "storyboardVideo", path: "/tmp/old.mp4", evidence: { storyboardId: "shot-1" } }, startUs: 0, durationUs: 1_000_000, trimStartUs: 0, speed: 1, volume: 1, muted: false },
      { id: "old-subtitle", trackId: "subtitles", name: "old subtitle", source: { kind: "text", text: "旧字幕", evidence: { storyboardId: "shot-1" } }, startUs: 0, durationUs: 1_000_000, trimStartUs: 0, speed: 1, volume: 0, muted: true },
    ],
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function artifact(mode: VideoUseChapterArtifactV1["mode"]): VideoUseChapterArtifactV1 {
  return {
    schemaVersion: 1,
    projectId: "project-1",
    chapterId: "chapter-1",
    revision: 2,
    mode,
    stage: "ready",
    status: "accepted",
    timeUnit: "seconds",
    timelineTimeUnit: "microseconds",
    sourceSha256: hash,
    audioSha256: hash,
    textSha256: hash,
    alignment: [],
    edl: [
      { shotId: "shot-1", sourcePath: "/tmp/shot-1.mp4", sourceInS: 0, sourceOutS: 1, timelineStartS: 0, durationS: 1 },
      { shotId: "shot-2", sourcePath: "/tmp/shot-2.mp4", sourceInS: 0.1, sourceOutS: 1.6, timelineStartS: 1, durationS: 1.5 },
    ],
    subtitles: [{ cueId: "cue-1", shotId: "shot-1", text: "你好", startUs: 0, durationUs: 500_000, source: "alignment" }],
    grade: { filter: "auto", parameters: {} },
    overlaySlots: [{ slotId: "caption-1", cueId: "cue-1", startUs: 250_000, durationUs: 500_000 }],
    preview: { path: "/tmp/preview.mp4", sha256: hash, subtitlesBurnedIn: true, durationS: 2.5 },
    selfEval: { passed: true, score: 1, notes: [], evaluatedAt: 2 },
    ...(mode === "flat-shot-mp4" ? { flatShotMp4Path: "/tmp/clean-flat.mp4" } : {}),
    evidence: { inputSha256: hash, artifactSha256: "b".repeat(64), toolVersion: "video-use@test", acceptedAt: 2 },
    review: { projectId: "project-1", chapterId: "chapter-1", revision: 2, artifactSha256: "b".repeat(64), reviewer: "user", decision: "accepted", timestamp: 3 },
    subtitleAuthority: {
      mode: mode === "flat-shot-mp4" ? "source-embedded" : "clean-remotion",
      evidence: { mode: mode === "flat-shot-mp4" ? "source-embedded" : "clean-remotion", decision: "human", sourceFingerprint: "b".repeat(64), evidencePaths: ["test"], reviewedAt: 3 },
    },
  } as VideoUseChapterArtifactV1;
}

describe("video-use to EditingProject projection", () => {
  it("projects editable EDL into TimelineTimeUs and advances the editing revision", () => {
    const sourceArtifact = artifact("editable-edl");
    sourceArtifact.overlaySlots = [];
    const result = projectVideoUseArtifactToEditingProject({ project: project(), artifact: sourceArtifact, now: 10 });
    expect(result).toMatchObject({ success: true, project: { revision: 2 } });
    if (!result.success) return;
    expect(result.project.tracks[0]?.clipIds).toHaveLength(2);
    expect(result.project.clips.filter((clip) => clip.trackId === "video")).toHaveLength(2);
    expect(result.project.clips.find((clip) => clip.source.evidence.storyboardId === "shot-2")).toMatchObject({ startUs: 1_000_000, durationUs: 1_500_000, trimStartUs: 100_000 });
    expect(result.project.clips.filter((clip) => clip.trackId === "subtitles")).toEqual([
      expect.objectContaining({
        source: { kind: "text", text: "你好", evidence: expect.objectContaining({ storyboardId: "shot-1", cueId: "cue-1", sourceFingerprint: "b".repeat(64), subtitleAuthority: expect.objectContaining({ mode: "clean-remotion" }) }) },
        startUs: 0,
        durationUs: 500_000,
        subtitle: { sourceFormat: "generated" },
      }),
    ]);
    expect(result.artifactRefs.subtitleCues).toHaveLength(1);
  });

  it("blocks flat source-embedded MP4 when overlay metadata would duplicate subtitles", () => {
    const result = projectVideoUseArtifactToEditingProject({ project: project(), artifact: artifact("flat-shot-mp4"), now: 10 });
    expect(result.success).toBe(false);
    expect(result).toMatchObject({ issues: [expect.objectContaining({ path: expect.stringContaining("cueId") })] });
  });

  it("uses clean flat MP4 as the only visual clip when explicitly approved clean", () => {
    const sourceArtifact = artifact("flat-shot-mp4");
    sourceArtifact.overlaySlots = [];
    (sourceArtifact as VideoUseChapterArtifactV1 & { subtitleAuthority: unknown }).subtitleAuthority = { mode: "clean-remotion", evidence: { mode: "clean-remotion", decision: "imported-manifest", sourceFingerprint: "b".repeat(64), evidencePaths: ["test"] } };
    const result = projectVideoUseArtifactToEditingProject({ project: project(), artifact: sourceArtifact, now: 10 });
    expect(result).toMatchObject({ success: true, project: { revision: 2 } });
    if (!result.success) return;
    const visuals = result.project.clips.filter((clip) => clip.trackId === "video");
    expect(visuals).toHaveLength(1);
    expect(visuals[0]?.source.path).toBe("/tmp/clean-flat.mp4");
    expect(result.project.clips.filter((clip) => clip.trackId === "subtitles")).toHaveLength(1);
    expect(result.artifactRefs.subtitleCues).toHaveLength(1);
    expect(result.artifactRefs.overlaySlots).toHaveLength(0);
  });

  it("keeps ordinary subtitles separate from a flat visual while Remotion remains their owner", () => {
    const sourceArtifact = artifact("flat-shot-mp4");
    sourceArtifact.overlaySlots = [];
    (sourceArtifact as VideoUseChapterArtifactV1 & { subtitleAuthority: unknown }).subtitleAuthority = { mode: "clean-remotion", evidence: { mode: "clean-remotion", decision: "imported-manifest", sourceFingerprint: "b".repeat(64), evidencePaths: ["test"] } };
    const result = projectVideoUseArtifactToEditingProject({ project: project(), artifact: sourceArtifact, now: 10 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.project.clips.filter((clip) => clip.trackId === "video")).toHaveLength(1);
    expect(result.project.clips.filter((clip) => clip.trackId === "subtitles")).toHaveLength(1);
  });

  it("blocks stale artifact revisions", () => {
    const stale = artifact("editable-edl");
    stale.revision = 1;
    expect(projectVideoUseArtifactToEditingProject({ project: project(), artifact: stale, now: 10 })).toMatchObject({ success: false, issues: [{ path: "revision" }] });
  });
});

describe("projection transitions from EDL boundary decisions", () => {
  it("projects transitionToNext into EditingProject.transitions with canonical params", () => {
    const base = artifact("editable-edl");
    base.edl = [
      { shotId: "shot-1", sourcePath: "/tmp/a.mp4", sourceInS: 0, sourceOutS: 3.2, timelineStartS: 0, durationS: 3.2,
        transitionToNext: { effectId: "crossfade", durationUs: 600_000, styleWord: "水墨晕染" } },
      { shotId: "shot-2", sourcePath: "/tmp/b.mp4", sourceInS: 0, sourceOutS: 3.0, timelineStartS: 3.2, durationS: 3.0 },
    ];
    const result = projectVideoUseArtifactToEditingProject({ project: project(), artifact: base, now: 10 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.project.transitions).toHaveLength(1);
    const transition = result.project.transitions[0]!;
    expect(transition.id).toBe("transition-shot-1-shot-2");
    expect(transition.effectId).toBe("crossfade");
    expect(transition.durationUs).toBe(600_000);
    expect(transition.params).toEqual({ curve: "linear" });
    expect(result.project.clips.some((clip) => clip.id === transition.fromClipId)).toBe(true);
    expect(result.project.clips.some((clip) => clip.id === transition.toClipId)).toBe(true);
  });

  it("keeps hard cuts when transitionToNext is absent or cut", () => {
    const base = artifact("editable-edl");
    base.edl = [
      { shotId: "shot-1", sourcePath: "/tmp/a.mp4", sourceInS: 0, sourceOutS: 3.2, timelineStartS: 0, durationS: 3.2,
        transitionToNext: { effectId: "cut", durationUs: 300_000 } },
      { shotId: "shot-2", sourcePath: "/tmp/b.mp4", sourceInS: 0, sourceOutS: 3.0, timelineStartS: 3.2, durationS: 3.0 },
    ];
    const result = projectVideoUseArtifactToEditingProject({ project: project(), artifact: base, now: 10 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.project.transitions).toHaveLength(0);
  });
});
