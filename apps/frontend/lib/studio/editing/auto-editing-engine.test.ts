import { describe, expect, it } from "vitest";
import type {
  AutoEditingRequest,
  EditingProjectV1,
  EditingProposal,
} from "@/types/editing";
import type {
  ProductionTrack,
  StoryboardItem,
  VideoCandidate,
} from "@/types/studio";
import {
  STORY_DRIVEN_V1_PRESET,
  runAutoEditingDraft,
} from "./auto-editing-engine";
import {
  validateAutoEditingRun,
  validateEditingProject,
} from "./validation";

describe("story-driven-v1 auto editing", () => {
  it("builds an explainable multi-track draft with approved audio and pending proposals", async () => {
    const stages: string[] = [];
    const result = await runAutoEditingDraft({
      request: request(),
      adapterInput: adapterInput(),
      existingProjects: [],
      runId: "run-1",
      editingProjectId: "auto-draft-1",
      now: sequenceClock(),
      selectedBgm: {
        id: "bgm-1",
        mediaId: "media-bgm-1",
        name: "已选主题音乐",
        path: "/bgm.wav",
      },
      approvedSfx: [
        {
          id: "sfx-1",
          mediaId: "media-sfx-1",
          name: "已批准剑鸣",
          path: "/sfx.wav",
          storyboardId: "sb-1",
          durationUs: 500_000,
        },
      ],
      generateProposals: async () => [proposal()],
      onRun: (run) => {
        stages.push(run.stage);
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.result.reusedExistingDraft).toBe(false);
    expect(result.result.project.id).toBe("auto-draft-1");
    expect(
      result.result.project.clips.find((clip) => clip.id === "visual-sb-1")
        ?.durationUs,
    ).toBe(4_700_000);
    expect(result.result.project.tracks.map((track) => track.kind)).toEqual([
      "video",
      "voice",
      "text",
      "bgm",
      "sfx",
    ]);
    expect(result.result.project.effects).toEqual([
      expect.objectContaining({
        effectId: "panZoom",
        targetClipId: "visual-sb-1",
        params: { scaleFrom: 1, scaleTo: 1.06, x: 0.5, y: 0.5 },
      }),
    ]);
    expect(result.result.project.transitions).toEqual([
      expect.objectContaining({
        fromClipId: "visual-sb-1",
        toClipId: "visual-sb-2",
        effectId: "crossfade",
        durationUs: 350_000,
      }),
    ]);
    expect(result.result.project.proposals).toEqual([
      expect.objectContaining({ id: "proposal-1", status: "pending" }),
    ]);
    expect(result.result.project.effects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ proposalId: "proposal-1" })]),
    );
    expect(result.result.run.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "source",
          ruleId: "source.storyboard-image",
          targetId: "visual-sb-1",
        }),
        expect.objectContaining({
          kind: "source",
          ruleId: "source.selected-candidate",
          targetId: "visual-sb-2",
          sourceEvidence: expect.objectContaining({ candidateId: "candidate-2" }),
        }),
        expect.objectContaining({ kind: "transition", ruleId: "transition.explicit.crossfade" }),
        expect.objectContaining({ kind: "audio", ruleId: "audio.bgm.selected" }),
        expect.objectContaining({ kind: "audio", ruleId: "audio.sfx.approved" }),
        expect.objectContaining({ kind: "proposal", ruleId: "proposal.ai.pending" }),
      ]),
    );
    expect(stages).toEqual([
      "preflight",
      "selectingSources",
      "arrangingClips",
      "arrangingAudio",
      "arrangingSubtitles",
      "generatingProposals",
      "previewReady",
      "completed",
    ]);
    expect(validateEditingProject(result.result.project).success).toBe(true);
    expect(validateAutoEditingRun(result.result.run).success).toBe(true);
  });

  it("reuses an unchanged automatic draft without duplicating clips", async () => {
    const first = await runAutoEditingDraft({
      request: request(),
      adapterInput: adapterInput(),
      existingProjects: [],
      runId: "run-1",
      editingProjectId: "auto-draft-1",
      now: sequenceClock(),
    });
    expect(first.success).toBe(true);
    if (!first.success) return;

    const second = await runAutoEditingDraft({
      request: request(),
      adapterInput: adapterInput(),
      existingProjects: [first.result.project],
      runId: "run-2",
      editingProjectId: "auto-draft-2",
      now: sequenceClock(100),
    });

    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.result.reusedExistingDraft).toBe(true);
    expect(second.result.project).toBe(first.result.project);
    expect(second.result.project.clips).toHaveLength(first.result.project.clips.length);
    expect(second.staleEditingProjectIds).toEqual([]);
    expect(second.result.run.editingProjectId).toBe("auto-draft-1");
  });

  it("creates a parallel draft beside manual work and stales old automatic snapshots", async () => {
    const manual = existingProject({
      id: "manual-1",
      createdBy: "manual",
      manuallyEdited: true,
      sourceSnapshotHash: "snapshot-2",
    });
    const oldAuto = existingProject({
      id: "auto-draft-old",
      sourceSnapshotHash: "snapshot-old",
    });

    const result = await runAutoEditingDraft({
      request: request(),
      adapterInput: adapterInput(),
      existingProjects: [manual, oldAuto],
      runId: "run-new",
      editingProjectId: "auto-draft-new",
      now: sequenceClock(),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.result.project.id).toBe("auto-draft-new");
    expect(result.result.project.manuallyEdited).toBe(false);
    expect(result.staleEditingProjectIds).toEqual(["auto-draft-old"]);
    expect(manual).toMatchObject({ id: "manual-1", stale: false, revision: 1 });
    expect(oldAuto).toMatchObject({ id: "auto-draft-old", stale: false, revision: 1 });
  });

  it("returns a failed run with exact storyboard ids and no partial project", async () => {
    const input = adapterInput();
    input.storyboards = input.storyboards.map((storyboard) =>
      storyboard.id === "sb-1"
        ? { ...storyboard, audioRef: undefined }
        : { ...storyboard, durationTarget: 0, duration: 0, mediaRef: undefined },
    );
    input.productionTracks = [];
    input.videoCandidates = [];

    const result = await runAutoEditingDraft({
      request: request(),
      adapterInput: input,
      existingProjects: [],
      runId: "run-failed",
      editingProjectId: "auto-draft-failed",
      now: sequenceClock(),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.run.stage).toBe("failed");
    expect(result.run.editingProjectId).toBeUndefined();
    expect(result.run.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "editing.auto.missing_audio", targetId: "sb-1" }),
        expect.objectContaining({ code: "editing.auto.missing_visual", targetId: "sb-2" }),
        expect.objectContaining({ code: "editing.auto.invalid_duration", targetId: "sb-2" }),
      ]),
    );
    expect(validateAutoEditingRun(result.run).success).toBe(true);
  });

  it("keeps the deterministic draft when AI fails or returns non-pending proposals", async () => {
    const failed = await runAutoEditingDraft({
      request: request(),
      adapterInput: adapterInput(),
      existingProjects: [],
      runId: "run-ai-failed",
      editingProjectId: "auto-draft-ai-failed",
      now: sequenceClock(),
      generateProposals: async () => {
        throw new Error("provider offline");
      },
    });
    expect(failed.success).toBe(true);
    if (!failed.success) return;
    expect(failed.result.project.proposals).toEqual([]);
    expect(failed.result.run.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "editing.auto.ai_failed", recoverable: true }),
      ]),
    );

    const invalid = await runAutoEditingDraft({
      request: request(),
      adapterInput: adapterInput(),
      existingProjects: [],
      runId: "run-ai-invalid",
      editingProjectId: "auto-draft-ai-invalid",
      now: sequenceClock(100),
      generateProposals: async () => [{ ...proposal(), status: "accepted" }],
    });
    expect(invalid.success).toBe(true);
    if (!invalid.success) return;
    expect(invalid.result.project.proposals).toEqual([]);
    expect(invalid.result.run.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "editing.auto.proposal_invalid" }),
      ]),
    );
  });

  it("warns instead of inventing BGM or storyboard sound effects", async () => {
    const result = await runAutoEditingDraft({
      request: request(),
      adapterInput: adapterInput(),
      existingProjects: [],
      runId: "run-no-audio-assets",
      editingProjectId: "auto-draft-no-audio-assets",
      now: sequenceClock(),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.result.project.tracks.map((track) => track.kind)).not.toEqual(
      expect.arrayContaining(["bgm", "sfx"]),
    );
    expect(result.result.run.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "editing.auto.bgm_missing" }),
        expect.objectContaining({ code: "editing.auto.sfx_missing", targetId: "sb-1" }),
      ]),
    );
  });

  it("fails an invalid preset without publishing a completed run", async () => {
    const stages: string[] = [];
    const invalidRequest = request();
    invalidRequest.preset = {
      ...invalidRequest.preset,
      maxTransitionRatio: 2 as AutoEditingRequest["preset"]["maxTransitionRatio"],
    };

    const result = await runAutoEditingDraft({
      request: invalidRequest,
      adapterInput: adapterInput(),
      existingProjects: [],
      runId: "run-invalid-preset",
      editingProjectId: "auto-draft-invalid-preset",
      now: sequenceClock(),
      onRun: (run) => {
        stages.push(run.stage);
      },
    });

    expect(result.success).toBe(false);
    expect(stages).toEqual(["preflight", "failed"]);
    if (result.success) return;
    expect(result.run.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "editing.auto.preset_invalid" }),
      ]),
    );
  });
});

