import fs from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveStorageRoots,
  parseStoryboard,
  requireTimelineArtifacts,
  resolveTimelineSourcePath,
} from "./render-daojie-editing-timeline";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Daojie editing timeline runner", () => {
  it("accepts the persisted chapter storyboard shape with an empty trackId", () => {
    expect(parseStoryboard({
      id: "sb-chapter-001-001",
      episodeId: "chapter-001",
      index: 1,
      trackKey: "chapter-001-scene-1",
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
