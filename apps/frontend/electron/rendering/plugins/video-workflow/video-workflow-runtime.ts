import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const VIDEO_USE_SOURCE_COMMIT = "92c2b34e44c205cbc2acae7f6ca7c1c219d5dd66" as const;
export const HYPERFRAMES_SOURCE_COMMIT = "b08cefea631b2c13697b6cb31075bf5a9b7c738d" as const;
export const HYPERFRAMES_NPM_VERSION = "0.7.101" as const;
export const VIDEO_USE_PROFILE_ID = "video-use-managed-python-v1" as const;
export const HYPERFRAMES_PROFILE_ID = "hyperframes-node22-v1" as const;

export interface VideoWorkflowRuntimePaths {
  storageBasePath: string;
  pythonRuntimeDir: string;
  pythonExecutable: string;
  videoUseProfileDir: string;
  videoUseUpstreamRoot: string;
  videoUseLockPath: string;
  videoUseMarkerPath: string;
  nodeRuntimeDir: string;
  nodeExecutable: string;
  hyperFramesProfileDir: string;
  hyperFramesMarkerPath: string;
  hyperFramesCliPath: string;
  hyperFramesBrowserPath: string;
  ffmpegExecutable: string;
  ffprobeExecutable: string;
}

export interface VideoWorkflowRuntimeProbeResult {
  state: "ready" | "needs-runtime" | "update-available" | "blocked" | "error";
  paths: VideoWorkflowRuntimePaths;
  missing: string[];
  versions: { python?: string; node?: string; browser?: string; ffmpeg?: string; ffprobe?: string };
  message?: string;
}

export interface VideoWorkflowRuntimeProbeDeps {
  fileExists?: (filePath: string) => boolean;
  execFile?: (
    file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number; cwd?: string; env?: NodeJS.ProcessEnv },
  ) => Promise<{ stdout?: string; stderr?: string }>;
}

export interface SharedVideoToolchainPair {
  ffmpegExecutable: string;
  ffprobeExecutable: string;
}

export interface SharedVideoToolchainSelectionOptions {
  configuredFfmpeg?: string;
  configuredFfprobe?: string;
  bundledFfmpeg: string;
  bundledFfprobe: string;
  platform?: NodeJS.Platform;
  fileExists?: (filePath: string) => boolean;
  homebrewBinDir?: string;
}

export interface VideoUseProfileMarkerV1 {
  schemaVersion: 1;
  profileId: typeof VIDEO_USE_PROFILE_ID;
  sourceCommit: typeof VIDEO_USE_SOURCE_COMMIT;
  pythonExecutable: string;
  upstreamRoot: string;
  lockPath: string;
  lockSha256: string;
  createdAt: number;
  verifiedAt: number;
}

export interface HyperFramesProfileMarkerV1 {
  schemaVersion: 1;
  profileId: typeof HYPERFRAMES_PROFILE_ID;
  sourceCommit: typeof HYPERFRAMES_SOURCE_COMMIT;
  npmVersion: typeof HYPERFRAMES_NPM_VERSION;
  nodeExecutable: string;
  cliPath: string;
  createdAt: number;
  verifiedAt: number;
}

const HYPERFRAMES_OPTIONAL_DOCTOR_CHECKS = new Set([
  "whisper-cpp",
  "TTS (Kokoro)",
  "BGM (MusicGen)",
  "Docker",
  "Docker running",
]);
const HYPERFRAMES_REQUIRED_DOCTOR_CHECKS = new Set([
  "Version",
  "Node.js",
  "FFmpeg",
  "FFprobe",
  "Chrome",
]);

/**
 * HyperFrames' doctor reports optional authoring integrations (Scribe/TTS,
 * MusicGen and Docker) in the same `ok` aggregate as the HTML renderer. Those
 * integrations are outside MYStudio's overlay contract; only the renderer,
 * browser and shared toolchain checks are readiness gates.
 */