function request(): AutoEditingRequest {
  return {
    projectId: "project-1",
    episodeId: "episode-1",
    mode: "draft",
    preset: STORY_DRIVEN_V1_PRESET,
  };
}

function adapterInput() {
  const storyboards = [
    storyboard(1, {
      mediaRef: { kind: "image", path: "/shot-1.png" },
      sound: "剑鸣",
    }),
    storyboard(2, { mediaRef: { kind: "image", path: "/shot-2.png" } }),
  ];
  const productionTracks: ProductionTrack[] = [track(1), track(2)];
  productionTracks[1]!.selectedVideoId = "candidate-2";
  const videoCandidates: VideoCandidate[] = [
    {
      id: "candidate-2",
      trackId: "track-2",
      provider: "ffmpeg-local",
      filePath: "/track-2.mp4",
      state: "ready",
      stale: false,
      sourceFingerprint: "candidate-fingerprint-2",
      outputVersion: 1,
      createdAt: 1,
    },
  ];
  return {
    projectId: "project-1",
    episodeId: "episode-1",
    sourceSnapshotHash: "snapshot-2",
    sourceRunId: "source-run-1",
    aspectRatio: "9:16",
    storyboards,
    productionTracks,
    videoCandidates,
    voiceDurationsUs: { "sb-1": 4_500_000, "sb-2": 3_000_000 },
    directorPlan: {
      id: "plan-1",
      episodeId: "episode-1",
      theme: "试炼",
      visualStyle: "水墨",
      narrativeRhythm: "先缓后急",
      sceneIntents: [],
      soundDirection: "剑鸣后留白",
      transitions: "场尾叠化",
      derivedAssetPlan: [],
    },
  };
}

