import {
  REMOTION_STUDIO_ALLOWED_WRITE_FIELDS,
  type RemotionChapterAudioBindingV2,
  type RemotionChapterManifestV1,
  type RemotionChapterManifestV2,
  type RemotionCurrentSlotPublicationV1,
  type RemotionCurrentSlotV1,
  type RemotionEvidenceV1,
  type RemotionRenderJobV1,
  type RemotionShotAudioBindingV2,
  type RemotionStudioSessionContractV1,
  type RemotionStudioWriteRequestV1,
  type RemotionWorkspaceManifestV1,
} from "@/types/remotion-workspace";
import {
  createRemotionAudioBindingFingerprint,
  createRemotionChapterManifestFingerprint,
} from "./remotion-audio-fingerprint";

export const TEST_SHA_A = "a".repeat(64);
export const TEST_SHA_B = "b".repeat(64);
export const TEST_SHA_C = "c".repeat(64);

export function makeWorkspaceManifest(): RemotionWorkspaceManifestV1 {
  return {
    schemaVersion: 1,
    projectId: "project-a",
    workspaceId: "workspace-project-a",
    templateId: "mystudio-remotion-v1",
    templateVersion: "1.0.0",
    remotionVersion: "4.0.499",
    bundleContentHash: TEST_SHA_A,
    compositionIds: ["StoryboardShot", "ChapterVideo"],
    defaultRenderSettings: {
      width: 1080,
      height: 1920,
      fps: 30,
      codec: "h264",
      subtitleMode: "burn-in",
      loudnessLufs: -14,
      truePeakDbtp: -1.5,
      audioDucking: { reductionDb: -8, attackUs: 50_000, releaseUs: 250_000 },
    },
    createdAt: 100,
    updatedAt: 100,
  };
}

export function makeChapterManifest(): RemotionChapterManifestV1 {
  return {
    schemaVersion: 1,
    projectId: "project-a",
    chapterId: "chapter-001",
    revision: 1,
    sourceSnapshotHash: TEST_SHA_B,
    requiredShotIds: ["shot-001"],
    sharedAudioTracks: [
      {
        trackId: "chapter-bgm",
        role: "bgm",
        source: makeMediaReference("audio/chapter-bgm.wav", TEST_SHA_C),
        sourceFingerprint: TEST_SHA_C,
      },
    ],
    shots: [
      {
        shotId: "shot-001",
        storyboardId: "storyboard-001",
        index: 0,
        revision: 1,
        sourceFingerprint: TEST_SHA_A,
        durationUs: 2_000_000,
        visualSource: makeMediaReference("images/shot-001.png", TEST_SHA_A),
        subtitleText: "第一镜",
        audioBindings: [
          {
            renderScope: "shot",
            role: "voice",
            source: makeMediaReference("audio/shot-001.wav", TEST_SHA_B),
            sourceStartUs: 0,
            shotStartUs: 0,
            durationUs: 1_500_000,
            volume: 1,
          },
          {
            renderScope: "chapter",
            role: "bgm",
            sharedTrackId: "chapter-bgm",
            sourceStartUs: 0,
            chapterStartUs: 0,
            durationUs: 2_000_000,
            volume: 0.35,
          },
        ],
        motion: {
          kind: "pan-zoom",
          fromScale: 1,
          toScale: 1.08,
          originX: 0.5,
          originY: 0.5,
        },
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        approvedContinuityVersion: "continuity-v1",
      },
    ],
    renderSettings: makeWorkspaceManifest().defaultRenderSettings,
    createdAt: 100,
    updatedAt: 100,
  };
}

