import { describe, expect, it } from "vitest";
import type { EditingProjectV1 } from "@/types/editing";
import {
  applyEditingCommand,
  createEditingHistory,
  executeEditingHistory,
  redoEditingHistory,
  snapTimelineTime,
  undoEditingHistory,
} from "./command-core";

describe("editing command core", () => {
  it("splits inside a clip and advances source trim by speed", () => {
    const project = fixtureProject();
    const result = applyEditingCommand(project, {
      type: "clip.split",
      clipId: "clip-1",
      splitAtUs: 1_000_000,
      newClipId: "clip-1-right",
      issuedAt: 20,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(project.clips).toHaveLength(3);
    expect(result.project.clips).toHaveLength(4);
    expect(result.project.clips.slice(0, 2)).toMatchObject([
      { id: "clip-1", durationUs: 1_000_000, trimStartUs: 1_000_000 },
      {
        id: "clip-1-right",
        startUs: 1_000_000,
        durationUs: 3_000_000,
        trimStartUs: 2_500_000,
      },
    ]);
    expect(result.project.tracks[0]?.clipIds).toEqual([
      "clip-1",
      "clip-1-right",
      "clip-2",
    ]);
    expect(result.project).toMatchObject({
      revision: 2,
      updatedAt: 20,
      manuallyEdited: true,
    });
  });

  it("rejects an invalid split without mutating the input", () => {
    const project = fixtureProject();
    const before = structuredClone(project);
    const result = applyEditingCommand(project, {
      type: "clip.split",
      clipId: "clip-1",
      splitAtUs: 0,
      newClipId: "clip-1-right",
      issuedAt: 20,
    });

    expect(result).toMatchObject({
      success: false,
      issue: { code: "editing.command.split_boundary" },
    });
    expect(project).toEqual(before);
  });

  it("trims then moves a clip across tracks while maintaining membership", () => {
    const trimmed = applyEditingCommand(fixtureProject(), {
      type: "clip.trim",
      clipId: "clip-1",
      startUs: 500_000,
      durationUs: 2_500_000,
      trimStartUs: 1_500_000,
      issuedAt: 20,
    });
    expect(trimmed.success).toBe(true);
    if (!trimmed.success) return;

    const moved = applyEditingCommand(trimmed.project, {
      type: "clip.move",
      clipId: "clip-1",
      trackId: "track-overlay",
      startUs: 6_000_000,
      issuedAt: 30,
    });
    expect(moved.success).toBe(true);
    if (!moved.success) return;
    expect(moved.project.clips.find((clip) => clip.id === "clip-1")).toMatchObject({
      trackId: "track-overlay",
      startUs: 6_000_000,
      durationUs: 2_500_000,
      trimStartUs: 1_500_000,
    });
    expect(moved.project.tracks.find((track) => track.id === "track-main")?.clipIds).toEqual([
      "clip-2",
    ]);
    expect(moved.project.tracks.find((track) => track.id === "track-overlay")?.clipIds).toEqual([
      "clip-overlay",
      "clip-1",
    ]);
  });

  it("snaps to the nearest boundary with deterministic ties", () => {
    const project = fixtureProject();
    expect(snapTimelineTime({
      project,
      proposedTimeUs: 4_100_000,
      thresholdUs: 200_000,
      excludeClipId: "clip-1",
    })).toEqual({ snapped: true, timeUs: 4_000_000, targetUs: 4_000_000 });
    expect(snapTimelineTime({
      project,
      proposedTimeUs: 8_000_000,
      thresholdUs: 1_000_000,
      markersUs: [7_000_000, 9_000_000],
    })).toEqual({ snapped: true, timeUs: 7_000_000, targetUs: 7_000_000 });
    expect(snapTimelineTime({
      project,
      proposedTimeUs: 4_400_000,
      thresholdUs: 100_000,
      excludeClipId: "clip-1",
    })).toEqual({ snapped: false, timeUs: 4_400_000 });
  });

  it("routes source, effect, transition and proposal changes through commands", () => {
    let project = fixtureProject();
    project = successful(applyEditingCommand(project, {
      type: "clip.replaceSource",
      clipId: "clip-1",
      source: {
        kind: "videoCandidate",
        path: "/replacement.mp4",
        evidence: { storyboardId: "sb-1", candidateId: "candidate-2" },
      },
      issuedAt: 20,
    }));
    project = successful(applyEditingCommand(project, {
      type: "effect.upsert",
      effect: {
        id: "effect-1",
        effectId: "glow",
        targetClipId: "clip-1",
        startUs: 0,
        durationUs: 1_000_000,
        params: { intensity: 0.4 },
        enabled: true,
      },
      issuedAt: 30,
    }));
    project = successful(applyEditingCommand(project, {
      type: "transition.upsert",
      transition: {
        id: "transition-1",
        fromClipId: "clip-1",
        toClipId: "clip-2",
        effectId: "crossfade",
        durationUs: 300_000,
        params: { curve: "linear" },
      },
      issuedAt: 40,
    }));
    project = successful(applyEditingCommand(project, {
      type: "proposal.accept",
      proposalIds: ["proposal-1"],
      issuedAt: 50,
    }));

    expect(project.clips[0]?.source).toMatchObject({
      kind: "videoCandidate",
      path: "/replacement.mp4",
    });
    expect(project.effects).toHaveLength(2);
    expect(project.transitions).toHaveLength(1);
    expect(project.proposals[0]?.status).toBe("accepted");
    expect(project.effects[1]).toMatchObject({
      id: "effect-from-proposal-proposal-1",
      effectId: "glow",
      proposalId: "proposal-1",
      enabled: true,
    });

    project = successful(applyEditingCommand(project, {
      type: "effect.remove",
      effectId: "effect-1",
      issuedAt: 60,
    }));
    project = successful(applyEditingCommand(project, {
      type: "transition.remove",
      transitionId: "transition-1",
      issuedAt: 70,
    }));
    expect(project.effects).toEqual([
      expect.objectContaining({ proposalId: "proposal-1" }),
    ]);
    expect(project.transitions).toEqual([]);
  });

  it("modifies, rejects and disables proposals through explicit state transitions", () => {
    let project = fixtureProject();
    project = successful(applyEditingCommand(project, {
      type: "proposal.modify",
      proposalId: "proposal-1",
      patch: {
        effectId: "blur",
        params: { radius: 8 },
        startUs: 4_500_000,
        durationUs: 1_500_000,
        reason: "聚焦主体",
      },
      issuedAt: 20,
    }));
    expect(project.proposals[0]).toMatchObject({
      effectId: "blur",
      params: { radius: 8 },
      startUs: 4_500_000,
      durationUs: 1_500_000,
      reason: "聚焦主体",
      confidence: 0.8,
      status: "pending",
    });

    const rejected = successful(applyEditingCommand(fixtureProject(), {
      type: "proposal.reject",
      proposalId: "proposal-1",
      issuedAt: 20,
    }));
    expect(rejected.proposals[0]?.status).toBe("rejected");

    project = successful(applyEditingCommand(project, {
      type: "proposal.accept",
      proposalIds: ["proposal-1"],
      issuedAt: 30,
    }));
    project = successful(applyEditingCommand(project, {
      type: "proposal.disable",
      proposalId: "proposal-1",
      issuedAt: 40,
    }));
    expect(project.proposals[0]?.status).toBe("disabled");
    expect(project.effects.find((effect) => effect.proposalId === "proposal-1")?.enabled).toBe(false);

    expect(applyEditingCommand(project, {
      type: "proposal.accept",
      proposalIds: ["proposal-1"],
      issuedAt: 50,
    })).toMatchObject({
      success: false,
      issue: { code: "editing.command.proposal_status" },
    });
  });

  it("accepts proposal batches atomically as one undoable history entry", () => {
    const project = fixtureProject();
    project.proposals.push({
      ...project.proposals[0]!,
      id: "proposal-2",
      effectId: "grain",
      params: { amount: 0.2 },
    });
    const invalid = structuredClone(project);
    invalid.proposals[1]!.status = "rejected";
    expect(applyEditingCommand(invalid, {
      type: "proposal.accept",
      proposalIds: ["proposal-2", "proposal-1"],
      issuedAt: 20,
    })).toMatchObject({
      success: false,
      issue: { code: "editing.command.proposal_status" },
    });
    expect(invalid.effects).toEqual([]);
    expect(invalid.proposals[0]?.status).toBe("pending");

    const executed = executeEditingHistory(createEditingHistory(project), {
      type: "proposal.accept",
      proposalIds: ["proposal-2", "proposal-1"],
      issuedAt: 20,
    });
    expect(executed.success).toBe(true);
    if (!executed.success) return;
    expect(executed.history.past).toHaveLength(1);
    expect(executed.history.present.proposals.map((item) => item.status)).toEqual([
      "accepted",
      "accepted",
    ]);
    expect(executed.history.present.effects.map((effect) => effect.proposalId)).toEqual([
      "proposal-1",
      "proposal-2",
    ]);

    const undone = undoEditingHistory(executed.history, 30);
    expect(undone.success).toBe(true);
    if (!undone.success) return;
    expect(undone.history.present.effects).toEqual([]);
    expect(undone.history.present.proposals.map((item) => item.status)).toEqual([
      "pending",
      "pending",
    ]);

    const redone = redoEditingHistory(undone.history, 40);
    expect(redone.success).toBe(true);
    if (!redone.success) return;
    expect(redone.history.present.effects).toHaveLength(2);
    expect(redone.history.present.proposals.map((item) => item.status)).toEqual([
      "accepted",
      "accepted",
    ]);
  });

  it("updates audio controls through one undoable command", () => {
    const project = withAudioAndSubtitleTracks(fixtureProject());
    const history = createEditingHistory(project);
    const executed = executeEditingHistory(history, {
      type: "clip.updateAudio",
      clipId: "voice-1",
      volume: 0.8,
      muted: false,
      fadeInUs: 120_000,
      fadeOutUs: 240_000,
      envelope: [
        { timeUs: 0, gain: 0.5 },
        { timeUs: 1_000_000, gain: 1 },
      ],
      issuedAt: 20,
    });

    expect(executed.success).toBe(true);
    if (!executed.success) return;
    expect(executed.history.present.clips.find((clip) => clip.id === "voice-1")).toMatchObject({
      volume: 0.8,
      muted: false,
      fadeInUs: 120_000,
      fadeOutUs: 240_000,
      envelope: [
        { timeUs: 0, gain: 0.5 },
        { timeUs: 1_000_000, gain: 1 },
      ],
    });

    const undone = undoEditingHistory(executed.history, 30);
    expect(undone.success).toBe(true);
    if (!undone.success) return;
    expect(undone.history.present.clips.find((clip) => clip.id === "voice-1")?.volume).toBe(1);
  });

  it("atomically replaces subtitle cues and edits cue text", () => {
    let project = withAudioAndSubtitleTracks(fixtureProject());
    project = successful(applyEditingCommand(project, {
      type: "subtitle.replaceTrackCues",
      trackId: "subtitle-track",
      clips: [
        subtitleClip("subtitle-import-1", 500_000, 1_500_000, "导入第一句", "srt"),
        subtitleClip("subtitle-import-2", 2_500_000, 1_000_000, "导入第二句", "srt"),
      ],
      issuedAt: 20,
    }));

    expect(project.tracks.find((track) => track.id === "subtitle-track")?.clipIds).toEqual([
      "subtitle-import-1",
      "subtitle-import-2",
    ]);
    expect(project.clips.some((clip) => clip.id === "subtitle-1")).toBe(false);

    project = successful(applyEditingCommand(project, {
      type: "clip.updateText",
      clipId: "subtitle-import-1",
      text: "人工修订第一句",
      issuedAt: 30,
    }));
    expect(project.clips.find((clip) => clip.id === "subtitle-import-1")?.source.text).toBe("人工修订第一句");
  });

  it("rejects audio edits on locked tracks and invalid subtitle batches without mutation", () => {
    const project = withAudioAndSubtitleTracks(fixtureProject());
    project.tracks.find((track) => track.id === "voice-track")!.locked = true;
    const before = structuredClone(project);

    expect(applyEditingCommand(project, {
      type: "clip.updateAudio",
      clipId: "voice-1",
      volume: 1,
      muted: false,
      envelope: [{ timeUs: 3_000_000, gain: 1 }],
      issuedAt: 20,
    })).toMatchObject({ success: false, issue: { code: "editing.command.track_locked" } });

    expect(applyEditingCommand(project, {
      type: "subtitle.replaceTrackCues",
      trackId: "subtitle-track",
      clips: [subtitleClip("clip-1", 0, 1_000_000, "重复 ID", "ass")],
      issuedAt: 30,
    })).toMatchObject({ success: false });
    expect(project).toEqual(before);
  });
});

describe("editing command history", () => {
  it("undoes and redoes while revisions keep increasing", () => {
    const history = createEditingHistory(fixtureProject(), 2);
    const executed = executeEditingHistory(history, {
      type: "clip.move",
      clipId: "clip-1",
      trackId: "track-main",
      startUs: 500_000,
      issuedAt: 20,
    });
    expect(executed.success).toBe(true);
    if (!executed.success) return;
    expect(executed.history.present.revision).toBe(2);

    const undone = undoEditingHistory(executed.history, 30);
    expect(undone.success).toBe(true);
    if (!undone.success) return;
    expect(undone.history.present.clips[0]?.startUs).toBe(0);
    expect(undone.history.present.revision).toBe(3);

    const redone = redoEditingHistory(undone.history, 40);
    expect(redone.success).toBe(true);
    if (!redone.success) return;
    expect(redone.history.present.clips[0]?.startUs).toBe(500_000);
    expect(redone.history.present.revision).toBe(4);
  });

  it("clears redo on a new command and enforces history limit", () => {
    let history = createEditingHistory(fixtureProject(), 2);
    for (const [index, startUs] of [100_000, 200_000, 300_000].entries()) {
      const result = executeEditingHistory(history, {
        type: "clip.move",
        clipId: "clip-1",
        trackId: "track-main",
        startUs,
        issuedAt: 20 + index,
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      history = result.history;
    }
    expect(history.past).toHaveLength(2);

    const undone = undoEditingHistory(history, 30);
    expect(undone.success).toBe(true);
    if (!undone.success) return;
    expect(undone.history.future).toHaveLength(1);
    const replacement = executeEditingHistory(undone.history, {
      type: "clip.move",
      clipId: "clip-1",
      trackId: "track-main",
      startUs: 900_000,
      issuedAt: 40,
    });
    expect(replacement.success).toBe(true);
    if (!replacement.success) return;
    expect(replacement.history.future).toEqual([]);
  });
});

function successful(result: ReturnType<typeof applyEditingCommand>) {
  if (!result.success) throw new Error(result.issue.message);
  return result.project;
}

function fixtureProject(): EditingProjectV1 {
  return {
    schemaVersion: 1,
    id: "editing-1",
    projectId: "project-1",
    episodeId: "episode-1",
    name: "草案",
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
      subtitleMode: "burn-in",
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
    },
    tracks: [
      {
        id: "track-main",
        kind: "video",
        name: "主画面",
        order: 0,
        clipIds: ["clip-1", "clip-2"],
        muted: false,
        locked: false,
      },
      {
        id: "track-overlay",
        kind: "overlay",
        name: "叠加",
        order: 1,
        clipIds: ["clip-overlay"],
        muted: false,
        locked: false,
      },
    ],
    clips: [
      clip("clip-1", "track-main", 0, 4_000_000, 1_000_000, 1.5),
      clip("clip-2", "track-main", 4_000_000, 2_000_000),
      clip("clip-overlay", "track-overlay", 5_000_000, 2_000_000),
    ],
    transitions: [],
    effects: [],
    proposals: [
      {
        id: "proposal-1",
        effectId: "glow",
        targetClipId: "clip-2",
        startUs: 4_000_000,
        durationUs: 1_000_000,
        params: { intensity: 0.4 },
        reason: "冲击增强",
        confidence: 0.8,
        sourceEvidence: { storyboardId: "sb-1" },
        status: "pending",
      },
    ],
    createdAt: 10,
    updatedAt: 10,
  };
}

function clip(
  id: string,
  trackId: string,
  startUs: number,
  durationUs: number,
  trimStartUs = 0,
  speed = 1,
) {
  return {
    id,
    trackId,
    name: id,
    source: {
      kind: "storyboardVideo" as const,
      path: `/${id}.mp4`,
      evidence: { storyboardId: id },
    },
    startUs,
    durationUs,
    trimStartUs,
    speed,
    volume: 0,
    muted: true,
  };
}

function withAudioAndSubtitleTracks(project: EditingProjectV1) {
  return {
    ...project,
    tracks: [
      ...project.tracks,
      { id: "voice-track", kind: "voice" as const, name: "口播", order: 2, clipIds: ["voice-1"], muted: false, locked: false },
      { id: "subtitle-track", kind: "text" as const, name: "字幕", order: 3, clipIds: ["subtitle-1"], muted: false, locked: false },
    ],
    clips: [
      ...project.clips,
      {
        id: "voice-1",
        trackId: "voice-track",
        name: "口播 1",
        source: { kind: "audio" as const, path: "/voice-1.wav", evidence: { storyboardId: "sb-1" } },
        startUs: 0,
        durationUs: 2_000_000,
        trimStartUs: 0,
        speed: 1,
        volume: 1,
        muted: false,
      },
      subtitleClip("subtitle-1", 0, 2_000_000, "原字幕", "generated"),
    ],
  };
}

function subtitleClip(
  id: string,
  startUs: number,
  durationUs: number,
  text: string,
  sourceFormat: "generated" | "srt" | "ass",
) {
  return {
    id,
    trackId: "subtitle-track",
    name: id,
    source: { kind: "text" as const, text, evidence: { storyboardId: "sb-1" } },
    startUs,
    durationUs,
    trimStartUs: 0,
    speed: 1,
    volume: 1,
    muted: false,
    subtitle: { sourceFormat },
  };
}
