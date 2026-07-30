import { describe, expect, it } from "vitest";
import {
  validateRemotionChapterManifest,
  validateRemotionCurrentSlot,
  validateRemotionCurrentSlotCollection,
  validateRemotionCurrentSlotPublication,
  validateRemotionEvidence,
  validateRemotionEvidenceIdentity,
  validateRemotionRenderJob,
  validateRemotionRenderJobIdentity,
  validateRemotionStudioSessionContract,
  validateRemotionStudioWriteRequest,
  validateRemotionWorkspaceManifest,
} from "./remotion-workspace-validation";
import {
  makeChapterManifest,
  makeCurrentSlot,
  makePublication,
  makeShotEvidence,
  makeStudioSession,
  makeStudioWriteRequest,
  makeSucceededShotJob,
  makeWorkspaceManifest,
} from "./remotion-workspace-test-fixtures";
import { createRemotionRenderJobId } from "./remotion-workspace-state";

function expectIssue(result: { success: boolean; issues?: Array<{ path: string }> }, path: string) {
  expect(result.success).toBe(false);
  expect(result.issues?.some((issue) => issue.path === path)).toBe(true);
}

describe("Remotion workspace and chapter validation", () => {
  it("accepts a complete workspace including negative loudness targets", () => {
    expect(validateRemotionWorkspaceManifest(makeWorkspaceManifest()).success).toBe(true);
  });

  it.each([
    ["schemaVersion", 2, "$.schemaVersion"],
    ["projectId", "../project-a", "$.projectId"],
    ["compositionIds", ["ChapterVideo", "StoryboardShot"], "$.compositionIds"],
  ])("rejects invalid workspace %s", (key, value, path) => {
    expectIssue(validateRemotionWorkspaceManifest({ ...makeWorkspaceManifest(), [key]: value }), path);
  });

  it("rejects runtime-only and unknown persisted workspace fields", () => {
    const workspace = { ...makeWorkspaceManifest(), capabilityUrl: "http://127.0.0.1/media" };
    expectIssue(validateRemotionWorkspaceManifest(workspace), "$.capabilityUrl");
  });

  it("accepts a chapter with independent shot and chapter audio bindings", () => {
    expect(validateRemotionChapterManifest(makeChapterManifest()).success).toBe(true);
  });

  it("allows a chapter without shared chapter-scoped audio", () => {
    const chapter = makeChapterManifest();
    chapter.sharedAudioTracks = [];
    chapter.shots[0].audioBindings = chapter.shots[0].audioBindings.filter(
      (binding) => binding.renderScope === "shot",
    );
    expect(validateRemotionChapterManifest(chapter).success).toBe(true);
  });

  it("rejects duplicate required shots and required-shot order drift", () => {
    const duplicate = makeChapterManifest();
    duplicate.requiredShotIds = ["shot-001", "shot-001"];
    duplicate.shots = [duplicate.shots[0], { ...duplicate.shots[0] }];
    expectIssue(validateRemotionChapterManifest(duplicate), "$.requiredShotIds[1]");

    const orderDrift = makeChapterManifest();
    orderDrift.requiredShotIds = ["shot-other"];
    expectIssue(validateRemotionChapterManifest(orderDrift), "$.requiredShotIds[0]");
  });

  it("rejects zero chapter and shot revisions", () => {
    const chapter = makeChapterManifest();
    chapter.revision = 0;
    expectIssue(validateRemotionChapterManifest(chapter), "$.revision");

    const shotRevision = makeChapterManifest();
    shotRevision.shots[0].revision = 0;
    expectIssue(validateRemotionChapterManifest(shotRevision), "$.shots[0].revision");
  });

  it("rejects duplicate shared tracks and unknown chapter bindings", () => {
    const duplicateTrack = makeChapterManifest();
    duplicateTrack.sharedAudioTracks.push({ ...duplicateTrack.sharedAudioTracks[0] });
    expectIssue(validateRemotionChapterManifest(duplicateTrack), "$.sharedAudioTracks[1].trackId");

    const unknownBinding = makeChapterManifest();
    const binding = unknownBinding.shots[0].audioBindings[1];
    if (binding.renderScope === "chapter") binding.sharedTrackId = "missing-track";
    expectIssue(
      validateRemotionChapterManifest(unknownBinding),
      "$.shots[0].audioBindings[1].sharedTrackId",
    );
  });

  it("rejects cross-project and escaping media references", () => {
    const crossProject = makeChapterManifest();
    crossProject.shots[0].visualSource.projectId = "project-b";
    expectIssue(
      validateRemotionChapterManifest(crossProject),
      "$.shots[0].visualSource.projectId",
    );

    const traversal = makeChapterManifest();
    traversal.shots[0].visualSource.relativePath = "../outside.png";
    expectIssue(
      validateRemotionChapterManifest(traversal),
      "$.shots[0].visualSource.relativePath",
    );
  });
});