export async function makeShotAudioBindingV2(
  overrides: Partial<RemotionShotAudioBindingV2> = {},
): Promise<RemotionShotAudioBindingV2> {
  const projectId = overrides.projectId ?? "project-a";
  const chapterId = overrides.chapterId ?? "chapter-001";
  const shotId = overrides.shotId ?? "shot-001";
  const shotRevision = overrides.shotRevision ?? 1;
  const role = overrides.role ?? "voice";
  const sourceFingerprint = overrides.sourceFingerprint
    ?? overrides.source?.contentSha256
    ?? TEST_SHA_B;
  const binding: RemotionShotAudioBindingV2 = {
    schemaVersion: 2,
    bindingId: `${role}-${shotId}`,
    bindingFingerprint: TEST_SHA_C,
    renderScope: "shot",
    projectId,
    chapterId,
    shotId,
    shotRevision,
    role,
    source: makeMediaReference(
      `remotion/audio/${chapterId}/shots/${shotId}/${role}/${sourceFingerprint}.wav`,
      sourceFingerprint,
      projectId,
    ),
    sourceFingerprint,
    sourceDurationUs: 1_600_000,
    sourceStartUs: 100_000,
    shotStartUs: 0,
    durationUs: 1_500_000,
    volume: 1,
    fadeInUs: 20_000,
    fadeOutUs: 40_000,
    envelope: [
      { timeUs: 0, gain: 1 },
      { timeUs: 1_500_000, gain: 0.9 },
    ],
    ...(role === "voice" ? { ttsInputFingerprint: TEST_SHA_C } : {}),
    ...overrides,
  };
  binding.bindingFingerprint = await createRemotionAudioBindingFingerprint(binding);
  return binding;
}

export async function makeChapterAudioBindingV2(
  overrides: Partial<RemotionChapterAudioBindingV2> = {},
): Promise<RemotionChapterAudioBindingV2> {
  const projectId = overrides.projectId ?? "project-a";
  const chapterId = overrides.chapterId ?? "chapter-001";
  const role = overrides.role ?? "bgm";
  const sourceFingerprint = overrides.sourceFingerprint
    ?? overrides.source?.contentSha256
    ?? TEST_SHA_C;
  const binding: RemotionChapterAudioBindingV2 = {
    schemaVersion: 2,
    bindingId: `${role}-${chapterId}`,
    bindingFingerprint: TEST_SHA_B,
    renderScope: "chapter",
    projectId,
    chapterId,
    role,
    source: makeMediaReference(
      `remotion/audio/${chapterId}/shared/${role}/${sourceFingerprint}.wav`,
      sourceFingerprint,
      projectId,
    ),
    sourceFingerprint,
    sourceDurationUs: 8_000_000,
    sourceStartUs: 0,
    chapterStartUs: 250_000,
    durationUs: 7_000_000,
    volume: 0.25,
    fadeInUs: 500_000,
    fadeOutUs: 800_000,
    envelope: [{ timeUs: 0, gain: 1 }],
    ducking: {
      enabled: role === "bgm",
      reductionDb: -12,
      attackUs: 120_000,
      releaseUs: 400_000,
    },
    ...overrides,
  };
  binding.bindingFingerprint = await createRemotionAudioBindingFingerprint(binding);
  return binding;
}

export async function makeChapterManifestV2(): Promise<RemotionChapterManifestV2> {
  const voice = await makeShotAudioBindingV2();
  const bgm = await makeChapterAudioBindingV2();
  const manifest: RemotionChapterManifestV2 = {
    schemaVersion: 2,
    manifestFingerprint: TEST_SHA_A,
    projectId: "project-a",
    chapterId: "chapter-001",
    revision: 1,
    sourceSnapshotHash: TEST_SHA_B,
    requiredShotIds: ["shot-001"],
    sharedAudioBindings: [bgm],
    shots: [{
      shotId: "shot-001",
      storyboardId: "storyboard-001",
      index: 0,
      revision: 1,
      sourceFingerprint: TEST_SHA_A,
      durationUs: 2_000_000,
      visualSource: makeMediaReference("images/shot-001.png", TEST_SHA_A),
      subtitleText: "第一镜",
      audioBindings: [voice],
      motion: {
        kind: "pan-zoom",
        fromScale: 1,
        toScale: 1.08,
        originX: 0.5,
        originY: 0.5,
      },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      approvedContinuityVersion: "continuity-v1",
    }],
    renderSettings: makeWorkspaceManifest().defaultRenderSettings,
    createdAt: 100,
    updatedAt: 100,
  };
  manifest.manifestFingerprint = await createRemotionChapterManifestFingerprint(manifest);
  return manifest;
}

export function makeSucceededShotJob(): RemotionRenderJobV1 {
  return {
    schemaVersion: 1,
    jobId: `shot:${TEST_SHA_A}`,
    projectId: "project-a",
    target: { kind: "shot", chapterId: "chapter-001", shotId: "shot-001", shotRevision: 1 },
    inputHash: TEST_SHA_A,
    bundleContentHash: TEST_SHA_B,
    renderSettingsHash: TEST_SHA_C,
    templateVersion: "1.0.0",
    remotionVersion: "4.0.499",
    status: "succeeded",
    attempt: 1,
    progress: 1,
    createdAt: 100,
    startedAt: 110,
    completedAt: 150,
    outputPath: "outputs/shots/chapter-001/shot-001/current.mp4",
    evidencePath: "evidence/shots/chapter-001/shot-001/current.json",
  };
}