export function isHyperFramesDoctorReady(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const checks = (value as { checks?: unknown }).checks;
  if (!Array.isArray(checks)) return false;
  const normalized = checks.filter((check): check is { name: string; ok: boolean; detail?: string } => (
    !!check
    && typeof check === "object"
    && typeof (check as { name?: unknown }).name === "string"
    && typeof (check as { ok?: unknown }).ok === "boolean"
    && ((check as { detail?: unknown }).detail === undefined || typeof (check as { detail?: unknown }).detail === "string")
  ));
  if (normalized.length !== checks.length) return false;
  const isCheckReady = (check: { name: string; ok: boolean; detail?: string }) => (
    check.ok
    || (check.name === "Version" && typeof check.detail === "string" && check.detail.startsWith(HYPERFRAMES_NPM_VERSION))
  );
  if (![...HYPERFRAMES_REQUIRED_DOCTOR_CHECKS].every((name) => normalized.some((check) => check.name === name && isCheckReady(check)))) {
    return false;
  }
  return normalized.every((check) => isCheckReady(check) || HYPERFRAMES_OPTIONAL_DOCTOR_CHECKS.has(check.name));
}

function resolveSharedExecutable(...environmentKeys: string[]): string {
  for (const environmentKey of environmentKeys) {
    const configured = process.env[environmentKey]?.trim() ?? "";
    if (path.isAbsolute(configured)) return configured;
  }
  return "";
}

/**
 * Resolve one process-wide FFmpeg/ffprobe pair without downloading tools.
 * A partial explicit override is preserved so the runtime probe can surface it
 * as blocked instead of silently selecting a different installation.
 */
export function selectSharedVideoToolchain(
  options: SharedVideoToolchainSelectionOptions,
): SharedVideoToolchainPair {
  const configuredFfmpeg = options.configuredFfmpeg?.trim() ?? "";
  const configuredFfprobe = options.configuredFfprobe?.trim() ?? "";
  if (configuredFfmpeg || configuredFfprobe) {
    return {
      ffmpegExecutable: configuredFfmpeg,
      ffprobeExecutable: configuredFfprobe,
    };
  }
  const fileExists = options.fileExists ?? fs.existsSync;
  if ((options.platform ?? process.platform) === "darwin") {
    const homebrewBinDir = options.homebrewBinDir ?? "/opt/homebrew/bin";
    const homebrewPair = {
      ffmpegExecutable: path.join(homebrewBinDir, "ffmpeg"),
      ffprobeExecutable: path.join(homebrewBinDir, "ffprobe"),
    };
    if (fileExists(homebrewPair.ffmpegExecutable) && fileExists(homebrewPair.ffprobeExecutable)) {
      return homebrewPair;
    }
  }
  return {
    ffmpegExecutable: options.bundledFfmpeg,
    ffprobeExecutable: options.bundledFfprobe,
  };
}

/**
 * Every video-workflow process receives the same absolute FFmpeg/ffprobe pair.
 * Remotion's macOS compositor binaries ship their dylibs beside the executable,
 * so child processes must inherit that directory through DYLD_LIBRARY_PATH.
 */
export function buildSharedToolchainEnv(
  paths: Pick<VideoWorkflowRuntimePaths, "ffmpegExecutable" | "ffprobeExecutable">,
  extra: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  const toolDirectories = [paths.ffmpegExecutable, paths.ffprobeExecutable]
    .filter((value) => path.isAbsolute(value))
    .map((value) => path.dirname(value));
  const requestedPath = extra.PATH ?? "";
  const inheritedPath = process.env.PATH ?? "";
  const requestedDylibPath = extra.DYLD_LIBRARY_PATH ?? "";
  const inheritedDylibPath = process.env.DYLD_LIBRARY_PATH ?? "";
  return {
    ...process.env,
    ...extra,
    MYSTUDIO_FFMPEG_PATH: paths.ffmpegExecutable,
    MYSTUDIO_FFPROBE_PATH: paths.ffprobeExecutable,
    PATH: [...toolDirectories, requestedPath, inheritedPath].filter(Boolean).join(path.delimiter),
    ...(process.platform === "darwin"
      ? { DYLD_LIBRARY_PATH: [...toolDirectories, requestedDylibPath, inheritedDylibPath].filter(Boolean).join(path.delimiter) }
      : {}),
  } as NodeJS.ProcessEnv;
}

