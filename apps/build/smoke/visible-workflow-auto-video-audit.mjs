import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

function issue(code, message) {
  return { code, message };
}

function isWithinRoot(filePath, rootPath) {
  const relativePath = relative(rootPath, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function auditVisibleAutoVideo({ chapterAutoVideo, userDataDir }) {
  const value = chapterAutoVideo || {};
  const issues = [];
  const finalPath = String(value.finalPath || "");
  const evidence = value.finalVideoEvidence || null;
  const timelineRecord = value.timelineRenderRecord || null;
  const timelineEvidence = value.timelineEvidence || null;
  const timelineArtifactPaths = value.timelineArtifactPaths || null;
  const projectId = String(value.projectId || "");
  const chapterId = String(value.chapterId || "");
  const startedAtMs = Number(value.startedAtMs);
  const expectedRoot = resolve(userDataDir, "media", "studio-render");

  if (value.enabled !== true) issues.push(issue("auto-video.disabled", "auto-video was not enabled"));
  if (value.stageClicked !== true) issues.push(issue("auto-video.stage", "storyboard stage was not clicked"));
  if (value.clicked !== true) issues.push(issue("auto-video.click", "one-click action was not clicked"));
  if (value.hasPostClickStageTransition !== true) {
    issues.push(issue("auto-video.transition", "no post-click stage transition was observed"));
  }
  if (value.terminalStage !== "completed") {
    issues.push(issue("auto-video.terminal", `terminal stage was ${value.terminalStage || "empty"}`));
  }
  if (value.timedOut === true) issues.push(issue("auto-video.timeout", "auto-video timed out"));
  if (value.hasFinalPathButton !== true) {
    issues.push(issue("auto-video.final-button", "final MP4 button was not visible"));
  }
  if (!projectId.trim()) {
    issues.push(issue("auto-video.project-id", "projectId is missing"));
  }
  if (!chapterId.trim()) {
    issues.push(issue("auto-video.chapter-id", "chapterId is missing"));
  }
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    issues.push(issue("auto-video.started-at", "startedAtMs is invalid"));
  }
  if (extname(finalPath).toLowerCase() !== ".mp4") {
    issues.push(issue("auto-video.extension", "final path is not an MP4"));
  }
  if (value.finalVideoEvidenceError) {
    issues.push(issue("auto-video.evidence-error", String(value.finalVideoEvidenceError)));
  }

  let fileStat = null;
  if (!finalPath || !existsSync(finalPath)) {
    issues.push(issue("auto-video.file-missing", "final MP4 does not exist"));
  } else {
    fileStat = statSync(finalPath);
    if (!fileStat.isFile() || fileStat.size <= 0) {
      issues.push(issue("auto-video.file-invalid", "final MP4 is not a non-empty regular file"));
    }
    try {
      if (dirname(realpathSync(finalPath)) !== realpathSync(expectedRoot)) {
        issues.push(issue("auto-video.clone-root", "final MP4 is outside the cloned studio-render root"));
      }
    } catch (error) {
      issues.push(issue("auto-video.realpath", error instanceof Error ? error.message : String(error)));
    }
    if (Number.isFinite(startedAtMs) && fileStat.mtimeMs < startedAtMs) {
      issues.push(issue("auto-video.stale-file", "final MP4 predates the one-click action"));
    }
  }

  if (!evidence) {
    issues.push(issue("auto-video.evidence-missing", "final media evidence is missing"));
  } else {
    if (evidence.path !== finalPath) issues.push(issue("auto-video.evidence-path", "evidence path differs from finalPath"));
    if (!(Number(evidence.sizeBytes) > 0) || (fileStat && evidence.sizeBytes !== fileStat.size)) {
      issues.push(issue("auto-video.evidence-size", "evidence size is invalid or stale"));
    }
    if (!(Number(evidence.mtimeMs) >= startedAtMs)) {
      issues.push(issue("auto-video.evidence-mtime", "evidence mtime predates the one-click action"));
    }
    if (!(Number(evidence.duration) > 0) || Number(evidence.duration) > 180) {
      issues.push(issue("auto-video.evidence-duration", "evidence duration is outside 0..180 seconds"));
    }
    if (!/^[a-f0-9]{64}$/.test(String(evidence.sha256 || ""))) {
      issues.push(issue("auto-video.evidence-sha256", "evidence SHA-256 is invalid"));
    }
    const streams = Array.isArray(evidence.streams) ? evidence.streams : [];
    if (!streams.includes("video") || !streams.includes("audio")) {
      issues.push(issue("auto-video.evidence-streams", "evidence lacks audio or video stream"));
    }
  }

  if (value.hasCurrentTimelineEvidence !== true) {
    issues.push(issue("auto-video.timeline-evidence-missing", "current EditingProject timeline evidence is missing or stale"));
  }
  if (!timelineRecord || !timelineEvidence) {
    issues.push(issue("auto-video.timeline-record-missing", "TimelineRenderRecord is missing"));
  } else {
    if (timelineRecord.projectId !== projectId) {
      issues.push(issue("auto-video.timeline-source-project", "timeline record projectId differs from the current project"));
    }
    if (timelineRecord.episodeId !== chapterId) {
      issues.push(issue("auto-video.timeline-source-episode", "timeline record episodeId differs from the current chapter"));
    }
    if (timelineRecord.editingProjectId !== value.editingProjectId) {
      issues.push(issue("auto-video.timeline-project", "timeline record project identity differs from the current EditingProject"));
    }
    if (timelineRecord.editingRevision !== value.editingRevision) {
      issues.push(issue("auto-video.timeline-revision", "timeline record revision differs from the current EditingProject"));
    }
    if (timelineRecord.sourceSnapshotHash !== value.editingSourceSnapshotHash) {
      issues.push(issue("auto-video.timeline-snapshot", "timeline record snapshot differs from the current EditingProject"));
    }
    if (timelineEvidence.path !== finalPath || timelineRecord.evidence?.path !== finalPath) {
      issues.push(issue("auto-video.timeline-path", "timeline evidence path differs from finalPath"));
    }
    const artifactKeys = [
      "outputPath",
      "snapshotPath",
      "renderPlanPath",
      "inputManifestPath",
      "filterGraphPath",
      "logPath",
      "ffprobePath",
    ];
    if (!timelineArtifactPaths || artifactKeys.some((key) => !String(timelineArtifactPaths[key] || "").trim())) {
      issues.push(issue("auto-video.timeline-artifacts", "timeline artifact paths are incomplete"));
    } else {
      let expectedRootRealPath = null;
      try {
        expectedRootRealPath = realpathSync(expectedRoot);
      } catch (error) {
        issues.push(issue("auto-video.timeline-root", error instanceof Error ? error.message : String(error)));
      }
      for (const key of artifactKeys) {
        const artifactPath = String(timelineArtifactPaths[key]);
        if (!existsSync(artifactPath)) {
          issues.push(issue("auto-video.timeline-artifact-missing", `${key} does not exist on disk`));
          continue;
        }
        const artifactStat = statSync(artifactPath);
        if (!artifactStat.isFile() || artifactStat.size <= 0) {
          issues.push(issue("auto-video.timeline-artifact-invalid", `${key} is not a non-empty regular file`));
        }
        if (expectedRootRealPath) {
          try {
            const artifactRealPath = realpathSync(artifactPath);
            if (!isWithinRoot(artifactRealPath, expectedRootRealPath)) {
              issues.push(issue("auto-video.timeline-artifact-root", `${key} is outside the cloned studio-render root`));
            }
          } catch (error) {
            issues.push(issue("auto-video.timeline-artifact-realpath", `${key}: ${error instanceof Error ? error.message : String(error)}`));
          }
        }
        if (Number.isFinite(startedAtMs) && artifactStat.mtimeMs < startedAtMs) {
          issues.push(issue("auto-video.timeline-artifact-stale", `${key} predates the one-click action`));
        }
      }
    }
  }

  return { ok: issues.length === 0, expectedRoot, issues };
}

export function auditVisibleFirstShotPreview({ firstShotPreview, userDataDir, expected }) {
  const value = firstShotPreview || {};
  const identity = expected || {};
  const issues = [];
  const slot = value.currentSlot || null;
  const target = slot?.target || null;
  const job = slot?.job || null;
  const evidence = slot?.evidence || null;
  const startedAtMs = Number(value.startedAtMs);
  const expectedRoot = resolve(
    userDataDir,
    "projects",
    "_p",
    String(identity.projectId || ""),
    "remotion",
  );
  const expectedOutputPath = `outputs/shots/${identity.chapterId || ""}/${identity.shotId || ""}/current.mp4`;
  const uiOutputPath = String(value.uiOutputPath || "");

  if (value.enabled !== true) issues.push(issue("first-shot.disabled", "first-shot preview was not enabled"));
  if (value.stageClicked !== true) issues.push(issue("first-shot.stage", "workbench stage was not clicked"));
  if (value.clicked !== true) issues.push(issue("first-shot.click", "first-shot preview action was not clicked"));
  if (value.clickedText !== "生成首镜横屏预览") {
    issues.push(issue("first-shot.action-label", "first-shot preview action label was not exact"));
  }
  if (value.terminalStatus !== "succeeded") {
    issues.push(issue("first-shot.terminal", `terminal status was ${value.terminalStatus || "empty"}`));
  }
  if (value.timedOut === true) issues.push(issue("first-shot.timeout", "first-shot preview timed out"));
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    issues.push(issue("first-shot.started-at", "startedAtMs is invalid"));
  }
  if (value.firstStoryboardId !== identity.shotId || value.firstShotRevision !== identity.shotRevision) {
    issues.push(issue("first-shot.source-identity", "first storyboard identity differs from the clone preflight"));
  }
  auditFirstShotRuntime(value, issues);

  if (!slot || !target || !job || !evidence) {
    issues.push(issue("first-shot.slot-missing", "matching succeeded current slot is missing"));
    return { ok: false, expectedRoot, expectedOutputPath, actualSha256: "", mediaProbe: null, issues };
  }

  const targetMatches = (candidate) => candidate
    && candidate.kind === "shot"
    && candidate.chapterId === identity.chapterId
    && candidate.shotId === identity.shotId
    && candidate.shotRevision === identity.shotRevision;
  if (slot.projectId !== identity.projectId || job.projectId !== identity.projectId || evidence.projectId !== identity.projectId) {
    issues.push(issue("first-shot.project", "slot/job/evidence project identity differs"));
  }
  if (!targetMatches(target) || !targetMatches(job.target) || !targetMatches(evidence.target)) {
    issues.push(issue("first-shot.target", "slot/job/evidence shot target differs"));
  }
  if (job.status !== "succeeded") issues.push(issue("first-shot.job-status", "current slot job is not succeeded"));
  if (slot.outputPath !== expectedOutputPath
    || job.outputPath !== expectedOutputPath
    || evidence.outputPath !== expectedOutputPath) {
    issues.push(issue("first-shot.output-contract", "current slot output path differs from the shot target"));
  }
  for (const key of [
    "jobId",
    "inputHash",
    "bundleContentHash",
    "renderSettingsHash",
    "templateVersion",
    "remotionVersion",
    "attempt",
  ]) {
    if (job[key] !== evidence[key]) {
      issues.push(issue("first-shot.core-identity", `job/evidence ${key} differs`));
    }
  }
  if (evidence.compositionId !== "StoryboardShot"
    || evidence.renderer?.requested !== "remotion"
    || evidence.renderer?.actual !== "remotion") {
    issues.push(issue("first-shot.renderer", "current slot is not StoryboardShot rendered by Remotion"));
  }
  const evidenceStreams = Array.isArray(evidence.streams) ? evidence.streams : [];
  const evidenceVideo = evidenceStreams.find((stream) => stream?.kind === "video");
  const evidenceAudio = evidenceStreams.find((stream) => stream?.kind === "audio");
  if (evidence.width !== 1920
    || evidence.height !== 1080
    || evidenceVideo?.codec !== "h264"
    || evidenceVideo?.width !== 1920
    || evidenceVideo?.height !== 1080) {
    issues.push(issue("first-shot.evidence-video", "current-slot evidence is not H.264 1920x1080"));
  }
  if (evidenceAudio?.codec !== "aac") {
    issues.push(issue("first-shot.evidence-audio", "current-slot evidence does not contain AAC audio"));
  }
  if (!(Number(evidence.durationUs) > 0)) {
    issues.push(issue("first-shot.evidence-duration", "current-slot evidence duration is invalid"));
  }
  if (!(Number(job.completedAt) >= startedAtMs)
    || !(Number(evidence.completedAt) >= startedAtMs)
    || !(Number(slot.publishedAt) >= Number(evidence.completedAt))) {
    issues.push(issue("first-shot.freshness", "current slot timestamps predate the button action or publication order"));
  }

  const absoluteOutputPath = resolve(expectedRoot, expectedOutputPath);
  let fileStat = null;
  let actualSha256 = "";
  let mediaProbe = null;
  if (!existsSync(absoluteOutputPath)) {
    issues.push(issue("first-shot.file-missing", "current-slot MP4 does not exist"));
  } else {
    fileStat = statSync(absoluteOutputPath);
    if (!fileStat.isFile() || fileStat.size <= 0) {
      issues.push(issue("first-shot.file-invalid", "current-slot MP4 is not a non-empty regular file"));
    }
    try {
      const rootRealPath = realpathSync(expectedRoot);
      const outputRealPath = realpathSync(absoluteOutputPath);
      if (!isWithinRoot(outputRealPath, rootRealPath)) {
        issues.push(issue("first-shot.clone-root", "current-slot MP4 is outside the cloned project Remotion root"));
      }
      if (!uiOutputPath || !isAbsolute(uiOutputPath) || realpathSync(uiOutputPath) !== outputRealPath) {
        issues.push(issue("first-shot.ui-output-path", "UI absolute output path differs from the current-slot MP4"));
      }
    } catch (error) {
      issues.push(issue("first-shot.realpath", error instanceof Error ? error.message : String(error)));
    }
    actualSha256 = createHash("sha256").update(readFileSync(absoluteOutputPath)).digest("hex");
    if (actualSha256 !== evidence.sha256
      || fileStat.size !== evidence.sizeBytes
      || Math.floor(fileStat.mtimeMs) !== evidence.mtimeMs) {
      issues.push(issue("first-shot.file-identity", "MP4 bytes/size/mtime differ from current-slot evidence"));
    }
    if (Number.isFinite(startedAtMs) && fileStat.mtimeMs < startedAtMs) {
      issues.push(issue("first-shot.stale-file", "current-slot MP4 predates the button action"));
    }
    mediaProbe = probeFirstShotMedia(absoluteOutputPath, issues);
  }

  return { ok: issues.length === 0, expectedRoot, expectedOutputPath, actualSha256, mediaProbe, issues };
}

