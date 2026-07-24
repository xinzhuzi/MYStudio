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

  it("rejects clip track mismatches, source branches and subtitle metadata", () => {
    const missingTrack = validProject();
    missingTrack.clips[0]!.trackId = "track-missing";
    const missingTrackResult = validateEditingProject(missingTrack);
    expect(missingTrackResult.success).toBe(false);
    if (missingTrackResult.success) return;
    expect(missingTrackResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.clip.track_missing" }),
    ]));

    const missingMembership = validProject();
    missingMembership.tracks[0]!.clipIds = [];
    const missingMembershipResult = validateEditingProject(missingMembership);
    expect(missingMembershipResult.success).toBe(false);
    if (missingMembershipResult.success) return;
    expect(missingMembershipResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.clip.track_membership" }),
    ]));

    const sourceAndSubtitle = validProject() as unknown as Record<string, unknown>;
    const clips = sourceAndSubtitle.clips as Array<Record<string, unknown>>;
    clips[0]!.source = {
      kind: "text",
      path: "project-file://ignored-for-text.txt",
      evidence: "not-object",
    };
    clips[0]!.subtitle = {
      sourceFormat: "vtt",
      warnings: ["kept warning", 7],
    };

    const sourceAndSubtitleResult = validateEditingProject(sourceAndSubtitle);
    expect(sourceAndSubtitleResult.success).toBe(false);
    if (sourceAndSubtitleResult.success) return;
    expect(sourceAndSubtitleResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.string.required", path: "$.clips[0].source.text" }),
      expect.objectContaining({ code: "editing.source.evidence" }),
      expect.objectContaining({ code: "editing.subtitle.source_format" }),
      expect.objectContaining({ code: "editing.string.required", path: "$.clips[0].subtitle.warnings[1]" }),
    ]));
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

  it("rejects render plan snapshot identity drift", () => {
    const invalidCases = [
      {
        mutate: (plan: TimelineRenderPlan) => {
          plan.editingProjectSnapshot.id = "editing-other";
        },
        code: "editing.render.snapshot_project",
        path: "$.editingProjectSnapshot.id",
      },
      {
        mutate: (plan: TimelineRenderPlan) => {
          plan.editingProjectSnapshot.revision += 1;
        },
        code: "editing.render.snapshot_revision",
        path: "$.editingProjectSnapshot.revision",
      },
      {
        mutate: (plan: TimelineRenderPlan) => {
          plan.editingProjectSnapshot.sourceSnapshotHash = "snapshot-other";
        },
        code: "editing.render.snapshot_hash",
        path: "$.editingProjectSnapshot.sourceSnapshotHash",
      },
    ];

    for (const invalidCase of invalidCases) {
      const plan = validRenderPlan(validProject());
      invalidCase.mutate(plan);
      const result = validateTimelineRenderPlan(plan);
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: invalidCase.code, path: invalidCase.path }),
      ]));
    }
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

  it("rejects renderer-controlled keys recursively", () => {
    const plan = validRenderPlan(validProject()) as unknown as Record<string, unknown>;
    plan.renderSettings = {
      ...plan.renderSettings as Record<string, unknown>,
      diagnostics: [{ filterGraph: "unsafe" }],
    };

    const result = validateTimelineRenderPlan(plan);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "editing.render.forbidden_key",
        path: "$.renderSettings.diagnostics[0].filterGraph",
      }),
    ]));
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

  it("rejects effect parameter and proposal linkage edge cases", () => {
    const badParams = validProject();
    badParams.effects = [{
      id: "effect-bad-param",
      effectId: "panZoom",
      targetClipId: "clip-1",
      startUs: 0,
      durationUs: 5_000_000,
      params: { scaleFrom: 1, scaleTo: 1.06, x: 0.5, y: 0.5, extra: 1 },
      enabled: true,
    }];
    const badParamsResult = validateEditingProject(badParams);
    expect(badParamsResult.success).toBe(false);
    if (badParamsResult.success) return;
    expect(badParamsResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.effect.param_unknown" }),
    ]));

    const badEnum = validProject();
    badEnum.transitions = [{
      id: "transition-bad-enum",
      fromClipId: "clip-1",
      toClipId: "clip-1",
      effectId: "crossfade",
      durationUs: 500_000,
      params: { curve: "diagonal" },
    }];
    const badEnumResult = validateEditingProject(badEnum);
    expect(badEnumResult.success).toBe(false);
    if (badEnumResult.success) return;
    expect(badEnumResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.effect.param_enum" }),
    ]));

    const orphan = validProject();
    orphan.effects = [linkedProposalEffect({ proposalId: "missing-proposal" })];
    const orphanResult = validateEditingProject(orphan);
    expect(orphanResult.success).toBe(false);
    if (orphanResult.success) return;
    expect(orphanResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.effect.proposal_missing" }),
    ]));

    const multipleLinks = validProject();
    multipleLinks.proposals = [proposal({ status: "accepted" })];
    multipleLinks.effects = [
      linkedProposalEffect(),
      linkedProposalEffect({ id: "effect-from-proposal-proposal-1-copy" }),
    ];
    const multipleLinksResult = validateEditingProject(multipleLinks);
    expect(multipleLinksResult.success).toBe(false);
    if (multipleLinksResult.success) return;
    expect(multipleLinksResult.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.proposal.effect_link" }),
    ]));

    const disabledMismatch = validProject();
    disabledMismatch.proposals = [proposal({ status: "disabled" })];
    disabledMismatch.effects = [linkedProposalEffect({ enabled: true })];
    const disabledMismatchResult = validateEditingProject(disabledMismatch);
    expect(disabledMismatchResult.success).toBe(false);
    if (disabledMismatchResult.success) return;
    expect(disabledMismatchResult.issues).toEqual(expect.arrayContaining([
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

  it("rejects malformed auto-editing warning entries", () => {
    const run: AutoEditingRun = {
      id: "run-1",
      projectId: "project-1",
      episodeId: "episode-1",
      sourceSnapshotHash: "snapshot-1",
      presetId: "story-driven-v1",
      stage: "arrangingClips",
      decisions: [],
      warnings: [],
      startedAt: 1,
      updatedAt: 2,
    };
    const invalid = {
      ...run,
      warnings: [
        "plain warning",
        {
          code: "",
          message: 7,
          targetId: 3,
          recoverable: "yes",
        },
      ],
    };

    const result = validateAutoEditingRun(invalid);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "editing.auto_warning.object", path: "$.warnings[0]" }),
      expect.objectContaining({ code: "editing.string.required", path: "$.warnings[1].code" }),
      expect.objectContaining({ code: "editing.string.required", path: "$.warnings[1].message" }),
      expect.objectContaining({ code: "editing.string.required", path: "$.warnings[1].targetId" }),
      expect.objectContaining({ code: "editing.boolean", path: "$.warnings[1].recoverable" }),
    ]));
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

  it("rejects invalid timeline render evidence numeric fields", () => {
    const invalidFields = [
      { field: "sizeBytes", value: 0, code: "editing.render_evidence.size" },
      { field: "mtimeMs", value: -1, code: "editing.render_evidence.mtime" },
      { field: "duration", value: Number.NaN, code: "editing.render_evidence.duration" },
      { field: "width", value: 1.5, code: "editing.render_evidence.width" },
      { field: "height", value: 0, code: "editing.render_evidence.height" },
    ];

    for (const invalidField of invalidFields) {
      const record = structuredClone(validRenderRecord(validProject())) as unknown as Record<string, unknown>;
      const evidence = record.evidence as Record<string, unknown>;
      evidence[invalidField.field] = invalidField.value;

      const result = validateTimelineRenderRecord(record);
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: invalidField.code,
          path: `$.evidence.${invalidField.field}`,
        }),
      ]));
    }
  });

  it("requires timeline render evidence identity and artifact paths", () => {
    const requiredFields = [
      "jobId",
      "path",
      "snapshotPath",
      "renderPlanPath",
      "inputManifestPath",
      "filterGraphPath",
      "logPath",
      "ffprobePath",
    ];

    for (const requiredField of requiredFields) {
      const record = structuredClone(validRenderRecord(validProject())) as unknown as Record<string, unknown>;
      const evidence = record.evidence as Record<string, unknown>;
      delete evidence[requiredField];

      const result = validateTimelineRenderRecord(record);
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "editing.string.required",
          path: `$.evidence.${requiredField}`,
        }),
      ]));
    }
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

function linkedProposalEffect(
  overrides: Partial<EditingProjectV1["effects"][number]> = {},
): EditingProjectV1["effects"][number] {
  return {
    id: "effect-from-proposal-proposal-1",
    effectId: "panZoom",
    targetClipId: "clip-1",
    startUs: 0,
    durationUs: 5_000_000,
    params: { scaleFrom: 1, scaleTo: 1.06, x: 0.5, y: 0.5 },
    enabled: true,
    proposalId: "proposal-1",
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
