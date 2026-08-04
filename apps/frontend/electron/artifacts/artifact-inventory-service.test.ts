import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import { scanProjectInventory } from "./artifact-inventory-service";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) await fs.rm(roots.pop()!, { recursive: true, force: true });
});

describe("artifact inventory persisted project state", () => {
  it("decodes Zustand project files and keeps chapter filters isolated", async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mystudio-artifact-inventory-"));
    roots.push(dataRoot);
    const projectRoot = path.join(dataRoot, "_p", "project-fixture");
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(path.join(projectRoot, "studio.json"), JSON.stringify({
      state: {
        novelChapters: [
          { id: "chapter-fixture", index: 1, title: "第一章" },
          { id: "chapter-keep", index: 2, title: "第二章" },
        ],
      },
      version: 0,
    }));
    await fs.writeFile(path.join(projectRoot, "script.json"), JSON.stringify({
      state: {
        projects: {
          "project-fixture": {
            scriptData: {
              episodes: [
                { id: "chapter-fixture", index: 1, title: "第一章剧本" },
                { id: "chapter-keep", index: 2, title: "第二章剧本" },
              ],
            },
          },
        },
      },
      version: 0,
    }));
    await fs.writeFile(path.join(projectRoot, "project-history.bak"), JSON.stringify({
      projectId: "project-fixture",
      state: {
        novelChapters: [
          { id: "chapter-fixture", title: "第一章备份" },
          { id: "chapter-keep", title: "第二章备份" },
        ],
      },
      timestamp: 1,
    }));
    await fs.mkdir(path.join(projectRoot, "workflow-images", "storyboards", "chapter-fixture"), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "workflow-images", "storyboards", "chapter-fixture", "shot-001.png"), "fixture-image");
    await fs.writeFile(path.join(projectRoot, "artifacts.json"), JSON.stringify({
      version: 1,
      overlays: {
        "novel:media-file:project-fixture-chapter-fixture": {
          name: "第一章覆盖名称",
          tags: ["checked"],
          updatedAt: 1,
        },
      },
    }));

    const full = await scanProjectInventory(dataRoot, "project-fixture");
    expect(full.success).toBe(true);
    if (!full.success) return;
    expect(full.data.artifacts.filter((artifact) => artifact.chapterId === "chapter-fixture").length).toBeGreaterThan(0);
    expect(full.data.artifacts.filter((artifact) => artifact.chapterId === "chapter-keep").length).toBeGreaterThan(0);
    expect(full.data.artifacts.some((artifact) => artifact.metadata?.name === "第一章覆盖名称")).toBe(true);

    const chapter = await scanProjectInventory(dataRoot, "project-fixture", "chapter-fixture");
    expect(chapter.success).toBe(true);
    if (!chapter.success) return;
    expect(chapter.data.artifacts.every((artifact) => artifact.chapterId === "chapter-fixture")).toBe(true);
    expect(chapter.data.artifacts.some((artifact) => artifact.name === "shot-001.png")).toBe(true);
    expect(chapter.data.discrepancies).toHaveLength(0);
  });
});
