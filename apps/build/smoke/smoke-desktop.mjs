import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { PNG } from "pngjs";
import { terminateSpawnedApp } from "./smoke-process-lifecycle.mjs";
import {
  shouldFallbackToLaunchServices,
  spawnSmokeApp,
} from "./smoke-launch.mjs";
import {
  hasMYStudioForegroundViolation,
  sampleFrontmostApplication,
} from "./smoke-focus.mjs";

const appBinCandidates = [
  process.env.MYSTUDIO_SMOKE_APP_BIN,
  resolve(
    process.cwd(),
    "release",
    "build",
    "mac-arm64",
    "mac-arm64",
    "漫影工作室.app",
    "Contents",
    "MacOS",
    "漫影工作室",
  ),
  resolve(
    process.cwd(),
    "release",
    "build",
    "mac-arm64",
    "漫影工作室.app",
    "Contents",
    "MacOS",
    "漫影工作室",
  ),
].filter(Boolean);
const appBin =
  appBinCandidates.find((candidate) => existsSync(candidate)) ??
  appBinCandidates[0];
const debugPort = Number(process.env.MYSTUDIO_SMOKE_DEBUG_PORT || 9342);
const userDataDir =
  process.env.MYSTUDIO_SMOKE_USER_DATA_DIR ||
  mkdtempSync(resolve(tmpdir(), "mystudio-smoke-"));
const CDP_CALL_TIMEOUT_MS = Number(
  process.env.MYSTUDIO_SMOKE_CDP_TIMEOUT_MS || 10_000,
);
const ASSET_VOICE_FLOW_TIMEOUT_MS = Number(
  process.env.MYSTUDIO_SMOKE_ASSET_VOICE_TIMEOUT_MS || 35_000,
);
const WORKFLOW_E2E_TIMEOUT_MS = Number(
  process.env.MYSTUDIO_SMOKE_WORKFLOW_E2E_TIMEOUT_MS || 90_000,
);
const AUDIO_METADATA_TIMEOUT_MS = Number(
  process.env.MYSTUDIO_SMOKE_AUDIO_METADATA_TIMEOUT_MS || 10_000,
);
const runStepwiseWorkflowSmoke =
  process.env.MYSTUDIO_SMOKE_WORKFLOW_STEPWISE === "1";
const remotionExportSmokeMode =
  process.env.MYSTUDIO_SMOKE_REMOTION_EXPORT || "disabled";
const runRemotionExportSmoke =
  remotionExportSmokeMode === "1"
  || remotionExportSmokeMode === "blocked"
  || remotionExportSmokeMode === "cancel";
const remotionExportSmokeModes = ["disabled", "0", "1", "blocked", "cancel"];
if (!remotionExportSmokeModes.includes(remotionExportSmokeMode)) {
  throw new Error(
    `MYSTUDIO_SMOKE_REMOTION_EXPORT must be 0, 1, blocked, or cancel; received ${remotionExportSmokeMode}`,
  );
}
const REMOTION_EXPORT_TIMEOUT_MS = Number(
  process.env.MYSTUDIO_SMOKE_REMOTION_EXPORT_TIMEOUT_MS || 180_000,
);
const remotionPreparedVersionFixture =
  process.env.MYSTUDIO_SMOKE_REMOTION_PREPARED_VERSION;
const skipPrekill = process.env.MYSTUDIO_SMOKE_SKIP_PREKILL === "1";
const foregroundSmoke = process.env.MYSTUDIO_SMOKE_FOREGROUND === "1";
const smokeMode = foregroundSmoke ? "visible" : "background";
const keepSmokeAppOpen = process.env.MYSTUDIO_SMOKE_KEEP_OPEN === "1";
const allowForeground = process.env.MYSTUDIO_SMOKE_ALLOW_FOREGROUND === "1";
const smokeLaunchMode = process.env.MYSTUDIO_SMOKE_LAUNCH_MODE || "auto";
if (!["auto", "direct", "launch-services"].includes(smokeLaunchMode)) {
  throw new Error(
    `MYSTUDIO_SMOKE_LAUNCH_MODE must be auto, direct, or launch-services; received ${smokeLaunchMode}`,
  );
}
const parsedForegroundHoldMs = Number(
  process.env.MYSTUDIO_SMOKE_HOLD_MS || (foregroundSmoke ? 5_000 : 0),
);
const foregroundHoldMs = Number.isFinite(parsedForegroundHoldMs)
  ? Math.max(0, parsedForegroundHoldMs)
  : 0;
const parsedStepDelayMs = Number(process.env.MYSTUDIO_SMOKE_STEP_DELAY_MS || 0);
const stepDelayMs = Number.isFinite(parsedStepDelayMs)
  ? Math.max(0, parsedStepDelayMs)
  : 0;
const CORE_ROUTE_CHECKS = [
  {
    label: "工作流",
    requiredText: [
      "当前工作区：漫影工作流",
      "待推进：",
    ],
    forbiddenText: ["制作流程推进", "导演造景", "导演规划与造景", "造景后继续"],
  },
  {
    label: "资产",
    requiredText: ["个人资产库", "默认风格"],
  },
  {
    label: "辅助",
    requiredText: ["辅助界面", "TTS"],
    waitMs: 2_500,
  },
  {
    label: "产物",
    requiredText: ["工作流产物", "媒体库", "本地文件", "删除当前章节"],
  },
  {
    label: "设置",
    requiredText: ["系统设置", "外观", "本地配置"],
  },
  {
    label: "自媒体",
    requiredText: ["自媒体发布台", "账号", "发布", "任务", "历史"],
    forbiddenText: ["AiToEarn Web", "OpenClaw"],
  },
];
// Keep each smoke run's fixture private. The packaged Remotion preview uses
// the same asset bridge as export, so a concurrent smoke must not be able to
// delete another run's source while its session is still serving it.
const REMOTION_SMOKE_PROJECT_ID = "desktop-remotion-smoke-project";
const REMOTION_SMOKE_CHAPTER_ID = "desktop-remotion-smoke-chapter";
const REMOTION_SMOKE_SHOT_ID = "desktop-remotion-smoke-shot";
const REMOTION_SMOKE_MEDIA_RELATIVE_PATH = "media/mystudio-smoke-final.mp4";
const SMOKE_PROJECT_DATA_ROOT = resolve(userDataDir, "projects");
const SMOKE_VIDEO_PATH = resolve(
  SMOKE_PROJECT_DATA_ROOT,
  "_p",
  REMOTION_SMOKE_PROJECT_ID,
  REMOTION_SMOKE_MEDIA_RELATIVE_PATH,
);
const SMOKE_VIDEO_WIDTH = 320;
const SMOKE_VIDEO_HEIGHT = 180;
const SMOKE_VIDEO_FPS = 30;
const SMOKE_VIDEO_DURATION_US = 1_000_000;
const smokeReportPath =
  process.env.MYSTUDIO_SMOKE_REPORT_PATH ||
  resolve(process.cwd(), "output", "automation", "desktop-smoke-report.json");
let smokeChildExit = null;
let tracksSmokeChildExit = true;

function watchSmokeChild(childProcess, { trackExit = true } = {}) {
  smokeChildExit = null;
  tracksSmokeChildExit = trackExit;
  if (trackExit) {
    childProcess.once("close", (code, signal) => {
      smokeChildExit = { code, signal };
    });
    childProcess.once("error", (error) => {
      smokeChildExit = { error: error instanceof Error ? error.message : String(error) };
    });
  }
}

if (!existsSync(appBin)) {
  console.error(
    `Packaged app was not found. Checked:\n${appBinCandidates.join("\n")}`,
  );
  process.exit(1);
}

function runOptional(command, args) {
  spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: "ignore",
  });
}

function stopExistingMYStudioInstances() {
  if (skipPrekill) {
    console.log("[smoke] skipping pre-run MYStudio instance cleanup");
    return;
  }
  if (process.platform === "darwin") {
    runOptional("osascript", [
      "-e",
      'tell application id "com.manju2026.manying-studio" to quit',
    ]);
  }
  for (const processName of [
    "漫影工作室",
    "漫影工作室 Helper",
    "manying-studio",
  ]) {
    runOptional("pkill", ["-x", processName]);
  }
  runOptional("pkill", ["-f", "漫影工作室.app/Contents"]);
  console.log("[smoke] closed existing MYStudio instances before smoke run");
}

