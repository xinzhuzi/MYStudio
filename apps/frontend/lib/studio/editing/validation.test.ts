import { describe, expect, it } from "vitest";
import type {
  AutoEditingRun,
  EditingProjectV1,
  TimelineRenderRecord,
  TimelineRenderPlan,
} from "@/types/editing";
import {
  validateAutoEditingRun,
  validateEditingProject,
  validateTimelineRenderPlan,
  validateTimelineRenderRecord,
} from "./validation";

describe("editing boundary validation", () => {
  it("accepts a valid project and render plan deterministically", () => {
    const project = validProject();
    expect(validateEditingProject(project)).toEqual({
      success: true,
      value: project,
    });

    const plan = validRenderPlan(project);
    expect(validateTimelineRenderPlan(plan)).toEqual({
      success: true,
      value: plan,
    });
  });

  it("rejects invalid time, duplicate ids, unknown kinds and effects", () => {
    const project = validProject() as unknown as Record<string, unknown>;
    const clips = project.clips as Array<Record<string, unknown>>;
    clips.push({ ...clips[0] });
    clips[0]!.durationUs = 0;
    (project.tracks as Array<Record<string, unknown>>)[0]!.kind = "shell";
    project.effects = [
      {
        id: "effect-1",
        effectId: "raw-filter",
        targetClipId: "clip-1",
        startUs: -1,
        durationUs: Number.NaN,
        params: { command: "-vf scale=1:1" },
        enabled: true,
      },
    ];

    const result = validateEditingProject(project);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "editing.track.kind",
        "editing.clip.duration",
        "editing.id.duplicate",
        "editing.effect.id",
        "editing.time.non_negative_integer",
        "editing.time.positive_integer",
      ]),
    );
  });

  it("rejects invalid nested numbers, zero transitions and dangling track clips", () => {
    const project = validProject() as unknown as Record<string, unknown>;
    const tracks = project.tracks as Array<Record<string, unknown>>;
    const clips = project.clips as Array<Record<string, unknown>>;
    const source = clips[0]!.source as Record<string, unknown>;
    const evidence = source.evidence as Record<string, unknown>;

    tracks[0]!.clipIds = ["clip-1", "clip-missing"];
    clips[0]!.transform = {
      x: 0,
      y: 0,
      scaleX: Number.POSITIVE_INFINITY,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
    };
    clips[0]!.envelope = [{ timeUs: 0, gain: Number.NaN }];
    evidence.outputVersion = Number.POSITIVE_INFINITY;
    project.transitions = [
      {
        id: "transition-1",
        fromClipId: "clip-1",
        toClipId: "clip-1",
        effectId: "fade",
        durationUs: 0,
        params: { opacity: 1 },
      },
    ];

    const result = validateEditingProject(project);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "editing.track.clip_missing",
        "editing.transform.scale",
        "editing.audio.gain",
        "editing.source.output_version",
        "editing.time.positive_integer",
      ]),
    );
  });

  it("rejects unsorted, duplicate and out-of-duration audio envelope points", () => {
    const project = validProject();
    project.clips[0]!.envelope = [
      { timeUs: 2_000_000, gain: 1 },
      { timeUs: 2_000_000, gain: 0.5 },
      { timeUs: 6_000_000, gain: 1 },
    ];

    const result = validateEditingProject(project);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.audio.envelope_order" }),
      expect.objectContaining({ code: "editing.audio.envelope_bounds" }),
    ]));
  });

  it("requires explicit typed ducking settings on render plans", () => {
    const project = validProject();
    const plan = validRenderPlan(project) as unknown as Record<string, unknown>;
    plan.renderSettings = { ...project.renderSettings };

    const result = validateTimelineRenderPlan(plan);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.render.ducking_object" }),
    ]));
  });

  it("rejects renderer-controlled commands, args and output paths", () => {
    const plan = {
      ...validRenderPlan(validProject()),
      outputPath: "/tmp/unsafe.mp4",
      extraArgs: ["-vf", "scale=1:1"],
      command: "ffmpeg",
    };

    const result = validateTimelineRenderPlan(plan);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "editing.render.forbidden_key" }),
      ]),
    );
  });

  it("rejects proposal targets and windows the v1 renderer cannot execute", () => {
    const invalidCases = [
      { proposal: proposal({ effectId: "fade" }), code: "editing.effect.category" },
      {
        proposal: proposal({ targetClipId: undefined, targetTrackId: "track-video" }),
        code: "editing.effect.track_unsupported",
      },
      {
        proposal: proposal({ targetTrackId: "track-video" }),
        code: "editing.effect.target_ambiguous",
      },
      {
        proposal: proposal({ startUs: 4_500_000, durationUs: 1_000_000 }),
        code: "editing.effect.window_bounds",
      },
      {
        proposal: proposal({ durationUs: 1_000_000 }),
        code: "editing.effect.full_clip_required",
      },
      {
        proposal: proposal({ effectId: "speed", params: { rate: 2 } }),
        code: "editing.effect.speed_visual",
      },
    ];

    for (const invalidCase of invalidCases) {
      const project = validProject();
      project.proposals = [invalidCase.proposal];
      const result = validateEditingProject(project);
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: invalidCase.code }),
      ]));
    }

    const nonVisual = validProject();
    nonVisual.tracks[0]!.kind = "voice";
    nonVisual.proposals = [proposal({ effectId: "blur", params: { radius: 4 } })];
    const result = validateEditingProject(nonVisual);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.effect.visual_target" }),
    ]));
  });

  it("keeps accepted and disabled proposals linked to exactly one effect", () => {
    const missing = validProject();
    missing.proposals = [proposal({ status: "accepted" })];
    const missingResult = validateEditingProject(missing);
    expect(missingResult.success).toBe(false);
    if (missingResult.success) return;
    expect(missingResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.proposal.effect_link" }),
    ]));

    const premature = validProject();
    premature.proposals = [proposal()];
    premature.effects = [{
      id: "effect-from-proposal-proposal-1",
      effectId: "panZoom",
      targetClipId: "clip-1",
      startUs: 0,
      durationUs: 5_000_000,
      params: { scaleFrom: 1, scaleTo: 1.06, x: 0.5, y: 0.5 },
      enabled: true,
      proposalId: "proposal-1",
    }];
    const prematureResult = validateEditingProject(premature);
    expect(prematureResult.success).toBe(false);
    if (prematureResult.success) return;
    expect(prematureResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.proposal.effect_state" }),
    ]));
  });

  it("validates auto-editing stages and decision evidence", () => {
    const run: AutoEditingRun = {
      id: "run-1",
      projectId: "project-1",
      episodeId: "episode-1",
      sourceSnapshotHash: "snapshot-1",
      presetId: "story-driven-v1",
      stage: "arrangingClips",
      decisions: [
        {
          id: "decision-1",
          kind: "source",
          ruleId: "source.selected-candidate",
          targetId: "clip-1",
          input: { candidateId: "candidate-1" },
          output: { sourceKind: "videoCandidate" },
          reason: "复用已选可用候选",
          sourceEvidence: {
            storyboardId: "storyboard-1",
            candidateId: "candidate-1",
          },
        },
      ],
      warnings: [],
      startedAt: 1,
      updatedAt: 2,
    };
    expect(validateAutoEditingRun(run)).toEqual({ success: true, value: run });

    const invalid = { ...run, stage: "exec-shell", decisions: [{}] };
    expect(validateAutoEditingRun(invalid).success).toBe(false);

    const nonFiniteDecision = {
      ...run,
      decisions: [{ ...run.decisions[0], input: { score: Number.NaN } }],
    };
    const nonFiniteResult = validateAutoEditingRun(nonFiniteDecision);
    expect(nonFiniteResult.success).toBe(false);
    if (nonFiniteResult.success) return;
    expect(nonFiniteResult.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "editing.auto_decision.value" }),
      ]),
    );
  });

  it("accepts only complete audio-video timeline render records", () => {
    const record = validRenderRecord(validProject());
    expect(validateTimelineRenderRecord(record)).toEqual({
      success: true,
      value: record,
    });

    const invalid = structuredClone(record) as unknown as Record<string, unknown>;
    const evidence = invalid.evidence as Record<string, unknown>;
    evidence.sha256 = "not-a-hash";
    evidence.streams = ["video"];
    evidence.filterGraphPath = undefined;
    const result = validateTimelineRenderRecord(invalid);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.render_evidence.sha256" }),
      expect.objectContaining({ code: "editing.render_evidence.streams" }),
      expect.objectContaining({ path: "$.evidence.filterGraphPath" }),
    ]));
  });
});

