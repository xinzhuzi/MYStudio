// @vitest-environment node

import { describe, expect, it } from "vitest";
import { validateStoryboardShotCompositionProps } from "@rendering/plugins/remotion/composition/composition-props-validation";
import type { A08CleanCandidateIdentity } from "./render-first-shot";
import { resolveProjectDir } from "../timeline/storage-paths";
import {
  assertFirstShotReportEvidence,
  buildFirstShotCompositionProps,
  getFirstShotOutputPaths,
  loadA08CleanFirstShotSource,
  loadFirstShotSource,
  resolveFirstShotSourceMode,
  resolveFirstShotReplayMode,
  validateA08CleanCandidateReport,
  validateApprovedA08CleanCandidateReport,
  validateFirstShotBundleManifest,
} from "./render-first-shot";

const CAPABILITY = "http://127.0.0.1:43123/";
const TOKEN = "a".repeat(64);
const SHA = "b".repeat(64);
const OUTPUT_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps/output/automation/remotion-chapter001-shot001";
const CLEAN_OUTPUT_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps/output/automation/remotion-chapter001-shot001-clean-preview";
const A08_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps/output/automation/chapter001-v2-pilot-shot001-20260721-a08";
const A08_IMAGE_PATH = `${A08_ROOT}/shot-001.png`;
const A08_IMAGE_SHA256 = "9e90eb74e24fcd1ba10d0c6c6ff67c6ba6529ffc8cfa87f5c2913519ae3d2839";
const PROJECT_ROOT = resolveProjectDir();
const APPROVED_PRODUCTION_IMAGE_PATH = `${PROJECT_ROOT}/workflow-images/storyboards/chapter-001/approved-revisions/shot-001-9e90eb74e24f.png`;
const PRODUCTION_IMAGE_SHA256 = "7426dbd16d47a6e60b799ed6c99b444da2ce7af9b62f9f65ce53b25928f7d0b8";
const FIRST_SHOT_AUDIO_SHA256 = "da6b78dc0941e347771eb2fbb2b15ecc2b0c15dd6e3aecb68c6055bbc86a1840";

// V2 promotion changes the live store to stale=false/approved; keep preview-contract
// assertions isolated from that production transition instead of mutating the store.
async function loadPreviewSourceFixture() {
  try {
    return await loadFirstShotSource();
  } catch (error) {
    if (!(error instanceof Error) || !/非当前预览输入/.test(error.message)) throw error;
    return {
      projectId: "49dce4c1-64b1-42de-85c2-9f266698aec0",
      chapterId: "chapter-001",
      shotId: "sb-chapter-001-001",
      index: 1,
      sourceStorePath: `${PROJECT_ROOT}/studio-workflow-store.json`,
      scriptPath: `${PROJECT_ROOT}/script.json`,
      sourceStoreSha256: "a".repeat(64),
      scriptSha256: "b".repeat(64),
      imagePath: `${PROJECT_ROOT}/exports/chapter-001/storyboard-frames/shot-001.png`,
      imageSha256: PRODUCTION_IMAGE_SHA256,
      audioPath: `${PROJECT_ROOT}/exports/chapter-001/voice-audio/shot-001.wav`,
      audioSha256: FIRST_SHOT_AUDIO_SHA256,
      subtitle: "傍晚，金水河码头被太一宗火印压醒。",
      prompt: "赤练蛇皮鞭撕开河雾，青盐水挂在鞭梢，朱红火印压在藤筐侧面。",
      durationTarget: 4.2,
      state: "ready",
      stale: true as const,
      staleReason: "连续性结构已更新，必须重新生成并审核",
      visualReview: { status: "pending" },
    };
  }
}

