import { existsSync, realpathSync, statSync } from "node:fs";
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