function storyboard(
  index: number,
  updates: Partial<StoryboardItem> = {},
): StoryboardItem {
  const id = `sb-${index}`;
  return {
    id,
    episodeId: "episode-1",
    index,
    trackKey: `track-key-${index}`,
    trackId: `track-${index}`,
    duration: 4,
    durationTarget: 4,
    prompt: `prompt ${index}`,
    videoDesc: `video ${index}`,
    assetIds: [],
    audioRef: { kind: "audio", path: `/voice-${index}.wav` },
    state: "ready",
    line: `台词 ${index}`,
    ttsSpokenText: `口播 ${index}`,
    sourceRunId: "source-run-1",
    sourceFingerprint: `storyboard-fingerprint-${index}`,
    outputVersion: 1,
    ...updates,
  };
}

function track(index: number): ProductionTrack {
  return {
    id: `track-${index}`,
    episodeId: "episode-1",
    trackKey: `track-key-${index}`,
    storyboardIds: [`sb-${index}`],
    prompt: `track prompt ${index}`,
    duration: 4,
    candidateVideoIds: [],
    state: "ready",
    stale: false,
    sourceRunId: "source-run-1",
    sourceFingerprint: `track-fingerprint-${index}`,
    outputVersion: 1,
  };
}

function proposal(): EditingProposal {
  return {
    id: "proposal-1",
    effectId: "glow",
    targetClipId: "visual-sb-2",
    startUs: 4_700_000,
    durationUs: 4_000_000,
    params: { intensity: 0.4 },
    reason: "爆发镜头可增加光晕",
    confidence: 0.8,
    sourceEvidence: { storyboardId: "sb-2" },
    status: "pending",
  };
}

function existingProject(
  updates: Partial<EditingProjectV1> = {},
): EditingProjectV1 {
  return {
    schemaVersion: 1,
    id: "auto-draft-existing",
    projectId: "project-1",
    episodeId: "episode-1",
    name: "既有草案",
    revision: 1,
    sourceSnapshotHash: "snapshot-old",
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
    tracks: [],
    clips: [],
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
    ...updates,
  };
}

function sequenceClock(start = 1) {
  let value = start;
  return () => {
    const current = value;
    value += 1;
    return current;
  };
}
