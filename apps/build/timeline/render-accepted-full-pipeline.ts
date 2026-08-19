import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RemotionCurrentSlotV1 } from "@/types/remotion-workspace";
import { validateTimelineRenderPlan } from "@/lib/studio/editing/validation";
import {
  readRemotionCurrentShotSlotsFromWorkspace,
  resolveRemotionCurrentSlotOutputPath,
} from "@/lib/studio/remotion/remotion-current-slot";
import { parseProjectFileUrl } from "@/electron/storage/storage-paths";
import {
  validateHyperFramesOverlayArtifact,
  validateVideoUseChapterArtifact,
  type RemotionChapterGateInputV1,
  type RemotionChapterGateResult,
} from "@rendering/contracts/video-workflow";
import { RemotionChapterManifestService } from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service";
import { RemotionChapterRenderer } from "@rendering/plugins/remotion/renderer/remotion-chapter-renderer";
import { createVideoWorkflowChapterService } from "@rendering/plugins/video-workflow/video-workflow-chapter-service";
import { hashFileSha256 } from "../remotion/render-smoke-evidence";
import {
  assertAcceptedArtifactProjection,
  assertFormalChapterSlotIdentity,
  assertStableFileInventory,
  invokeFormalChapterRenderer,
  materializeIsolatedShotWorkspace,
  projectAcceptedTimelinePlan,
  type FormalFileIdentity,
} from "./render-accepted-full-pipeline-core";
import { runFormalOutputQc } from "./render-accepted-full-pipeline-qc";
import { registeredProjectDir } from "./storage-paths";

const execFileAsync = promisify(execFile);
const PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec4";
const CHAPTER_ID = "chapter-001";
const EXPECTED_VISUAL_COUNT = 43;

type ElectronMainModule = typeof import("electron");
type FormalElectronMain = Pick<ElectronMainModule, "app" | "utilityProcess">;

declare global {
  // TypeScript global augmentation requires `var` for a runtime global property.
  // eslint-disable-next-line no-var
  var __MYSTUDIO_FORMAL_ELECTRON_MAIN__: FormalElectronMain | undefined;
}

export function resolveFormalElectronMain(
  value: FormalElectronMain | undefined = globalThis.__MYSTUDIO_FORMAL_ELECTRON_MAIN__,
): FormalElectronMain {
  if (!value?.app || !value.utilityProcess) {
    throw new Error("formal renderer Electron main bridge is unavailable; use formal-renderer-electron-bootstrap.cjs");
  }
  return value;
}

export function resolveFormalProjectRoot(input: {
  explicitProjectRoot?: string;
  registeredProjectRoot?: string;
  productUserData: string;
  projectId: string;
}): string {
  const explicitProjectRoot = input.explicitProjectRoot?.trim();
  if (explicitProjectRoot) return path.resolve(explicitProjectRoot);
  const registeredRoot = input.registeredProjectRoot?.trim();
  if (registeredRoot) return path.resolve(registeredRoot);
  return path.join(input.productUserData, "projects", "_p", input.projectId);
}

export function resolveFormalSlotSourceRoot(input: {
  explicitSlotSourceRoot?: string;
  productionRemotionRoot: string;
}): string {
  const explicitSlotSourceRoot = input.explicitSlotSourceRoot?.trim();
  return path.resolve(explicitSlotSourceRoot || input.productionRemotionRoot);
}

export function resolveFormalRevision(value?: string): number {
  const raw = value?.trim();
  if (!raw) throw new Error("MYSTUDIO_FORMAL_REVISION is required; historical revisions are not current evidence");
  if (!/^\d+$/.test(raw)) throw new Error("MYSTUDIO_FORMAL_REVISION must be a positive integer");
  const revision = Number(raw);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("MYSTUDIO_FORMAL_REVISION must be a positive integer");
  }
  return revision;
}

export function resolveFormalArtifactRevisionRoots(input: {
  productionProjectRoot: string;
  chapterId: string;
  revision: number;
  explicitVideoUseRevisionRoot?: string;
  explicitHyperFramesRevisionRoot?: string;
}): { videoUseRevisionRoot: string; hyperFramesRevisionRoot: string } {
  const revisionName = `r${input.revision}`;
  return {
    videoUseRevisionRoot: path.resolve(
      input.explicitVideoUseRevisionRoot?.trim()
        || path.join(input.productionProjectRoot, "video-use", input.chapterId, revisionName),
    ),
    hyperFramesRevisionRoot: path.resolve(
      input.explicitHyperFramesRevisionRoot?.trim()
        || path.join(input.productionProjectRoot, "hyperframes", input.chapterId, revisionName),
    ),
  };
}