describe("Remotion job, evidence, and current-slot validation", () => {
  it("accepts one complete succeeded job -> evidence -> MP4 slot", () => {
    expect(validateRemotionRenderJob(makeSucceededShotJob()).success).toBe(true);
    expect(validateRemotionEvidence(makeShotEvidence()).success).toBe(true);
    expect(validateRemotionCurrentSlot(makeCurrentSlot()).success).toBe(true);
  });

  it("binds job and evidence IDs to the complete canonical identity", async () => {
    const job = makeSucceededShotJob();
    job.jobId = await createRemotionRenderJobId(job);
    expect((await validateRemotionRenderJobIdentity(job)).success).toBe(true);

    const forgedJob = { ...job, inputHash: "d".repeat(64) };
    expectIssue(await validateRemotionRenderJobIdentity(forgedJob), "$.jobId");

    const evidence = { ...makeShotEvidence(), jobId: job.jobId };
    expect((await validateRemotionEvidenceIdentity(evidence)).success).toBe(true);
    const forgedEvidence = { ...evidence, renderSettingsHash: "d".repeat(64) };
    expectIssue(await validateRemotionEvidenceIdentity(forgedEvidence), "$.jobId");
  });

  it("rejects unknown status, target, and absolute runtime paths", () => {
    expectIssue(validateRemotionRenderJob({ ...makeSucceededShotJob(), status: "done" }), "$.status");
    expectIssue(
      validateRemotionRenderJob({ ...makeSucceededShotJob(), target: { kind: "episode" } }),
      "$.target.kind",
    );
    expectIssue(
      validateRemotionRenderJob({ ...makeSucceededShotJob(), outputPath: "/tmp/output.mp4" }),
      "$.outputPath",
    );
  });

  it("requires succeeded jobs to have terminal identity and evidence paths", () => {
    const job = makeSucceededShotJob();
    delete job.evidencePath;
    expectIssue(validateRemotionRenderJob(job), "$.evidencePath");
  });

  it("rejects non-Remotion renderer evidence and target/composition drift", () => {
    const fallback = makeShotEvidence() as unknown as Record<string, unknown>;
    fallback.renderer = { requested: "remotion", actual: "ffmpeg" };
    expectIssue(validateRemotionEvidence(fallback), "$.renderer.actual");

    const wrongComposition = { ...makeShotEvidence(), compositionId: "ChapterVideo" };
    expectIssue(validateRemotionEvidence(wrongComposition), "$.compositionId");
  });

  it("rejects current-slot identity, hash, and path mismatches", () => {
    const mismatched = makeCurrentSlot();
    mismatched.evidence = { ...mismatched.evidence, inputHash: "d".repeat(64) };
    expectIssue(validateRemotionCurrentSlot(mismatched), "$.evidence.inputHash");

    const wrongPath = makeCurrentSlot();
    wrongPath.outputPath = "outputs/shots/chapter-001/shot-001/other.mp4";
    expectIssue(validateRemotionCurrentSlot(wrongPath), "$.outputPath");
  });

  it("allows only one current slot per target and unique current paths", () => {
    expect(validateRemotionCurrentSlotCollection([makeCurrentSlot()]).success).toBe(true);
    expectIssue(
      validateRemotionCurrentSlotCollection([makeCurrentSlot(), makeCurrentSlot()]),
      "$[1].target",
    );

    const projectB = makeCurrentSlot();
    projectB.projectId = "project-b";
    projectB.job = { ...projectB.job, projectId: "project-b" };
    projectB.evidence = { ...projectB.evidence, projectId: "project-b" };
    expect(validateRemotionCurrentSlotCollection([makeCurrentSlot(), projectB]).success).toBe(true);
  });

  it("accepts only a fully verified succeeded staged publication", () => {
    expect(validateRemotionCurrentSlotPublication(makePublication()).success).toBe(true);

    const canceled = makePublication();
    canceled.job = { ...canceled.job, status: "canceled", progress: 0.5 };
    expectIssue(validateRemotionCurrentSlotPublication(canceled), "$.job.status");

    const wrongBytes = makePublication();
    wrongBytes.stagedOutput = { ...wrongBytes.stagedOutput, sizeBytes: 1 };
    expectIssue(validateRemotionCurrentSlotPublication(wrongBytes), "$.stagedOutput.sizeBytes");

    const escapedJob = { ...makePublication(), stagedJobPath: "staging/other/job.json" };
    expectIssue(validateRemotionCurrentSlotPublication(escapedJob), "$.stagedJobPath");
  });
});

