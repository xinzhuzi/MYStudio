import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

function issue(code, message) {
  return { code, message };
}

export function auditVisibleAutoVideo({ chapterAutoVideo, userDataDir }) {
  const value = chapterAutoVideo || {};
  const issues = [];
  const finalPath = String(value.finalPath || "");
  const evidence = value.finalVideoEvidence || null;
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

  return { ok: issues.length === 0, expectedRoot, issues };
}