export function resolveFormalSourceRunDir(input: {
  explicitSourceRun?: string;
  explicitPlanPath?: string;
}): string {
  const explicitSourceRun = input.explicitSourceRun?.trim();
  if (explicitSourceRun) return path.resolve(explicitSourceRun);
  const explicitPlanPath = input.explicitPlanPath?.trim();
  if (explicitPlanPath) return path.dirname(path.resolve(explicitPlanPath));
  throw new Error("MYSTUDIO_FORMAL_SOURCE_RUN or MYSTUDIO_FORMAL_TIMELINE_PLAN is required; historical runs are not current evidence");
}

type FormalSlotSourceInventoryRow = {
  shotId: string;
  shotRevision: number;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  sha256: string;
};

export function assertFormalSlotSourceInventory(
  production: readonly FormalSlotSourceInventoryRow[],
  slotSource: readonly FormalSlotSourceInventoryRow[],
): void {
  const project = (rows: readonly FormalSlotSourceInventoryRow[]) => rows
    .map(({ shotId, shotRevision, sizeBytes, sha256 }) => ({ shotId, shotRevision, sizeBytes, sha256 }))
    .sort((left, right) => left.shotId.localeCompare(right.shotId));
  if (JSON.stringify(project(production)) !== JSON.stringify(project(slotSource))) {
    throw new Error("slot-source media inventory does not match production");
  }
}

export function resolveFormalTimelinePlanPath(input: {
  explicitPlanPath?: string;
  sourceRunDir: string;
}): string {
  const explicitPlanPath = input.explicitPlanPath?.trim();
  return explicitPlanPath
    ? path.resolve(explicitPlanPath)
    : path.join(input.sourceRunDir, "timeline-render-plan.json");
}

