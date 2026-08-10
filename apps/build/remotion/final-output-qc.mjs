import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function issue(code, message) {
  return { code, message };
}

function readJsonInput(value, label) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(readFileSync(resolve(value), "utf8"));
  } catch (error) {
    throw new Error(`${label} JSON 无法读取: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function probeFinalOutput(filePath, ffprobePath = process.env.MYSTUDIO_FFPROBE_PATH || "ffprobe") {
  const result = await execFileAsync(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,codec_name,duration,width,height,channels,sample_rate",
    "-of", "json",
    filePath,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const raw = JSON.parse(String(result.stdout || "{}"));
  const video = Array.isArray(raw.streams) ? raw.streams.find((stream) => stream.codec_type === "video") : undefined;
  const audio = Array.isArray(raw.streams) ? raw.streams.find((stream) => stream.codec_type === "audio") : undefined;
  return {
    raw,
    duration: Number(video?.duration || raw.format?.duration || 0),
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    streams: (raw.streams || []).map((stream) => stream.codec_type).filter(Boolean),
    videoCodec: video?.codec_name || "",
    audioCodec: audio?.codec_name || "",
  };
}

function artifactIdentityIssues(prefix, artifact, expected) {
  const issues = [];
  if (!artifact || typeof artifact !== "object") return [issue(`${prefix}.missing`, `${prefix} artifact 缺失`)];
  for (const key of ["projectId", "chapterId", "revision"]) {
    if (expected[key] !== undefined && artifact[key] !== expected[key]) issues.push(issue(`${prefix}.${key}`, `${prefix} ${key} 与 expected 不一致`));
  }
  if (expected.inputSha256 && artifact.inputSha256 && artifact.inputSha256 !== expected.inputSha256) {
    issues.push(issue(`${prefix}.input-sha`, `${prefix} inputSha256 漂移`));
  }
  return issues;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function hasStream(streams, kind) {
  return Array.isArray(streams) && streams.some((stream) => (
    stream === kind
    || (isRecord(stream) && (stream.kind === kind || stream.codec_type === kind))
  ));
}

function normalizeProjectMediaPath(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const normalized = value.trim().replaceAll("\\", "/");
  const marker = "/remotion/";
  const markerIndex = normalized.lastIndexOf(marker);
  return markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized;
}

function evidenceIdentityIssues(evidence, expected) {
  const issues = [];
  if (!isRecord(evidence)) return { issues: [issue("evidence.invalid", "ChapterVideo evidence 必须是对象")] };
  const target = isRecord(evidence.target) ? evidence.target : null;
  if (target?.kind !== "chapter") issues.push(issue("evidence.target", "ChapterVideo evidence 必须绑定 chapter target"));
  const projectId = typeof evidence.projectId === "string" && evidence.projectId.length > 0 ? evidence.projectId : "";
  const chapterId = typeof evidence.chapterId === "string" && evidence.chapterId.length > 0
    ? evidence.chapterId
    : (typeof target?.chapterId === "string" && target.chapterId.length > 0 ? target.chapterId : "");
  const revision = Number.isInteger(evidence.revision) && evidence.revision > 0
    ? evidence.revision
    : (Number.isInteger(target?.editingRevision) && target.editingRevision > 0 ? target.editingRevision : 0);
  if (!projectId) issues.push(issue("evidence.projectId", "ChapterVideo evidence 缺少 projectId"));
  if (!chapterId) issues.push(issue("evidence.chapterId", "ChapterVideo evidence 缺少 chapterId"));
  if (!revision) issues.push(issue("evidence.revision", "ChapterVideo evidence 缺少正 revision"));
  for (const key of ["projectId", "chapterId", "revision"]) {
    if (expected[key] !== undefined && ({ projectId, chapterId, revision })[key] !== expected[key]) {
      issues.push(issue(`evidence.${key}`, `ChapterVideo evidence ${key} 与 expected 不一致`));
    }
  }
  if (!isSha256(evidence.inputHash)) issues.push(issue("evidence.inputHash", "ChapterVideo evidence 缺少有效 inputHash"));
  if (expected.inputSha256 && evidence.inputHash !== expected.inputSha256) {
    issues.push(issue("evidence.inputHash", "ChapterVideo evidence inputHash 与 expected 不一致"));
  }
  return { issues, identity: { projectId, chapterId, revision } };
}

function cueOwnedByOverlay(cue, slots) {
  return slots.some((slot) => cue?.shotId === slot?.slotId
    || (Number(cue?.startUs) < Number(slot?.startUs) + Number(slot?.durationUs)
      && Number(cue?.startUs) + Number(cue?.durationUs) > Number(slot?.startUs)));
}

function checkSubtitleOwnership(videoUseArtifact, editingProject, outputPath, issues) {
  const preview = videoUseArtifact?.preview;
  if (preview?.subtitlesBurnedIn === true && preview.path === outputPath) {
    issues.push(issue("subtitle.preview-burn-in", "最终 MP4 复用了带烧录字幕的 video-use preview，禁止重复烧录"));
  }
  if (!Array.isArray(editingProject?.tracks) || !Array.isArray(editingProject?.clips)) return;
  const cues = Array.isArray(videoUseArtifact?.subtitles) ? videoUseArtifact.subtitles : [];
  const slots = Array.isArray(videoUseArtifact?.overlaySlots) ? videoUseArtifact.overlaySlots : [];
  const artifactSha256 = videoUseArtifact?.evidence?.artifactSha256;
  const subtitleTrackIds = new Set(editingProject.tracks
    .filter((track) => track?.kind === "text" && track?.name === "字幕")
    .map((track) => track.id));
  const projected = editingProject.clips.filter((clip) => subtitleTrackIds.has(clip?.trackId)
    && clip?.subtitle?.sourceFormat === "generated"
    && clip?.source?.evidence?.sourceFingerprint === artifactSha256);
  const standardCues = cues.filter((cue) => !cueOwnedByOverlay(cue, slots));
  if (standardCues.length > 0 && editingProject.renderSettings?.subtitleMode !== "burn-in") {
    issues.push(issue("subtitle.remotion-disabled", "存在普通字幕 cue 时 Remotion subtitleMode 必须为 burn-in"));
  }
  for (const cue of cues) {
    const matches = projected.filter((clip) => clip?.source?.text === cue?.text
      && clip?.source?.evidence?.storyboardId === cue?.shotId
      && clip?.startUs === cue?.startUs
      && clip?.durationUs === cue?.durationUs);
    if (cueOwnedByOverlay(cue, slots)) {
      if (matches.length > 0) issues.push(issue("subtitle.animated-duplicate", `HyperFrames 动效字幕不得再次由 Remotion 烧录: ${String(cue?.cueId || "unknown")}`));
    } else if (matches.length === 0) {
      issues.push(issue("subtitle.remotion-missing", `普通字幕未投影到 Remotion 字幕轨: ${String(cue?.cueId || "unknown")}`));
    } else if (matches.length > 1) {
      issues.push(issue("subtitle.remotion-duplicate", `普通字幕被重复投影到 Remotion 字幕轨: ${String(cue?.cueId || "unknown")}`));
    }
  }
  for (const clip of projected) {
    const ownedCue = standardCues.some((cue) => clip?.source?.text === cue?.text
      && clip?.source?.evidence?.storyboardId === cue?.shotId
      && clip?.startUs === cue?.startUs
      && clip?.durationUs === cue?.durationUs);
    if (!ownedCue) {
      issues.push(issue("subtitle.remotion-stale", `Remotion 字幕轨包含未绑定当前 video-use cue 的片段: ${String(clip?.id || "unknown")}`));
    }
  }
}

function checkEditingProjectConsistency(videoUseArtifact, editingProject, evidence, issues) {
  if (!isRecord(editingProject)) {
    issues.push(issue("editing-project.missing", "final-output QC 必须提供 EditingProject"));
    return;
  }
  const target = isRecord(evidence?.target) ? evidence.target : null;
  if (typeof editingProject.id !== "string" || !editingProject.id) issues.push(issue("editing-project.id", "EditingProject 缺少 id"));
  else if (typeof target?.editingProjectId !== "string" || target.editingProjectId !== editingProject.id) issues.push(issue("editing-project.id", "EditingProject id 与 ChapterVideo evidence 不一致"));
  if (videoUseArtifact) {
    if (editingProject.projectId !== videoUseArtifact.projectId) issues.push(issue("editing-project.projectId", "EditingProject projectId 与 video-use artifact 不一致"));
    if (editingProject.episodeId !== videoUseArtifact.chapterId) issues.push(issue("editing-project.chapterId", "EditingProject episodeId 与 video-use artifact 不一致"));
    if (editingProject.revision !== videoUseArtifact.revision) issues.push(issue("editing-project.revision", "EditingProject revision 与 video-use artifact 不一致"));
  }
  if (Number.isInteger(target?.editingRevision) && editingProject.revision !== target.editingRevision) {
    issues.push(issue("editing-project.revision", "EditingProject revision 与 ChapterVideo evidence 不一致"));
  }
  if (!Array.isArray(editingProject.tracks) || !Array.isArray(editingProject.clips)) {
    issues.push(issue("editing-project.structure", "EditingProject 缺少 tracks 或 clips"));
    return;
  }
  if (!videoUseArtifact) return;
  const visualTrackIds = new Set(editingProject.tracks.filter((track) => track?.kind === "video" || track?.kind === "image").map((track) => track.id));
  const visualClips = editingProject.clips.filter((clip) => visualTrackIds.has(clip?.trackId));
  if (videoUseArtifact.mode === "flat-shot-mp4") {
    const sourcePath = videoUseArtifact.flatShotMp4Path;
    if (typeof sourcePath !== "string" || !/\.mp4$/i.test(sourcePath) || sourcePath === videoUseArtifact.preview?.path) {
      issues.push(issue("video-use.flat-input", "flat-shot-mp4 必须提供独立的 clean MP4 输入"));
      return;
    }
    const projected = visualClips.find((clip) => clip?.source?.kind === "storyboardVideo"
      && normalizeProjectMediaPath(clip.source.path) === normalizeProjectMediaPath(sourcePath));
    if (!projected) issues.push(issue("editing-project.flat-source", "EditingProject 未消费 accepted flat-shot MP4"));
    else if (projected.source?.evidence?.sourceFingerprint !== videoUseArtifact.evidence?.artifactSha256) {
      issues.push(issue("editing-project.flat-fingerprint", "flat-shot MP4 未绑定当前 video-use artifact SHA"));
    }
    return;
  }
  if (!Array.isArray(videoUseArtifact.edl)) {
    issues.push(issue("video-use.edl", "editable-edl artifact 缺少 EDL"));
    return;
  }
  for (const entry of videoUseArtifact.edl) {
    const expectedStartUs = Math.round(Number(entry?.timelineStartS) * 1_000_000);
    const expectedDurationUs = Math.round(Number(entry?.durationS) * 1_000_000);
    const expectedTrimStartUs = Math.round(Number(entry?.sourceInS) * 1_000_000);
    const projected = visualClips.find((clip) => clip?.source?.kind === "storyboardVideo"
      && normalizeProjectMediaPath(clip.source.path) === normalizeProjectMediaPath(entry?.sourcePath)
      && clip.source?.evidence?.storyboardId === entry?.shotId
      && clip.startUs === expectedStartUs
      && clip.durationUs === expectedDurationUs
      && clip.trimStartUs === expectedTrimStartUs);
    if (!projected) {
      issues.push(issue("editing-project.edl", `EditingProject 未消费 EDL shot: ${String(entry?.shotId || "unknown")}`));
      continue;
    }
    if (projected.source?.evidence?.sourceFingerprint !== videoUseArtifact.evidence?.artifactSha256) {
      issues.push(issue("editing-project.edl-fingerprint", `EDL shot 未绑定当前 video-use artifact SHA: ${String(entry?.shotId || "unknown")}`));
    }
  }
}

function checkHyperFramesConsistency(videoUseArtifact, hyperFramesArtifact, issues) {
  if (!videoUseArtifact || !hyperFramesArtifact) return;
  if (hyperFramesArtifact.inputSha256 !== videoUseArtifact.evidence?.inputSha256) {
    issues.push(issue("hyperframes.input-sha", "HyperFrames input SHA 与 video-use evidence 不一致"));
  }
  const slots = Array.isArray(videoUseArtifact.overlaySlots) ? videoUseArtifact.overlaySlots : [];
  const windows = Array.isArray(hyperFramesArtifact.windows) ? hyperFramesArtifact.windows : [];
  const windowsMatchSlots = windows.length === slots.length && slots.every((slot) => windows.some((window) => (
    window?.slotId === slot?.slotId && window?.startUs === slot?.startUs && window?.durationUs === slot?.durationUs
  )));
  if (!windowsMatchSlots) issues.push(issue("hyperframes.windows", "HyperFrames windows 与 video-use overlay slots 不一致"));
  if (hyperFramesArtifact.status === "noop" && slots.length > 0) {
    issues.push(issue("hyperframes.noop-slots", "存在 overlay slots 时 HyperFrames 不得使用 no-op"));
  }
}

export async function runFinalOutputQc(input) {
  const expected = input.expected || {};
  // video-use's source/TTS fingerprint and ChapterVideo's render identity are
  // intentionally different hashes. Keep the historical `inputSha256` fallback
  // for older evidence, while allowing current callers to bind both explicitly.
  const expectedVideoUseInputSha256 = expected.videoUseInputSha256 || expected.inputSha256;
  const outputPath = resolve(String(input.outputPath || ""));
  const issues = [];
  let file;
  if (extname(outputPath).toLowerCase() !== ".mp4") issues.push(issue("output.extension", "最终输出必须是 MP4"));
  if (!outputPath || !existsSync(outputPath)) issues.push(issue("output.missing", "最终 MP4 不存在"));
  else {
    file = statSync(outputPath);
    if (!file.isFile() || file.size <= 0) issues.push(issue("output.invalid", "最终 MP4 必须是非空普通文件"));
  }
  const videoUseArtifact = readJsonInput(input.videoUseArtifact || input.videoUseArtifactPath, "video-use artifact");
  const hyperFramesArtifact = readJsonInput(input.hyperFramesArtifact || input.hyperFramesArtifactPath, "HyperFrames artifact");
  const editingProject = readJsonInput(input.editingProject || input.editingProjectPath, "EditingProject");
  const evidence = readJsonInput(input.evidence || input.evidencePath, "ChapterVideo evidence");
  const evidenceIdentity = evidence ? evidenceIdentityIssues(evidence, expected) : { issues: [], identity: undefined };
  issues.push(...evidenceIdentity.issues);

  const artifactExpected = evidenceIdentity.identity ? { ...expected, ...evidenceIdentity.identity } : expected;
  issues.push(...artifactIdentityIssues("video-use", videoUseArtifact, artifactExpected));
  if (videoUseArtifact) {
    if (videoUseArtifact.status !== "accepted" || videoUseArtifact.stage !== "ready") issues.push(issue("video-use.not-accepted", "video-use artifact 必须为 ready/accepted"));
    if (expected.mode && videoUseArtifact.mode !== expected.mode) issues.push(issue("video-use.mode", "video-use mode 与 expected 不一致"));
    if (!isSha256(videoUseArtifact.evidence?.inputSha256)) issues.push(issue("video-use.evidence-input-sha", "video-use artifact 缺少有效 evidence input SHA"));
    else if (expectedVideoUseInputSha256 && videoUseArtifact.evidence.inputSha256 !== expectedVideoUseInputSha256) issues.push(issue("video-use.evidence-input-sha", "video-use evidence inputSha256 与 expected 不一致"));
    if (!isSha256(videoUseArtifact.evidence?.artifactSha256)) issues.push(issue("video-use.evidence-sha", "video-use artifact 缺少有效 evidence artifact SHA"));
    if (!isRecord(videoUseArtifact.review) || videoUseArtifact.review.decision !== "accepted") issues.push(issue("video-use.review-missing", "video-use accepted artifact 缺少 accepted review"));
    if (videoUseArtifact.review?.artifactSha256 !== videoUseArtifact.evidence?.artifactSha256) issues.push(issue("video-use.review-sha", "video-use review 未绑定当前 artifact SHA"));
    if (videoUseArtifact.mode === "flat-shot-mp4") {
      const flatPath = typeof videoUseArtifact.flatShotMp4Path === "string" ? resolve(videoUseArtifact.flatShotMp4Path) : "";
      if (!isSha256(videoUseArtifact.flatShotMp4Sha256)) {
        issues.push(issue("video-use.flat-input-sha", "flat-shot-mp4 缺少 clean MP4 SHA-256"));
      } else if (!flatPath || !existsSync(flatPath)) {
        issues.push(issue("video-use.flat-input-missing", "flat-shot-mp4 clean MP4 不存在"));
      } else {
        let flatStat;
        try { flatStat = statSync(flatPath); } catch { flatStat = undefined; }
        if (!flatStat?.isFile() || flatStat.size <= 0) {
          issues.push(issue("video-use.flat-input-missing", "flat-shot-mp4 clean MP4 必须是非空普通文件"));
        } else if (await sha256File(flatPath) !== videoUseArtifact.flatShotMp4Sha256) {
          issues.push(issue("video-use.flat-input-sha", "flat-shot-mp4 clean MP4 SHA-256 已漂移"));
        }
      }
    }
  }
  issues.push(...artifactIdentityIssues("hyperframes", hyperFramesArtifact, {
    ...artifactExpected,
    inputSha256: expectedVideoUseInputSha256,
  }));
  if (hyperFramesArtifact && videoUseArtifact) {
    if (hyperFramesArtifact.sourceArtifactSha256 !== videoUseArtifact.evidence?.artifactSha256) issues.push(issue("hyperframes.source-sha", "HyperFrames 未绑定当前 video-use artifact"));
    checkHyperFramesConsistency(videoUseArtifact, hyperFramesArtifact, issues);
    if (hyperFramesArtifact.status === "noop") {
      if (hyperFramesArtifact.outputPath || hyperFramesArtifact.outputSha256) issues.push(issue("hyperframes.noop-output", "HyperFrames no-op 不得携带透明层输出"));
    } else if (hyperFramesArtifact.status === "accepted") {
      if (!hyperFramesArtifact.outputPath || !hyperFramesArtifact.outputSha256) issues.push(issue("hyperframes.output-missing", "accepted HyperFrames 缺少输出路径或 SHA"));
      if (hyperFramesArtifact.alphaFormat === "png-sequence") issues.push(issue("hyperframes.png-sequence", "正式 macOS 透明层禁止 png-sequence"));
      if (hyperFramesArtifact.outputPath) {
        const overlayPath = resolve(hyperFramesArtifact.outputPath);
        if (overlayPath === outputPath) issues.push(issue("hyperframes.output-collision", "最终 MP4 不得等于透明层输出"));
        if (!existsSync(overlayPath)) issues.push(issue("hyperframes.output-missing", "accepted HyperFrames 透明层文件不存在"));
        else if (!isSha256(hyperFramesArtifact.outputSha256)) issues.push(issue("hyperframes.output-sha", "accepted HyperFrames 缺少有效输出 SHA-256"));
        else if (await sha256File(overlayPath) !== hyperFramesArtifact.outputSha256) issues.push(issue("hyperframes.output-sha", "HyperFrames 透明层 SHA-256 已漂移"));
      }
    } else issues.push(issue("hyperframes.not-accepted", "HyperFrames 必须为 accepted 或 noop"));
  }
  checkEditingProjectConsistency(videoUseArtifact, editingProject, evidence, issues);
  if (videoUseArtifact) checkSubtitleOwnership(videoUseArtifact, editingProject, outputPath, issues);

  let sha256 = "";
  let probe = null;
  if (file?.isFile() && file.size > 0) {
    sha256 = await sha256File(outputPath);
    try { probe = await probeFinalOutput(outputPath, input.ffprobePath); }
    catch (error) { issues.push(issue("output.ffprobe", error instanceof Error ? error.message : String(error))); }
  }
  if (evidence) {
    const evidencePath = typeof evidence.path === "string" ? evidence.path : evidence.outputPath;
    if (typeof evidencePath !== "string" || evidencePath.length === 0) issues.push(issue("evidence.path", "ChapterVideo evidence 缺少输出路径"));
    else if (resolve(evidencePath) !== outputPath) issues.push(issue("evidence.path", "ChapterVideo evidence path 与最终 MP4 不一致"));
    if (!Number.isInteger(evidence.sizeBytes) || evidence.sizeBytes <= 0) issues.push(issue("evidence.size", "ChapterVideo evidence 缺少有效 sizeBytes"));
    else if (file && evidence.sizeBytes !== file.size) issues.push(issue("evidence.size", "ChapterVideo evidence size 已过期"));
    if (!Number.isFinite(evidence.mtimeMs) || evidence.mtimeMs <= 0) issues.push(issue("evidence.mtime", "ChapterVideo evidence 缺少有效 mtimeMs"));
    else if (file && Math.abs(evidence.mtimeMs - file.mtimeMs) > 5) issues.push(issue("evidence.mtime", "ChapterVideo evidence mtime 已漂移"));
    if (!isSha256(evidence.sha256)) issues.push(issue("evidence.sha256", "ChapterVideo evidence 缺少有效 SHA-256"));
    else if (evidence.sha256 !== sha256) issues.push(issue("evidence.sha256", "ChapterVideo evidence SHA-256 已漂移"));
    if (!hasStream(evidence.streams, "video") || !hasStream(evidence.streams, "audio")) issues.push(issue("evidence.streams", "ChapterVideo evidence 缺少音频或视频流"));
  } else issues.push(issue("evidence.missing", "ChapterVideo evidence 缺失"));
  if (probe) {
    if (!probe.streams.includes("video") || !probe.streams.includes("audio")) issues.push(issue("output.streams", "最终 MP4 缺少音频或视频流"));
    if (probe.videoCodec !== "h264" || probe.audioCodec !== "aac") issues.push(issue("output.codec", `编解码器不匹配: video=${probe.videoCodec || "missing"} audio=${probe.audioCodec || "missing"}`));
    if (expected.width && probe.width !== expected.width) issues.push(issue("output.width", `宽度不匹配: ${probe.width} != ${expected.width}`));
    if (expected.height && probe.height !== expected.height) issues.push(issue("output.height", `高度不匹配: ${probe.height} != ${expected.height}`));
    if (expected.durationS && Math.abs(probe.duration - expected.durationS) > 1 / Number(expected.fps || 30)) issues.push(issue("output.duration", `时长误差超过一帧: ${probe.duration} != ${expected.durationS}`));
  }
  return {
    schemaVersion: 1,
    ok: issues.length === 0,
    outputPath,
    sizeBytes: file?.size || 0,
    mtimeMs: file?.mtimeMs || 0,
    sha256,
    probe,
    issues,
    readOnly: true,
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--output") result.outputPath = argv[++index];
    else if (key === "--evidence") result.evidencePath = argv[++index];
    else if (key === "--video-use") result.videoUseArtifactPath = argv[++index];
    else if (key === "--hyperframes") result.hyperFramesArtifactPath = argv[++index];
    else if (key === "--editing-project") result.editingProjectPath = argv[++index];
    else if (key === "--expected") result.expected = JSON.parse(readFileSync(resolve(argv[++index]), "utf8"));
    else if (key === "--report") result.reportPath = resolve(argv[++index]);
    else if (key === "--ffprobe") result.ffprobePath = resolve(argv[++index]);
    else if (key === "--help") result.help = true;
    else throw new Error(`未知参数: ${key}`);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node ./build/remotion/final-output-qc.mjs --output final.mp4 --evidence evidence.json --video-use video-use-artifact.json --hyperframes hyperframes-artifact.json [--editing-project project.json] [--expected expected.json] [--report report.json]");
    return;
  }
  const report = await runFinalOutputQc(args);
  if (args.reportPath) writeFileSync(args.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.url.replace("file://", ""))) await main();