function validProject(): EditingProjectV1 {
  return {
    schemaVersion: 1,
    id: "editing-1",
    projectId: "project-1",
    episodeId: "episode-1",
    name: "自动剪辑草案 1",
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
        id: "track-video",
        kind: "video",
        name: "主画面",
        order: 0,
        clipIds: ["clip-1"],
        muted: false,
        locked: false,
      },
    ],
    clips: [
      {
        id: "clip-1",
        trackId: "track-video",
        name: "分镜 1",
        source: {
          kind: "storyboardImage",
          path: "project-file://storyboard-1.png",
          evidence: { storyboardId: "storyboard-1" },
        },
        startUs: 0,
        durationUs: 5_000_000,
        trimStartUs: 0,
        speed: 1,
        volume: 1,
        muted: false,
      },
    ],
    transitions: [],
    effects: [],
    proposals: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function proposal(
  overrides: Partial<EditingProjectV1["proposals"][number]> = {},
): EditingProjectV1["proposals"][number] {
  return {
    id: "proposal-1",
    effectId: "panZoom",
    targetClipId: "clip-1",
    startUs: 0,
    durationUs: 5_000_000,
    params: { scaleFrom: 1, scaleTo: 1.06, x: 0.5, y: 0.5 },
    reason: "增强镜头动势",
    confidence: 0.8,
    sourceEvidence: { storyboardId: "storyboard-1" },
    status: "pending",
    ...overrides,
  };
}