describe("Remotion Studio session contract validation", () => {
  it("accepts the generated projection identity and allowed write fields", () => {
    const session = makeStudioSession();
    expect(validateRemotionStudioSessionContract(session).success).toBe(true);
    expect(validateRemotionStudioWriteRequest(makeStudioWriteRequest(), session).success).toBe(true);
  });

  it("rejects tokens, absolute source paths, and unknown write fields", () => {
    const tokenized = { ...makeStudioSession(), sessionToken: "secret" };
    expectIssue(validateRemotionStudioSessionContract(tokenized), "$.sessionToken");

    const absolute = { ...makeStudioSession(), projectionSourcePath: "/tmp/chapter.tsx" };
    expectIssue(validateRemotionStudioSessionContract(absolute), "$.projectionSourcePath");

    const request = { ...makeStudioWriteRequest(), changedFields: ["arbitraryCode"] };
    expectIssue(validateRemotionStudioWriteRequest(request, makeStudioSession()), "$.changedFields[0]");
  });

  it("rejects cross-chapter, stale-revision, and unauthorized source writeback", () => {
    const session = makeStudioSession();
    expectIssue(
      validateRemotionStudioWriteRequest({ ...makeStudioWriteRequest(), chapterId: "chapter-002" }, session),
      "$.chapterId",
    );
    expectIssue(
      validateRemotionStudioWriteRequest({ ...makeStudioWriteRequest(), editingRevision: 0 }, session),
      "$.editingRevision",
    );
    expectIssue(
      validateRemotionStudioWriteRequest(
        { ...makeStudioWriteRequest(), projectionSourcePath: "studio/sessions/other/chapter.tsx" },
        session,
      ),
      "$.projectionSourcePath",
    );
  });

  it.each([
    "unknownImports",
    "unknownJsxNodes",
    "unknownMediaReferences",
    "unknownShotIds",
  ] as const)("rejects non-empty Studio source inspection %s", (key) => {
    const request = makeStudioWriteRequest();
    request.sourceInspection = { ...request.sourceInspection, [key]: ["unknown-value"] };
    expectIssue(
      validateRemotionStudioWriteRequest(request, makeStudioSession()),
      `$.sourceInspection.${key}`,
    );
  });

  it("rejects Studio source structure drift", () => {
    const request = makeStudioWriteRequest();
    request.sourceInspection = { ...request.sourceInspection, structureValid: false };
    expectIssue(
      validateRemotionStudioWriteRequest(request, makeStudioSession()),
      "$.sourceInspection.structureValid",
    );
  });
});