async function probeSharedVideoToolchain(
  paths: VideoWorkflowRuntimePaths,
  run: NonNullable<VideoWorkflowRuntimeProbeDeps["execFile"]>,
): Promise<Pick<VideoWorkflowRuntimeProbeResult, "missing" | "versions">> {
  const missing: string[] = [];
  const versions: VideoWorkflowRuntimeProbeResult["versions"] = {};
  const pair: Array<["ffmpeg" | "ffprobe", string]> = [
    ["ffmpeg", paths.ffmpegExecutable],
    ["ffprobe", paths.ffprobeExecutable],
  ];
  for (const [key, executable] of pair) {
    if (!path.isAbsolute(executable)) {
      missing.push(`${key}-path`);
      continue;
    }
    try {
      const result = await run(executable, ["-version"], {
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
        env: buildSharedToolchainEnv(paths),
      });
      versions[key] = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n")[0];
    } catch {
      missing.push(key);
    }
  }
  if (!missing.includes("ffmpeg") && !missing.includes("ffmpeg-path")) {
    try {
      const result = await run(paths.ffmpegExecutable, ["-hide_banner", "-filters"], {
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
        env: buildSharedToolchainEnv(paths),
      });
      const filters = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      for (const requiredFilter of ["tpad", "apad"]) {
        if (!new RegExp(`^\\s*[TSC.]{3}\\s+${requiredFilter}\\s`, "m").test(filters)) {
          missing.push(`ffmpeg-filter-${requiredFilter}`);
        }
      }
    } catch {
      missing.push("ffmpeg-filters");
    }
  }
  return { missing, versions };
}

export function resolveVideoWorkflowRuntimePaths(
  storageBasePath: string,
  platform: NodeJS.Platform = process.platform,
): VideoWorkflowRuntimePaths {
  if (!path.isAbsolute(storageBasePath)) throw new Error(`storageBasePath 必须是绝对路径: ${storageBasePath}`);
  const pythonRuntimeDir = path.join(storageBasePath, "python");
  const pythonExecutable = platform === "win32"
    ? path.join(pythonRuntimeDir, "python.exe")
    : path.join(pythonRuntimeDir, "bin", "python3");
  const nodeRuntimeDir = path.join(storageBasePath, "node22");
  const nodeExecutable = platform === "win32"
    ? path.join(nodeRuntimeDir, "node.exe")
    : path.join(nodeRuntimeDir, "bin", "node");
  const videoUseProfileDir = path.join(pythonRuntimeDir, "profiles", "video-use");
  const videoUseUpstreamRoot = path.join(videoUseProfileDir, "upstream");
  const hyperFramesProfileDir = path.join(nodeRuntimeDir, "profiles", "hyperframes");
  const hyperFramesCliPath = platform === "win32"
    ? path.join(hyperFramesProfileDir, "node_modules", ".bin", "hyperframes.cmd")
    : path.join(hyperFramesProfileDir, "node_modules", ".bin", "hyperframes");
  return {
    storageBasePath,
    pythonRuntimeDir,
    pythonExecutable,
    videoUseProfileDir,
    videoUseUpstreamRoot,
    videoUseLockPath: path.join(videoUseProfileDir, "requirements-video-use.lock"),
    videoUseMarkerPath: path.join(videoUseProfileDir, "profile.json"),
    nodeRuntimeDir,
    nodeExecutable,
    hyperFramesProfileDir,
    hyperFramesMarkerPath: path.join(hyperFramesProfileDir, "profile.json"),
    hyperFramesCliPath,
    hyperFramesBrowserPath: resolveSharedExecutable("HYPERFRAMES_BROWSER_PATH", "PRODUCER_HEADLESS_SHELL_PATH"),
    ffmpegExecutable: resolveSharedExecutable("MYSTUDIO_FFMPEG_PATH"),
    ffprobeExecutable: resolveSharedExecutable("MYSTUDIO_FFPROBE_PATH"),
  };
}

