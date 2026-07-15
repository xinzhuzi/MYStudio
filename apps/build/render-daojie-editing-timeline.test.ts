import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveStorageRoots,
  parseStoryboard,
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
  });
});