export function makeShotEvidence(): RemotionEvidenceV1 {
  const job = makeSucceededShotJob();
  return {
    schemaVersion: 1,
    jobId: job.jobId,
    projectId: job.projectId,
    target: job.target,
    inputHash: job.inputHash,
    bundleContentHash: job.bundleContentHash,
    renderSettingsHash: job.renderSettingsHash,
    templateVersion: job.templateVersion,
    remotionVersion: job.remotionVersion,
    attempt: job.attempt,
    compositionId: "StoryboardShot",
    renderer: { requested: "remotion", actual: "remotion" },
    outputPath: job.outputPath!,
    sizeBytes: 42_000,
    mtimeMs: 150,
    sha256: TEST_SHA_C,
    width: 1080,
    height: 1920,
    durationUs: 2_000_000,
    streams: [
      { kind: "video", codec: "h264", width: 1080, height: 1920 },
      { kind: "audio", codec: "aac", channels: 2, sampleRate: 48_000 },
    ],
    inputManifestPath: "chapters/chapter-001.json",
    startedAt: 110,
    completedAt: 150,
  };
}

export function makeCurrentSlot(): RemotionCurrentSlotV1 {
  const job = makeSucceededShotJob();
  return {
    schemaVersion: 1,
    projectId: job.projectId,
    target: job.target,
    jobPath: "jobs/shot/chapter-001/shot-001/current.json",
    evidencePath: job.evidencePath!,
    outputPath: job.outputPath!,
    job,
    evidence: makeShotEvidence(),
    publishedAt: 160,
  };
}

export function makePublication(): RemotionCurrentSlotPublicationV1 {
  const current = makeCurrentSlot();
  return {
    schemaVersion: 1,
    publicationId: "publication-001",
    projectId: current.projectId,
    target: current.target,
    currentPaths: {
      jobPath: current.jobPath,
      evidencePath: current.evidencePath,
      outputPath: current.outputPath,
    },
    stagedJobPath: "staging/publication-001/job.json",
    stagedEvidencePath: "staging/publication-001/evidence.json",
    stagedOutput: {
      relativePath: "staging/publication-001/output.mp4",
      sizeBytes: current.evidence.sizeBytes,
      mtimeMs: current.evidence.mtimeMs,
      sha256: current.evidence.sha256,
    },
    job: current.job,
    evidence: current.evidence,
    preparedAt: 155,
  };
}

export function makeStudioSession(): RemotionStudioSessionContractV1 {
  return {
    schemaVersion: 1,
    sessionId: "session-001",
    projectId: "project-a",
    chapterId: "chapter-001",
    editingProjectId: "editing-001",
    editingRevision: 1,
    projectionSourceHash: TEST_SHA_A,
    projectionSourcePath: "studio/sessions/session-001/chapter.tsx",
    allowedWriteFields: [...REMOTION_STUDIO_ALLOWED_WRITE_FIELDS],
    status: "ready",
    createdAt: 100,
    updatedAt: 100,
  };
}

export function makeStudioWriteRequest(): RemotionStudioWriteRequestV1 {
  const session = makeStudioSession();
  return {
    schemaVersion: 1,
    sessionId: session.sessionId,
    projectId: session.projectId,
    chapterId: session.chapterId,
    editingProjectId: session.editingProjectId,
    editingRevision: session.editingRevision,
    projectionSourceHash: session.projectionSourceHash,
    projectionSourcePath: session.projectionSourcePath,
    changedFields: ["shotOrder", "duration"],
    sourceInspection: {
      unknownImports: [],
      unknownJsxNodes: [],
      unknownMediaReferences: [],
      unknownShotIds: [],
      structureValid: true,
    },
  };
}

function makeMediaReference(
  relativePath: string,
  contentSha256: string,
  projectId = "project-a",
) {
  return {
    kind: "project-file" as const,
    projectId,
    relativePath,
    contentSha256,
    provenance: {
      sourceKind: "generated" as const,
      sourceId: relativePath,
      sourceVersion: "revision-1",
    },
  };
}