export async function probeVideoWorkflowRuntime(
  paths: VideoWorkflowRuntimePaths,
  deps: VideoWorkflowRuntimeProbeDeps = {},
): Promise<VideoWorkflowRuntimeProbeResult> {
  const fileExists = deps.fileExists ?? fs.existsSync;
  const run = deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options));
  const missing: string[] = [];
  if (!fileExists(paths.pythonExecutable)) missing.push("managed-python");
  if (!fileExists(paths.videoUseMarkerPath)) missing.push("video-use-profile");
  if (!fileExists(paths.nodeExecutable)) missing.push("node22");
  if (!fileExists(paths.hyperFramesMarkerPath)) missing.push("hyperframes-profile");
  if (!fileExists(paths.hyperFramesCliPath)) missing.push("hyperframes-cli");
  const versions: VideoWorkflowRuntimeProbeResult["versions"] = {};
  const probes: Array<[keyof typeof versions, string, string[]]> = [
    ["python", paths.pythonExecutable, ["--version"]],
    ["node", paths.nodeExecutable, ["--version"]],
  ];
  for (const [key, executable, args] of probes) {
    if (!path.isAbsolute(executable)) {
      missing.push(`${key}-path`);
      continue;
    }
    try {
      const result = await run(executable, args, {
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
        env: buildSharedToolchainEnv(paths),
      });
      versions[key] = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n")[0];
    } catch {
      missing.push(key);
    }
  }
  const toolchain = await probeSharedVideoToolchain(paths, run);
  missing.push(...toolchain.missing);
  Object.assign(versions, toolchain.versions);
  if (missing.includes("managed-python") || missing.includes("node22")) {
    return { state: "needs-runtime", paths, missing, versions, message: "请先在视频工作流插件设置中准备共享运行时" };
  }
  if (missing.length > 0) {
    return { state: "blocked", paths, missing, versions, message: `共享依赖未通过检查: ${missing.join(", ")}` };
  }
  if (!/^Python\s+3\.12\./.test(versions.python ?? "")) {
    return { state: "blocked", paths, missing: ["python-version"], versions, message: "video-use 必须复用 managed Python 3.12" };
  }
  if (!/^v?22\./.test(versions.node ?? "")) {
    return { state: "blocked", paths, missing: ["node-version"], versions, message: "HyperFrames 必须使用 Node 22" };
  }
  return { state: "ready", paths, missing, versions };
}

export async function probeVideoWorkflowAlignmentRuntime(
  paths: VideoWorkflowRuntimePaths,
  deps: VideoWorkflowRuntimeProbeDeps = {},
): Promise<VideoWorkflowRuntimeProbeResult> {
  const fileExists = deps.fileExists ?? fs.existsSync;
  const run = deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options));
  const missing: string[] = [];
  if (!fileExists(paths.pythonExecutable)) missing.push("managed-python");
  const versions: VideoWorkflowRuntimeProbeResult["versions"] = {};
  if (missing.length === 0) {
    try {
      const result = await run(paths.pythonExecutable, ["--version"], {
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
        env: buildSharedToolchainEnv(paths),
      });
      versions.python = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n")[0];
    } catch {
      missing.push("python");
    }
  }
  if (missing.includes("managed-python")) {
    return { state: "needs-runtime", paths, missing, versions, message: "请先在视频工作流插件设置中准备共享 Python 3.12" };
  }
  if (missing.length > 0) {
    return { state: "blocked", paths, missing, versions, message: `共享 Python 未通过检查: ${missing.join(", ")}` };
  }
  if (!/^Python\s+3\.12\./.test(versions.python ?? "")) {
    return { state: "blocked", paths, missing: ["python-version"], versions, message: "原文强制对齐必须复用 managed Python 3.12" };
  }
  return { state: "ready", paths, missing, versions };
}

/**
 * video-use runs before HyperFrames.  Its chapter worker must not be blocked
 * by the optional Node 22/HyperFrames profile that is only needed after the
 * user has reviewed the EDL and preview.
 */
