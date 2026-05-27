import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createStoredStudioSkillFile,
  deleteStoredStudioSkillFile,
  ensureStudioSkillsSynced,
  getStudioSkillStorageRoot,
  listStoredStudioSkillFiles,
  readStoredStudioSkillText,
  resolveStoredStudioSkillPath,
  writeStoredStudioSkillText,
} from "./studio-skills-storage";

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "manying-skills-"));
  tempRoots.push(root);
  return root;
}

async function writeText(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf-8");
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("studio skills storage", () => {
  it("copies bundled skills into storage and edits only the storage copy", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    await writeText(path.join(sourceRoot, "script_agent_decision.md"), "# Bundled\n");
    await writeText(path.join(sourceRoot, "art_skills/daojie_ink_guofeng/README.md"), "# Daojie\n");

    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });
    await writeStoredStudioSkillText(storageRoot, "agent_skills/script_agent_decision.md", "# User Edit\n");

    await expect(fs.readFile(path.join(sourceRoot, "script_agent_decision.md"), "utf-8")).resolves.toBe("# Bundled\n");
    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/script_agent_decision.md")).resolves.toBe("# User Edit\n");

    const files = await listStoredStudioSkillFiles({ sourceRoot, storageRoot });
    expect(files.find((file) => file.relativePath === "agent_skills/script_agent_decision.md")).toMatchObject({
      isCustomized: true,
      sourceExists: true,
    });
    await expect(fs.access(path.join(storageRoot, "script_agent_decision.md"))).rejects.toThrow();
  });

  it("updates unmodified storage files from new bundled seeds but preserves user edits", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    await writeText(path.join(sourceRoot, "script_execution_skeleton.md"), "seed v1\n");
    await writeText(path.join(sourceRoot, "script_execution_script.md"), "seed script v1\n");
    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });

    await writeStoredStudioSkillText(storageRoot, "agent_skills/script_execution_script.md", "user edit\n");
    await writeText(path.join(sourceRoot, "script_execution_skeleton.md"), "seed v2\n");
    await writeText(path.join(sourceRoot, "script_execution_script.md"), "seed script v2\n");
    await writeText(path.join(sourceRoot, "production_skills/storyboard_table_techniques.md"), "new seed\n");

    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });

    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/script_execution_skeleton.md")).resolves.toBe("seed v2\n");
    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/script_execution_script.md")).resolves.toBe("user edit\n");
    await expect(readStoredStudioSkillText(storageRoot, "production_skills/storyboard_table_techniques.md")).resolves.toBe("new seed\n");
  });

  it("migrates legacy root agent skill copies into agent_skills", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    await writeText(path.join(sourceRoot, "script_agent_supervision.md"), "seed\n");
    await writeText(path.join(storageRoot, "script_agent_supervision.md"), "legacy user edit\n");

    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });

    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/script_agent_supervision.md")).resolves.toBe("legacy user edit\n");
    await expect(fs.access(path.join(storageRoot, "script_agent_supervision.md"))).rejects.toThrow();
  });

  it("creates and deletes classified storage skill files", async () => {
    const root = await createTempRoot();
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    const created = await createStoredStudioSkillFile(storageRoot, "art_skills/custom-style/README.md", "# Custom\n");
    expect(created.relativePath).toBe("art_skills/custom-style/README.md");
    await expect(readStoredStudioSkillText(storageRoot, "art_skills/custom-style/README.md")).resolves.toBe("# Custom\n");

    const deleted = await deleteStoredStudioSkillFile(storageRoot, "art_skills/custom-style/README.md");
    expect(deleted).toBe(true);
    await expect(readStoredStudioSkillText(storageRoot, "art_skills/custom-style/README.md")).rejects.toThrow();
  });

  it("keeps deleted bundled skills deleted across later syncs", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    await writeText(path.join(sourceRoot, "script_agent_decision.md"), "seed\n");
    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });

    expect(await deleteStoredStudioSkillFile(storageRoot, "agent_skills/script_agent_decision.md")).toBe(true);
    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });

    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/script_agent_decision.md")).rejects.toThrow();
    const files = await listStoredStudioSkillFiles({ sourceRoot, storageRoot });
    expect(files.map((file) => file.relativePath)).not.toContain("agent_skills/script_agent_decision.md");
  });

  it("rejects unsafe editable skill paths", async () => {
    const root = await createTempRoot();
    const storageRoot = getStudioSkillStorageRoot(root);

    expect(() => resolveStoredStudioSkillPath(storageRoot, "../escape.md")).toThrow("Invalid studio skill path");
    expect(() => resolveStoredStudioSkillPath(storageRoot, "images/icon.png")).toThrow("Invalid studio skill path");
  });
});