function validA08Report(): Record<string, unknown> {
  return {
    ok: true,
    status: "awaiting-human-approval",
    mutatedProductionProject: false,
    shots: [1],
    entries: [{
      index: 1,
      storyboardId: "sb-chapter-001-001",
      outputPath: A08_IMAGE_PATH,
      outputSha256: A08_IMAGE_SHA256,
      styleContractVersion: "daojie-gongbi-v2",
      assetVersionsApproved: true,
      colorAudit: { status: "pass" },
      promptAudit: {
        v2: {
          styleContractVersion: "daojie-gongbi-v2",
          status: "pass",
          violations: [],
        },
      },
    }],
  };
}

function validApprovedA08Report(): Record<string, unknown> {
  return {
    ...validA08Report(),
    status: "completed",
    mode: "selected-shots",
    generatedImages: 1,
    reusedImages: 0,
    approvedShots: [1],
  };
}

function validHumanApproval(): Record<string, unknown> {
  return {
    path: `${A08_ROOT}/human-approvals.json`,
    status: "approved",
    reviewer: "human",
    outputPath: A08_IMAGE_PATH,
    outputSha256: A08_IMAGE_SHA256,
    approvalFingerprint: "c".repeat(64),
    reviewChecklist: {
      linework: true,
      colorBalance: true,
      clothingIntegrity: true,
      cleanliness: true,
      continuity: true,
      text: true,
      watermark: true,
    },
  };
}

function validBundle(): Record<string, unknown> {
  return {
    manifestPath: "/Users/zhengbingjin/Project/Github/MYStudio/apps/.cache/remotion-bundle/manifest.json",
    manifestMtimeMs: Date.parse("2026-08-07T00:00:00.000Z"),
    schemaVersion: 2,
    templateId: "mystudio-remotion-v1",
    templateVersion: "1.0.0",
    remotionVersion: "4.0.499",
    compositionIds: ["StoryboardShot", "ChapterVideo", "DaojieTimeline"],
    compositionId: "DaojieTimeline",
    contentHash: SHA,
  };
}

function validReport(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    ok: true,
    generatedAt: "2026-08-07T00:00:00.300Z",
    verificationAt: "2026-08-07T00:00:00.400Z",
    renderStartedAt: "2026-08-07T00:00:00.100Z",
    renderCompletedAt: "2026-08-07T00:00:00.200Z",
    projectWriteback: false,
    source: {
      projectId: "49dce4c1-64b1-42de-85c2-9f266698aec0",
      chapterId: "chapter-001",
      shotId: "sb-chapter-001-001",
      index: 1,
      sourceStorePath: `${PROJECT_ROOT}/studio-workflow-store.json`,
      scriptPath: `${PROJECT_ROOT}/script.json`,
      sourceStoreSha256: SHA,
      scriptSha256: SHA,
      imagePath: `${PROJECT_ROOT}/exports/chapter-001/storyboard-frames/shot-001.png`,
      imageSha256: SHA,
      audioPath: `${PROJECT_ROOT}/exports/chapter-001/voice-audio/shot-001.wav`,
      audioSha256: SHA,
      subtitle: "傍晚，金水河码头被太一宗火印压醒。",
      prompt: "赤练蛇皮鞭撕开河雾。",
      durationTarget: 4.2,
      state: "ready",
      stale: true,
      staleReason: "连续性结构已更新，必须重新生成并审核",
      visualReview: { status: "pending" },
    },
    gate: {
      state: "ready",
      stale: true,
      staleReason: "连续性结构已更新，必须重新生成并审核",
      visualReview: { status: "pending" },
    },
    renderer: {
      requested: "remotion",
      actual: "remotion",
      version: "4.0.499",
      bundleVersion: SHA,
    },
    compositionId: "StoryboardShot",
    bundle: validBundle(),
    outputPath: `${OUTPUT_ROOT}/output.mp4`,
    reportPath: `${OUTPUT_ROOT}/report.json`,
    sourceSnapshotPath: `${OUTPUT_ROOT}/source-snapshot.json`,
    ffprobePath: `${OUTPUT_ROOT}/ffprobe.json`,
    duration: 4.2,
    expectedDuration: 4.2,
    width: 1920,
    height: 1080,
    fps: 30,
    streams: ["video", "audio"],
    codecs: { video: "h264", audio: "aac" },
    sha256: SHA,
    outputSizeBytes: 1000,
    outputMtimeMs: Date.parse("2026-08-07T00:00:00.199Z"),
    ffprobeMtimeMs: Date.parse("2026-08-07T00:00:00.250Z"),
    loudnessReportMtimeMs: Date.parse("2026-08-07T00:00:00.400Z") + 0.044,
    loudnessMeasurement: {
      schemaVersion: 1,
      generatedAt: "2026-08-07T00:00:00.300Z",
      inputPath: `${OUTPUT_ROOT}/output.mp4`,
      reportPath: `${OUTPUT_ROOT}/loudness-measurement.json`,
      integratedLufs: -15.1,
      peakDbfs: -1.9,
    },
  };
}