function auditFirstShotRuntime(value, issues) {
  const browser = value.browserStatus || null;
  const runtime = value.workspaceRuntime || null;
  if (browser?.state !== "ready") {
    issues.push(issue("first-shot.browser-runtime", "installed Headless Shell was not ready"));
  }
  if (!runtime
    || runtime.schemaVersion !== 1
    || runtime.templateId !== "mystudio-remotion-v1"
    || runtime.templateVersion !== "1.0.0"
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(runtime.remotionVersion || ""))
    || !/^[a-f0-9]{64}$/.test(String(runtime.bundleContentHash || ""))
    || JSON.stringify(runtime.compositionIds) !== JSON.stringify(["StoryboardShot", "ChapterVideo", "DaojieTimeline"])) {
    issues.push(issue("first-shot.workspace-runtime", "workspace runtime identity is invalid"));
  }
  if (browser?.remotionVersion && runtime?.remotionVersion !== browser.remotionVersion) {
    issues.push(issue("first-shot.runtime-version", "browser and workspace Remotion versions differ"));
  }
  if (!Array.isArray(value.downloadProgressEvents) || value.downloadProgressEvents.length > 0) {
    issues.push(issue("first-shot.download", "Headless Shell download activity was observed or not recorded"));
  }
}

function probeFirstShotMedia(filePath, issues) {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,width,height,avg_frame_rate",
      "-of",
      "json",
      filePath,
    ],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    issues.push(issue("first-shot.ffprobe", String(result.stderr || "ffprobe failed").trim()));
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout || "{}");
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    const fps = parseFrameRate(video?.avg_frame_rate);
    if (video?.codec_name !== "h264" || video?.width !== 1920 || video?.height !== 1080) {
      issues.push(issue("first-shot.video", "video stream is not H.264 1920x1080"));
    }
    if (audio?.codec_name !== "aac") {
      issues.push(issue("first-shot.audio", "audio stream is not AAC"));
    }
    if (!Number.isFinite(fps) || Math.abs(fps - 30) > 0.001) {
      issues.push(issue("first-shot.fps", `video frame rate was ${Number.isFinite(fps) ? fps : "invalid"}`));
    }
    return { video, audio, fps };
  } catch (error) {
    issues.push(issue("first-shot.ffprobe-json", error instanceof Error ? error.message : String(error)));
    return null;
  }
}

