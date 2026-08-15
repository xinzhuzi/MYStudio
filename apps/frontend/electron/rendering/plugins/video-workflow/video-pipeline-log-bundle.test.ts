import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createVideoPipelineLogBundle } from "./video-pipeline-log-bundle";
import { setProjectLocationResolver } from "../../../storage/storage-paths";

describe("createVideoPipelineLogBundle project locations", () => {
  afterEach(() => {
    setProjectLocationResolver(null);
  });

  it("collects video-use artifacts from the external project root when a location is registered", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-log-bundle-"));
    const dataRoot = path.join(root, "data");
    const externalRoot = path.join(root, "external");
    // Legacy dir exists but stays empty: the bundle must not read from it.
    fs.mkdirSync(path.join(dataRoot, "_p", "p-ext"), { recursive: true });
    const revisionDir = path.join(externalRoot, "video-use", "chapter-1", "r2");
    fs.mkdirSync(revisionDir, { recursive: true });
    fs.writeFileSync(path.join(revisionDir, "video-use-run.json"), JSON.stringify({ marker: "external-run" }), "utf8");
    setProjectLocationResolver((projectId) => (projectId === "p-ext" ? externalRoot : undefined));

    try {
      const bundle = createVideoPipelineLogBundle({
        dataRoot,
        projectId: "p-ext",
        chapterId: "chapter-1",
        now: () => 123,
      });
      expect(bundle.revision).toBe(2);
      expect(bundle.stages.videoUse?.run).toEqual({ marker: "external-run" });
    } finally {
      setProjectLocationResolver(null);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the legacy data-root layout for unregistered projects", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-log-bundle-legacy-"));
    const dataRoot = path.join(root, "data");
    const revisionDir = path.join(dataRoot, "_p", "p-legacy", "video-use", "chapter-1", "r1");
    fs.mkdirSync(revisionDir, { recursive: true });
    fs.writeFileSync(path.join(revisionDir, "video-use-run.json"), JSON.stringify({ marker: "legacy-run" }), "utf8");

    try {
      const bundle = createVideoPipelineLogBundle({
        dataRoot,
        projectId: "p-legacy",
        chapterId: "chapter-1",
        now: () => 1,
      });
      expect(bundle.revision).toBe(1);
      expect(bundle.stages.videoUse?.run).toEqual({ marker: "legacy-run" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