function prepareSmokeMedia() {
  mkdirSync(dirname(SMOKE_VIDEO_PATH), { recursive: true });
  rmSync(SMOKE_VIDEO_PATH, { force: true });
  const result = spawnSync(
    "ffmpeg",
    [
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=${SMOKE_VIDEO_WIDTH}x${SMOKE_VIDEO_HEIGHT}:d=${SMOKE_VIDEO_DURATION_US / 1_000_000}`,
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      SMOKE_VIDEO_PATH,
    ],
    { stdio: "ignore" },
  );
  if (result.status !== 0 || !existsSync(SMOKE_VIDEO_PATH)) {
    console.warn(
      "[smoke] failed to create smoke mp4 fixture; video preview check may fall back to DOM state",
    );
  }
}

function canonicalJson(value) {
  const normalize = (current) => {
    if (Array.isArray(current)) return current.map(normalize);
    if (current && typeof current === "object") {
      return Object.fromEntries(
        Object.keys(current).sort().map((key) => [key, normalize(current[key])]),
      );
    }
    return current;
  };
  return JSON.stringify(normalize(value));
}

function sha256CanonicalJson(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function buildRemotionSmokeShotPlan(durationUs = SMOKE_VIDEO_DURATION_US) {
  const sourceFingerprint = createHash("sha256")
    .update(readFileSync(SMOKE_VIDEO_PATH))
    .digest("hex");
  const renderSettings = {
    width: SMOKE_VIDEO_WIDTH,
    height: SMOKE_VIDEO_HEIGHT,
    fps: SMOKE_VIDEO_FPS,
    codec: "h264",
    subtitleMode: "none",
    loudnessLufs: -14,
    truePeakDbtp: -1.5,
    audioDucking: {
      reductionDb: -12,
      attackUs: 120_000,
      releaseUs: 400_000,
    },
  };
  const visualSource = {
    kind: "project-file",
    projectId: REMOTION_SMOKE_PROJECT_ID,
    relativePath: REMOTION_SMOKE_MEDIA_RELATIVE_PATH,
    contentSha256: sourceFingerprint,
    provenance: {
      sourceKind: "generated",
      sourceId: "desktop-remotion-smoke-media",
      sourceVersion: "1",
    },
  };
  const shot = {
    shotId: REMOTION_SMOKE_SHOT_ID,
    storyboardId: "desktop-remotion-smoke-storyboard",
    index: 0,
    revision: 1,
    sourceFingerprint,
    durationUs,
    visualSource,
    audioBindings: [],
    motion: { kind: "static" },
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
    },
  };
  const hashInput = {
    schemaVersion: 1,
    target: "shot",
    projectId: REMOTION_SMOKE_PROJECT_ID,
    chapterId: REMOTION_SMOKE_CHAPTER_ID,
    renderSettings,
    visualKind: "video",
    shot,
    sharedAudioTracks: [],
  };
  return {
    schemaVersion: 1,
    target: "shot",
    projectId: REMOTION_SMOKE_PROJECT_ID,
    chapterId: REMOTION_SMOKE_CHAPTER_ID,
    chapterRevision: 1,
    sourceSnapshotHash: sha256CanonicalJson({
      projectId: REMOTION_SMOKE_PROJECT_ID,
      chapterId: REMOTION_SMOKE_CHAPTER_ID,
      shotId: REMOTION_SMOKE_SHOT_ID,
      sourceFingerprint,
    }),
    renderSettings,
    visualKind: "video",
    shot,
    sharedAudioTracks: [],
    inputHash: sha256CanonicalJson(hashInput),
  };
}

function inspectRemotionExportArtifact(remotionExport) {
  if (!runRemotionExportSmoke) return { enabled: false, ok: true, issues: [] };
  const issues = [];
  try {
    if (remotionExportSmokeMode === "blocked") {
      if (!remotionExport?.success
        || remotionExport?.render?.success !== false
        || remotionExport?.noDownloadObserved !== true) {
        issues.push(remotionExport?.error || "Remotion export was not blocked without a download");
      }
      return {
        enabled: true,
        blocked: true,
        ok: issues.length === 0,
        issues,
        realMediaGeneration: false,
        browserState: remotionExport?.browserStatus?.state,
        error: remotionExport?.render?.error,
      };
    }
    if (remotionExportSmokeMode === "cancel") {
      const queueRoot = resolve(SMOKE_PROJECT_DATA_ROOT, "_remotion", "queue");
      const queueStatePath = resolve(queueRoot, "queue-state.json");
      const queueEventsPath = resolve(queueRoot, "queue-events.jsonl");
      const artifactPaths = [queueStatePath, queueEventsPath];
      const cancellationArtifactsPresent = artifactPaths.every((artifactPath) => existsSync(artifactPath));
      const currentOutputPath = resolve(
        SMOKE_PROJECT_DATA_ROOT,
        "_p",
        REMOTION_SMOKE_PROJECT_ID,
        "remotion",
        "outputs",
        "shots",
        REMOTION_SMOKE_CHAPTER_ID,
        REMOTION_SMOKE_SHOT_ID,
        "current.mp4",
      );
      const currentAfter = existsSync(currentOutputPath)
        ? createHash("sha256").update(readFileSync(currentOutputPath)).digest("hex")
        : null;
      const currentSlotPreserved = remotionExport?.currentBefore
        ? currentAfter === remotionExport.currentBefore.sha256
        : currentAfter === null;
      if (!remotionExport?.success
        || remotionExport?.cancel?.success !== true
        || remotionExport?.cancel?.canceled !== true
        || remotionExport?.render?.success !== false
        || remotionExport?.render?.canceled !== true
        || remotionExport?.render?.job?.status !== "canceled"
        || !cancellationArtifactsPresent
        || !currentSlotPreserved) {
        issues.push(remotionExport?.error || "Remotion queue cancellation evidence was incomplete");
      }
      return {
        enabled: true,
        canceled: true,
        ok: issues.length === 0,
        issues,
        realMediaGeneration: false,
        cancellationArtifactsPresent,
        currentSlotPreserved,
        artifactPaths,
      };
    }
    if (!remotionExport?.success || !remotionExport.render?.success) {
      issues.push(remotionExport?.error || remotionExport?.render?.error || "Remotion export did not succeed");
      return { enabled: true, ok: false, issues };
    }

    const job = remotionExport.render.job;
    const workspaceRoot = resolve(
      SMOKE_PROJECT_DATA_ROOT,
      "_p",
      REMOTION_SMOKE_PROJECT_ID,
      "remotion",
    );
    const expectedJobRelativePath = `jobs/shot/${REMOTION_SMOKE_CHAPTER_ID}/${REMOTION_SMOKE_SHOT_ID}/current.json`;
    const expectedEvidenceRelativePath = `evidence/shots/${REMOTION_SMOKE_CHAPTER_ID}/${REMOTION_SMOKE_SHOT_ID}/current.json`;
    const expectedOutputRelativePath = `outputs/shots/${REMOTION_SMOKE_CHAPTER_ID}/${REMOTION_SMOKE_SHOT_ID}/current.mp4`;
    if (job?.evidencePath !== expectedEvidenceRelativePath
      || job?.outputPath !== expectedOutputRelativePath) {
      issues.push("Remotion queue job does not point to the canonical shot current slot");
      return { enabled: true, ok: false, issues };
    }
    const evidencePath = resolve(workspaceRoot, expectedEvidenceRelativePath);
    const jobPath = resolve(workspaceRoot, expectedJobRelativePath);
    if (!evidencePath || !existsSync(evidencePath) || !existsSync(jobPath)) {
      issues.push(`Remotion current job/evidence is missing: ${jobPath}, ${evidencePath || "missing"}`);
      return { enabled: true, ok: false, issues };
    }
    const persistedJob = JSON.parse(readFileSync(jobPath, "utf8"));
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    const identityKeys = [
      "jobId",
      "projectId",
      "inputHash",
      "bundleContentHash",
      "renderSettingsHash",
      "templateVersion",
      "remotionVersion",
      "attempt",
    ];
    for (const key of identityKeys) {
      if (persistedJob?.[key] !== job?.[key] || evidence?.[key] !== job?.[key]) {
        issues.push(`Remotion job/evidence identity mismatch: ${key}`);
      }
    }
    if (JSON.stringify(persistedJob?.target) !== JSON.stringify(job?.target)
      || JSON.stringify(evidence?.target) !== JSON.stringify(job?.target)) {
      issues.push("Remotion job/evidence target identity mismatch");
    }
    if (persistedJob?.status !== "succeeded" || job?.status !== "succeeded") {
      issues.push("Remotion current job is not succeeded");
    }
    const renderer = evidence?.renderer;
    if (renderer?.requested !== "remotion" || renderer?.actual !== "remotion") {
      issues.push(`renderer evidence mismatch: ${renderer?.requested || "missing"}/${renderer?.actual || "missing"}`);
    }
    if (evidence?.remotionVersion !== remotionExport.browserStatus?.remotionVersion) {
      issues.push("renderer version does not match the prepared browser status");
    }
    if (!/^[a-f0-9]{64}$/.test(evidence?.bundleContentHash || "")) {
      issues.push("bundleContentHash is not a SHA-256 content hash");
    }
    if (evidence?.compositionId !== "StoryboardShot") {
      issues.push(`compositionId is ${evidence?.compositionId || "missing"}, expected StoryboardShot`);
    }
    if (Object.prototype.hasOwnProperty.call(evidence, "audioPostProcess")) {
      issues.push("shot evidence must not contain external audio post-processing");
    }

    if (evidence?.outputPath !== expectedOutputRelativePath) {
      issues.push("Remotion evidence does not point to the canonical shot current output");
      return { enabled: true, ok: false, issues };
    }
    const outputPath = resolve(workspaceRoot, expectedOutputRelativePath);
    if (!outputPath || !existsSync(outputPath)) {
      issues.push(`rendered output is missing: ${outputPath || "missing"}`);
      return { enabled: true, ok: false, issues };
    }
    const outputStat = statSync(outputPath);
    const sha256 = createHash("sha256").update(readFileSync(outputPath)).digest("hex");
    if (evidence.sizeBytes !== outputStat.size) issues.push("output size does not match render evidence");
    if (evidence.mtimeMs !== Math.floor(outputStat.mtimeMs)) issues.push("output mtime does not match render evidence");
    if (evidence.sha256 !== sha256) issues.push("output SHA-256 does not match render evidence");

    const artifactPaths = [jobPath, evidencePath, outputPath];
    const missingArtifactPaths = artifactPaths.filter(
      (artifactPath) => typeof artifactPath !== "string" || !existsSync(artifactPath),
    );
    if (missingArtifactPaths.length > 0) {
      issues.push(`render artifacts are missing: ${missingArtifactPaths.join(", ")}`);
    }

    const probeResult = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height",
        "-of",
        "json",
        outputPath,
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    if (probeResult.status !== 0) {
      issues.push(`ffprobe failed: ${(probeResult.stderr || "").trim() || `exit ${probeResult.status}`}`);
      return { enabled: true, ok: false, issues, path: outputPath, sha256 };
    }
    const probe = JSON.parse(probeResult.stdout);
    const video = probe.streams?.find((stream) => stream.codec_type === "video");
    const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
    const duration = Number(probe.format?.duration);
    if (video?.codec_name !== "h264") issues.push(`video codec is ${video?.codec_name || "missing"}, expected h264`);
    if (audio?.codec_name !== "aac") issues.push(`audio codec is ${audio?.codec_name || "missing"}, expected aac`);
    if (video?.width !== SMOKE_VIDEO_WIDTH || video?.height !== SMOKE_VIDEO_HEIGHT) {
      issues.push(`video dimensions are ${video?.width || 0}x${video?.height || 0}`);
    }
    if (!Number.isFinite(duration)
      || Math.abs(duration - SMOKE_VIDEO_DURATION_US / 1_000_000) > 1 / SMOKE_VIDEO_FPS) {
      issues.push(`video duration is outside one frame: ${duration}`);
    }
    const evidenceDuration = Number(evidence.durationUs) / 1_000_000;
    if (!Number.isFinite(evidenceDuration)
      || !Number.isFinite(duration)
      || Math.abs(evidenceDuration - duration) > 1 / SMOKE_VIDEO_FPS) {
      issues.push(`render evidence duration does not match ffprobe: ${evidenceDuration}/${duration}`);
    }
    if (evidence.width !== SMOKE_VIDEO_WIDTH || evidence.height !== SMOKE_VIDEO_HEIGHT) {
      issues.push(`render evidence dimensions are ${evidence.width || 0}x${evidence.height || 0}`);
    }
    const evidenceVideoStreams = (evidence.streams || []).filter((stream) => stream.kind === "video");
    const evidenceAudioStreams = (evidence.streams || []).filter((stream) => stream.kind === "audio");
    const evidenceStreamKinds = (evidence.streams || []).map((stream) => stream.kind);
    if (evidenceVideoStreams.length !== 1
      || evidenceAudioStreams.length !== 1
      || evidenceVideoStreams[0]?.codec !== "h264"
      || evidenceVideoStreams[0]?.width !== SMOKE_VIDEO_WIDTH
      || evidenceVideoStreams[0]?.height !== SMOKE_VIDEO_HEIGHT
      || evidenceAudioStreams[0]?.codec !== "aac") {
      issues.push(`render evidence streams are incomplete: ${evidenceStreamKinds.join(",")}`);
    }

    return {
      enabled: true,
      ok: issues.length === 0,
      issues,
      path: outputPath,
      sizeBytes: outputStat.size,
      sha256,
      duration,
      width: video?.width,
      height: video?.height,
      videoCodec: video?.codec_name,
      audioCodec: audio?.codec_name,
      artifactPaths,
    };
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    return { enabled: true, ok: false, issues };
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function prepareRemotionBrowserStateFixture() {
  if (!remotionPreparedVersionFixture) return;
  const runtimeDir = resolve(userDataDir, "remotion-runtime");
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    resolve(runtimeDir, "browser-state.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      preparedForRemotionVersion: remotionPreparedVersionFixture,
    }, null, 2)}\n`,
    "utf8",
  );
}

function writeSmokeReport(report) {
  mkdirSync(dirname(smokeReportPath), { recursive: true });
  writeFileSync(
    smokeReportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        command: [
          runStepwiseWorkflowSmoke ? "MYSTUDIO_SMOKE_WORKFLOW_STEPWISE=1" : null,
          runRemotionExportSmoke
            ? `MYSTUDIO_SMOKE_REMOTION_EXPORT=${remotionExportSmokeMode}`
            : null,
          "npm run smoke:desktop",
        ].filter(Boolean).join(" "),
        reportPath: smokeReportPath,
        appBin,
        userDataDir,
        debugPort,
        mode: smokeMode,
        launchMode: smokeLaunchMode,
        runStepwiseWorkflowSmoke,
        remotionExportSmokeMode,
        ...report,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`[smoke] report written: ${smokeReportPath}`);
}

function bringSmokeAppToForeground(childProcess, launchMode = "direct") {
  if (!foregroundSmoke) return;
  if (process.platform !== "darwin") {
    console.warn("[smoke] foreground mode is only implemented for macOS");
    return;
  }
  if (launchMode === "launch-services") {
    const result = spawnSync(
      "osascript",
      ["-e", 'tell application id "com.manju2026.manying-studio" to activate'],
      { stdio: "ignore" },
    );
    if (result.status !== 0) {
      console.warn(
        "[smoke] failed to activate the LaunchServices app; macOS may require Automation permission",
      );
    }
    return;
  }
  if (!childProcess.pid) {
    console.warn("[smoke] cannot foreground app because child pid is missing");
    return;
  }

  const script = `tell application "System Events" to set frontmost of first process whose unix id is ${childProcess.pid} to true`;
  const result = spawnSync("osascript", ["-e", script], { stdio: "ignore" });
  if (result.status !== 0) {
    console.warn(
      "[smoke] failed to bring app to foreground; macOS may require Automation or Accessibility permission",
    );
  }
}

async function holdForegroundSmokeWindow() {
  if (!foregroundSmoke || foregroundHoldMs <= 0) return;
  console.log(`[smoke] foreground smoke hold ${foregroundHoldMs}ms`);
  await sleep(foregroundHoldMs);
}

function readJson(url) {
  return new Promise((resolveJson, reject) => {
    const req = http.get(url, (response) => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => {
        try {
          resolveJson(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
  });
}

async function waitForPageTarget() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const targets = await readJson(`http://127.0.0.1:${debugPort}/json/list`);
      const page = Array.isArray(targets)
        ? targets.find((target) => target.type === "page")
        : null;
      if (page?.webSocketDebuggerUrl) {
        return page;
      }
    } catch {
      // The debugging server opens after Electron has started.
    }
    if (tracksSmokeChildExit && smokeChildExit) {
      const detail = smokeChildExit.error
        ? `error=${smokeChildExit.error}`
        : `code=${smokeChildExit.code ?? "null"}, signal=${smokeChildExit.signal ?? "none"}`;
      throw new Error(`Smoke app exited before exposing a page target (${detail}).`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("No Electron page target appeared on the debugging port.");
}

function connectWebSocket(url) {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolveSocket(socket));
    socket.addEventListener("error", reject);
  });
}

function withTimeout(promise, label, timeoutMs = CDP_CALL_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function summarizePageError(error) {
  if (error?.method === "Runtime.consoleAPICalled") {
    const args = error.params?.args || [];
    return {
      method: error.method,
      type: error.params?.type,
      text: args
        .map(
          (arg) =>
            arg.value || arg.description || arg.unserializableValue || "",
        )
        .filter(Boolean)
        .join(" "),
    };
  }
  if (error?.method === "Runtime.exceptionThrown") {
    return {
      method: error.method,
      text: error.params?.exceptionDetails?.text || "",
      exception: error.params?.exceptionDetails?.exception?.description || "",
    };
  }
  if (error?.method === "Log.entryAdded") {
    return {
      method: error.method,
      level: error.params?.entry?.level,
      text: error.params?.entry?.text || "",
      source: error.params?.entry?.source || "",
      url: error.params?.entry?.url || "",
    };
  }
  if (error?.method === "Network.loadingFailed") {
    return {
      method: error.method,
      text: error.params?.errorText || "",
      url: error.params?.url || "",
      type: error.params?.type || "",
    };
  }
  return error;
}

function isAllowedOfflinePreviewResourceError(message) {
  if (message?.method !== "Log.entryAdded") return false;
  const entry = message.params?.entry;
  if (entry?.level !== "error") return false;
  const url = entry?.url || "";
  const text = entry?.text || "";
  if (url.startsWith("https://fonts.googleapis.com/css2")) {
    return (
      text.includes("Failed to load resource") &&
      url.includes("family=Cormorant+Garamond") &&
      url.includes("family=JetBrains+Mono") &&
      url.includes("family=Noto+Serif+SC")
    );
  }
  if (!url.startsWith("https://unpkg.com/")) return false;
  if (!text.includes("Failed to load resource")) return false;
  return (
    url.includes("/@highlightjs/cdn-assets@") ||
    url.includes("/katex@") ||
    url.includes("/mermaid@")
  );
}

async function inspectPage(pageTarget) {
  const socket = await connectWebSocket(pageTarget.webSocketDebuggerUrl);
  let messageId = 0;
  const pending = new Map();
  const errors = [];
  const allowedErrors = [];
  const networkRequests = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        callback.reject(new Error(JSON.stringify(message.error)));
      } else {
        callback.resolve(message.result);
      }
      return;
    }

    if (message.method === "Runtime.exceptionThrown") {
      errors.push(message);
      return;
    }
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params?.type === "error"
    ) {
      errors.push(message);
      return;
    }
    if (
      message.method === "Log.entryAdded" &&
      message.params?.entry?.level === "error"
    ) {
      if (isAllowedOfflinePreviewResourceError(message)) {
        allowedErrors.push(message);
        return;
      }
      errors.push(message);
      return;
    }
    if (message.method === "Network.requestWillBeSent") {
      networkRequests.set(
        message.params?.requestId,
        message.params?.request?.url || "",
      );
      return;
    }
    if (message.method === "Network.loadingFailed") {
      const text = message.params?.errorText || "";
      if (text.includes("ERR_FILE_NOT_FOUND")) {
        errors.push({
          method: "Network.loadingFailed",
          params: {
            ...message.params,
            url: networkRequests.get(message.params?.requestId) || "",
          },
        });
      }
    }
  });

  const send = (method, params = {}, timeoutMs = CDP_CALL_TIMEOUT_MS) => {
    const request = new Promise((resolveResult, reject) => {
      const id = ++messageId;
      pending.set(id, { resolve: resolveResult, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    return withTimeout(request, method, timeoutMs).catch((error) => {
      for (const [id, callback] of pending.entries()) {
        callback.reject(
          new Error(
            `Cancelled pending CDP request ${id} after ${method} failed`,
          ),
        );
        pending.delete(id);
      }
      throw error;
    });
  };

  try {
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Network.enable");
    await send("Page.enable");
    if (foregroundSmoke) await send("Page.bringToFront");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 4_000));

    const evaluate = async (
      expression,
      label = "Runtime.evaluate",
      timeoutMs = CDP_CALL_TIMEOUT_MS,
    ) => {
      const evaluated = await withTimeout(
        send(
          "Runtime.evaluate",
          {
            awaitPromise: true,
            returnByValue: true,
            expression,
          },
          timeoutMs,
        ),
        label,
        timeoutMs,
      );
      if (evaluated?.exceptionDetails) {
        const exception = evaluated.exceptionDetails;
        const description = exception.exception?.description
          || exception.exception?.value
          || exception.text
          || `${label} failed`;
        throw new Error(String(description));
      }
      return evaluated.result.value;
    };

    const smokeEnvironment = await evaluate(
      `(() => {
        const smoke = window.mystudioSmoke;
        const userDataDir = smoke?.userDataDir || '';
        return {
          exposed: Boolean(smoke),
          enabled: smoke?.enabled ?? null,
          userDataDir,
          isolatedUserDataDir: /(?:^|[/\\\\])mystudio-(?:(?:installed-)?smoke|project-workflow-run)-[^/\\\\]+$/.test(userDataDir),
        };
      })()`,
      "smoke bridge environment check",
    );

    console.log("[smoke] checking dashboard/project entry");
    const state = await evaluate(
      `(() => {
    const root = document.getElementById('root');
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const dashboardCard = document.querySelector('.dashboard-project-card');
    dashboardCard?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return new Promise((resolve) => setTimeout(() => resolve({
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      bodyBg,
      bodyText: document.body.innerText,
      bodyTextLength: document.body.innerText.trim().length,
      rootChildren: root ? root.children.length : -1,
      hasDashboardCard: Boolean(dashboardCard),
      hasProjectOverview: document.body.innerText.includes('项目概览'),
      hasWorkspaceContent:
        document.body.innerText.includes('当前工作区') ||
        document.body.innerText.includes('剧情产物生成') ||
        document.body.innerText.includes('风格与导演选择'),
      hasWhiteBody: bodyBg === 'rgb(255, 255, 255)' || bodyBg === 'white',
      visibilityState: document.visibilityState,
      documentHasFocus: document.hasFocus(),
    }), 1500));
  })()`,
      "initial project entry check",
    );

    console.log("[smoke] checking overview workflow steps");
    const overviewWorkflow = await verifyOverviewWorkflow(evaluate);

    const routeChecks = [];
    for (const route of CORE_ROUTE_CHECKS) {
      console.log(`[smoke] checking route: ${route.label}`);
      routeChecks.push(await verifyRoute(evaluate, route));
    }

    console.log("[smoke] checking workflow stages");
    const workflowStages = await verifyWorkflowStages(evaluate);

    console.log("[smoke] checking end-to-end workflow data");
    const workflowEndToEnd = await verifyWorkflowEndToEnd(evaluate);

    const workflowStepwise = runStepwiseWorkflowSmoke
      ? await verifyWorkflowStepByStepExecution(evaluate)
      : null;

    console.log("[smoke] checking asset voice flow");
    const assetVoiceFlow = await verifyAssetVoiceFlow(evaluate);

    console.log("[smoke] checking script asset generation voice flow");
    const scriptAssetGenerationVoiceFlow =
      await verifyScriptAssetGenerationVoiceFlow(evaluate);

    console.log("[smoke] checking plugin settings");
    const pluginSettings = await verifyPluginSettings(evaluate);

    const remotionExport = runRemotionExportSmoke
      ? await verifyRemotionExport(evaluate)
      : { enabled: false, success: false };

    const domVisualStats = await captureDomVisualStats(evaluate);
    console.log("[smoke] capturing screenshot");
    const screenshot = await captureVisualStats(send, domVisualStats);
    return {
      state,
      smokeEnvironment,
      errors,
      allowedErrors,
      overviewWorkflow,
      routeChecks,
      workflowStages,
      workflowEndToEnd,
      workflowStepwise,
      assetVoiceFlow,
      scriptAssetGenerationVoiceFlow,
      pluginSettings,
      remotionExport,
      screenshot,
    };
  } finally {
    for (const [, callback] of pending.entries()) {
      callback.reject(new Error("CDP socket closed during smoke cleanup"));
    }
    pending.clear();
    socket.close();
  }
}

async function verifyRoute(evaluate, route) {
  const label = JSON.stringify(route.label);
  const requiredText = JSON.stringify(route.requiredText);
  const forbiddenText = JSON.stringify(route.forbiddenText || []);
  const waitMs = Number(route.waitMs || 1_500);
  return evaluate(
    `(() => {
    const routeLabel = ${label};
    const requiredText = ${requiredText};
    const forbiddenText = ${forbiddenText};
    const navButtons = Array.from(document.querySelectorAll('.studio-nav-button'))
      .filter((node) => node.tagName === 'BUTTON');
    const routeButton = navButtons.find((node) => {
      const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
      return text === routeLabel || text.includes(routeLabel);
    });

    if (!routeButton) {
      return {
        label: routeLabel,
        clicked: false,
        hasRequiredText: false,
        missingRequiredText: requiredText,
        forbiddenTextFound: [],
        activeNavText: '',
        availableNavText: navButtons.map((node) => (node.textContent || '').replace(/\\s+/g, ' ').trim()),
        bodyTextSample: document.body.innerText.slice(0, 800),
      };
    }

    routeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return new Promise((resolve) => setTimeout(() => {
      const bodyText = document.body.innerText;
      const missingRequiredText = requiredText.filter((text) => !bodyText.includes(text));
      const forbiddenTextFound = forbiddenText.filter((text) => bodyText.includes(text));
      resolve({
        label: routeLabel,
        clicked: true,
        hasRequiredText: missingRequiredText.length === 0,
        missingRequiredText,
        forbiddenTextFound,
        activeNavText: document.querySelector('.studio-nav-button.is-active')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        bodyTextLength: bodyText.trim().length,
        bodyTextSample: bodyText.slice(0, 800),
      });
    }, ${waitMs}));
  })()`,
    `route check: ${route.label}`,
  );
}

async function verifyOverviewWorkflow(evaluate) {
  return evaluate(
    `(() => {
    const navButtons = Array.from(document.querySelectorAll('.studio-nav-button'))
      .filter((node) => node.tagName === 'BUTTON');
    const overviewButton = navButtons.find((node) => {
      const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
      return text === '概览' || text.includes('概览');
    });
    overviewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return new Promise((resolve) => setTimeout(() => {
      const bodyText = document.body.innerText;
      resolve({
        clickedOverview: Boolean(overviewButton),
        hasProjectEntry: bodyText.includes('开始制作'),
        hasWorkflowEntry: bodyText.includes('进入工作流'),
        hasAssetEntry: bodyText.includes('查看资产库'),
        forbiddenTextFound: ['漫影工作室标准工作流', 'STAGE 01', '小说导入后按章节逐章制作', '单章输入、单章产物、单章成片']
          .filter((text) => bodyText.includes(text)),
        bodyTextSample: bodyText.slice(0, 1200),
      });
    }, 1000));
  })()`,
    "overview workflow check",
  );
}

async function verifyWorkflowStages(evaluate) {
  return evaluate(
    `(async () => {
    const normalize = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const activate = (node) => {
      if (!node) return false;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, view: window }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const navButtons = Array.from(document.querySelectorAll('.studio-nav-button')).filter((node) => node.tagName === 'BUTTON');
    const workflowButton = navButtons.find((node) => normalize(node).includes('工作流'));
    const clickedWorkflow = activate(workflowButton);
    await wait(800);
	    const hasTopNodeCanvas = Boolean(document.querySelector('.studio-workspace-workflow > .workflow-node-canvas'));

	    const stages = [
	      { id: 'manuals', label: '风格与导演', requiredText: ['视觉手册', '导演手册'] },
      { id: 'novel', label: '小说导入', requiredText: ['导入原文'] },
		      { id: 'script', label: '剧本生产阶段', requiredText: ['请先在「小说导入」导入章节', '逐章生成剧本'] },
		      { id: 'assets', label: '剧本资产管理', requiredText: ['资产提取', '还没有剧本', '承接本阶段已提取的角色、场景、道具', '参考音频'], forbiddenText: ['运行导演计划', '锁定剧集圣经', '角色库', '全部润色角色提示词', '全部润色提示词', '生成图片 ('] },
      {
        id: 'storyboard',
        label: '分镜视频生成',
        requiredText: ['自动排版'],
        forbiddenText: ['分镜表与分镜视频生成', '运行 AI 分镜计划', '添加分镜', '生成配音', '试听配音', '进入待处理阶段'],
      },
      {
        id: 'workbench',
        label: '视频工作台',
        requiredText: ['原生 Remotion Studio'],
        forbiddenText: ['一键成片', '旧拼接导出', 'ffmpeg-local', 'track-candidate'],
      },
    ];

    const results = [];
    for (const stage of stages) {
      const clicked = await window.mystudioWorkflowSmoke?.setWorkflowStage?.(stage.id);
	      await wait(450);
	      const bodyText = document.body.innerText;
	      const missingRequiredText = stage.requiredText.filter((text) => !bodyText.includes(text));
	      const presentForbiddenText = (stage.forbiddenText || []).filter((text) => bodyText.includes(text));
	      const stageRoot = document.querySelector('[data-state="active"]');
	      const flowCanvas = stageRoot?.querySelector('.workflow-node-canvas');
	      const reactFlowCanvas = stageRoot?.querySelector('.react-flow');
	      const generationCanvas = document.querySelector('.production-agent-workspace .workflow-node-canvas');
	      const hasNodeCanvas = Boolean(flowCanvas && reactFlowCanvas);
	      const connectorCount = flowCanvas ? flowCanvas.querySelectorAll('.react-flow__edge').length : 0;
	      const productionNodes = flowCanvas
	        ? Array.from(flowCanvas.querySelectorAll('[data-flow-node-id]')).map((node) => node.getAttribute('data-flow-node-id'))
	        : [];
	      const productionEdges = flowCanvas
	        ? Array.from(flowCanvas.querySelectorAll('.react-flow__edge')).map((node) => node.getAttribute('data-id') || node.id)
	        : [];
	      results.push({
	        label: stage.label,
	        id: stage.id,
	        clicked: Boolean(clicked),
	        hasRequiredText: missingRequiredText.length === 0,
	        missingRequiredText,
	        hasForbiddenText: presentForbiddenText.length > 0,
	        presentForbiddenText,
	        hasNodeCanvas,
	        hasGenerationNodeCanvas: Boolean(generationCanvas),
	        connectorCount,
	        productionNodes,
	        productionEdges,
	        bodyTextSample: bodyText.slice(0, 800),
	      });
    }

    return {
      clickedWorkflow,
      hasTopNodeCanvas,
      stages: results,
    };
  })()`,
    "workflow stages check",
    12_000,
  );
}

async function verifyPluginSettings(evaluate) {
  return evaluate(
    `(() => {
    const normalize = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const activate = (node) => {
      if (!node) return false;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, view: window }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    };
    const navButtons = Array.from(document.querySelectorAll('.studio-nav-button'))
      .filter((node) => node.tagName === 'BUTTON');
    const settingsButton = navButtons.find((node) => normalize(node).includes('设置'));
    activate(settingsButton);

    return new Promise((resolve) => setTimeout(() => {
      const tabButtons = Array.from(document.querySelectorAll('button'));
      const pluginTab = tabButtons.find((node) => normalize(node) === '本地配置' || normalize(node).includes('本地配置'));
      activate(pluginTab);

      setTimeout(() => {
        const bodyText = document.body.innerText;
        // 本地配置区块默认全折叠(08-18 起),只断言折叠头可见的标题与描述;
        // 区块内按钮(如「开始配置」)默认不在 DOM,不能作为必现文案。
        const requiredText = [
          '所有本地 TTS、video-use Python worker 和 MLX 对齐都复用应用管理的 Python',
          'Python 运行环境',
          '深度估计（电影级 3D）',
          '声音（TTS · 音乐 · 音效）',
          '视频工作流插件',
        ];
        const forbiddenText = [
          '正在配置 Python 运行环境',
          '正在下载 Python 运行环境',
          '正在安装 TTS 依赖',
        ];
        resolve({
          clickedSettings: Boolean(settingsButton),
          clickedPluginTab: Boolean(pluginTab),
          pluginTabState: pluginTab?.getAttribute('data-state') || '',
          activeTabText: tabButtons.find((node) => node.getAttribute('data-state') === 'active')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
          hasRequiredText: requiredText.every((text) => bodyText.includes(text)),
          missingRequiredText: requiredText.filter((text) => !bodyText.includes(text)),
          forbiddenTextFound: forbiddenText.filter((text) => bodyText.includes(text)),
          bodyTextLength: bodyText.trim().length,
          bodyTextSample: bodyText.slice(0, 1000),
        });
      }, 1200);
    }, 800));
  })()`,
    "Python settings check",
  );
}

const REMOTION_DOWNLOAD_PROGRESS_KEY = "__mystudioRemotionDownloadProgress";

async function prepareRemotionBrowserDownload(evaluate) {
  return evaluate(
    `(async () => {
      const normalize = (node) => (node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const activate = (node) => {
        if (!node) return false;
        node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
        node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
        node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
        node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, view: window }));
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
        return true;
      };
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (check, timeoutMs, label) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await check();
          if (value) return value;
          await wait(250);
        }
        throw new Error(label + ' timed out after ' + timeoutMs + 'ms');
      };
      const readStatusAfterProbeSettles = async () => {
        let lastConflict = '';
        for (let attempt = 0; attempt < 40; attempt += 1) {
          try {
            const status = await window.remotionRuntime.status();
            if (
              status?.state === 'error'
              && typeof status.message === 'string'
              && status.message.includes('同一时间只允许一个浏览器 utility 操作')
            ) {
              lastConflict = status.message;
              await wait(250);
              continue;
            }
            return status;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('同一时间只允许一个浏览器 utility 操作')) throw error;
            lastConflict = message;
            await wait(250);
          }
        }
        throw new Error(lastConflict || 'Remotion browser status probe did not settle');
      };
      const result = {
        enabled: true,
        success: true,
        settings: {},
        browserProgress: [],
        browserDownloadStarted: false,
      };
      if (!window.remotionRuntime || !window.remotionPreview?.createShot || !window.remotionQueue) {
        throw new Error('Remotion runtime, shot preview, or queue bridge is unavailable');
      }

      const navButtons = Array.from(document.querySelectorAll('.studio-nav-button'))
        .filter((node) => node.tagName === 'BUTTON');
      const settingsButton = navButtons.find((node) => normalize(node).includes('设置'));
      result.settings.clickedSettings = activate(settingsButton);
      await waitFor(
        () => Array.from(document.querySelectorAll('.settings-tabs-bar button')).some((node) => normalize(node) === '本地配置'),
          10_000,
          'plugin settings tab',
        );
      const pluginTab = Array.from(document.querySelectorAll('.settings-tabs-bar button'))
        .find((node) => normalize(node) === '本地配置');
      result.settings.clickedPluginTab = activate(pluginTab);
      await waitFor(() => document.body.innerText.includes('Remotion Headless Shell'), 10_000, 'Remotion settings panel');

      const remotionOption = Array.from(document.querySelectorAll('[role="radio"]'))
        .find((node) => normalize(node).startsWith('Remotion'));
      result.settings.clickedRemotion = activate(remotionOption);
      await waitFor(() => remotionOption?.getAttribute('aria-checked') === 'true', 5_000, 'Remotion renderer selection');
      result.settings.rendererSelected = remotionOption?.getAttribute('aria-checked') === 'true';
      result.settings.hasRuntimeStatus = document.body.innerText.includes('当前状态');
      await waitFor(
        () => ['已就绪', '需要手动更新', '尚未安装', '检查失败']
          .some((label) => document.body.innerText.includes(label)),
        30_000,
        'initial Remotion browser status',
      );
      result.initialBrowserStatus = await readStatusAfterProbeSettles();

      if (result.initialBrowserStatus.state === 'ready') return result;
      if (${JSON.stringify(remotionExportSmokeMode)} === 'blocked') return result;

      const progressState = { progress: [], unsubscribe: null };
      globalThis.${REMOTION_DOWNLOAD_PROGRESS_KEY} = progressState;
      progressState.unsubscribe = window.remotionRuntime.onDownloadProgress((progress) => {
        const previous = progressState.progress[progressState.progress.length - 1];
        const stage = progress.phase || progress.stage || '';
        if (!previous || previous.stage !== stage || Math.abs(previous.ratio - progress.ratio) >= 0.1) {
          progressState.progress.push({ stage, ratio: progress.ratio, message: progress.message || '' });
          if (progressState.progress.length > 40) progressState.progress.shift();
        }
      });
      const downloadButton = Array.from(document.querySelectorAll('button')).find((node) => {
        const text = normalize(node);
        return !node.disabled && (text.includes('下载 Headless Shell') || text.includes('手动更新'));
      });
      result.settings.clickedBrowserDownload = activate(downloadButton);
      if (!result.settings.clickedBrowserDownload) {
        progressState.unsubscribe?.();
        delete globalThis.${REMOTION_DOWNLOAD_PROGRESS_KEY};
        throw new Error('Remotion browser download button was not available');
      }
      result.browserDownloadStarted = true;
      return result;
    })()`,
    "Remotion browser download trigger",
    30_000,
  );
}

async function verifyRemotionExport(evaluate) {
  const serializedPlan = JSON.stringify(
    buildRemotionSmokeShotPlan(SMOKE_VIDEO_DURATION_US),
  );
  const mode = JSON.stringify(remotionExportSmokeMode);
  const promiseKey = "__mystudioRemotionExportSmokePromise";
  const currentOutputPath = resolve(
    SMOKE_PROJECT_DATA_ROOT,
    "_p",
    REMOTION_SMOKE_PROJECT_ID,
    "remotion",
    "outputs",
    "shots",
    REMOTION_SMOKE_CHAPTER_ID,
    REMOTION_SMOKE_SHOT_ID,
    "current.mp4",
  );
  const currentBefore = existsSync(currentOutputPath)
    ? {
        path: currentOutputPath,
        sha256: createHash("sha256").update(readFileSync(currentOutputPath)).digest("hex"),
      }
    : null;
  let prepared;
  let browserStatus;
  let browserProgress = [];
  try {
    prepared = await prepareRemotionBrowserDownload(evaluate);
    browserStatus = prepared.initialBrowserStatus;
    if (prepared.browserDownloadStarted) {
      const deadline = Date.now() + REMOTION_EXPORT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const remainingMs = Math.max(1_000, deadline - Date.now());
        try {
          browserStatus = await evaluate(
            "window.remotionRuntime.status()",
            "Remotion browser download status poll",
            Math.min(CDP_CALL_TIMEOUT_MS, remainingMs),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("同一时间只允许一个浏览器 utility 操作")) throw error;
          await sleep(500);
          continue;
        }
        browserProgress = await evaluate(
          `globalThis.${REMOTION_DOWNLOAD_PROGRESS_KEY}?.progress || []`,
          "Remotion browser download progress poll",
          Math.min(CDP_CALL_TIMEOUT_MS, remainingMs),
        );
        const failedProgress = Array.isArray(browserProgress)
          ? [...browserProgress].reverse().find((progress) => progress?.stage === "failed")
          : undefined;
        if (failedProgress) {
          throw new Error(
            failedProgress.message || "Remotion Headless Shell 下载失败",
          );
        }
        if (
          browserStatus?.state === "error"
          && typeof browserStatus.message === "string"
          && browserStatus.message.includes("同一时间只允许一个浏览器 utility 操作")
        ) {
          await sleep(500);
          continue;
        }
        if (browserStatus?.state === "ready") break;
        const alert = await evaluate(
          "document.querySelector('[role=alert]')?.innerText || ''",
          "Remotion browser download error poll",
          Math.min(CDP_CALL_TIMEOUT_MS, remainingMs),
        );
        if (alert) throw new Error(alert);
        if (browserStatus?.state === "error" || browserStatus?.state === "update-required") {
          throw new Error(browserStatus.message || `Remotion 浏览器状态为 ${browserStatus.state}`);
        }
        await sleep(1_000);
      }
      if (browserStatus?.state !== "ready") {
        throw new Error(
          `Remotion browser download timed out after ${REMOTION_EXPORT_TIMEOUT_MS}ms; last state=${browserStatus?.state || "unknown"}`,
        );
      }
      browserProgress = await evaluate(
        `globalThis.${REMOTION_DOWNLOAD_PROGRESS_KEY}?.progress || []`,
        "Remotion browser download final progress",
        CDP_CALL_TIMEOUT_MS,
      );
    }

    const renderBrowserStatus = JSON.stringify(browserStatus || prepared?.initialBrowserStatus || null);
    const renderResult = await evaluate(
    `(() => {
      const smokePromise = (async () => {
      const plan = ${serializedPlan};
      const mode = ${mode};
      const expectBlockedExport = mode === 'blocked';
      const expectCanceledExport = mode === 'cancel';
      const result = {
        enabled: true,
        mode,
        jobId: plan.jobId,
        success: false,
        settings: {},
        browserProgress: [],
        renderProgress: [],
      };
      const normalize = (node) => (node?.textContent || '').replace(/\\s+/g, ' ').trim();
      const activate = (node) => {
        if (!node) return false;
        node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
        node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
        node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
        node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, view: window }));
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
        return true;
      };
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (check, timeoutMs, label) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = await check();
          if (value) return value;
          await wait(250);
        }
        throw new Error(label + ' timed out after ' + timeoutMs + 'ms');
      };
      const rememberProgress = (target, progress) => {
        const previous = target[target.length - 1];
        const stage = progress.phase || progress.stage || '';
        if (!previous || previous.stage !== stage || Math.abs(previous.ratio - progress.ratio) >= 0.1) {
          target.push({ stage, ratio: progress.ratio, message: progress.message || '' });
          if (target.length > 20) target.shift();
        }
      };
      let unsubscribeQueue;
      let previewSessionId = '';

      try {
        if (!window.remotionRuntime?.workspaceRuntime
          || !window.remotionPreview?.createShot
          || !window.remotionQueue) {
          throw new Error('Remotion runtime, shot preview, or queue bridge is unavailable');
        }

        const navButtons = Array.from(document.querySelectorAll('.studio-nav-button'))
          .filter((node) => node.tagName === 'BUTTON');
        const settingsButton = navButtons.find((node) => normalize(node).includes('设置'));
        result.settings.clickedSettings = activate(settingsButton);
        await waitFor(
          () => Array.from(document.querySelectorAll('.settings-tabs-bar button')).some((node) => normalize(node) === '本地配置'),
          10_000,
          'plugin settings tab',
        );
        const pluginTab = Array.from(document.querySelectorAll('.settings-tabs-bar button'))
          .find((node) => normalize(node) === '本地配置');
        result.settings.clickedPluginTab = activate(pluginTab);
        await waitFor(() => document.body.innerText.includes('Remotion Headless Shell'), 10_000, 'Remotion settings panel');

        const remotionOption = Array.from(document.querySelectorAll('[role="radio"]'))
          .find((node) => normalize(node).startsWith('Remotion'));
        result.settings.clickedRemotion = activate(remotionOption);
        await waitFor(() => remotionOption?.getAttribute('aria-checked') === 'true', 5_000, 'Remotion renderer selection');
        result.settings.rendererSelected = remotionOption?.getAttribute('aria-checked') === 'true';
        result.settings.hasRuntimeStatus = document.body.innerText.includes('当前状态');

        await waitFor(
          () => ['已就绪', '需要手动更新', '尚未安装', '检查失败']
            .some((label) => document.body.innerText.includes(label)),
          30_000,
          'initial Remotion browser status',
        );
        result.initialBrowserStatus = ${renderBrowserStatus};

        const preview = await window.remotionPreview.createShot(plan);
        previewSessionId = preview.sessionId;
        result.preview = {
          sessionId: preview.sessionId,
          browserStateAtCreate: result.initialBrowserStatus.state,
          width: preview.composition.width,
          height: preview.composition.height,
          fps: preview.composition.fps,
          durationInFrames: preview.composition.durationInFrames,
          visualClipCount: preview.composition.visualClips.length,
        };
        const released = await window.remotionPreview.release(previewSessionId);
        result.previewReleased = released.released === true && released.sessionId === previewSessionId;
        previewSessionId = '';

        result.browserStatus = result.initialBrowserStatus;
        if (!expectBlockedExport && result.browserStatus.state !== 'ready') {
          throw new Error('Remotion browser is not ready: ' + result.browserStatus.state);
        }

        const workflowButton = Array.from(document.querySelectorAll('.studio-nav-button'))
          .find((node) => node.tagName === 'BUTTON' && normalize(node).includes('工作流'));
        result.studioHost = { clickedWorkflow: activate(workflowButton), mounted: false };
        if (!window.mystudioWorkflowSmoke?.seedCompleteWorkflow) {
          throw new Error('Workflow smoke bridge is unavailable for the native Studio host check');
        }
        await window.mystudioWorkflowSmoke.seedCompleteWorkflow();
        await window.mystudioWorkflowSmoke.setWorkflowStage('workbench');
        result.studioHost = await waitFor(() => {
          const iframe = document.querySelector('iframe[title="原生 Remotion Studio"]');
          if (!iframe) return null;
          return {
            clickedWorkflow: true,
            mounted: true,
            iframeMounted: true,
            title: iframe.getAttribute('title'),
          };
        }, 30_000, 'native Remotion Studio host');

        const runtime = await window.remotionRuntime.workspaceRuntime();
        const canonical = (value) => JSON.stringify(Array.isArray(value)
          ? value.map((item) => JSON.parse(canonical(item)))
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, JSON.parse(canonical(value[key]))]))
            : value);
        const sha256 = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(canonical(value)),
        )), (byte) => byte.toString(16).padStart(2, '0')).join('');
        const target = {
          kind: 'shot',
          chapterId: plan.chapterId,
          shotId: plan.shot.shotId,
          shotRevision: plan.shot.revision,
        };
        const renderSettingsHash = await sha256(plan.renderSettings);
        const identity = {
          projectId: plan.projectId,
          target,
          inputHash: plan.inputHash,
          bundleContentHash: runtime.bundleContentHash,
          renderSettingsHash,
        };
        const jobId = 'shot:' + await sha256(identity);
        const job = {
          schemaVersion: 1,
          jobId,
          ...identity,
          templateVersion: runtime.templateVersion,
          remotionVersion: runtime.remotionVersion,
          status: 'ready',
          attempt: 0,
          progress: 0,
          createdAt: Date.now(),
        };
        result.jobId = jobId;
        result.queueStates = [];
        unsubscribeQueue = window.remotionQueue.onJob((notification) => {
          if (notification.jobId !== jobId) return;
          result.queueStates.push(notification.status);
          rememberProgress(result.renderProgress, {
            stage: notification.status,
            ratio: notification.status === 'succeeded' ? 1 : 0,
            message: '',
          });
        });
        result.enqueue = await window.remotionQueue.enqueueShot({ job, plan });
        if (result.enqueue.accepted !== true) {
          throw new Error(result.enqueue.message || ('Remotion queue rejected shot job: ' + result.enqueue.reason));
        }
        if (expectCanceledExport) {
          result.cancel = await window.remotionQueue.cancel(jobId);
        }
        const terminalJob = await waitFor(
          async () => {
            const scope = await window.remotionQueue.get({ projectId: plan.projectId, chapterId: plan.chapterId });
            return scope.jobs.find((item) => item.jobId === jobId
              && ['succeeded', 'failed', 'canceled'].includes(item.status));
          },
          120_000,
          'Remotion shot queue terminal state',
        );
        result.render = {
          success: terminalJob.status === 'succeeded',
          canceled: terminalJob.status === 'canceled',
          job: terminalJob,
          error: terminalJob.error?.message,
        };
        if (expectCanceledExport) {
          result.success = result.settings.rendererSelected
            && result.settings.hasRuntimeStatus
            && result.previewReleased
            && result.studioHost?.mounted
            && result.cancel?.success === true
            && result.cancel?.canceled === true
            && result.render.success === false
            && result.render.canceled === true;
          if (!result.success) throw new Error('Remotion queue cancellation evidence was incomplete');
          return result;
        }
        if (expectBlockedExport) {
          result.noDownloadObserved = result.browserProgress.length === 0
            && !result.settings.clickedBrowserDownload;
          result.success = result.settings.rendererSelected
            && result.settings.hasRuntimeStatus
            && result.previewReleased
            && result.studioHost?.mounted
            && result.browserStatus.state !== 'ready'
            && result.render.success === false
            && result.render.canceled === false
            && terminalJob.status === 'failed'
            && result.noDownloadObserved;
          if (!result.success) throw new Error('Remotion no-download shot queue block evidence was incomplete');
          return result;
        }
        result.success = result.settings.rendererSelected
          && result.settings.hasRuntimeStatus
          && result.previewReleased
          && result.studioHost?.mounted
          && result.render.success
          && terminalJob.status === 'succeeded';
        if (!result.success) throw new Error('Remotion shot queue smoke evidence was incomplete');
        return result;
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        return result;
      } finally {
        unsubscribeQueue?.();
        if (previewSessionId) {
          try {
            const released = await window.remotionPreview?.release(previewSessionId);
            result.previewReleased = released?.released === true;
          } catch (error) {
            result.previewReleaseError = error instanceof Error ? error.message : String(error);
          }
        }
      }
      })();
      globalThis.${promiseKey} = smokePromise;
      return smokePromise;
    })()`,
    "Remotion packaged export smoke",
    REMOTION_EXPORT_TIMEOUT_MS,
    );
    return {
      ...renderResult,
      currentBefore,
      settings: {
        ...(prepared?.settings || {}),
        ...(renderResult?.settings || {}),
      },
      initialBrowserStatus: prepared?.initialBrowserStatus || renderResult?.initialBrowserStatus,
      browserStatus: browserStatus || renderResult?.browserStatus,
      browserProgress: [
        ...(Array.isArray(browserProgress) ? browserProgress : []),
        ...(Array.isArray(renderResult?.browserProgress) ? renderResult.browserProgress : []),
      ],
    };
  } catch (error) {
    return {
      enabled: true,
      mode: remotionExportSmokeMode,
      success: false,
      settings: prepared?.settings || {},
      initialBrowserStatus: prepared?.initialBrowserStatus,
      browserStatus,
      browserProgress,
      currentBefore,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await evaluate(
      `delete globalThis.${promiseKey}`,
      "Remotion packaged export smoke promise cleanup",
    ).catch(() => undefined);
    await evaluate(
      `globalThis.${REMOTION_DOWNLOAD_PROGRESS_KEY}?.unsubscribe?.(); delete globalThis.${REMOTION_DOWNLOAD_PROGRESS_KEY}`,
      "Remotion browser download progress cleanup",
    ).catch(() => undefined);
  }
}

async function verifyWorkflowEndToEnd(evaluate) {
  return evaluate(
    `(async () => {
    const normalize = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const activate = (node) => {
      if (!node) return false;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, view: window }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, timeout = 8000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await wait(150);
      }
      return null;
    };
    const clickButtonByText = (text) => {
      const button = Array.from(document.querySelectorAll('button'))
        .find((node) => normalize(node) === text || normalize(node).includes(text));
      return activate(button);
    };
    const seed = await waitFor(() => window.mystudioWorkflowSmoke?.seedCompleteWorkflow, 10_000);
    const seedResult = seed ? await seed() : null;
    await wait(500);
    const clickedWorkflow = clickButtonByText('工作流');
    await waitFor(() => document.body.innerText.includes('100%') || document.body.innerText.includes('已导出最终成片'), 8000);
    await window.mystudioWorkflowSmoke?.setWorkflowStage?.('storyboard');
    await wait(800);
    const flowCanvas = document.querySelector('.workflow-node-canvas');
    const nodeCardTexts = Array.from(document.querySelectorAll('[data-flow-node-id]'))
      .map((node) => ({ id: node.getAttribute('data-flow-node-id'), text: normalize(node) }));
    const nodeById = (id) => document.querySelector('[data-flow-node-id="' + id + '"]');
    const scriptPlanNode = nodeById('scriptPlan');
    const assetsNode = nodeById('assets');
    const storyboardNode = nodeById('storyboard');
    const themeControls = flowCanvas?.querySelector('.workflow-node-viewport-controls');
    const scriptPlanText = scriptPlanNode ? normalize(scriptPlanNode) : '';
    const assetsText = assetsNode ? normalize(assetsNode) : '';
    const storyboardText = storyboardNode ? normalize(storyboardNode) : '';
    const openDerivativeImageWorkflowDetail = async (workflowId, generatedTitle, writebackTarget) => {
      clickButtonByText('工作流');
      await window.mystudioWorkflowSmoke?.setWorkflowStage?.('storyboard');
      const workflowButton = await waitFor(() => document
        .querySelector('[data-flow-node-id="assets"] [data-asset-workflow-id="' + workflowId + '"]'), 8000);
      const clicked = activate(workflowButton);
      if (!clicked) return { workflowId, ready: false, clicked: false, missingChecks: ['clicked'] };
      const captureDetail = () => {
        const text = document.body.innerText;
        const visibleRect = (node) => {
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              rect.right > 0 &&
              rect.bottom > 0 &&
              rect.left < viewportWidth &&
              rect.top < viewportHeight,
          };
        };
        const inputValues = Array.from(document.querySelectorAll('input'))
          .map((node) => node.value || '');
        const referenceNode = document.querySelector('[data-image-workflow-node-kind="reference"]');
        const generatedNode = document.querySelector('[data-image-workflow-node-kind="generated"]');
        const referenceNodeText = referenceNode ? normalize(referenceNode) : '';
        const generatedNodeText = generatedNode ? normalize(generatedNode) : '';
        const referenceInputValues = referenceNode
          ? Array.from(referenceNode.querySelectorAll('input')).map((node) => node.value || '')
          : [];
        const generatedInputValues = generatedNode
          ? Array.from(generatedNode.querySelectorAll('input')).map((node) => node.value || '')
          : [];
        const hasReferenceNode = Boolean(referenceNode) && (
          referenceNodeText.includes('参考') ||
          referenceInputValues.some((value) => value.trim().length > 0) ||
          Boolean(referenceNode.querySelector('img'))
        );
        const hasGeneratedNode = Boolean(generatedNode) && (
          generatedNodeText.includes(generatedTitle) ||
          generatedNodeText.includes('生成结果') ||
          generatedNodeText.includes('成图') ||
          generatedInputValues.includes(generatedTitle) ||
          generatedInputValues.some((value) => value.includes('生成结果') || value.includes('成图'))
        );
        const hasAssetWritebackTarget = text.includes('回写目标') && text.includes(writebackTarget);
        const hasImageWorkflowCanvas = Boolean(document.querySelector('.react-flow'));
        const imageWorkflowNodeCount = document.querySelectorAll('.react-flow__node').length;
        const hasImageWorkflowNodes = imageWorkflowNodeCount >= 3;
        const hasImageWorkflowPromptNode = Boolean(document.querySelector('[data-image-workflow-node-kind="prompt"]'));
        const generatedPromptPanel = generatedNode?.querySelector('[data-toonflow-generated-prompt-panel]');
        const canvasRect = visibleRect(document.querySelector('.react-flow'));
        const generatedNodeRect = visibleRect(generatedNode);
        const generatedPromptPanelRect = visibleRect(generatedPromptPanel);
        const hasVisibleImageWorkflowCanvas = Boolean(canvasRect?.visible && canvasRect.width >= 480 && canvasRect.height >= 320);
        const hasVisibleGeneratedNode = Boolean(generatedNodeRect?.visible && generatedNodeRect.width >= 180 && generatedNodeRect.height >= 120);
        const hasVisibleDuplicateGeneratedPromptPanel = hasImageWorkflowPromptNode && Boolean(generatedPromptPanelRect?.visible && generatedPromptPanelRect.width >= 180 && generatedPromptPanelRect.height >= 80);
        const generatedPromptTextValues = generatedPromptPanel
          ? Array.from(generatedPromptPanel.querySelectorAll('textarea')).map((node) => node.value || '')
          : [];
        const promptNodeTextValues = Array.from(document.querySelectorAll('[data-image-workflow-node-kind="prompt"] textarea')).map((node) => node.value || '');
        const promptTextValues = hasImageWorkflowPromptNode ? promptNodeTextValues : generatedPromptTextValues;
        const hasNoDuplicateGeneratedPromptPanel = !(hasImageWorkflowPromptNode && Boolean(generatedPromptPanel));
        const hasNoVisibleDuplicateGeneratedPromptPanel = !hasVisibleDuplicateGeneratedPromptPanel;
        const hasEditableImageWorkflowPrompt = promptTextValues.some((value) => value.trim().length > 0);
        const hasImageWorkflowSource = text.includes('来源') && text.includes('分镜视频生成') && text.includes('衍生资产');
        const imageWorkflowScope = document.querySelector('[data-scoped-image-workflow-summary]')?.closest('section') || document;
        const scopedButtonTexts = Array.from(imageWorkflowScope.querySelectorAll('button')).map((node) => normalize(node));
        const scopedText = imageWorkflowScope.innerText || '';
        const hasScopedImageWorkflowSummary = Boolean(imageWorkflowScope.querySelector('[data-scoped-image-workflow-summary]'));
        const hasNoGlobalImageWorkflowControls =
          !imageWorkflowScope.querySelector('[data-image-workflow-selector]') &&
          !imageWorkflowScope.querySelector('[data-image-workflow-global-action]');
        const hasNoGlobalImageWorkflowPalettes = !scopedText.includes('项目参考图');
        const hasImageWorkflowBackButton = scopedButtonTexts.some((buttonText) => buttonText === '返回');
        const checks = {
          clicked: true,
          hasReferenceNode,
          hasGeneratedNode,
          hasAssetWritebackTarget,
          hasImageWorkflowCanvas,
          hasVisibleImageWorkflowCanvas,
          hasImageWorkflowNodes,
          hasImageWorkflowPromptNode,
          hasNoDuplicateGeneratedPromptPanel,
          hasVisibleGeneratedNode,
          hasNoVisibleDuplicateGeneratedPromptPanel,
          hasEditableImageWorkflowPrompt,
          hasImageWorkflowSource,
          hasScopedImageWorkflowSummary,
          hasNoGlobalImageWorkflowControls,
          hasNoGlobalImageWorkflowPalettes,
          hasImageWorkflowBackButton,
        };
        const missingChecks = Object.entries(checks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name);
        return {
          workflowId,
          ready: missingChecks.length === 0,
          ...checks,
          missingChecks,
          imageWorkflowNodeCount,
          canvasRect,
          generatedNodeRect,
          generatedPromptPanelRect,
          inputValues,
          promptTextValues,
          referenceInputValues,
          generatedInputValues,
          referenceNodeText,
          generatedNodeText,
          bodyTextSample: text.slice(0, 800),
        };
      };
      const detail = await waitFor(() => {
        const evidence = captureDetail();
        return evidence.ready ? evidence : null;
      }, 8000);
      return detail || captureDetail();
    };
    const derivativeImageWorkflowDetails = [
      await openDerivativeImageWorkflowDetail('smoke-flow-role-wanderer', '落魄江湖客 成图', '角色衍生 · 落魄江湖客'),
      await openDerivativeImageWorkflowDetail('smoke-flow-scene-low-angle', '低机位推进 成图', '场景衍生 · 低机位推进'),
      await openDerivativeImageWorkflowDetail('smoke-flow-prop-broken', '断剑破损版 成图', '道具衍生 · 断剑破损版'),
    ];
    const clickedDerivativeImageWorkflow = derivativeImageWorkflowDetails.every((detail) => detail?.ready);
    const derivativeImageWorkflowDetail = {
      checkedWorkflowIds: derivativeImageWorkflowDetails.map((detail) => detail.workflowId),
      details: derivativeImageWorkflowDetails,
    };
    const requiredNodePreviewText = [
      ['独孤剑尘睁眼'],
      ['矿场入局'],
      ['独孤剑尘'],
      ['序号', '画面描述', '台词'],
      ['旁白：他在尘土里醒来。'],
      ['ChapterVideo', '章节 MP4'],
    ];
    const missingNodePreviewText = requiredNodePreviewText
      .filter((texts) => !nodeCardTexts.some((node) => texts.every((text) => node.text.includes(text))))
      .map((texts) => texts.join(' / '));
    const bodyText = document.body.innerText;
    const inspectResult = await window.mystudioWorkflowSmoke?.inspectWorkflow?.();
    const editingEvidence = inspectResult?.workflowParityReport?.video || null;
    const evidenceBoundary = inspectResult?.workflowParityReport?.evidenceBoundary || null;
    const derivativeAssetNamesReady = ['独孤剑尘', '落魄江湖客', '矿场', '低机位推进', '断剑', '断剑破损版']
      .every((text) => assetsText.includes(text));
    const derivativeParentRefsReady = ['smoke-role-sword', 'smoke-scene-mine', 'smoke-prop-sword']
      .every((id) => Boolean(assetsNode?.querySelector('[data-parent-asset-id="' + id + '"]')));
    const derivativeFlowRefsReady = ['smoke-flow-role-wanderer', 'smoke-flow-scene-low-angle', 'smoke-flow-prop-broken']
      .every((id) => Boolean(assetsNode?.querySelector('[data-asset-workflow-id="' + id + '"]')));
    return {
      bridgeAvailable: Boolean(window.mystudioWorkflowSmoke?.seedCompleteWorkflow),
      clickedWorkflow,
      seedResult,
      inspectResult,
      editingEvidence,
      evidenceBoundary,
      hasReadyProgress: bodyText.includes('100%') || inspectResult?.progress === 100,
      hasCompletedExport: Boolean(inspectResult?.checks?.hasFinalExport),
      hasEditingProject: Boolean(editingEvidence?.currentEditingProjectId),
      hasTimelineRenderRecord: Boolean(editingEvidence?.timelineRenderRecords > 0),
      hasCompleteTimelineEvidence: Boolean(editingEvidence?.hasCompleteTimelineEvidence),
      seededEditingEvidence: Boolean(inspectResult?.checks?.seededEditingEvidence && evidenceBoundary?.seededUiSmoke),
      realMediaGeneration: evidenceBoundary?.realMediaGeneration === true,
      doesNotClaimRealMediaGeneration: evidenceBoundary?.realMediaGeneration === false,
      hasSelectedCandidate: bodyText.includes('已选候选片段') || Boolean(inspectResult?.checks?.hasSelectedCandidate),
      hasVoiceFlow: bodyText.includes('已分配角色音色') || Boolean(inspectResult?.checks?.hasVoiceBinding),
      hasVoiceAudio: bodyText.includes('分镜配音已生成') || Boolean(inspectResult?.checks?.hasVoiceAudio),
      hasNodeFlowDataPreview: missingNodePreviewText.length === 0,
      hasDirectorPlanPreview: Boolean(scriptPlanNode)
        && ['矿场入局', '水墨漫剧', '低机位推进'].every((text) => scriptPlanText.includes(text))
        && Boolean(scriptPlanNode.querySelector('.md-editor-preview')),
      hasToonflowDerivativeLinks: Boolean(assetsNode)
        && derivativeAssetNamesReady
        && derivativeParentRefsReady
        && derivativeFlowRefsReady
        && assetsNode.querySelectorAll('img[src^="data:image"], img[src^="project-file:"]').length >= 4,
      clickedDerivativeImageWorkflow,
      hasDerivativeImageWorkflowDetail: Boolean(derivativeImageWorkflowDetail),
      derivativeImageWorkflowDetail,
      hasStoryboardImagePreview: Boolean(storyboardNode)
        && storyboardText.includes('旁白：他在尘土里醒来。')
        && Boolean(storyboardNode.querySelector('img[src^="data:image"], img[src^="project-file:"]')),
      hasNoDefaultReactFlowControls: Boolean(flowCanvas)
        && !Boolean(flowCanvas.querySelector('.react-flow__controls')),
      hasThemeViewportControls: Boolean(themeControls)
        && normalize(themeControls).includes('适配')
        && themeControls.querySelectorAll('button[aria-label]').length === 3,
      missingNodePreviewText,
      nodeCardTexts,
      bodyTextSample: bodyText.slice(0, 1200),
    };
  })()`,
    "workflow end-to-end check",
    WORKFLOW_E2E_TIMEOUT_MS,
  );
}

async function verifyWorkflowStepByStepExecution(evaluate) {
  console.log("[smoke] checking step-by-step workflow execution");
  if (stepDelayMs > 0) {
    console.log(`[smoke] visible step-by-step delay ${stepDelayMs}ms`);
  }
  return evaluate(
    `(async () => {
    const normalize = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const activate = (node) => {
      if (!node) return false;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, view: window }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visibleStepDelayMs = ${stepDelayMs};
    const visibleStepDelay = async () => {
      if (visibleStepDelayMs > 0) await wait(visibleStepDelayMs);
    };
    const waitFor = async (predicate, timeout = 8000) => {
      const deadline = Date.now() + timeout;
      let lastValue = null;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        lastValue = value;
        await wait(150);
      }
      return lastValue;
    };
    const clickButtonByText = (text, exact = false) => {
      const candidates = Array.from(document.querySelectorAll('button, [role="menuitem"], [cmdk-item]'));
      const button = candidates.find((node) => {
        const normalized = normalize(node);
        return exact ? normalized === text : normalized.includes(text);
      });
      return { clicked: activate(button), text: button ? normalize(button) : '' };
    };
    const clickStageById = async (stageId) => {
      clickButtonByText('切换阶段');
      await wait(150);
      const result =
        stageId === 'manuals' ? clickButtonByText('风格与导演') :
        stageId === 'novel' ? clickButtonByText('小说导入') :
        stageId === 'script' ? clickButtonByText('剧本生产阶段') :
        stageId === 'assets' ? clickButtonByText('剧本资产管理') :
        stageId === 'storyboard' ? clickButtonByText('分镜视频生成') :
        stageId === 'workbench' ? clickButtonByText('视频工作台') :
        { clicked: false, text: '' };
      await window.mystudioWorkflowSmoke?.setWorkflowStage?.(stageId);
      await wait(250);
      return result;
    };
    const waitForStageReady = async (stageId) => waitFor(async () => {
      const inspected = await window.mystudioWorkflowSmoke?.inspectWorkflowStages?.();
      const stage = inspected?.stages?.find((item) => item.id === stageId);
      return stage?.status === 'ready' ? inspected : null;
    }, 5000);

    const clickedWorkflow = clickButtonByText('工作流', true);
    await visibleStepDelay();
    await waitFor(() => window.mystudioWorkflowSmoke?.resetForStepwiseExecution, 10_000);
    const reset = await window.mystudioWorkflowSmoke?.resetForStepwiseExecution?.();
    await visibleStepDelay();
    const stages = [
      { id: 'manuals', label: '风格与导演' },
      { id: 'novel', label: '小说导入' },
      { id: 'script', label: '剧本生产阶段' },
      { id: 'assets', label: '剧本资产管理' },
      { id: 'storyboard', label: '分镜视频生成' },
      { id: 'workbench', label: '视频工作台' },
    ];
    const results = [];
    for (const stage of stages) {
      const stageClick = await clickStageById(stage.id);
      console.info('[workflow-stepwise-visible] clicked ' + stage.label);
      await visibleStepDelay();
      const before = await window.mystudioWorkflowSmoke?.inspectWorkflowStages?.();
      const run = await window.mystudioWorkflowSmoke?.runStepwiseWorkflowStage?.(stage.id);
      await visibleStepDelay();
      const ready = await waitForStageReady(stage.id);
      await visibleStepDelay();
      results.push({
        id: stage.id,
        label: stage.label,
        clicked: Boolean(stageClick.clicked),
        clickedText: stageClick.text,
        beforeProgress: before?.progress ?? null,
        afterProgress: ready?.progress ?? run?.progress ?? null,
        ready: Boolean(run?.ready && ready),
        evidence: run?.evidenceText || '',
        nextStageId: ready?.nextStageId || run?.nextStageId || '',
      });
    }
    const finalInspection = await window.mystudioWorkflowSmoke?.inspectWorkflowStages?.();
    return {
      bridgeAvailable: Boolean(window.mystudioWorkflowSmoke?.resetForStepwiseExecution),
      clickedWorkflow: clickedWorkflow.clicked,
      reset,
      source: finalInspection?.source || reset?.source || '',
      completed: Boolean(finalInspection?.progress === 100 && results.every((item) => item.ready)),
      progress: finalInspection?.progress ?? 0,
      results,
      evidence: finalInspection?.evidence || [],
      checks: finalInspection?.checks || {},
      editingEvidence: finalInspection?.workflowParityReport?.video || null,
      evidenceBoundary: finalInspection?.workflowParityReport?.evidenceBoundary || null,
      bodyTextSample: document.body.innerText.slice(0, 1200),
    };
  })()`,
    "workflow step-by-step execution check",
    30_000,
  );
}

async function verifyAssetVoiceFlow(evaluate) {
  const seed = await evaluate(
    `(async () => {
    const waitFor = async (predicate, timeout = 5000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return null;
    };
    await waitFor(() => window.studioAssets?.add && window.studioAssets?.list && window.studioAssets?.saveMaterial);
    if (!window.studioAssets?.add || !window.studioAssets?.list || !window.studioAssets?.saveMaterial) {
      return { seeded: false, reason: 'studioAssets API unavailable' };
    }
    const existingRoles = await window.studioAssets.list({ type: 'role', search: 'Smoke测试剑修', limit: 1 });
    const role = existingRoles.items?.[0] || await window.studioAssets.add({
      type: 'role',
      name: 'Smoke测试剑修',
      description: '青年男声，冷静克制，适合断剑剑修。',
      setting: '- **性别**：男\\n- **年龄**：青年\\n- **身份**：剑修',
      prompt: '水墨漫剧角色，青年剑修，玄色长衣',
    });
    const existingAudio = await window.studioAssets.list({ type: 'audio', search: 'Smoke青年男声', limit: 1 });
    let audio = existingAudio.items?.[0];
    if (!audio) {
      const sampleRate = 8000;
      const seconds = 0.25;
      const samples = Math.floor(sampleRate * seconds);
      const dataBytes = samples * 2;
      const buffer = new ArrayBuffer(44 + dataBytes);
      const view = new DataView(buffer);
      const writeString = (offset, text) => {
        for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
      };
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + dataBytes, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, dataBytes, true);
      for (let i = 0; i < samples; i += 1) {
        const sample = Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 0.15;
        view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
      }
      const saved = await window.studioAssets.saveMaterial({ name: 'Smoke青年男声.wav', bytes: buffer });
      audio = await window.studioAssets.add({
        type: 'audio',
        name: 'Smoke青年男声.wav',
        sourceFilePath: saved.filePath,
        description: '我会走到最后。',
      });
    }
    const audioList = await waitFor(async () => {
      const result = await window.studioAssets.list({ type: 'audio', search: 'Smoke青年男声', limit: 10 });
      return result.items?.length ? result : null;
    }, 5000);
    return {
      seeded: Boolean(role && audio && audioList?.items?.length),
      roleName: role?.name || '',
      audioName: audio?.name || '',
      audioListCount: audioList?.items?.length || 0,
      audioListFirst: audioList?.items?.[0]?.name || '',
    };
  })()`,
    "asset voice seed",
  );

  const flow = await evaluate(
    `(async () => {
    const normalize = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const activate = (node) => {
      if (!node) return false;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, view: window }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
     const waitFor = async (predicate, timeout = 5000) => {
       const deadline = Date.now() + timeout;
       while (Date.now() < deadline) {
         const value = await predicate();
         if (value) return value;
         await wait(150);
       }
      return null;
    };
    const clickButtonByText = (text, exact = false) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const button = buttons.find((node) => {
        const normalized = normalize(node);
        return exact ? normalized === text : normalized.includes(text);
      });
      return { clicked: activate(button), text: button ? normalize(button) : '' };
    };
    const searchAssetLibrary = async (text) => {
      const input = Array.from(document.querySelectorAll('.studio-asset-library input'))
        .find((node) => node.getAttribute('placeholder') === '搜索名称');
      if (!input) return false;
      input.focus();
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, text);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(900);
      return true;
    };
    const searchVoiceAssignDialog = async (text) => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).at(-1);
      const input = dialog
        ? Array.from(dialog.querySelectorAll('input'))
          .find((node) => node.getAttribute('placeholder') === '搜索音频名称或文件名')
        : null;
      if (!input) return false;
      input.focus();
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, text);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(500);
      return true;
    };
    const closeTopDialog = async () => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      const dialog = dialogs.at(-1);
      if (!dialog) return false;
      const beforeCount = dialogs.length;
      const closeButton = Array.from(dialog.querySelectorAll('button'))
        .find((node) => normalize(node) === 'Close' || node.querySelector('.sr-only')?.textContent?.trim() === 'Close');
      const clicked = activate(closeButton);
      if (!clicked) return false;
      await waitFor(() => document.querySelectorAll('[role="dialog"]').length < beforeCount, 3000);
      return document.querySelectorAll('[role="dialog"]').length < beforeCount;
    };

    const clickedAssets = clickButtonByText('资产');
    await waitFor(() => document.body.innerText.includes('个人资产库'));
    const clickedRole = clickButtonByText('角色', true);
    await waitFor(() => document.body.innerText.includes('角色库'));
    await searchAssetLibrary('Smoke测试剑修');
    await waitFor(() => document.body.innerText.includes('Smoke测试剑修'));

    const bodyAfterRole = document.body.innerText;
    const roleCards = Array.from(document.querySelectorAll('.studio-asset-library button[title]'))
      .filter((node) => {
        const title = node.getAttribute('title') || '';
        const text = normalize(node);
        return title.trim().length > 0 && !text.includes('自动分配音频') && !text.includes('多选') && !text.includes('添加');
      });
    const smokeRoleCard = roleCards.find((node) => (node.getAttribute('title') || '').includes('Smoke测试剑修') || normalize(node).includes('Smoke测试剑修'));
    const clickedRoleCard = activate(smokeRoleCard || roleCards[0]);
    await waitFor(() => document.body.innerText.includes('尚未分配音色') || document.body.innerText.includes('音色信息'));

    const detailText = document.body.innerText;
    const audioPanelButton = Array.from(document.querySelectorAll('.studio-asset-detail-dialog button'))
      .find((node) => normalize(node).includes('音色'));
    await waitFor(async () => {
      const result = await window.studioAssets?.list?.({ type: 'audio', search: 'Smoke青年男声', limit: 10 });
      return result?.items?.length ? result : null;
    }, 5000);
    const clickedVoicePanel = activate(audioPanelButton);
    await waitFor(() => document.body.innerText.includes('资产库音频'));
    const searchedVoiceDialog = await searchVoiceAssignDialog('Smoke青年男声');
    const voiceCandidate = await waitFor(() => Array.from(document.querySelectorAll('[role="dialog"] button[title], .studio-asset-detail-dialog button[title], button[title]'))
      .find((node) => (node.getAttribute('title') || '').includes('Smoke青年男声') || normalize(node).includes('Smoke青年男声')), 8000);
    const dialogText = document.body.innerText;
    const clickedVoiceCandidate = activate(voiceCandidate);
    await wait(250);
    const confirmAssign = clickButtonByText('确认分配');
    await waitFor(() => document.body.innerText.includes('已绑定音色音频') || !document.body.innerText.includes('资产库音频'));
    const afterAssignText = document.body.innerText;
    await waitFor(() => document.body.innerText.includes('克隆音色') || document.body.innerText.includes('音色信息'));
    const afterBindingText = document.body.innerText;
    const closedVoiceDialog = await closeTopDialog();
    const closedRoleDetailDialog = await closeTopDialog();
    const dialogsClosedBeforeAudio = await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 0, 3000);
    const openDialogCountBeforeAudio = document.querySelectorAll('[role="dialog"]').length;
    const clickedAudio = clickButtonByText('配音', true);
    await waitFor(() => document.body.innerText.includes('配音库'));
    await searchAssetLibrary('Smoke青年男声');
    await waitFor(() => document.body.innerText.includes('Smoke青年男声'));
    const audioLibraryText = document.body.innerText;
    const audioCards = Array.from(document.querySelectorAll('.studio-asset-library button[title]'));
    const smokeAudioCard = audioCards.find((node) => (node.getAttribute('title') || '').includes('Smoke青年男声') || normalize(node).includes('Smoke青年男声'));
    const clickedAudioCard = activate(smokeAudioCard || audioCards[0]);
    await waitFor(() => document.querySelector('audio[controls]'));
    const audioElement = document.querySelector('audio[controls]');
    const audioLoadResult = audioElement ? await new Promise((resolve) => {
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        resolve(result);
      };
      const timeout = setTimeout(() => finish({
        loadedmetadata: false,
        readyState: audioElement.readyState,
        currentSrc: audioElement.currentSrc || audioElement.getAttribute('src') || '',
        error: audioElement.error?.message || audioElement.error?.code || null,
      }), ${AUDIO_METADATA_TIMEOUT_MS});
      audioElement.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        finish({
          loadedmetadata: true,
          readyState: audioElement.readyState,
          duration: Number.isFinite(audioElement.duration) ? audioElement.duration : null,
          currentSrc: audioElement.currentSrc || audioElement.getAttribute('src') || '',
          error: null,
        });
      }, { once: true });
      audioElement.addEventListener('error', () => {
        clearTimeout(timeout);
        finish({
          loadedmetadata: false,
          readyState: audioElement.readyState,
          currentSrc: audioElement.currentSrc || audioElement.getAttribute('src') || '',
          error: audioElement.error?.message || audioElement.error?.code || 'audio error',
        });
      }, { once: true });
      audioElement.load();
      if (audioElement.readyState >= 1) {
        clearTimeout(timeout);
        finish({
          loadedmetadata: true,
          readyState: audioElement.readyState,
          duration: Number.isFinite(audioElement.duration) ? audioElement.duration : null,
          currentSrc: audioElement.currentSrc || audioElement.getAttribute('src') || '',
          error: null,
        });
      }
    }) : { loadedmetadata: false, readyState: -1, currentSrc: '', error: 'audio[controls] missing' };

    return {
      clickedAssets: clickedAssets.clicked,
      clickedRole: clickedRole.clicked,
      hasRoleLibrary: bodyAfterRole.includes('角色库'),
      hasAutoAssignAudio: bodyAfterRole.includes('自动分配音频'),
      roleCardCount: roleCards.length,
      clickedRoleCard,
      hasRoleDetail: detailText.includes('名字') && detailText.includes('音色'),
      clickedVoicePanel,
      searchedVoiceDialog,
      hasVoiceDialog: dialogText.includes('为角色「') && dialogText.includes('分配音色'),
      hasVoiceDialogAudioSection: dialogText.includes('资产库音频'),
      hasConfirmAssign: dialogText.includes('确认分配'),
      clickedVoiceCandidate,
      clickedConfirmAssign: confirmAssign.clicked,
      hasAssignSuccess: afterAssignText.includes('已绑定音色音频') || afterBindingText.includes('克隆音色'),
      hasBoundVoiceDetail: afterBindingText.includes('音色信息') && afterBindingText.includes('克隆音色'),
      voiceDialogShowsAudioOrEmptyState:
        dialogText.includes('共 ') ||
        dialogText.includes(' / ') ||
        dialogText.includes('搜索音频名称或文件名') ||
        dialogText.includes('Smoke青年男声') ||
        dialogText.includes('资产库中暂无可用音频。请先在资产库导入 WAV/MP3 音色样本。'),
      closedVoiceDialog,
      closedRoleDetailDialog: closedRoleDetailDialog || Boolean(dialogsClosedBeforeAudio),
      openDialogCountBeforeAudio,
      clickedAudio: clickedAudio.clicked,
      hasAudioLibrary: audioLibraryText.includes('配音库'),  // 1df6ef8 音频→配音改名对齐(旧断言 音频库/音色 已不存在)
      audioCardCount: audioCards.length,
      clickedAudioCard,
      hasAudioControls: Boolean(audioElement),
      audioLoadedMetadata: Boolean(audioLoadResult.loadedmetadata),
      audioReadyState: audioLoadResult.readyState,
      audioCurrentSrc: audioLoadResult.currentSrc,
      audioError: audioLoadResult.error,
      bodyTextSample: dialogText.slice(0, 1000),
    };
  })()`,
    "asset voice flow check",
    ASSET_VOICE_FLOW_TIMEOUT_MS,
  );
  return { ...flow, seed };
}

async function verifyScriptAssetGenerationVoiceFlow(evaluate) {
  return evaluate(
    `(async () => {
    const normalize = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const activate = (node) => {
      if (!node) return false;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, view: window }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, timeout = 5000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await wait(150);
      }
      return null;
    };
    const clickButtonByText = (text, exact = false) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const button = buttons.find((node) => {
        const normalized = normalize(node);
        return exact ? normalized === text : normalized.includes(text);
      });
      return { clicked: activate(button), text: button ? normalize(button) : '' };
    };

    await waitFor(() => window.mystudioWorkflowSmoke?.seedCompleteWorkflow, 10_000);
    const seedResult = await window.mystudioWorkflowSmoke?.seedCompleteWorkflow?.();
    const clickedWorkflow = clickButtonByText('工作流', true);
    await waitFor(() => document.body.innerText.includes('当前工作区：漫影工作流'), 5000);
    await window.mystudioWorkflowSmoke?.setWorkflowStage?.('assets');
    await wait(900);
    const bodyBefore = document.body.innerText;
    const clickedAutoAssign = clickButtonByText('自动分配音频');
    await waitFor(async () => {
      const inspected = await window.mystudioWorkflowSmoke?.inspectWorkflow?.();
      return inspected?.checks?.hasVoiceBinding ? inspected : null;
    }, 5000);
    const inspectResult = await window.mystudioWorkflowSmoke?.inspectWorkflow?.();
    const bodyAfter = document.body.innerText;
    return {
      seedResult,
      clickedWorkflow: clickedWorkflow.clicked,
      hasGenerationStage: bodyBefore.includes('资产生成') && bodyBefore.includes('承接本阶段已提取的角色、场景、道具'),
      hasAutoAssignAudio: bodyBefore.includes('自动分配音频'),
      hasCharacterRow: bodyBefore.includes('独孤剑尘'),
      clickedAutoAssign: clickedAutoAssign.clicked,
      hasVoiceBinding: Boolean(inspectResult?.checks?.hasVoiceBinding),
      hasAutoAssignSuccess:
        (bodyAfter.includes('已为 ') && bodyAfter.includes('自动分配音频')) ||
        (bodyAfter.includes('参考音频 1/1') && bodyAfter.includes('已绑定音色音频')),
      inspectResult,
      bodyTextSample: bodyAfter.slice(0, 1000),
    };
  })()`,
    "script asset generation voice flow check",
    ASSET_VOICE_FLOW_TIMEOUT_MS,
  );
}

async function captureScreenshotStats(send) {
  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const png = PNG.sync.read(Buffer.from(screenshot.data, "base64"));
  let sampled = 0;
  let white = 0;
  let transparent = 0;
  const pixelStride = Math.max(
    1,
    Math.floor((png.width * png.height) / 80_000),
  );

  for (let y = 0; y < png.height; y += pixelStride) {
    for (let x = 0; x < png.width; x += pixelStride) {
      const offset = (png.width * y + x) * 4;
      const r = png.data[offset];
      const g = png.data[offset + 1];
      const b = png.data[offset + 2];
      const a = png.data[offset + 3];
      sampled += 1;
      if (a < 16) transparent += 1;
      if (r > 245 && g > 245 && b > 245 && a > 240) white += 1;
    }
  }

  return {
    source: "screenshot",
    width: png.width,
    height: png.height,
    sampled,
    whiteRatio: sampled > 0 ? white / sampled : 1,
    transparentRatio: sampled > 0 ? transparent / sampled : 1,
    bytes: screenshot.data.length,
  };
}

async function captureVisualStats(send, domVisualStats) {
  try {
    return await captureScreenshotStats(send);
  } catch (error) {
    const captureError = error instanceof Error ? error.message : String(error);
    console.warn(
      `[smoke] screenshot capture failed, falling back to DOM visual stats: ${captureError}`,
    );
    return { ...domVisualStats, captureError };
  }
}

async function captureDomVisualStats(evaluate) {
  return evaluate(
    `(() => {
    const parseColor = (color) => {
      const match = color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
      if (!match) return null;
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
        a: match[4] === undefined ? 1 : Number(match[4]),
      };
    };
    const visibleColorAt = (x, y) => {
      let node = document.elementFromPoint(x, y);
      while (node && node instanceof Element) {
        const color = parseColor(getComputedStyle(node).backgroundColor);
        if (color && color.a > 0.1) return color;
        node = node.parentElement;
      }
      return parseColor(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    };
    const points = [];
    const columns = 9;
    const rows = 7;
    for (let row = 1; row <= rows; row += 1) {
      for (let col = 1; col <= columns; col += 1) {
        points.push({
          x: Math.round((window.innerWidth * col) / (columns + 1)),
          y: Math.round((window.innerHeight * row) / (rows + 1)),
        });
      }
    }
    let white = 0;
    let transparent = 0;
    for (const point of points) {
      const color = visibleColorAt(point.x, point.y);
      if (color.a < 0.1) transparent += 1;
      if (color.r > 245 && color.g > 245 && color.b > 245 && color.a > 0.9) white += 1;
    }
    return {
      source: 'dom',
      captureError: null,
      width: window.innerWidth,
      height: window.innerHeight,
      sampled: points.length,
      whiteRatio: points.length > 0 ? white / points.length : 1,
      transparentRatio: points.length > 0 ? transparent / points.length : 1,
      bodyTextLength: document.body.innerText.trim().length,
    };
  })()`,
    "DOM visual stats fallback",
  );
}

function assertHealthy(
  state,
  errors,
  overviewWorkflow,
  routeChecks,
  workflowStages,
  workflowEndToEnd,
  workflowStepwise,
  assetVoiceFlow,
  scriptAssetGenerationVoiceFlow,
  pluginSettings,
  remotionExport,
  remotionArtifact,
  screenshot,
  allowedErrors,
  foregroundViolation,
) {
  const failures = [];
  if (state.readyState !== "complete")
    failures.push(`document not complete: ${state.readyState}`);
  if (state.rootChildren < 1) failures.push("React root has no children");
  if (state.hasWhiteBody)
    failures.push(`body background is white: ${state.bodyBg}`);
  if (state.bodyTextLength < 20)
    failures.push(`body text is too short: ${state.bodyTextLength}`);
  if (!state.hasProjectOverview && !state.hasWorkspaceContent) {
    failures.push(
      "neither project dashboard nor workspace content was rendered",
    );
  }
  if (!overviewWorkflow.clickedOverview || !overviewWorkflow.hasProjectEntry) {
    failures.push("project overview entry did not render");
  }
  if (!overviewWorkflow.hasWorkflowEntry || !overviewWorkflow.hasAssetEntry) {
    failures.push(
      "project overview is missing workflow or asset entry actions",
    );
  }
  if (overviewWorkflow.forbiddenTextFound.length > 0) {
    failures.push(
      `project overview rendered removed workflow guide copy: ${overviewWorkflow.forbiddenTextFound.join(", ")}`,
    );
  }
  for (const route of routeChecks) {
    if (!route.clicked) failures.push(`route button not found: ${route.label}`);
    if (route.clicked && !route.hasRequiredText) {
      failures.push(
        `route missing required content: ${route.label} (${route.missingRequiredText.join(", ")})`,
      );
    }
    if (route.clicked && route.forbiddenTextFound.length > 0) {
      failures.push(
        `route rendered forbidden content: ${route.label} (${route.forbiddenTextFound.join(", ")})`,
      );
    }
  }
  if (!workflowStages.clickedWorkflow)
    failures.push("workflow route button not found for stage checks");
  if (workflowStages.hasTopNodeCanvas) {
    failures.push(
      "workflow node canvas rendered above the workflow stage content",
    );
  }
  const storyboardStage = (workflowStages.stages || []).find(
    (stage) => stage.id === "storyboard",
  );
  const generationStage = (workflowStages.stages || []).find(
    (stage) => stage.id === "assets",
  );
  if (!storyboardStage?.hasNodeCanvas) {
    failures.push(
      `storyboard video generation React Flow workflow canvas did not render: canvas=${storyboardStage?.hasNodeCanvas}`,
    );
  }
  if (generationStage?.hasGenerationNodeCanvas) {
    failures.push(
      "workflow node canvas rendered inside 剧本资产管理 instead of 分镜视频生成",
    );
  }
  const expectedProductionNodes = [
    "script",
    "scriptPlan",
    "storyboardTable",
    "storyboard",
    "workbench",
  ];
  const missingProductionNodes = expectedProductionNodes.filter(
    (node) => !storyboardStage?.productionNodes?.includes(node),
  );
  if (missingProductionNodes.length > 0) {
    failures.push(
      `storyboard workflow node layout missing nodes: ${missingProductionNodes.join(", ")}`,
    );
  }
  for (const stage of workflowStages.stages || []) {
    if (!stage.clicked)
      failures.push(`workflow stage button not found: ${stage.label}`);
    if (stage.clicked && !stage.hasRequiredText) {
      failures.push(
        `workflow stage missing required content: ${stage.label} (${stage.missingRequiredText.join(", ")})`,
      );
    }
    if (stage.clicked && stage.hasForbiddenText) {
      failures.push(
        `workflow stage rendered removed content: ${stage.label} (${stage.presentForbiddenText.join(", ")})`,
      );
    }
  }
  if (!workflowEndToEnd.bridgeAvailable)
    failures.push("workflow smoke bridge was not available");
  if (!workflowEndToEnd.clickedWorkflow)
    failures.push("workflow route button not found for end-to-end check");
  if (
    !workflowEndToEnd.inspectResult ||
    workflowEndToEnd.inspectResult.progress !== 100
  ) {
    failures.push(
      `workflow end-to-end readiness did not reach 100%: ${workflowEndToEnd.inspectResult?.progress ?? "missing"}`,
    );
  }
  const workflowChecks = workflowEndToEnd.inspectResult?.checks ?? {};
  for (const [key, ok] of Object.entries(workflowChecks)) {
    if (!ok) failures.push(`workflow end-to-end check failed: ${key}`);
  }
  if (
    !workflowEndToEnd.hasCompletedExport ||
    !workflowEndToEnd.hasEditingProject ||
    !workflowEndToEnd.hasTimelineRenderRecord ||
    !workflowEndToEnd.hasCompleteTimelineEvidence ||
    !workflowEndToEnd.seededEditingEvidence ||
    !workflowEndToEnd.doesNotClaimRealMediaGeneration ||
    !workflowEndToEnd.hasSelectedCandidate ||
    !workflowEndToEnd.hasVoiceFlow ||
    !workflowEndToEnd.hasVoiceAudio
  ) {
    failures.push(
      "workflow end-to-end UI did not expose seeded EditingProject, current timeline evidence, selected candidate, voice binding, and voice audio completion",
    );
  }
  if (!workflowEndToEnd.hasNodeFlowDataPreview) {
    failures.push(
      `workflow node cards did not show Toonflow FlowData previews: ${(workflowEndToEnd.missingNodePreviewText || []).join(", ")}`,
    );
  }
  if (!workflowEndToEnd.hasDirectorPlanPreview) {
    failures.push(
      "workflow node cards did not show director plan markdown content",
    );
  }
  if (!workflowEndToEnd.hasToonflowDerivativeLinks) {
    failures.push(
      "workflow node cards did not show Toonflow derivative asset links",
    );
  }
  if (
    !workflowEndToEnd.clickedDerivativeImageWorkflow ||
    !workflowEndToEnd.hasDerivativeImageWorkflowDetail
  ) {
    failures.push(
      "workflow derivative asset card did not open Toonflow image workflow detail",
    );
  }
  if (!workflowEndToEnd.hasStoryboardImagePreview) {
    failures.push(
      "storyboard workflow node did not show generated image previews",
    );
  }
  if (!workflowEndToEnd.hasNoDefaultReactFlowControls) {
    failures.push(
      "storyboard workflow node rendered default white React Flow controls",
    );
  }
  if (!workflowEndToEnd.hasThemeViewportControls) {
    failures.push(
      "storyboard workflow node did not render themed viewport controls",
    );
  }
  if (runStepwiseWorkflowSmoke) {
    if (!workflowStepwise?.bridgeAvailable) {
      failures.push("workflow step-by-step smoke bridge was not available");
    }
    if (!workflowStepwise?.clickedWorkflow) {
      failures.push("workflow route button not found for step-by-step execution");
    }
    if (workflowStepwise?.source !== "isolated-smoke-project") {
      failures.push(
        `workflow step-by-step smoke used unexpected data source: ${workflowStepwise?.source || "missing"}`,
      );
    }
    if (!workflowStepwise?.completed || workflowStepwise?.progress !== 100) {
      failures.push(
        `workflow step-by-step execution did not reach 100%: ${workflowStepwise?.progress ?? "missing"}`,
      );
    }
    const failedStepwiseStages = (workflowStepwise?.results || [])
      .filter((stage) => !stage.ready)
      .map((stage) => `${stage.id}:${stage.evidence || "no evidence"}`);
    if (failedStepwiseStages.length > 0) {
      failures.push(
        `workflow step-by-step stages failed: ${failedStepwiseStages.join(", ")}`,
      );
    }
    const scriptStep = (workflowStepwise?.results || []).find((stage) => stage.id === "script");
    const scriptEvidence = scriptStep?.evidence || "";
    for (const reviewKey of [
      "storySkeletonReview=1",
      "adaptationStrategyReview=1",
      "scriptDraftReview=1",
    ]) {
      if (!scriptEvidence.includes(reviewKey)) {
        failures.push(`workflow step-by-step script review evidence missing: ${reviewKey}`);
      }
    }
  }
  if (!assetVoiceFlow.clickedAssets)
    failures.push("assets route button not found for asset voice flow check");
  if (!assetVoiceFlow.clickedRole)
    failures.push("role asset sidebar item not found");
  if (!assetVoiceFlow.hasRoleLibrary || !assetVoiceFlow.hasAutoAssignAudio) {
    failures.push("role asset library did not render role voice actions");
  }
  if (assetVoiceFlow.roleCardCount < 1 || !assetVoiceFlow.clickedRoleCard) {
    failures.push(
      `no role asset card could be opened: ${assetVoiceFlow.roleCardCount}`,
    );
  }
  if (!assetVoiceFlow.hasRoleDetail || !assetVoiceFlow.clickedVoicePanel) {
    failures.push(
      "role asset detail did not expose the voice assignment entry",
    );
  }
  if (
    !assetVoiceFlow.hasVoiceDialog ||
    !assetVoiceFlow.hasVoiceDialogAudioSection ||
    !assetVoiceFlow.hasConfirmAssign
  ) {
    failures.push(
      "role voice assignment dialog did not render required controls",
    );
  }
  if (
    !assetVoiceFlow.clickedVoiceCandidate ||
    !assetVoiceFlow.searchedVoiceDialog ||
    !assetVoiceFlow.clickedConfirmAssign ||
    !assetVoiceFlow.hasAssignSuccess
  ) {
    failures.push(
      "role voice assignment did not select and bind the seeded audio",
    );
  }
  if (!assetVoiceFlow.hasBoundVoiceDetail) {
    failures.push(
      "role detail did not show the bound cloned voice after assignment",
    );
  }
  if (!assetVoiceFlow.voiceDialogShowsAudioOrEmptyState) {
    failures.push(
      "role voice assignment dialog did not show audio options or empty state",
    );
  }
  if (
    !assetVoiceFlow.closedVoiceDialog ||
    assetVoiceFlow.openDialogCountBeforeAudio > 0
  ) {
    failures.push(
      `asset voice flow left dialogs open before opening the audio library: ${assetVoiceFlow.openDialogCountBeforeAudio}`,
    );
  }
  if (!assetVoiceFlow.clickedAudio || !assetVoiceFlow.hasAudioLibrary) {
    failures.push(
      "audio asset library could not be reached for playback entry check",
    );
  }
  if (
    !assetVoiceFlow.clickedAudioCard ||
    !assetVoiceFlow.hasAudioControls ||
    !assetVoiceFlow.audioLoadedMetadata
  ) {
    failures.push(
      `audio detail playback control did not load metadata: ${assetVoiceFlow.audioError || assetVoiceFlow.audioReadyState}`,
    );
  }
  if (
    !scriptAssetGenerationVoiceFlow.hasGenerationStage ||
    !scriptAssetGenerationVoiceFlow.hasAutoAssignAudio ||
    !scriptAssetGenerationVoiceFlow.hasCharacterRow
  ) {
    failures.push(
      "script asset generation did not expose role audio assignment",
    );
  }
  if (
    !scriptAssetGenerationVoiceFlow.clickedAutoAssign ||
    !scriptAssetGenerationVoiceFlow.hasVoiceBinding
  ) {
    failures.push(
      "script asset generation voice assignment did not bind a character voice",
    );
  }
  if (!pluginSettings.clickedSettings)
    failures.push("settings route button not found for plugin settings check");
  if (!pluginSettings.clickedPluginTab)
    failures.push("plugin settings tab was not found");
  if (!pluginSettings.hasRequiredText) {
    failures.push(
      `plugin settings missing Python section content: ${pluginSettings.missingRequiredText.join(", ")}`,
    );
  }
  if (pluginSettings.forbiddenTextFound.length > 0) {
    failures.push(
      `plugin settings appears to auto-configure before user action: ${pluginSettings.forbiddenTextFound.join(", ")}`,
    );
  }
  if (runRemotionExportSmoke) {
    const expectBlockedExport = remotionExportSmokeMode === "blocked";
    const expectCanceledExport = remotionExportSmokeMode === "cancel";
    if (!remotionExport?.success) {
      failures.push(`Remotion export smoke failed: ${remotionExport?.error || "missing result"}`);
    }
    if (!remotionExport?.settings?.clickedSettings
      || !remotionExport?.settings?.clickedPluginTab
      || !remotionExport?.settings?.clickedRemotion
      || !remotionExport?.settings?.rendererSelected
      || !remotionExport?.settings?.hasRuntimeStatus) {
      failures.push("Remotion settings UI was not fully exercised");
    }
    if (!expectBlockedExport
      && remotionExport?.initialBrowserStatus?.state !== "ready"
      && !remotionExport?.settings?.clickedBrowserDownload) {
      failures.push("Remotion browser was not ready and the settings download action was not used");
    }
    if (!expectBlockedExport && remotionExport?.browserStatus?.state !== "ready") {
      failures.push(`Remotion browser status is ${remotionExport?.browserStatus?.state || "missing"}`);
    }
    if (!remotionExport?.previewReleased
      || remotionExport?.preview?.width !== SMOKE_VIDEO_WIDTH
      || remotionExport?.preview?.height !== SMOKE_VIDEO_HEIGHT
      || remotionExport?.preview?.fps !== SMOKE_VIDEO_FPS
      || remotionExport?.preview?.visualClipCount !== 1) {
      failures.push("Remotion shot preview session evidence is incomplete");
    }
    if (!remotionExport?.studioHost?.mounted) {
      failures.push("native Remotion Studio host did not mount inside the packaged workbench");
    }
    if (expectBlockedExport
      && (remotionExport?.render?.success !== false
        || remotionExport?.noDownloadObserved !== true
        || remotionExport?.browserStatus?.state === "ready")) {
      failures.push("Remotion export was not blocked before download");
    }
    if (expectCanceledExport
      && (remotionExport?.cancel?.success !== true
        || remotionExport?.cancel?.canceled !== true
        || remotionExport?.render?.success !== false
        || remotionExport?.render?.canceled !== true
        || !remotionExport?.renderProgress?.some((progress) => progress.stage === "canceled")
        || remotionArtifact?.cancellationArtifactsPresent !== true
        || remotionArtifact?.currentSlotPreserved !== true
        || remotionArtifact?.realMediaGeneration !== false)) {
      failures.push("Remotion cancellation did not preserve artifacts or quarantine partial output");
    }
    if (!expectBlockedExport
      && !expectCanceledExport
      && !remotionExport?.queueStates?.includes("succeeded")) {
      failures.push("Remotion shot queue did not report succeeded");
    }
    if (!remotionArtifact?.ok) {
      failures.push(`Remotion artifact verification failed: ${(remotionArtifact?.issues || []).join(", ")}`);
    }
  }
  if (!screenshot || screenshot.whiteRatio > 0.75) {
    failures.push(
      `screenshot is too white: ${screenshot ? screenshot.whiteRatio.toFixed(3) : "missing"}`,
    );
  }
  if (!screenshot || screenshot.transparentRatio > 0.1) {
    failures.push(
      `screenshot is unexpectedly transparent: ${screenshot ? screenshot.transparentRatio.toFixed(3) : "missing"}`,
    );
  }
  if (errors.length > 0)
    failures.push(`page reported ${errors.length} runtime/log error(s)`);
  // CI 无头 runner 上被测应用是唯一 GUI 应用,必然 frontmost,该检查只对
  // 真实用户桌面有意义;CI 以 MYSTUDIO_SMOKE_ALLOW_FOREGROUND=1 豁免。
  if (smokeMode === "background" && foregroundViolation && !allowForeground) {
    failures.push("background smoke brought MYStudio to the foreground");
  }

  if (failures.length > 0) {
    console.error("Desktop smoke failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error(JSON.stringify(state, null, 2));
    console.error(
      JSON.stringify(
        {
          overviewWorkflow,
          routeChecks,
          workflowEndToEnd,
          workflowStepwise,
          assetVoiceFlow,
          scriptAssetGenerationVoiceFlow,
          pluginSettings,
          remotionExport,
          remotionArtifact,
          screenshot,
          pageErrors: errors.map(summarizePageError),
          allowedPageErrors: allowedErrors.map(summarizePageError),
        },
        null,
        2,
      ),
    );
    throw new Error(`Desktop smoke failed with ${failures.length} failure(s)`);
  }

  const workflowStepwiseSummary = runStepwiseWorkflowSmoke
    ? ", workflowStepwise=ok"
    : "";
  const remotionSummary = runRemotionExportSmoke
    ? remotionExportSmokeMode === "blocked"
      ? `, remotionExport=blocked, browserState=${remotionArtifact.browserState}`
      : remotionExportSmokeMode === "cancel"
        ? `, remotionExport=canceled, artifacts=${remotionArtifact.cancellationArtifactsPresent ? "ok" : "missing"}`
        : `, remotionExport=ok, remotionSha256=${remotionArtifact.sha256}`
    : "";
  console.log(
    `Desktop smoke passed: ${state.title}, rootChildren=${state.rootChildren}, bodyBg=${state.bodyBg}, routes=${routeChecks.length}, workflowE2E=ok${workflowStepwiseSummary}, assetVoiceFlow=ok, scriptAssetGenerationVoiceFlow=ok, pluginSettings=ok${remotionSummary}, whiteRatio=${screenshot.whiteRatio.toFixed(3)}, appBin=${appBin}`,
  );
}

stopExistingMYStudioInstances();
prepareSmokeMedia();
prepareRemotionBrowserStateFixture();

const focusSamples = [];
if (smokeMode === "background") {
  focusSamples.push(sampleFrontmostApplication("before app launch"));
}
let smokeReport = {
  mode: smokeMode,
  launchMode: smokeLaunchMode,
  focusSamples,
  foregroundViolation: false,
};
let smokePassed = false;

const childEnv = {
  ...process.env,
  ELECTRON_ENABLE_LOGGING: "1",
  MYSTUDIO_SMOKE: "1",
  MYSTUDIO_SMOKE_BACKGROUND: foregroundSmoke ? "0" : "1",
};

const smokeAppArgs = [
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`,
];
let activeLaunch = spawnSmokeApp({
  appBin,
  args: smokeAppArgs,
  cwd: process.cwd(),
  env: childEnv,
  detached: keepSmokeAppOpen,
  launchMode: smokeLaunchMode === "launch-services" ? "launch-services" : "direct",
});
let child = activeLaunch.child;
watchSmokeChild(child, { trackExit: activeLaunch.tracksChildExit });

const forwardStdout = (data) => process.stdout.write(data);
const forwardStderr = (data) => process.stderr.write(data);
function attachChildOutput(childProcess) {
  childProcess.stdout?.on("data", forwardStdout);
  childProcess.stderr?.on("data", forwardStderr);
}
attachChildOutput(child);

try {
  let page;
  try {
    page = await waitForPageTarget();
  } catch (error) {
    if (!shouldFallbackToLaunchServices({
      platform: process.platform,
      childExit: smokeChildExit,
      launchMode: smokeLaunchMode,
    })) {
      throw error;
    }
    console.warn(
      "[smoke] direct Electron launch aborted before page startup; retrying through macOS LaunchServices",
    );
    await terminateSpawnedApp(child, { detached: keepSmokeAppOpen, logPrefix: "[smoke]" });
    activeLaunch = spawnSmokeApp({
      appBin,
      args: smokeAppArgs,
      cwd: process.cwd(),
      env: childEnv,
      detached: keepSmokeAppOpen,
      launchMode: "launch-services",
    });
    child = activeLaunch.child;
    watchSmokeChild(child, { trackExit: activeLaunch.tracksChildExit });
    attachChildOutput(child);
    page = await waitForPageTarget();
  }
  if (smokeMode === "background") {
    focusSamples.push(sampleFrontmostApplication("after CDP target appeared"));
  }
  bringSmokeAppToForeground(child, activeLaunch.launchMode);
  const {
    state,
    errors,
    allowedErrors,
    overviewWorkflow,
    smokeEnvironment,
    routeChecks,
    workflowStages,
    workflowEndToEnd,
    workflowStepwise,
    assetVoiceFlow,
    scriptAssetGenerationVoiceFlow,
    pluginSettings,
    remotionExport,
    screenshot,
  } = await inspectPage(page);
  const remotionArtifact = inspectRemotionExportArtifact(remotionExport);
  if (smokeMode === "background") {
    focusSamples.push(sampleFrontmostApplication("after desktop checks"));
  }
  const foregroundViolation = hasMYStudioForegroundViolation(focusSamples);
  smokeReport = {
    ok: true,
    mode: smokeMode,
    launchMode: activeLaunch.launchMode,
    windowVisibility: state.visibilityState,
    documentHasFocus: state.documentHasFocus,
    focusSamples,
    foregroundViolation,
    state,
    smokeEnvironment,
    overviewWorkflow,
    routeChecks,
    workflowStages,
    workflowEndToEnd,
    workflowStepwise,
    assetVoiceFlow,
    scriptAssetGenerationVoiceFlow,
    pluginSettings,
    remotionExport,
    remotionArtifact,
    realMediaGeneration: runRemotionExportSmoke
      && remotionExportSmokeMode === "1"
      && remotionExport.success
      && remotionArtifact.ok,
    screenshot,
    pageErrors: errors.map(summarizePageError),
    allowedPageErrors: allowedErrors.map(summarizePageError),
  };
  assertHealthy(
    state,
    errors,
    overviewWorkflow,
    routeChecks,
    workflowStages,
    workflowEndToEnd,
    workflowStepwise,
    assetVoiceFlow,
    scriptAssetGenerationVoiceFlow,
    pluginSettings,
    remotionExport,
    remotionArtifact,
    screenshot,
    allowedErrors,
    foregroundViolation,
  );
  smokePassed = true;
} catch (error) {
  smokeReport = {
    ...(smokeReport ?? {}),
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  try {
    if (smokeMode === "background") {
      focusSamples.push(sampleFrontmostApplication("before smoke report"));
      smokeReport.focusSamples = focusSamples;
      smokeReport.foregroundViolation = hasMYStudioForegroundViolation(focusSamples);
      if (smokeReport.foregroundViolation && !allowForeground) {
        smokeReport.ok = false;
        smokeReport.error = "background smoke brought MYStudio to the foreground";
        smokePassed = false;
        process.exitCode = 1;
      }
    }
    if (smokeReport) writeSmokeReport(smokeReport);
    if (smokePassed) await holdForegroundSmokeWindow();
  } finally {
    child.stdout?.off("data", forwardStdout);
    child.stderr?.off("data", forwardStderr);
    if (keepSmokeAppOpen && smokePassed) {
      child.unref();
      console.log(`[smoke] leaving app open: pid=${child.pid}, userDataDir=${userDataDir}`);
    } else {
      await terminateSpawnedApp(child, {
        detached: keepSmokeAppOpen,
        logPrefix: "[smoke]",
      });
      if (activeLaunch.launchMode === "launch-services") {
        stopExistingMYStudioInstances();
      }
    }
    rmSync(SMOKE_VIDEO_PATH, { force: true });
  }
}