function parseFrameRate(value) {
  const [numerator, denominator] = String(value || "").split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return Number.NaN;
  return numerator / denominator;
}

export function auditVisibleProductionCanvasVideo({ productionCanvasVideo, expected }) {
  const value = productionCanvasVideo || {};
  const issues = [];
  const startedAtMs = Number(value.startedAtMs);

  if (value.enabled !== true) issues.push(issue("production-canvas.disabled", "production-canvas-video was not enabled"));
  if (value.stageClicked !== true) issues.push(issue("production-canvas.stage", "storyboard stage was not clicked"));
  if (value.clicked !== true) issues.push(issue("production-canvas.click", "production node action was not clicked"));
  if (value.clickedText !== "一键生成所有视频" && value.clickedText !== "生成当前章分镜视频") {
    issues.push(issue("production-canvas.button-text", `unexpected button text: ${value.clickedText}`));
  }
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    issues.push(issue("production-canvas.started-at", "startedAtMs is invalid"));
  }
  if (value.timedOut === true) issues.push(issue("production-canvas.timeout", "production-canvas flow timed out"));

  // Terminal stage: expected to fail-closed due to visual continuity gate (42 pending shots)
  if (value.terminalStage !== "failed") {
    issues.push(issue("production-canvas.terminal", `terminal stage was ${value.terminalStage || "empty"}, expected failed due to visual continuity gate`));
  }

  if (!String(value.statusText || "").includes("分镜视觉连续性未通过")) {
    issues.push(issue("production-canvas.gate", "visual-continuity fail-closed status was not observed"));
  }

  // Queue and current slots must both be unchanged.
  if (!value.preClickQueue || !value.postClickQueue) {
    issues.push(issue("production-canvas.queue-missing", "queue before/after snapshots are missing"));
  } else {
    if (value.preClickQueue.jobCount < 0 || value.postClickQueue.jobCount < 0) {
      issues.push(issue("production-canvas.queue-unavailable", "queue before/after snapshot is unavailable"));
    }
    if (value.preClickQueue.jobCount !== value.postClickQueue.jobCount) {
      issues.push(issue("production-canvas.queue-mutation", `queue job count changed from ${value.preClickQueue.jobCount} to ${value.postClickQueue.jobCount}`));
    }
    if (value.preClickQueue.currentSlotCount !== value.postClickQueue.currentSlotCount) {
      issues.push(issue("production-canvas.slot-mutation", `current slot count changed from ${value.preClickQueue.currentSlotCount} to ${value.postClickQueue.currentSlotCount}`));
    }
  }

  // Zero downloads
  const downloads = Array.isArray(value.downloadProgressEvents) ? value.downloadProgressEvents : [];
  if (downloads.length > 0) {
    issues.push(issue("production-canvas.download", `${downloads.length} Headless Shell download event(s) detected`));
  }

  // Runtime identity
  if (!value.browserStatus) {
    issues.push(issue("production-canvas.runtime-missing", "browserStatus is missing"));
  } else if (value.browserStatus.state !== "ready") {
    issues.push(issue("production-canvas.runtime-state", `browser state is ${value.browserStatus.state}`));
  }
  if (!value.workspaceRuntime) {
    issues.push(issue("production-canvas.workspace-missing", "workspaceRuntime is missing"));
  }

  // Pre-click review counts should match expected
  if (value.preClickReviewCounts) {
    const counts = value.preClickReviewCounts;
    if (counts.total !== expected.expectedStoryboards) {
      issues.push(issue("production-canvas.review-counts", `pre-click total ${counts.total} != expected ${expected.expectedStoryboards}`));
    }
    if (!(counts.approved < counts.total && counts.pending > 0 && counts.stale > 0)) {
      issues.push(issue("production-canvas.review-gate", "pre-click review counts do not show the expected pending/stale gate"));
    }
  }

  if (value.preflightError) {
    issues.push(issue("production-canvas.preflight", value.preflightError));
  }

  return { ok: issues.length === 0, issues };
}
