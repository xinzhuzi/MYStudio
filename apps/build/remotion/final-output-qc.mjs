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

function checkSubtitleDuplication(videoUseArtifact, editingProject, outputPath, issues) {
  const preview = videoUseArtifact?.preview;
  if (preview?.subtitlesBurnedIn === true && preview.path === outputPath) {
    issues.push(issue("subtitle.preview-burn-in", "最终 MP4 复用了带烧录字幕的 video-use preview，禁止重复烧录"));
  }
  const cueTexts = new Set(Array.isArray(videoUseArtifact?.subtitles) ? videoUseArtifact.subtitles.map((cue) => String(cue.text || "").trim()).filter(Boolean) : []);
  const textClips = Array.isArray(editingProject?.clips)
    ? editingProject.clips.filter((clip) => editingProject.tracks?.find((track) => track.id === clip.trackId)?.kind === "text" || clip.source?.kind === "text")
    : [];
  for (const clip of textClips) {
    const text = String(clip.source?.text || "").trim();
    if (text && cueTexts.has(text) && clip.subtitle) {
      issues.push(issue("subtitle.duplicate-risk", `EditingProject text clip 与 video-use subtitle cue 重复: ${text.slice(0, 40)}`));
    }
  }
}

export async function runFinalOutputQc(input) {
  const expected = input.expected || {};
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
    else if (expected.inputSha256 && videoUseArtifact.evidence.inputSha256 !== expected.inputSha256) issues.push(issue("video-use.evidence-input-sha", "video-use evidence inputSha256 与 expected 不一致"));
    if (!isSha256(videoUseArtifact.evidence?.artifactSha256)) issues.push(issue("video-use.evidence-sha", "video-use artifact 缺少有效 evidence artifact SHA"));
    if (!isRecord(videoUseArtifact.review) || videoUseArtifact.review.decision !== "accepted") issues.push(issue("video-use.review-missing", "video-use accepted artifact 缺少 accepted review"));
    if (videoUseArtifact.review?.artifactSha256 !== videoUseArtifact.evidence?.artifactSha256) issues.push(issue("video-use.review-sha", "video-use review 未绑定当前 artifact SHA"));
  }
  issues.push(...artifactIdentityIssues("hyperframes", hyperFramesArtifact, artifactExpected));
  if (hyperFramesArtifact && videoUseArtifact) {
    if (hyperFramesArtifact.sourceArtifactSha256 !== videoUseArtifact.evidence?.artifactSha256) issues.push(issue("hyperframes.source-sha", "HyperFrames 未绑定当前 video-use artifact"));
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
  if (videoUseArtifact) checkSubtitleDuplication(videoUseArtifact, editingProject, outputPath, issues);

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
