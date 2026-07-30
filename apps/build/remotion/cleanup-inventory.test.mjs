// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCleanupInventory, runCleanupInventoryCli, SHARED_SCOPE_ID } from "./cleanup-inventory.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "remotion-cleanup-inventory-"));
  const dataDir = path.join(root, "projects");
  const projectRoot = path.join(dataDir, "_p", "project-a");
  fs.mkdirSync(path.join(root, "apps", "frontend", "components", "panels", "studio"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "remotion", "outputs"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "backups"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "apps", "frontend", "components", "panels", "studio", "legacy.tsx"),
    "import { createFfmpegRendererAdapter } from '@rendering/runtime/ffmpeg/ffmpeg-renderer-adapter';\n",
  );
  fs.writeFileSync(path.join(projectRoot, "studio-workflow-store.json"), JSON.stringify({ state: { storyboards: [{ prompt: "protected" }] } }));
  fs.writeFileSync(path.join(projectRoot, "editing.json"), JSON.stringify({ state: { revision: 2, sourceFingerprint: "a".repeat(64) } }));
  fs.writeFileSync(path.join(projectRoot, "remotion", "outputs", "current.mp4"), "current");
  fs.writeFileSync(path.join(projectRoot, "backups", "source.json"), "source");
  return { root, dataDir };
}

describe("Remotion cleanup inventory", () => {
  it("keeps mixed workflow state, backups and current Remotion output protected", () => {
    const { root, dataDir } = fixture();
    const manifest = buildCleanupInventory({ repoRoot: root, dataDir, generatedAt: 1 });
    const items = manifest.projects[0]?.items ?? [];
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.mode).toBe("read-only");
    expect(items.find((item) => item.relativePath.endsWith("studio-workflow-store.json"))).toMatchObject({
      kind: "legacy-workflow-state",
      protected: true,
      deletionEligible: false,
    });
    expect(items.find((item) => item.relativePath.endsWith("current.mp4"))).toMatchObject({
      kind: "remotion-output",
      protected: true,
      deletionEligible: false,
    });
    expect(items.find((item) => item.relativePath.endsWith("source.json"))).toMatchObject({
      kind: "protected-backup",
      protected: true,
      deletionEligible: false,
    });
    expect(manifest.shared.items.find((item) => item.projectId === SHARED_SCOPE_ID)?.currentCallerCount).toBeGreaterThan(0);
  });

  it("writes a manifest only when the data root is explicitly supplied", () => {
    const { root, dataDir } = fixture();
    const output = path.join(root, "inventory.json");
    const result = runCleanupInventoryCli(["--repo-root", root, "--data-dir", dataDir, "--output", output]);
    expect(result.output).toBe(output);
    expect(JSON.parse(fs.readFileSync(output, "utf8")).dataDir).toBe(dataDir);
    expect(() => runCleanupInventoryCli(["--repo-root", root])).toThrow("--data-dir");
  });

  it("does not count the legacy target file itself as a caller and separates tests", () => {
    const { root, dataDir } = fixture();
    const target = path.join(root, "apps", "frontend", "electron", "rendering", "runtime", "ffmpeg", "ffmpeg-renderer-adapter.ts");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "const provider = 'ffmpeg-local';\n");
    fs.writeFileSync(
      path.join(root, "apps", "frontend", "components", "panels", "studio", "legacy.test.tsx"),
      "const provider = 'createFfmpegRendererAdapter';\n",
    );
    const manifest = buildCleanupInventory({ repoRoot: root, dataDir, generatedAt: 1 });
    expect(manifest.shared.items.find((item) => item.id === "legacy-ffmpeg-renderer")).toMatchObject({
      currentCallerCount: 1,
      testCallerCount: 1,
    });
  });

  it("allows cleanup when only test sources reference a project artifact", () => {
    const { root, dataDir } = fixture();
    const projectArtifact = path.join(dataDir, "_p", "project-a", "legacy-track.json");
    fs.writeFileSync(projectArtifact, JSON.stringify({ revision: 1 }));
    fs.writeFileSync(
      path.join(root, "apps", "frontend", "components", "panels", "studio", "legacy-track.test.tsx"),
      "readFile('legacy-track.json');\n",
    );
    const manifest = buildCleanupInventory({ repoRoot: root, dataDir, generatedAt: 1 });
    const item = manifest.projects[0]?.items.find((entry) => entry.relativePath.endsWith("legacy-track.json"));
    expect(item).toMatchObject({
      currentCallerCount: 0,
      testCallerCount: 1,
      deletionEligible: true,
    });
  });
});