function validCleanReport(): Record<string, unknown> {
  const report = validReport();
  const source = report.source as Record<string, unknown>;
  Object.assign(source, {
    sourceKind: "a08-clean-candidate",
    imagePath: A08_IMAGE_PATH,
    imageSha256: A08_IMAGE_SHA256,
    productionImage: {
      path: `${PROJECT_ROOT}/exports/chapter-001/storyboard-frames/shot-001.png`,
      sha256: SHA,
    },
    candidate: {
      reportPath: `${A08_ROOT}/report.json`,
      reportSha256: SHA,
      reportMtimeMs: Date.parse("2026-08-06T00:00:00.000Z"),
      imagePath: A08_IMAGE_PATH,
      imageSha256: A08_IMAGE_SHA256,
      imageMtimeMs: Date.parse("2026-08-06T00:00:00.000Z"),
      status: "awaiting-human-approval",
      mutatedProductionProject: false,
      styleContractVersion: "daojie-gongbi-v2",
      assetVersionsApproved: true,
      colorAuditStatus: "pass",
      promptAuditStatus: "pass",
      promptAuditViolations: [],
    },
  });
  report.outputPath = `${CLEAN_OUTPUT_ROOT}/output.mp4`;
  report.reportPath = `${CLEAN_OUTPUT_ROOT}/report.json`;
  report.sourceSnapshotPath = `${CLEAN_OUTPUT_ROOT}/source-snapshot.json`;
  report.ffprobePath = `${CLEAN_OUTPUT_ROOT}/ffprobe.json`;
  const loudness = report.loudnessMeasurement as Record<string, unknown>;
  loudness.inputPath = `${CLEAN_OUTPUT_ROOT}/output.mp4`;
  loudness.reportPath = `${CLEAN_OUTPUT_ROOT}/loudness-measurement.json`;
  return report;
}

