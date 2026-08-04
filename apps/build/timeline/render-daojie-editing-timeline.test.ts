import fs from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { EditingProjectV1 } from "@/types/editing";
import {
  deriveStorageRoots,
  resolveProjectDir,
  resolveStorageBasePath,
  parseStoryboard,
  removeRemotionEditingAudioTracks,
  requireTimelineArtifacts,
  resolveTimelineSourcePath,
  resolveUserDataDir,
  resolveRemotionRuntimeDir,
} from "./render-daojie-editing-timeline";

const temporaryRoots: string[] = [];
const ENV_KEYS = [
  "MYSTUDIO_DAOJIE_PROJECT_DIR",
  "MYSTUDIO_DAOJIE_PROJECT_ID",
  "MYSTUDIO_DAOJIE_USER_DATA_DIR",
  "MYSTUDIO_USER_DATA_DIR",
  "MYSTUDIO_REMOTION_RUNTIME_DIR",
  "MYSTUDIO_STORAGE_BASE_PATH",
] as const;

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe("Daojie editing timeline runner", () => {
  it("uses injected Electron userData, then canonical and legacy env aliases", () => {
    const injected = path.join(os.tmpdir(), "mystudio-injected-user-data");
    process.env.MYSTUDIO_USER_DATA_DIR = path.join(os.tmpdir(), "mystudio-canonical-user-data");
    process.env.MYSTUDIO_DAOJIE_USER_DATA_DIR = path.join(os.tmpdir(), "mystudio-legacy-user-data");
    expect(resolveUserDataDir(injected)).toBe(path.resolve(injected));
    expect(resolveUserDataDir()).toBe(path.resolve(process.env.MYSTUDIO_USER_DATA_DIR));
    delete process.env.MYSTUDIO_USER_DATA_DIR;
    expect(resolveUserDataDir()).toBe(path.resolve(process.env.MYSTUDIO_DAOJIE_USER_DATA_DIR!));
    process.env.MYSTUDIO_REMOTION_RUNTIME_DIR = path.join(os.tmpdir(), "mystudio-remotion-runtime");
    expect(resolveRemotionRuntimeDir(injected)).toBe(path.resolve(process.env.MYSTUDIO_REMOTION_RUNTIME_DIR));
  });

  it("keeps only visual and text tracks for the formal Remotion chapter projection", () => {
    const project = {
      tracks: [
        { id: "video", kind: "video" },
        { id: "voice", kind: "voice" },
        { id: "bgm", kind: "bgm" },
        { id: "sfx", kind: "sfx" },
        { id: "text", kind: "text" },
      ],
      clips: [
        { id: "visual", trackId: "video" },
        { id: "voice-clip", trackId: "voice" },
        { id: "bgm-clip", trackId: "bgm" },
        { id: "sfx-clip", trackId: "sfx" },
        { id: "subtitle", trackId: "text" },
      ],
    } as EditingProjectV1;

    const projected = removeRemotionEditingAudioTracks(project);

    expect(projected.tracks.map((track) => track.kind)).toEqual(["video", "text"]);
    expect(projected.clips.map((clip) => clip.id)).toEqual(["visual", "subtitle"]);
  });

  it("accepts the persisted chapter storyboard shape with an empty trackId", () => {
    expect(parseStoryboard({
      id: "sb-chapter-001-001",
      episodeId: "chapter-001",
      index: 1,
      trackKey: "001", // Dynamic runtime key: {episodeNumber} (matches production.ts resolution)
      trackId: "",
      duration: 4.2,
      prompt: "分镜提示",
      videoDesc: "镜头描述",
      assetIds: [],
      mediaRef: { kind: "image", path: "project-file://project-1/shot.png" },
      audioRef: { kind: "audio", path: "/tmp/shot.wav" },
      state: "ready",
    }, 0)).toMatchObject({
      id: "sb-chapter-001-001",
      trackId: "",
    });
  });

  it("derives production storage roots and resolves every supported source URL", () => {
    const storageBase = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-daojie-runner-"));
    temporaryRoots.push(storageBase);
    const projectDir = path.join(storageBase, "projects", "_p", "project-1");
    const projectSource = path.join(projectDir, "workflow-images", "shot.png");
    const mediaSource = path.join(storageBase, "media", "ai-image", "cover.png");
    const absoluteSource = path.join(storageBase, "absolute.mp4");
    for (const sourcePath of [projectSource, mediaSource, absoluteSource]) {
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, "fixture", "utf8");
    }

    const roots = deriveStorageRoots(projectDir);
    expect(roots).toEqual({
      projectId: "project-1",
      dataRoot: path.join(storageBase, "projects"),
      mediaRoot: path.join(storageBase, "media"),
      renderRoot: path.join(storageBase, "media", "studio-render"),
    });
    expect(resolveTimelineSourcePath({
      sourcePath: "project-file://project-1/workflow-images/shot.png",
      dataRoot: roots.dataRoot,
      mediaRoot: roots.mediaRoot,
    })).toBe(projectSource);
    expect(resolveTimelineSourcePath({
      sourcePath: "local-image://ai-image/cover.png",
      dataRoot: roots.dataRoot,
      mediaRoot: roots.mediaRoot,
    })).toBe(mediaSource);
    expect(resolveTimelineSourcePath({
      sourcePath: pathToFileURL(absoluteSource).href,
      dataRoot: roots.dataRoot,
      mediaRoot: roots.mediaRoot,
    })).toBe(absoluteSource);
    expect(resolveTimelineSourcePath({
      sourcePath: absoluteSource,
      dataRoot: roots.dataRoot,
      mediaRoot: roots.mediaRoot,
    })).toBe(absoluteSource);

    expect(() => resolveTimelineSourcePath({
      sourcePath: "relative/shot.png",
      dataRoot: roots.dataRoot,
      mediaRoot: roots.mediaRoot,
    })).toThrow(/不是绝对路径/);
    expect(() => resolveTimelineSourcePath({
      sourcePath: path.join(storageBase, "missing.png"),
      dataRoot: roots.dataRoot,
      mediaRoot: roots.mediaRoot,
    })).toThrow();

    const emptySource = path.join(storageBase, "empty.png");
    fs.writeFileSync(emptySource, "");
    expect(() => resolveTimelineSourcePath({
      sourcePath: emptySource,
      dataRoot: roots.dataRoot,
      mediaRoot: roots.mediaRoot,
    })).toThrow(/不可读或为空/);
  });

  it("resolves the Daojie project from storage config and explicit project id", () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-user-data-"));
    const storageBase = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-storage-base-"));
    temporaryRoots.push(userData, storageBase);
    fs.writeFileSync(path.join(userData, "storage-config.json"), `${JSON.stringify({ basePath: storageBase })}\n`, "utf8");
    process.env.MYSTUDIO_DAOJIE_USER_DATA_DIR = userData;
    process.env.MYSTUDIO_DAOJIE_PROJECT_ID = "project-from-env";

    expect(resolveStorageBasePath()).toBe(storageBase);
    expect(resolveProjectDir()).toBe(path.join(storageBase, "projects", "_p", "project-from-env"));
  });

  it("resolves the Daojie project from the project catalog when no fixed id is configured", () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-user-data-"));
    const storageBase = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-storage-base-"));
    temporaryRoots.push(userData, storageBase);
    fs.writeFileSync(path.join(userData, "storage-config.json"), `${JSON.stringify({ basePath: storageBase })}\n`, "utf8");
    fs.mkdirSync(path.join(storageBase, "projects"), { recursive: true });
    fs.writeFileSync(
      path.join(storageBase, "projects", "mystudio-project-store.json"),
      `${JSON.stringify({ state: { projects: [{ id: "project-from-name", name: "道劫" }] } })}\n`,
      "utf8",
    );
    process.env.MYSTUDIO_DAOJIE_USER_DATA_DIR = userData;

    expect(resolveProjectDir()).toBe(path.join(storageBase, "projects", "_p", "project-from-name"));
  });

  it("keeps an explicit Daojie project directory override above storage config", () => {
    const explicitProjectDir = path.join(os.tmpdir(), "mystudio-explicit-project");
    process.env.MYSTUDIO_DAOJIE_PROJECT_DIR = explicitProjectDir;
    process.env.MYSTUDIO_STORAGE_BASE_PATH = path.join(os.tmpdir(), "mystudio-storage-ignored");

    expect(resolveProjectDir()).toBe(explicitProjectDir);
  });

  it("accepts only complete timeline artifacts with a matching snapshot hash", () => {
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-timeline-artifacts-"));
    temporaryRoots.push(artifactRoot);
    const files = {
      outputPath: path.join(artifactRoot, "final.mp4"),
      snapshotPath: path.join(artifactRoot, "editing-project.json"),
      renderPlanPath: path.join(artifactRoot, "timeline-render-plan.json"),
      inputManifestPath: path.join(artifactRoot, "input-manifest.json"),
      filterGraphPath: path.join(artifactRoot, "filter-graph.txt"),
      logPath: path.join(artifactRoot, "render.log"),
      ffprobePath: path.join(artifactRoot, "ffprobe.json"),
    };
    for (const filePath of Object.values(files)) fs.writeFileSync(filePath, "fixture", "utf8");
    const snapshotHash = createHash("sha256")
      .update(fs.readFileSync(files.snapshotPath))
      .digest("hex");
    const outputStat = fs.statSync(files.outputPath);
    const outputSha256 = createHash("sha256")
      .update(fs.readFileSync(files.outputPath))
      .digest("hex");
    const evidence = {
      jobId: "timeline-fixture-1",
      path: files.outputPath,
      sizeBytes: outputStat.size,
      mtimeMs: outputStat.mtimeMs,
      sha256: outputSha256,
      duration: 1,
      width: 1080,
      height: 1920,
      streams: ["video", "audio"],
      snapshotHash,
      snapshotPath: files.snapshotPath,
      renderPlanPath: files.renderPlanPath,
      inputManifestPath: files.inputManifestPath,
      filterGraphPath: files.filterGraphPath,
      logPath: files.logPath,
      ffprobePath: files.ffprobePath,
    } as const;

    expect(() => requireTimelineArtifacts(evidence, {
      renderRoot: artifactRoot,
      minimumMtimeMs: 0,
    })).not.toThrow();
    expect(() => requireTimelineArtifacts({
      ...evidence,
      path: path.join(artifactRoot, "final.mov"),
    }, { renderRoot: artifactRoot })).toThrow(/不是 MP4/);
    expect(() => requireTimelineArtifacts({
      ...evidence,
      streams: ["video"],
    }, { renderRoot: artifactRoot })).toThrow(/缺少音视频流/);
    expect(() => requireTimelineArtifacts({
      ...evidence,
      duration: 0,
    }, { renderRoot: artifactRoot })).toThrow(/时长无效/);
    expect(() => requireTimelineArtifacts({
      ...evidence,
      width: 0,
    }, { renderRoot: artifactRoot })).toThrow(/尺寸无效/);
    expect(() => requireTimelineArtifacts({
      ...evidence,
      height: Number.NaN,
    }, { renderRoot: artifactRoot })).toThrow(/尺寸无效/);
    expect(() => requireTimelineArtifacts({
      ...evidence,
      ffprobePath: path.join(artifactRoot, "missing-ffprobe.json"),
    }, { renderRoot: artifactRoot })).toThrow(/ffprobePath/);
    expect(() => requireTimelineArtifacts({
      ...evidence,
      snapshotHash: "b".repeat(64),
    }, { renderRoot: artifactRoot })).toThrow(/snapshotHash/);
    expect(() => requireTimelineArtifacts({
      ...evidence,
      sha256: "b".repeat(64),
    }, { renderRoot: artifactRoot })).toThrow(/sha256/);
    expect(() => requireTimelineArtifacts({
      ...evidence,
      sizeBytes: evidence.sizeBytes + 1,
    }, { renderRoot: artifactRoot })).toThrow(/sizeBytes/);

    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-timeline-outside-"));
    temporaryRoots.push(outsideRoot);
    const outsideOutput = path.join(outsideRoot, "outside.mp4");
    fs.writeFileSync(outsideOutput, "outside fixture", "utf8");
    const outsideOutputStat = fs.statSync(outsideOutput);
    const outsideOutputSha256 = createHash("sha256")
      .update(fs.readFileSync(outsideOutput))
      .digest("hex");
    expect(() => requireTimelineArtifacts({
      ...evidence,
      path: outsideOutput,
      sizeBytes: outsideOutputStat.size,
      mtimeMs: outsideOutputStat.mtimeMs,
      sha256: outsideOutputSha256,
    }, { renderRoot: artifactRoot })).toThrow(/逃逸/);
  });
});