export async function probeVideoUseRuntime(
  paths: VideoWorkflowRuntimePaths,
  deps: VideoWorkflowRuntimeProbeDeps = {},
): Promise<VideoWorkflowRuntimeProbeResult> {
  const alignment = await probeVideoWorkflowAlignmentRuntime(paths, deps);
  if (alignment.state !== "ready") return alignment;
  const fileExists = deps.fileExists ?? fs.existsSync;
  const run = deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options));
  const missing: string[] = [];
  if (!fileExists(paths.videoUseMarkerPath)) missing.push("video-use-profile");
  const versions = { ...alignment.versions };
  const toolchain = await probeSharedVideoToolchain(paths, run);
  missing.push(...toolchain.missing);
  Object.assign(versions, toolchain.versions);
  if (missing.includes("video-use-profile")) {
    return { state: "needs-runtime", paths, missing, versions, message: "请先准备 video-use profile" };
  }
  const profile = readJsonFile(paths.videoUseMarkerPath);
  if (!profile
    || profile.schemaVersion !== 1
    || profile.profileId !== VIDEO_USE_PROFILE_ID
    || profile.pythonExecutable !== paths.pythonExecutable
    || profile.upstreamRoot !== paths.videoUseUpstreamRoot
    || profile.lockPath !== paths.videoUseLockPath
    || typeof profile.lockSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(profile.lockSha256)
    || !fileExists(paths.videoUseLockPath)) {
    return {
      state: "blocked",
      paths,
      missing: ["video-use-profile-invalid"],
      versions,
      message: "video-use profile marker、lock 或 managed Python 路径不一致",
    };
  }
  if (profile.sourceCommit !== VIDEO_USE_SOURCE_COMMIT) {
    return {
      state: "update-available",
      paths,
      missing: ["video-use-update-available"],
      versions,
      message: `video-use 可更新到应用锁定版本 ${VIDEO_USE_SOURCE_COMMIT}`,
    };
  }
  try {
    if (sha256File(paths.videoUseLockPath) !== profile.lockSha256) {
      return {
        state: "blocked",
        paths,
        missing: ["video-use-lock-drift"],
        versions,
        message: "video-use lock SHA-256 与 profile marker 不一致",
      };
    }
  } catch {
    return {
      state: "blocked",
      paths,
      missing: ["video-use-lock-missing"],
      versions,
      message: "video-use lock 文件无法读取",
    };
  }
  try {
    await run(paths.pythonExecutable, ["-c", "import librosa, matplotlib, PIL, numpy"], {
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      cwd: paths.videoUseProfileDir,
      env: buildSharedToolchainEnv(paths),
    });
  } catch (error) {
    return {
      state: "blocked",
      paths,
      missing: ["video-use-dependencies"],
      versions,
      message: `video-use managed Python 依赖未完整安装: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (missing.length > 0) {
    return { state: "blocked", paths, missing, versions, message: `video-use 共享依赖未通过检查: ${missing.join(", ")}` };
  }
  return { state: "ready", paths, missing, versions };
}

/** HyperFrames has its own Node 22 sidecar and does not require video-use. */
export async function probeHyperFramesRuntime(
  paths: VideoWorkflowRuntimePaths,
  deps: VideoWorkflowRuntimeProbeDeps = {},
  options: { browserPath?: string } = {},
): Promise<VideoWorkflowRuntimeProbeResult> {
  const fileExists = deps.fileExists ?? fs.existsSync;
  const run = deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options));
  const missing: string[] = [];
  if (!fileExists(paths.nodeExecutable)) missing.push("node22");
  if (!fileExists(paths.hyperFramesMarkerPath)) missing.push("hyperframes-profile");
  if (!fileExists(paths.hyperFramesCliPath)) missing.push("hyperframes-cli");
  const versions: VideoWorkflowRuntimeProbeResult["versions"] = {};
  for (const [key, executable, args] of [
    ["node", paths.nodeExecutable, ["--version"]],
  ] as Array<[keyof VideoWorkflowRuntimeProbeResult["versions"], string, string[]]>) {
    if (!path.isAbsolute(executable)) {
      missing.push(`${key}-path`);
      continue;
    }
    try {
      const result = await run(executable, args, {
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
        env: buildSharedToolchainEnv(paths),
      });
      versions[key] = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n")[0];
    } catch {
      missing.push(key);
    }
  }
  const toolchain = await probeSharedVideoToolchain(paths, run);
  missing.push(...toolchain.missing);
  Object.assign(versions, toolchain.versions);
  if (missing.includes("node22")) {
    return { state: "needs-runtime", paths, missing, versions, message: "请先准备 Node 22 运行时" };
  }
  if (missing.length > 0) {
    return { state: "blocked", paths, missing, versions, message: `HyperFrames 共享依赖未通过检查: ${missing.join(", ")}` };
  }
  if (!/^v?22\./.test(versions.node ?? "")) {
    return { state: "blocked", paths, missing: ["node-version"], versions, message: "HyperFrames 必须使用 Node 22" };
  }
  const profile = readJsonFile(paths.hyperFramesMarkerPath);
  if (!profile
    || profile.schemaVersion !== 1
    || profile.profileId !== HYPERFRAMES_PROFILE_ID
    || profile.nodeExecutable !== paths.nodeExecutable
    || profile.cliPath !== paths.hyperFramesCliPath) {
    return {
      state: "blocked",
      paths,
      missing: ["hyperframes-profile-invalid"],
      versions,
      message: "HyperFrames profile marker 与应用级 Node 22 路径不一致",
    };
  }
  if (profile.sourceCommit !== HYPERFRAMES_SOURCE_COMMIT || profile.npmVersion !== HYPERFRAMES_NPM_VERSION) {
    return {
      state: "update-available",
      paths,
      missing: ["hyperframes-update-available"],
      versions,
      message: `HyperFrames 可更新到应用锁定版本 ${HYPERFRAMES_NPM_VERSION}`,
    };
  }
  const browserPath = options.browserPath?.trim() || paths.hyperFramesBrowserPath;
  if (!browserPath || !path.isAbsolute(browserPath)) {
    return {
      state: "needs-runtime",
      paths,
      missing: ["browser-path"],
      versions,
      message: "HyperFrames 未找到可复用的 Remotion Headless Shell；请先在设置页准备浏览器或配置 HYPERFRAMES_BROWSER_PATH",
    };
  }
  if (!fileExists(browserPath)) {
    return {
      state: "blocked",
      paths,
      missing: ["browser-path"],
      versions,
      message: `HyperFrames 浏览器路径不存在: ${browserPath}`,
    };
  }
  const cliCommand = paths.hyperFramesCliPath.endsWith(".mjs") ? paths.nodeExecutable : paths.hyperFramesCliPath;
  const cliPrefix = cliCommand === paths.nodeExecutable ? [paths.hyperFramesCliPath] : [];
  const sharedEnv = buildSharedToolchainEnv(paths, {
    HYPERFRAMES_BROWSER_PATH: browserPath,
    PRODUCER_HEADLESS_SHELL_PATH: browserPath,
    PATH: [path.dirname(paths.nodeExecutable), process.env.PATH ?? ""].filter(Boolean).join(path.delimiter),
  });
  let doctorPayload: unknown;
  try {
    const result = await run(cliCommand, [...cliPrefix, "doctor", "--json"], {
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
      cwd: paths.hyperFramesProfileDir,
      env: sharedEnv,
    });
    const output = `${result.stdout ?? ""}`.trim();
    const jsonStart = output.indexOf("{");
    doctorPayload = jsonStart >= 0 ? JSON.parse(output.slice(jsonStart)) : undefined;
  } catch (error) {
    return {
      state: "blocked",
      paths,
      missing: ["hyperframes-doctor"],
      versions,
      message: `HyperFrames doctor --json 失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!isHyperFramesDoctorReady(doctorPayload)) {
    return {
      state: "blocked",
      paths,
      missing: ["hyperframes-doctor"],
      versions,
      message: "HyperFrames doctor --json 未通过 ok=true 门禁",
    };
  }
  try {
    const result = await run(cliCommand, [...cliPrefix, "browser", "path"], {
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      cwd: paths.hyperFramesProfileDir,
      env: sharedEnv,
    });
    const resolvedBrowserPath = `${result.stdout ?? ""}`.trim().split("\n").filter(Boolean).at(-1) ?? "";
    if (!path.isAbsolute(resolvedBrowserPath) || !fileExists(resolvedBrowserPath)) {
      return {
        state: "blocked",
        paths,
        missing: ["hyperframes-browser"],
        versions,
        message: "HyperFrames browser path 未返回可执行的绝对路径",
      };
    }
    versions.browser = resolvedBrowserPath;
  } catch (error) {
    return {
      state: "blocked",
      paths,
      missing: ["hyperframes-browser"],
      versions,
      message: `HyperFrames browser path 探针失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { state: "ready", paths, missing, versions };
}

export function buildVideoUseProfileMarker(
  paths: VideoWorkflowRuntimePaths,
  lockSha256: string,
  now = Date.now(),
): VideoUseProfileMarkerV1 {
  if (!/^[a-f0-9]{64}$/.test(lockSha256)) throw new Error("video-use lock SHA-256 无效");
  return {
    schemaVersion: 1,
    profileId: VIDEO_USE_PROFILE_ID,
    sourceCommit: VIDEO_USE_SOURCE_COMMIT,
    pythonExecutable: paths.pythonExecutable,
    upstreamRoot: paths.videoUseUpstreamRoot,
    lockPath: paths.videoUseLockPath,
    lockSha256,
    createdAt: now,
    verifiedAt: now,
  };
}

export function buildHyperFramesProfileMarker(
  paths: VideoWorkflowRuntimePaths,
  now = Date.now(),
): HyperFramesProfileMarkerV1 {
  return {
    schemaVersion: 1,
    profileId: HYPERFRAMES_PROFILE_ID,
    sourceCommit: HYPERFRAMES_SOURCE_COMMIT,
    npmVersion: HYPERFRAMES_NPM_VERSION,
    nodeExecutable: paths.nodeExecutable,
    cliPath: paths.hyperFramesCliPath,
    createdAt: now,
    verifiedAt: now,
  };
}

export function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readJsonFile(filePath: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeProfileMarker(filePath: string, marker: VideoUseProfileMarkerV1 | HyperFramesProfileMarkerV1): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}