export async function runAcceptedFormalRenderer(): Promise<void> {
  const appsRoot = path.resolve(process.env.MYSTUDIO_APPS_ROOT ?? process.cwd());
  const runDir = path.join(
    appsRoot,
    "output",
    "automation",
    `formal-renderer-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
  );
  const isolatedWorkspace = path.join(runDir, "formal-workspace");
  const snapshotsDir = path.join(runDir, "snapshots");
  const qcDir = path.join(runDir, "qc");
  const progressPath = path.join(runDir, "renderer-progress.jsonl");
  await fs.promises.mkdir(path.join(runDir, "electron-user-data"), { recursive: true });
  await fs.promises.mkdir(snapshotsDir, { recursive: true });
  let renderer: RemotionChapterRenderer | undefined;
  let exitCode = 0;
  let lifecycle: FormalElectronMain["app"] | undefined;
  try {
    const { app, utilityProcess } = resolveFormalElectronMain();
    lifecycle = app;
    const revision = resolveFormalRevision(process.env.MYSTUDIO_FORMAL_REVISION);
    const repoRoot = path.dirname(appsRoot);
    const productUserData = path.resolve(
      process.env.MYSTUDIO_PRODUCT_USER_DATA
        ?? path.join(os.homedir(), "Library", "Application Support", "漫影工作室"),
    );
    const productionProjectRoot = resolveFormalProjectRoot({
      explicitProjectRoot: process.env.MYSTUDIO_FORMAL_PROJECT_ROOT,
      registeredProjectRoot: registeredProjectDir(PROJECT_ID),
      productUserData,
      projectId: PROJECT_ID,
    });
    const productionRemotionRoot = path.join(productionProjectRoot, "remotion");
    const slotSourceRoot = resolveFormalSlotSourceRoot({
      explicitSlotSourceRoot: process.env.MYSTUDIO_FORMAL_SLOT_SOURCE_ROOT,
      productionRemotionRoot,
    });
    const { videoUseRevisionRoot, hyperFramesRevisionRoot } = resolveFormalArtifactRevisionRoots({
      productionProjectRoot,
      chapterId: CHAPTER_ID,
      revision,
      explicitVideoUseRevisionRoot: process.env.MYSTUDIO_FORMAL_VIDEO_USE_REVISION_ROOT
        ?? process.env.MYSTUDIO_FORMAL_REVISION_ROOT,
      explicitHyperFramesRevisionRoot: process.env.MYSTUDIO_FORMAL_HYPERFRAMES_REVISION_ROOT,
    });
    const sourceRunDir = resolveFormalSourceRunDir({
      explicitSourceRun: process.env.MYSTUDIO_FORMAL_SOURCE_RUN,
      explicitPlanPath: process.env.MYSTUDIO_FORMAL_TIMELINE_PLAN,
    });
    const timelinePlanPath = resolveFormalTimelinePlanPath({
      explicitPlanPath: process.env.MYSTUDIO_FORMAL_TIMELINE_PLAN,
      sourceRunDir,
    });
    const installedApp = path.resolve(
      process.env.MYSTUDIO_FORMAL_INSTALLED_APP ?? "/Applications/漫影工作室.app",
    );
    const resourcesRoot = path.join(installedApp, "Contents", "Resources");
    const appAsarPath = path.join(resourcesRoot, "app.asar");
    const workerPath = resolveInstalledRemotionWorkerPath(resourcesRoot);
    const bundlePath = path.join(resourcesRoot, "remotion-bundle");
    const bundleManifestPath = path.join(bundlePath, "manifest.json");
    const binariesDirectory = path.join(
      resourcesRoot,
      "app.asar.unpacked",
      "node_modules",
      "@remotion",
      "compositor-darwin-arm64",
    );
    const compositorFfprobePath = path.join(binariesDirectory, "ffprobe");
    const browserExecutable = path.resolve(
      process.env.MYSTUDIO_REMOTION_BROWSER
        ?? path.join(
          productUserData,
          "remotion-runtime",
          "node_modules",
          ".remotion",
          "chrome-headless-shell",
          "mac-arm64",
          "chrome-headless-shell-mac-arm64",
          "chrome-headless-shell",
        ),
    );
    const collisionFilesBefore = await collisionInventory([
      path.join(repoRoot, "apps", "build", "timeline", "run-full-pipeline.ts"),
      path.join(repoRoot, "apps", "frontend", "electron", "main", "main.ts"),
      appAsarPath,
      workerPath,
      bundleManifestPath,
      compositorFfprobePath,
      browserExecutable,
    ]);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    assertStableFileInventory(
      collisionFilesBefore,
      await collisionInventory(Object.keys(collisionFilesBefore)),
      "workflow collision files during preflight",
    );
    app.setPath("userData", path.join(runDir, "electron-user-data"));
    await app.whenReady();
    const packageMetadata = await readJson(path.join(appsRoot, "package.json"));
    const remotionVersion = readRemotionVersion(packageMetadata);
    await assertReadableRuntimePath(appAsarPath, "installed app.asar");
    await assertReadableRuntimePath(workerPath, "packaged Remotion worker");
    await assertReadableRuntimePath(bundleManifestPath, "Remotion bundle manifest");
    await assertReadableRuntimePath(compositorFfprobePath, "Remotion compositor ffprobe");
    await assertReadableRuntimePath(browserExecutable, "managed Headless Shell");
    const appAsarBefore = await fileIdentity(appAsarPath);
    await assertFileStable(appAsarPath, appAsarBefore);

    const rawPlan = await readJson(timelinePlanPath);
    const planValidation = validateTimelineRenderPlan(rawPlan);
    if (!planValidation.success) {
      throw new Error(formatIssues("timeline plan", planValidation.issues));
    }
    const acceptedPlan = planValidation.value;
    const videoUseValidation = validateVideoUseChapterArtifact(
      await readJson(path.join(videoUseRevisionRoot, "video-use-artifact.json")),
    );
    if (!videoUseValidation.success) {
      throw new Error(formatIssues("video-use artifact", videoUseValidation.issues));
    }
    const hyperFramesValidation = validateHyperFramesOverlayArtifact(
      await readJson(path.join(hyperFramesRevisionRoot, "hyperframes-artifact.json")),
    );
    if (!hyperFramesValidation.success) {
      throw new Error(formatIssues("HyperFrames artifact", hyperFramesValidation.issues));
    }
    const hyperFramesOutputPath = await resolveAcceptedHyperFramesOutputPath(
      hyperFramesValidation.value.outputPath!,
      hyperFramesRevisionRoot,
    );
    const artifactProjection = assertAcceptedArtifactProjection({
      plan: acceptedPlan,
      videoUse: videoUseValidation.value,
      hyperFrames: hyperFramesValidation.value,
      productionRemotionRoot,
      expectedVisualCount: EXPECTED_VISUAL_COUNT,
    });
    const projectedPlan = projectAcceptedTimelinePlan(acceptedPlan, {
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      revision,
      expectedVisualCount: EXPECTED_VISUAL_COUNT,
      productionRemotionRoot,
    });

    const chapterManifestService = new RemotionChapterManifestService({
      projectRootForProject: (projectId) => checkedProjectRoot(projectId, productionProjectRoot),
      probeMedia: async () => {
        throw new Error("formal accepted-source render does not import audio");
      },
    });
    const chapterManifest = await chapterManifestService.read(PROJECT_ID, CHAPTER_ID);
    if (!chapterManifest) throw new Error("accepted source chapter manifest is missing");

    const videoWorkflowService = createVideoWorkflowChapterService({
      workspaceRootForProject: (projectId) => path.join(checkedProjectRoot(projectId, productionProjectRoot), "video-use"),
      readArtifacts: async () => ({
        success: true as const,
        value: {
          paths: {
            revisionDir: videoUseRevisionRoot,
            videoUsePath: path.join(videoUseRevisionRoot, "video-use-artifact.json"),
            hyperFramesRevisionDir: hyperFramesRevisionRoot,
            hyperFramesPath: path.join(hyperFramesRevisionRoot, "hyperframes-artifact.json"),
          },
          videoUseArtifact: videoUseValidation.value,
          hyperFramesArtifact: hyperFramesValidation.value,
        },
      }),
      runVideoUse: async () => {
        throw new Error("video-use provider execution is forbidden in the formal accepted-source renderer");
      },
      renderHyperFrames: async () => {
        throw new Error("HyperFrames provider execution is forbidden in the formal accepted-source renderer");
      },
    });
    const evaluateAcceptedGate = async (
      input: RemotionChapterGateInputV1,
    ): Promise<RemotionChapterGateResult> => {
      const artifacts = await videoWorkflowService.readArtifacts(input);
      const videoUseInputSha256 = artifacts.success
        ? artifacts.value.videoUseArtifact?.evidence.inputSha256
        : undefined;
      const gate = await videoWorkflowService.evaluateGate({ ...input, videoUseInputSha256 });
      if (!gate.accepted || !gate.hyperFramesOutputPath) return gate;
      return { ...gate, hyperFramesOutputPath };
    };
    const gate = await evaluateAcceptedGate({
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      revision,
      inputSha256: videoUseValidation.value.evidence.inputSha256,
    });
    if (!gate.accepted) throw new Error(`accepted video workflow gate blocked: ${gate.code} ${gate.message}`);
    // Fail closed before MediaBridge/Remotion can consume the overlay: an accepted
    // artifact is not evidence that the referenced alpha file still exists or has
    // the required codec/pixel format.
    await probeHyperFrames(
      hyperFramesOutputPath,
      process.env.MYSTUDIO_FFPROBE_PATH ?? "ffprobe",
    );
    const hyperFramesDiskSha256Before = await hashFileSha256(hyperFramesOutputPath);
    if (hyperFramesDiskSha256Before !== hyperFramesValidation.value.outputSha256) {
      throw new Error("HyperFrames alpha output SHA-256 drifted before formal render");
    }

    const productionSlots = await readRemotionCurrentShotSlotsFromWorkspace(
      productionRemotionRoot,
      PROJECT_ID,
      CHAPTER_ID,
    );
    if (productionSlots.length !== EXPECTED_VISUAL_COUNT) {
      throw new Error(`expected ${EXPECTED_VISUAL_COUNT} production shot slots, received ${productionSlots.length}`);
    }
    const sourceInventoryBefore = await buildSourceInventory(productionRemotionRoot, productionSlots);
    const slotSourceSlots = slotSourceRoot === productionRemotionRoot
      ? productionSlots
      : await readRemotionCurrentShotSlotsFromWorkspace(
        slotSourceRoot,
        PROJECT_ID,
        CHAPTER_ID,
      );
    if (slotSourceSlots.length !== EXPECTED_VISUAL_COUNT) {
      throw new Error(`expected ${EXPECTED_VISUAL_COUNT} slot-source shot slots, received ${slotSourceSlots.length}`);
    }
    const slotSourceInventoryBefore = await buildSourceInventory(slotSourceRoot, slotSourceSlots);
    assertFormalSlotSourceInventory(sourceInventoryBefore, slotSourceInventoryBefore);
    await materializeIsolatedShotWorkspace({
      sourceWorkspace: slotSourceRoot,
      targetWorkspace: isolatedWorkspace,
      currentShotSlots: slotSourceSlots,
    });
    const isolatedSlots = await readRemotionCurrentShotSlotsFromWorkspace(
      isolatedWorkspace,
      PROJECT_ID,
      CHAPTER_ID,
    );
    if (isolatedSlots.length !== EXPECTED_VISUAL_COUNT) {
      throw new Error(`isolated slot revalidation returned ${isolatedSlots.length} slots`);
    }

    await Promise.all([
      snapshotFile(path.join(videoUseRevisionRoot, "video-use-artifact.json"), path.join(snapshotsDir, "video-use-artifact.json")),
      snapshotFile(path.join(hyperFramesRevisionRoot, "hyperframes-artifact.json"), path.join(snapshotsDir, "hyperframes-artifact.json")),
      snapshotFile(timelinePlanPath, path.join(snapshotsDir, "timeline-render-plan-input.json")),
      snapshotFile(path.join(productionProjectRoot, "remotion", "chapters", `${CHAPTER_ID}.json`), path.join(snapshotsDir, "chapter-manifest.json")),
      writeJson(path.join(snapshotsDir, "timeline-render-plan-projected.json"), projectedPlan),
      writeJson(path.join(snapshotsDir, "editing-project.json"), projectedPlan.editingProjectSnapshot),
      writeJson(path.join(runDir, "source-inventory-before.json"), sourceInventoryBefore),
      writeJson(path.join(runDir, "slot-source-inventory-before.json"), slotSourceInventoryBefore),
    ]);

    const resolveIsolatedSource = (sourcePath: string): string => {
      const parsed = sourcePath.startsWith("project-file://") ? parseProjectFileUrl(sourcePath) : null;
      if (parsed) {
        checkedProjectRoot(parsed.projectId, productionProjectRoot);
        return resolveInside(isolatedWorkspace, parsed.relativePath);
      }
      if (path.isAbsolute(sourcePath)) return sourcePath;
      throw new Error(`unsupported formal renderer source path: ${sourcePath}`);
    };
    const progress: Array<{ jobId: string; stage: string; ratio: number; message?: string }> = [];
    renderer = new RemotionChapterRenderer({
      workspaceRoot: isolatedWorkspace,
      bundlePath,
      workerPath,
      cwd: path.join(productUserData, "remotion-runtime"),
      binariesDirectory,
      remotionVersion,
      resolveSourcePath: resolveIsolatedSource,
      projectRootForProject: (projectId) => checkedProjectRoot(projectId, productionProjectRoot),
      chapterManifestService,
      probeBrowser: async () => ({
        status: { state: "ready", remotionVersion },
        executablePath: browserExecutable,
      }),
      fork: (modulePath, args, options) => utilityProcess.fork(modulePath, [...args], options),
      emitProgress: (event) => {
        progress.push(event);
        fs.appendFileSync(progressPath, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
      },
      videoWorkflowGate: evaluateAcceptedGate,
    });
    const formalSlot = await invokeFormalChapterRenderer({
      renderer,
      plan: projectedPlan,
      currentShotSlots: isolatedSlots,
      expectedVisualCount: EXPECTED_VISUAL_COUNT,
    });
    assertFormalChapterSlotIdentity(formalSlot, {
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      editingProjectId: projectedPlan.editingProjectSnapshot.id,
      editingRevision: revision,
    });
    const outputPath = resolveRemotionCurrentSlotOutputPath(isolatedWorkspace, formalSlot);
    await writeJson(path.join(runDir, "formal-current-slot.json"), formalSlot);
    await writeJson(path.join(runDir, "formal-job.json"), formalSlot.job);
    await writeJson(path.join(runDir, "formal-evidence.json"), formalSlot.evidence);

    const sourcePathByClipId = Object.fromEntries(
      projectedPlan.clips
        .filter((clip) => clip.trackKind === "video" || clip.trackKind === "image")
        .map((clip) => [clip.id, resolveIsolatedSource(clip.source.path ?? "")]),
    );
    const qc = await runFormalOutputQc({
      outputPath,
      plan: projectedPlan,
      sourcePathByClipId,
      evidenceDir: qcDir,
      ffmpegExecutable: process.env.MYSTUDIO_FFMPEG_PATH,
    });
    const outputIdentity = await fileIdentity(outputPath);
    if (outputIdentity.sha256 !== formalSlot.evidence.sha256
      || outputIdentity.sizeBytes !== formalSlot.evidence.sizeBytes
      || outputIdentity.mtimeMs !== formalSlot.evidence.mtimeMs
      || qc.outputSha256 !== formalSlot.evidence.sha256) {
      throw new Error("formal renderer output file/evidence identity mismatch");
    }
    const hyperFramesProbe = await probeHyperFrames(
      hyperFramesOutputPath,
      process.env.MYSTUDIO_FFPROBE_PATH ?? "ffprobe",
    );
    const hyperFramesDiskSha256 = await hashFileSha256(hyperFramesOutputPath);
    if (hyperFramesDiskSha256 !== hyperFramesDiskSha256Before
      || hyperFramesDiskSha256 !== hyperFramesValidation.value.outputSha256) {
      throw new Error("HyperFrames alpha output SHA-256 drifted during formal render");
    }
    const sourceInventoryAfter = await buildSourceInventory(productionRemotionRoot, productionSlots);
    await writeJson(path.join(runDir, "source-inventory-after.json"), sourceInventoryAfter);
    if (JSON.stringify(sourceInventoryAfter) !== JSON.stringify(sourceInventoryBefore)) {
      throw new Error("production source inventory changed during formal render");
    }
    const slotSourceInventoryAfter = await buildSourceInventory(slotSourceRoot, slotSourceSlots);
    await writeJson(path.join(runDir, "slot-source-inventory-after.json"), slotSourceInventoryAfter);
    if (JSON.stringify(slotSourceInventoryAfter) !== JSON.stringify(slotSourceInventoryBefore)) {
      throw new Error("slot-source inventory changed during formal render");
    }
    const appAsarAfter = await fileIdentity(appAsarPath);
    assertStableFileInventory(
      { [appAsarPath]: appAsarBefore },
      { [appAsarPath]: appAsarAfter },
      "installed app.asar during formal render",
    );
    const collisionFilesAfter = await collisionInventory(Object.keys(collisionFilesBefore));
    assertStableFileInventory(
      collisionFilesBefore,
      collisionFilesAfter,
      "workflow collision files during formal render",
    );

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runDir,
      source: "accepted-source-read-only",
      projectId: PROJECT_ID,
      chapterId: CHAPTER_ID,
      revision,
      providerCalls: 0,
      formalRenderer: {
        class: "RemotionChapterRenderer",
        method: "render",
        compositionId: formalSlot.evidence.compositionId,
        renderer: formalSlot.evidence.renderer,
        jobId: formalSlot.job.jobId,
        currentSlotPath: path.join(runDir, "formal-current-slot.json"),
        outputPath,
        outputSha256: qc.outputSha256,
        outputIdentity,
        progressEventCount: progress.length,
        progressPath,
      },
      plugins: {
        videoUse: {
          status: videoUseValidation.value.status,
          stage: videoUseValidation.value.stage,
          mode: videoUseValidation.value.mode,
          edlCount: artifactProjection.videoUseEdlCount,
          artifactSha256: videoUseValidation.value.evidence.artifactSha256,
        },
        hyperFrames: {
          status: hyperFramesValidation.value.status,
          windowCount: artifactProjection.hyperFramesWindowCount,
          outputSha256: hyperFramesDiskSha256,
          probe: hyperFramesProbe,
        },
        remotion: {
          version: remotionVersion,
          bundlePath,
          bundleManifest: await readJson(path.join(bundlePath, "manifest.json")),
          workerPath,
        },
      },
      media: {
        visualClipCount: EXPECTED_VISUAL_COUNT,
        textClipCount: 0,
        subtitleAuthority: "source-embedded",
        qc,
      },
      safety: {
        sourceInventoryUnchanged: true,
        slotSourceInventoryUnchanged: true,
        appAsarUnchanged: true,
        isolatedWorkspace,
        productionRemotionRoot,
        slotSourceRoot,
        appAsar: appAsarAfter,
        collisionFilesBefore,
        collisionFilesAfter,
      },
      acceptanceEvidence: {
        ac1SourceShaUnchanged: {
          sourceInventoryBefore: path.join(runDir, "source-inventory-before.json"),
          sourceInventoryAfter: path.join(runDir, "source-inventory-after.json"),
          unchanged: JSON.stringify(sourceInventoryBefore) === JSON.stringify(sourceInventoryAfter),
          slotSourceInventoryBefore: path.join(runDir, "slot-source-inventory-before.json"),
          slotSourceInventoryAfter: path.join(runDir, "slot-source-inventory-after.json"),
          slotSourceUnchanged: JSON.stringify(slotSourceInventoryBefore) === JSON.stringify(slotSourceInventoryAfter),
        },
        ac2VideoUseEdlProjected: {
          expectedVisualCount: EXPECTED_VISUAL_COUNT,
          edlCount: artifactProjection.videoUseEdlCount,
        },
        ac3HyperFramesConsumed: {
          windowCount: artifactProjection.hyperFramesWindowCount,
          outputSha256: hyperFramesDiskSha256,
          outputProbe: hyperFramesProbe,
        },
        ac4FormalRendererEvidence: {
          currentSlotPath: path.join(runDir, "formal-current-slot.json"),
          jobPath: path.join(runDir, "formal-job.json"),
          evidencePath: path.join(runDir, "formal-evidence.json"),
        },
        ac5AndAc6MediaQc: {
          qc,
        },
        ac7FreshQualityGate: {
          status: "pending-external-evidence",
          required: ["targetedTests", "typecheck", "lint", "trellisCheck", "taskQc"],
          note: "The renderer does not run or claim repository quality checks; record fresh command evidence separately.",
        },
      },
    };
    await writeJson(path.join(runDir, "report.json"), report);
    console.log(`FORMAL_RENDER_OUTPUT=${outputPath}`);
    console.log(`FORMAL_RENDER_SHA256=${qc.outputSha256}`);
    console.log(`FORMAL_RENDER_REPORT=${path.join(runDir, "report.json")}`);
  } catch (error) {
    exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    await writeJson(path.join(runDir, "failure.json"), {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      message,
      stack: error instanceof Error ? error.stack : undefined,
    }).catch(() => undefined);
    console.error(`FORMAL_RENDER_FAILED=${message}`);
  } finally {
    await renderer?.dispose().catch(() => undefined);
    if (lifecycle) finishFormalRenderer(exitCode, lifecycle);
    else process.exitCode = exitCode;
  }
}

export function resolveInstalledRemotionWorkerPath(resourcesRoot: string): string {
  return path.join(resourcesRoot, "app.asar.unpacked", "out", "main", "remotion-render-worker.cjs");
}

export function finishFormalRenderer(
  exitCode: number,
  lifecycle: Pick<ElectronMainModule["app"], "exit">,
): void {
  process.exitCode = exitCode;
  lifecycle.exit(exitCode);
}

async function buildSourceInventory(
  workspaceRoot: string,
  slots: readonly RemotionCurrentSlotV1[],
): Promise<FormalSlotSourceInventoryRow[]> {
  const rows: FormalSlotSourceInventoryRow[] = [];
  for (const slot of slots) {
    if (slot.target.kind !== "shot") throw new Error("source inventory accepts shot slots only");
    const outputPath = resolveRemotionCurrentSlotOutputPath(workspaceRoot, slot);
    const stat = await fs.promises.stat(outputPath);
    rows.push({
      shotId: slot.target.shotId,
      shotRevision: slot.target.shotRevision,
      path: outputPath,
      sizeBytes: stat.size,
      mtimeMs: Math.floor(stat.mtimeMs),
      sha256: await hashFileSha256(outputPath),
    });
  }
  return rows.sort((left, right) => left.shotId.localeCompare(right.shotId));
}

async function resolveAcceptedHyperFramesOutputPath(
  artifactOutputPath: string,
  revisionRoot: string,
): Promise<string> {
  const candidates = [
    path.resolve(artifactOutputPath),
    path.resolve(revisionRoot, path.basename(artifactOutputPath)),
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.promises.stat(candidate);
      if (stat.isFile() && stat.size > 0) return candidate;
    } catch {
      // Try the next bounded candidate; fail closed below if neither exists.
    }
  }
  throw new Error(`accepted HyperFrames output is missing: ${candidates.join(" or ")}`);
}

async function probeHyperFrames(filePath: string, ffprobeExecutable: string): Promise<unknown> {
  const { stdout } = await execFileAsync(ffprobeExecutable, [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,profile,pix_fmt,width,height",
    "-of", "json", filePath,
  ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  const parsed = JSON.parse(stdout || "{}") as {
    streams?: Array<{ codec_type?: string; codec_name?: string; profile?: string; pix_fmt?: string; width?: number; height?: number }>;
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  if (!video || video.codec_name !== "prores" || video.pix_fmt !== "yuva444p12le"
    || video.width !== 1920 || video.height !== 1080) {
    throw new Error("HyperFrames alpha probe mismatch");
  }
  return parsed;
}

async function collisionInventory(files: readonly string[]): Promise<Record<string, FormalFileIdentity>> {
  return Object.fromEntries(await Promise.all(
    files.map(async (filePath) => [filePath, await fileIdentity(filePath)] as const),
  ));
}

async function assertReadableRuntimePath(filePath: string, label: string): Promise<void> {
  const stat = await statFormalRuntimePath(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`${label} is missing or empty: ${filePath}`);
}

async function assertFileStable(filePath: string, before: Awaited<ReturnType<typeof fileIdentity>>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const after = await fileIdentity(filePath);
  if (before.sha256 !== after.sha256 || before.sizeBytes !== after.sizeBytes || before.mtimeMs !== after.mtimeMs) {
    throw new Error(`runtime file is changing concurrently: ${filePath}`);
  }
}

async function fileIdentity(filePath: string): Promise<FormalFileIdentity> {
  const stat = await statFormalRuntimePath(filePath);
  return {
    path: filePath,
    sizeBytes: stat.size,
    mtimeMs: Math.floor(stat.mtimeMs),
    sha256: filePath.endsWith(".asar")
      ? await hashFormalRawFileSha256(filePath)
      : await hashFileSha256(filePath),
  };
}

async function statFormalRuntimePath(filePath: string): Promise<Awaited<ReturnType<typeof fs.promises.stat>>> {
  if (!filePath.endsWith(".asar")) return fs.promises.stat(filePath);
  const previousNoAsar = process.noAsar;
  process.noAsar = true;
  try {
    return await fs.promises.stat(filePath);
  } finally {
    process.noAsar = previousNoAsar;
  }
}

export async function hashFormalRawFileSha256(filePath: string): Promise<string> {
  const shasum = process.env.MYSTUDIO_SHASUM_PATH?.trim() || "/usr/bin/shasum";
  const { stdout } = await execFileAsync(shasum, ["-a", "256", filePath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  const sha256 = /^([0-9a-f]{64})\s/i.exec(stdout)?.[1]?.toLowerCase();
  if (!sha256) throw new Error(`raw SHA-256 output is invalid for ${filePath}`);
  return sha256;
}

function checkedProjectRoot(projectId: string, projectRoot: string): string {
  if (projectId !== PROJECT_ID) throw new Error(`unexpected project id: ${projectId}`);
  return projectRoot;
}

function resolveInside(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("isolated project-file source escapes the formal workspace");
  }
  return resolved;
}

function readRemotionVersion(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.dependencies) || typeof value.dependencies.remotion !== "string"
    || !/^\d+\.\d+\.\d+$/.test(value.dependencies.remotion)) {
    throw new Error("package.json dependencies.remotion must be an exact semver");
  }
  return value.dependencies.remotion;
}

function formatIssues(label: string, issues: Array<{ path: string; message: string }>): string {
  return `${label} invalid: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.promises.readFile(filePath, "utf8")) as unknown;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

async function snapshotFile(sourcePath: string, targetPath: string): Promise<void> {
  await fs.promises.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (process.env.MYSTUDIO_FORMAL_RENDERER === "1") {
  void runAcceptedFormalRenderer();
}