function validRenderPlan(project: EditingProjectV1): TimelineRenderPlan {
  return {
    schemaVersion: 1,
    jobId: "render-1",
    projectId: project.projectId,
    episodeId: project.episodeId,
    editingProjectId: project.id,
    editingRevision: project.revision,
    sourceSnapshotHash: project.sourceSnapshotHash,
    editingProjectSnapshot: structuredClone(project),
    renderSettings: {
      ...project.renderSettings,
      audioDucking: {
        reductionDb: -12,
        attackUs: 120_000,
        releaseUs: 400_000,
      },
    },
    clips: project.clips.map((clip) => ({
      ...clip,
      trackKind: "video",
    })),
    transitions: [],
    effects: [],
    createdAt: 2,
  };
}

function validRenderRecord(project: EditingProjectV1): TimelineRenderRecord {
  const hash = "a".repeat(64);
  return {
    projectId: project.projectId,
    episodeId: project.episodeId,
    editingProjectId: project.id,
    editingRevision: project.revision,
    sourceSnapshotHash: project.sourceSnapshotHash,
    completedAt: 3,
    evidence: {
      jobId: "render-1",
      path: "/tmp/output.mp4",
      sizeBytes: 1024,
      mtimeMs: 2,
      sha256: hash,
      duration: 5,
      width: 1080,
      height: 1920,
      streams: ["video", "audio"],
      snapshotHash: hash,
      snapshotPath: "/tmp/editing-project.json",
      renderPlanPath: "/tmp/render-plan.json",
      inputManifestPath: "/tmp/input-manifest.json",
      filterGraphPath: "/tmp/filter-graph.txt",
      logPath: "/tmp/ffmpeg.log",
      ffprobePath: "/tmp/ffprobe.json",
    },
  };
}