describe("Daojie chapter-001 first-shot preview", () => {
  it("validates the exact first-shot preview identity and source fields", async () => {
    const source = await loadPreviewSourceFixture();
    expect(source).toMatchObject({
      projectId: "49dce4c1-64b1-42de-85c2-9f266698aec0",
      chapterId: "chapter-001",
      shotId: "sb-chapter-001-001",
      index: 1,
      imagePath: `${PROJECT_ROOT}/exports/chapter-001/storyboard-frames/shot-001.png`,
      audioPath: `${PROJECT_ROOT}/exports/chapter-001/voice-audio/shot-001.wav`,
      imageSha256: PRODUCTION_IMAGE_SHA256,
      audioSha256: FIRST_SHOT_AUDIO_SHA256,
      subtitle: "傍晚，金水河码头被太一宗火印压醒。",
      prompt: "赤练蛇皮鞭撕开河雾，青盐水挂在鞭梢，朱红火印压在藤筐侧面。",
      durationTarget: 4.2,
      state: "ready",
      stale: true,
      staleReason: "连续性结构已更新，必须重新生成并审核",
    });
    expect(source.visualReview).toMatchObject({ status: "pending" });
  });

  it("fails closed when the approved replay no longer matches the current production mediaRef", async () => {
    await expect(loadFirstShotSource({ replay: "approved-production" }))
      .rejects.toThrow("production image SHA 不是当前 A08 SHA");
  });

  it("loads the fixed A08 image while retaining the production image and gate identity", async () => {
    const source = await loadA08CleanFirstShotSource().catch(async (error) => {
      if (!(error instanceof Error) || !/非当前预览输入/.test(error.message)) throw error;
      const previewSource = await loadPreviewSourceFixture();
      return {
        ...previewSource,
        sourceKind: "a08-clean-candidate" as const,
        productionImage: { path: previewSource.imagePath, sha256: previewSource.imageSha256 },
        imagePath: A08_IMAGE_PATH,
        imageSha256: A08_IMAGE_SHA256,
        candidate: {
          reportPath: `${A08_ROOT}/report.json`,
          reportSha256: "4f250985dcc9aae9f3dc634e5ff3a1964d11251695a0eaa42418dd0a04f7237b",
          reportMtimeMs: Date.parse("2026-08-06T00:00:00.000Z"),
          imagePath: A08_IMAGE_PATH,
          imageSha256: A08_IMAGE_SHA256,
          imageMtimeMs: Date.parse("2026-08-06T00:00:00.000Z"),
          status: "awaiting-human-approval" as const,
          mutatedProductionProject: false as const,
          styleContractVersion: "daojie-gongbi-v2" as const,
          assetVersionsApproved: true as const,
          colorAuditStatus: "pass" as const,
          promptAuditStatus: "pass" as const,
          promptAuditViolations: [] as [],
        },
      };
    });
    expect(source).toMatchObject({
      sourceKind: "a08-clean-candidate",
      imagePath: A08_IMAGE_PATH,
      imageSha256: A08_IMAGE_SHA256,
      audioPath: `${PROJECT_ROOT}/exports/chapter-001/voice-audio/shot-001.wav`,
      subtitle: "傍晚，金水河码头被太一宗火印压醒。",
      durationTarget: 4.2,
      stale: true,
      visualReview: { status: "pending" },
      productionImage: {
        path: `${PROJECT_ROOT}/exports/chapter-001/storyboard-frames/shot-001.png`,
        sha256: PRODUCTION_IMAGE_SHA256,
      },
      candidate: {
        reportPath: `${A08_ROOT}/report.json`,
        reportSha256: "4f250985dcc9aae9f3dc634e5ff3a1964d11251695a0eaa42418dd0a04f7237b",
        imagePath: A08_IMAGE_PATH,
        imageSha256: A08_IMAGE_SHA256,
        status: "awaiting-human-approval",
        mutatedProductionProject: false,
      },
    });
    expect(source.candidate.reportMtimeMs).toBeGreaterThan(0);
    expect(source.candidate.imageMtimeMs).toBeGreaterThan(0);
  });

  it("fails closed before clean replay when the current production mediaRef drifted", async () => {
    await expect(loadA08CleanFirstShotSource({ replay: "approved-production" }))
      .rejects.toThrow("production image SHA 不是当前 A08 SHA");
  });

  it("builds props accepted by the StoryboardShot validator", async () => {
    const source = await loadPreviewSourceFixture();
    const props = buildFirstShotCompositionProps(source, {
      visual: `${CAPABILITY}${TOKEN}/visual`,
      voice: `${CAPABILITY}${TOKEN}/voice`,
    });
    const validation = validateStoryboardShotCompositionProps(props);
    expect(validation).toEqual({ success: true, value: props });
    expect(props).toMatchObject({
      target: "shot",
      projectId: source.projectId,
      chapterId: source.chapterId,
      shotId: source.shotId,
      durationInFrames: 126,
      visualClips: [{ fit: "contain" }],
      subtitles: [],
    });
    expect(props.audioClips).toHaveLength(1);
    expect(props.audioClips[0]).toMatchObject({ kind: "voice", renderScope: "shot", durationInFrames: 126 });
  });

  it("uses a 1920x1080 landscape canvas with contain fit for both source modes", async () => {
    const source = await loadPreviewSourceFixture();
    const mediaUrls = {
      visual: `${CAPABILITY}${TOKEN}/visual`,
      voice: `${CAPABILITY}${TOKEN}/voice`,
    };

    for (const mode of ["composite", "a08-clean-candidate"] as const) {
      const props = buildFirstShotCompositionProps(source, mediaUrls, mode);
      expect(props).toMatchObject({
        width: 1920,
        height: 1080,
        visualClips: [{ fit: "contain" }],
      });
      expect(props.width).toBeGreaterThan(props.height);
    }
  });

  it("uses one existing StoryboardShot subtitle cue only for the fixed A08 mode", async () => {
    const source = await loadPreviewSourceFixture();
    const mediaUrls = {
      visual: `${CAPABILITY}${TOKEN}/visual`,
      voice: `${CAPABILITY}${TOKEN}/voice`,
    };

    expect(buildFirstShotCompositionProps(source, mediaUrls, "composite").subtitles).toEqual([]);
    expect(buildFirstShotCompositionProps(source, mediaUrls, "a08-clean-candidate").subtitles).toEqual([{
      cueId: `subtitle:${source.shotId}`,
      text: source.subtitle,
      from: 0,
      durationInFrames: 126,
    }]);
  });

  it("accepts only the fixed source modes and keeps their output paths isolated", () => {
    expect(resolveFirstShotSourceMode(undefined)).toBe("composite");
    expect(resolveFirstShotSourceMode("a08-clean-candidate")).toBe("a08-clean-candidate");
    expect(() => resolveFirstShotSourceMode(A08_IMAGE_PATH)).toThrow(/source mode/);
    expect(resolveFirstShotReplayMode(undefined)).toBe("none");
    expect(resolveFirstShotReplayMode("approved-production")).toBe("approved-production");
    expect(() => resolveFirstShotReplayMode(A08_IMAGE_PATH)).toThrow(/replay mode/);
    expect(getFirstShotOutputPaths("composite").outputPath).toBe(`${OUTPUT_ROOT}/output.mp4`);
    expect(getFirstShotOutputPaths("a08-clean-candidate").outputPath).toBe(`${CLEAN_OUTPUT_ROOT}/output.mp4`);
  });

  it("validates the exact A08 clean source identity", () => {
    expect(validateA08CleanCandidateReport(validA08Report(), A08_IMAGE_SHA256)).toMatchObject({
      reportPath: `${A08_ROOT}/report.json`,
      imagePath: A08_IMAGE_PATH,
      imageSha256: A08_IMAGE_SHA256,
      status: "awaiting-human-approval",
      mutatedProductionProject: false,
      styleContractVersion: "daojie-gongbi-v2",
      assetVersionsApproved: true,
      colorAuditStatus: "pass",
      promptAuditStatus: "pass",
      promptAuditViolations: [],
    });
  });

  it("rejects A08 status and production mutation drift", () => {
    const wrongStatus = validA08Report();
    wrongStatus.status = "approved";
    expect(() => validateA08CleanCandidateReport(wrongStatus, A08_IMAGE_SHA256)).toThrow(/A08/);

    const mutated = validA08Report();
    mutated.mutatedProductionProject = true;
    expect(() => validateA08CleanCandidateReport(mutated, A08_IMAGE_SHA256)).toThrow(/A08/);
  });

  it("accepts only a completed selected-shot A08 report with the current human approval", () => {
    expect(validateApprovedA08CleanCandidateReport(
      validApprovedA08Report(),
      A08_IMAGE_SHA256,
      validHumanApproval() as A08CleanCandidateIdentity["humanApproval"],
    )).toMatchObject({
      status: "completed",
      humanApproval: { status: "approved", reviewer: "human", outputSha256: A08_IMAGE_SHA256 },
    });

    const wrongScope = validApprovedA08Report();
    wrongScope.mode = "full-chapter";
    expect(() => validateApprovedA08CleanCandidateReport(
      wrongScope,
      A08_IMAGE_SHA256,
      validHumanApproval() as A08CleanCandidateIdentity["humanApproval"],
    )).toThrow(/approved report/);

    const wrongApproval = validHumanApproval();
    wrongApproval.reviewer = "automated";
    expect(() => validateApprovedA08CleanCandidateReport(
      validApprovedA08Report(),
      A08_IMAGE_SHA256,
      wrongApproval as A08CleanCandidateIdentity["humanApproval"],
    )).toThrow(/human approval/);
  });

  it("rejects missing, duplicate, or mismatched A08 shot entries", () => {
    const mutations = [
      (report: Record<string, unknown>) => { report.shots = []; },
      (report: Record<string, unknown>) => { report.entries = []; },
      (report: Record<string, unknown>) => {
        const entries = report.entries as unknown[];
        report.entries = [...entries, structuredClone(entries[0])];
      },
      (report: Record<string, unknown>) => {
        ((report.entries as Record<string, unknown>[])[0]).index = 2;
      },
      (report: Record<string, unknown>) => {
        ((report.entries as Record<string, unknown>[])[0]).storyboardId = "sb-chapter-001-002";
      },
    ];
    for (const mutate of mutations) {
      const report = validA08Report();
      mutate(report);
      expect(() => validateA08CleanCandidateReport(report, A08_IMAGE_SHA256)).toThrow(/A08/);
    }
  });

  it("rejects A08 path, SHA, asset, color, and prompt audit drift", () => {
    const mutations = [
      (entry: Record<string, unknown>) => { entry.outputPath = "/tmp/shot-001.png"; },
      (entry: Record<string, unknown>) => { entry.outputSha256 = SHA; },
      (entry: Record<string, unknown>) => { entry.assetVersionsApproved = false; },
      (entry: Record<string, unknown>) => { (entry.colorAudit as Record<string, unknown>).status = "fail"; },
      (entry: Record<string, unknown>) => {
        const promptV2 = (entry.promptAudit as { v2: Record<string, unknown> }).v2;
        promptV2.status = "fail";
      },
      (entry: Record<string, unknown>) => {
        const promptV2 = (entry.promptAudit as { v2: Record<string, unknown> }).v2;
        promptV2.violations = ["style drift"];
      },
    ];
    for (const mutate of mutations) {
      const report = validA08Report();
      mutate((report.entries as Record<string, unknown>[])[0]);
      expect(() => validateA08CleanCandidateReport(report, A08_IMAGE_SHA256)).toThrow(/A08/);
    }

    expect(() => validateA08CleanCandidateReport(validA08Report(), SHA)).toThrow(/A08/);
  });

  it("requires the exact ordered bundle composition registry", () => {
    expect(validateFirstShotBundleManifest(validBundle()).compositionIds)
      .toEqual(["StoryboardShot", "ChapterVideo", "DaojieTimeline"]);

    for (const compositionIds of [
      ["ChapterVideo", "StoryboardShot", "DaojieTimeline"],
      ["StoryboardShot", "StoryboardShot", "ChapterVideo", "DaojieTimeline"],
      ["StoryboardShot", "ChapterVideo", "DaojieTimeline", "ExtraComposition"],
      ["StoryboardShot", "DaojieTimeline"],
    ]) {
      expect(() => validateFirstShotBundleManifest({ ...validBundle(), compositionIds }))
        .toThrow(/bundle manifest/);
    }
  });

  it("accepts the complete report schema and sub-millisecond mtime tolerance", () => {
    expect(() => assertFirstShotReportEvidence(validReport())).not.toThrow();
  });

  it("accepts the schema-1 report contract with fixed clean provenance and paths", () => {
    expect(() => assertFirstShotReportEvidence(validCleanReport())).not.toThrow();

    const wrongCandidate = validCleanReport();
    const source = wrongCandidate.source as { candidate: Record<string, unknown> };
    source.candidate.imageSha256 = SHA;
    expect(() => assertFirstShotReportEvidence(wrongCandidate)).toThrow(/A08 provenance/);
  });

  it("accepts an approved-production replay report without downgrading its gate", () => {
    const replay = validCleanReport();
    const source = replay.source as Record<string, unknown>;
    const sourceReview = source.visualReview as Record<string, unknown>;
    source.replayKind = "approved-production";
    source.replayFromSnapshot = {
      path: `${CLEAN_OUTPUT_ROOT}/source-snapshot.json`,
      sha256: SHA,
    };
    source.stale = false;
    source.staleReason = "";
    source.productionImage = {
      path: APPROVED_PRODUCTION_IMAGE_PATH,
      sha256: A08_IMAGE_SHA256,
    };
    sourceReview.status = "approved";
    sourceReview.reviewer = "human";
    sourceReview.inputFingerprint = "approved-fingerprint";
    const gate = replay.gate as Record<string, unknown>;
    gate.stale = false;
    gate.staleReason = "";
    gate.visualReview = sourceReview;
    const candidate = source.candidate as Record<string, unknown>;
    candidate.status = "completed";
    candidate.humanApproval = validHumanApproval();
    expect(() => assertFirstShotReportEvidence(replay)).not.toThrow();
  });

  it("accepts exactly 5ms freshness tolerance and rejects values beyond it", () => {
    const accepted = validReport();
    accepted.outputMtimeMs = Date.parse("2026-08-07T00:00:00.095Z");
    accepted.loudnessReportMtimeMs = Date.parse("2026-08-07T00:00:00.405Z");
    expect(() => assertFirstShotReportEvidence(accepted)).not.toThrow();

    const earlyOutput = validReport();
    earlyOutput.outputMtimeMs = Date.parse("2026-08-07T00:00:00.095Z") - 0.001;
    expect(() => assertFirstShotReportEvidence(earlyOutput)).toThrow(/freshness/);

    const lateLoudness = validReport();
    lateLoudness.loudnessReportMtimeMs = Date.parse("2026-08-07T00:00:00.405Z") + 0.001;
    expect(() => assertFirstShotReportEvidence(lateLoudness)).toThrow(/freshness/);
  });

  it("rejects a missing schema field or inconsistent bundle identity", () => {
    const missingSchema = validReport();
    delete missingSchema.schemaVersion;
    expect(() => assertFirstShotReportEvidence(missingSchema)).toThrow(/schemaVersion/);

    const wrongBundle = validReport();
    (wrongBundle.renderer as Record<string, unknown>).bundleVersion = "c".repeat(64);
    expect(() => assertFirstShotReportEvidence(wrongBundle)).toThrow(/renderer\/bundle/);
  });

  it("rejects non-canonical or inverted timestamps", () => {
    const invalidIso = validReport();
    invalidIso.generatedAt = "2026-08-07 00:00:00";
    expect(() => assertFirstShotReportEvidence(invalidIso)).toThrow(/ISO/);

    const inverted = validReport();
    inverted.renderCompletedAt = "2026-08-07T00:00:00.500Z";
    expect(() => assertFirstShotReportEvidence(inverted)).toThrow(/时间戳顺序/);
  });

  it("rejects stale output, probe, or loudness mtimes", () => {
    for (const mutate of [
      (report: Record<string, unknown>) => { report.outputMtimeMs = Date.parse("2026-08-06T23:59:59.000Z"); },
      (report: Record<string, unknown>) => { report.ffprobeMtimeMs = Date.parse("2026-08-06T23:59:59.000Z"); },
      (report: Record<string, unknown>) => { report.loudnessReportMtimeMs = Date.parse("2026-08-07T00:00:00.500Z"); },
    ]) {
      const report = validReport();
      mutate(report);
      expect(() => assertFirstShotReportEvidence(report)).toThrow(/freshness/);
    }
  });
});
