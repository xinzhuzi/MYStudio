import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createStoredStudioSkillFile,
  deleteStoredStudioSkillFile,
  ensureStudioSkillsSynced,
  getStudioSkillReseedMarkerPath,
  getStudioSkillStorageRoot,
  listStoredStudioSkillFiles,
  readStoredStudioSkillText,
  reseedDriftedAppSeeds,
  resetStudioSkillsSyncState,
  restoreStoredStudioSkillFile,
  resolveStoredStudioSkillPath,
  runStudioSkillReseedIfMarkerPresent,
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

beforeEach(() => {
  resetStudioSkillsSyncState();
});

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

  it("syncs editable markdown and visual images while ignoring package junk files", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    await writeText(path.join(sourceRoot, "script_agent_decision.md"), "# Bundled\n");
    await writeText(path.join(sourceRoot, ".DS_Store"), "desktop metadata\n");
    await writeText(path.join(sourceRoot, "art_skills/default/images/preview.png"), "png bytes\n");
    await writeText(path.join(sourceRoot, "art_skills/default/prompt.tmp"), "temp\n");
    await writeText(path.join(sourceRoot, "art_skills/default/prompt.md.map"), "source map\n");
    await writeText(path.join(sourceRoot, "art_skills/default/README.md"), "# Default\n");

    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });

    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/script_agent_decision.md")).resolves.toBe("# Bundled\n");
    await expect(readStoredStudioSkillText(storageRoot, "art_skills/default/README.md")).resolves.toBe("# Default\n");
    await expect(fs.access(path.join(storageRoot, "art_skills/default/images/preview.png"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(storageRoot, ".DS_Store"))).rejects.toThrow();
    await expect(fs.access(path.join(storageRoot, "art_skills/default/prompt.tmp"))).rejects.toThrow();
    await expect(fs.access(path.join(storageRoot, "art_skills/default/prompt.md.map"))).rejects.toThrow();
  });

  it("fills missing local skills from a Toonflow runtime fallback source", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const runtimeRoot = path.join(root, "toonflow-runtime");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    await writeText(path.join(sourceRoot, "script_agent_decision.md"), "# Bundled\n");
    await writeText(path.join(runtimeRoot, "art_skills/daojie_ink_guofeng/README.md"), "# Daojie Runtime\n");

    await ensureStudioSkillsSynced({
      sourceRoot,
      fallbackSourceRoots: [runtimeRoot],
      storageRoot,
    });

    await expect(readStoredStudioSkillText(storageRoot, "art_skills/daojie_ink_guofeng/README.md")).resolves.toBe("# Daojie Runtime\n");

    const files = await listStoredStudioSkillFiles({
      sourceRoot,
      fallbackSourceRoots: [runtimeRoot],
      storageRoot,
    });
    expect(files.find((file) => file.relativePath === "art_skills/daojie_ink_guofeng/README.md")).toMatchObject({
      isCustomized: false,
      sourceExists: true,
      sourcePath: path.join(runtimeRoot, "art_skills/daojie_ink_guofeng/README.md"),
    });

    await deleteStoredStudioSkillFile(storageRoot, "art_skills/daojie_ink_guofeng/README.md");
    const restored = await restoreStoredStudioSkillFile({
      sourceRoot,
      fallbackSourceRoots: [runtimeRoot],
      storageRoot,
    }, "art_skills/daojie_ink_guofeng/README.md");
    expect(restored.sourcePath).toBe(path.join(runtimeRoot, "art_skills/daojie_ink_guofeng/README.md"));
    await expect(readStoredStudioSkillText(storageRoot, "art_skills/daojie_ink_guofeng/README.md")).resolves.toBe("# Daojie Runtime\n");
  });

  it("updates pristine copies when seeds change but keeps user-customized copies (hash-based sync)", async () => {
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

    resetStudioSkillsSyncState();
    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });

    // Pristine copy follows the seed update automatically.
    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/script_execution_skeleton.md")).resolves.toBe("seed v2\n");
    // User-customized copy is never overwritten.
    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/script_execution_script.md")).resolves.toBe("user edit\n");
    // Missing seed still fills in.
    await expect(readStoredStudioSkillText(storageRoot, "production_skills/storyboard_table_techniques.md")).resolves.toBe("new seed\n");
  });

  it.each(["pristine", "customized", "deleted", "unmanaged"] as const)(
    "propagates the real Daojie narrative seed while protecting %s storage",
    async (state) => {
      const relativePath = "story_skills/Daojie_xianxia/script_narrative.md";
      const currentSeed = await fs.readFile(new URL(`../../assets/studio-manuals/${relativePath}`, import.meta.url), "utf-8");
      const previousSeed = "原文叙述性心理不能改成新旁白；例外对象仅限原文明文，且只走旁白，不得借道 OS。\n";
      const userText = `${previousSeed}\n用户保留的叙事规则\n`;
      expect(currentSeed).toContain("原文明示叙述可转画面、V.S.或有当时知情依据的 OS");
      expect(currentSeed).not.toContain("且只走旁白，不得借道 OS");
      const root = await createTempRoot();
      const sourceRoot = path.join(root, "source");
      const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));
      const options = { sourceRoot, storageRoot };
      await writeText(path.join(sourceRoot, relativePath), previousSeed);
      if (state === "unmanaged") {
        await writeStoredStudioSkillText(storageRoot, relativePath, userText);
      }
      await ensureStudioSkillsSynced(options);
      await expect(readStoredStudioSkillText(storageRoot, relativePath)).resolves.toBe(
        state === "unmanaged" ? userText : previousSeed,
      );
      if (state === "customized") {
        await writeStoredStudioSkillText(storageRoot, relativePath, userText);
      }
      if (state === "deleted") {
        expect(await deleteStoredStudioSkillFile(storageRoot, relativePath)).toBe(true);
      }
      await writeText(path.join(sourceRoot, relativePath), currentSeed);
      resetStudioSkillsSyncState();
      await ensureStudioSkillsSynced(options);
      if (state === "deleted") {
        await expect(readStoredStudioSkillText(storageRoot, relativePath)).rejects.toThrow();
      } else {
        await expect(readStoredStudioSkillText(storageRoot, relativePath)).resolves.toBe(
          state === "pristine" ? currentSeed : userText,
        );
      }
      const files = await listStoredStudioSkillFiles(options);
      expect(files.find((file) => file.relativePath === relativePath)).toMatchObject({
        sourceExists: true,
        isDeleted: state === "deleted",
        isCustomized: state === "customized" || state === "unmanaged",
      });
      await expect(fs.readFile(path.join(sourceRoot, relativePath), "utf-8")).resolves.toBe(currentSeed);
    },
  );

  it("propagates external-source (personal asset) edits to pristine copies but not customized ones", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const externalRoot = path.join(root, "external");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    // Personal asset lives only in the external (toonflow) root.
    await writeText(path.join(externalRoot, "art_skills/daojie_ink_guofeng/prefix.md"), "dao v1\n");
    await writeText(path.join(externalRoot, "art_skills/daojie_ink_guofeng/custom.md"), "custom v1\n");
    await ensureStudioSkillsSynced({ sourceRoot, fallbackSourceRoots: [externalRoot], storageRoot });

    // Edit the external source, and customize one stored copy.
    await writeText(path.join(externalRoot, "art_skills/daojie_ink_guofeng/prefix.md"), "dao v2 with DV rules\n");
    await writeStoredStudioSkillText(storageRoot, "art_skills/daojie_ink_guofeng/custom.md", "user touched\n");

    resetStudioSkillsSyncState();
    await ensureStudioSkillsSynced({ sourceRoot, fallbackSourceRoots: [externalRoot], storageRoot });

    await expect(readStoredStudioSkillText(storageRoot, "art_skills/daojie_ink_guofeng/prefix.md")).resolves.toBe("dao v2 with DV rules\n");
    await expect(readStoredStudioSkillText(storageRoot, "art_skills/daojie_ink_guofeng/custom.md")).resolves.toBe("user touched\n");
  });

  it("prevents flip-flop when both roots carry a diverging shared file (root ownership)", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const externalRoot = path.join(root, "external");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    await writeText(path.join(sourceRoot, "production_skills/shared.md"), "app seed\n");
    await writeText(path.join(externalRoot, "production_skills/shared.md"), "external drift\n");

    await ensureStudioSkillsSynced({ sourceRoot, fallbackSourceRoots: [externalRoot], storageRoot });
    // App root claims ownership first; the external drift must not win.
    await expect(readStoredStudioSkillText(storageRoot, "production_skills/shared.md")).resolves.toBe("app seed\n");

    // Even after the external copy changes again, the app-owned file stays put.
    await writeText(path.join(externalRoot, "production_skills/shared.md"), "external drift v2\n");
    resetStudioSkillsSyncState();
    await ensureStudioSkillsSynced({ sourceRoot, fallbackSourceRoots: [externalRoot], storageRoot });
    await expect(readStoredStudioSkillText(storageRoot, "production_skills/shared.md")).resolves.toBe("app seed\n");
  });

  it("never adopts unknown-provenance files that sit at seed paths without a manifest entry", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    // User hand-placed file at a seed path, never synced before.
    await writeText(path.join(sourceRoot, "agent_skills/hand_made.md"), "seed\n");
    await writeStoredStudioSkillText(storageRoot, "agent_skills/hand_made.md", "hand made\n");

    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });
    // Must stay untouched (no automatic adoption); it shows as customized in the UI.
    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/hand_made.md")).resolves.toBe("hand made\n");
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

  it("keeps deleted bundled skills unreadable across later syncs but lists them as restorable", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    await writeText(path.join(sourceRoot, "script_agent_decision.md"), "seed\n");
    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });

    expect(await deleteStoredStudioSkillFile(storageRoot, "agent_skills/script_agent_decision.md")).toBe(true);
    resetStudioSkillsSyncState();
    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });

    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/script_agent_decision.md")).rejects.toThrow();
    const files = await listStoredStudioSkillFiles({ sourceRoot, storageRoot });
    expect(files.find((file) => file.relativePath === "agent_skills/script_agent_decision.md")).toMatchObject({
      isDeleted: true,
      sourceExists: true,
    });
  });

  it("lists deleted bundled skills so they can be restored from the bundled seed", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    await writeText(path.join(sourceRoot, "script_agent_decision.md"), "seed\n");
    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });
    await deleteStoredStudioSkillFile(storageRoot, "agent_skills/script_agent_decision.md");

    const files = await listStoredStudioSkillFiles({ sourceRoot, storageRoot });

    expect(files.find((file) => file.relativePath === "agent_skills/script_agent_decision.md")).toMatchObject({
      isDeleted: true,
      sourceExists: true,
    });
  });

  it("restores a deleted bundled skill from the bundled seed", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    await writeText(path.join(sourceRoot, "script_agent_decision.md"), "seed\n");
    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });
    await writeStoredStudioSkillText(storageRoot, "agent_skills/script_agent_decision.md", "user edit\n");
    await deleteStoredStudioSkillFile(storageRoot, "agent_skills/script_agent_decision.md");

    const restored = await restoreStoredStudioSkillFile({ sourceRoot, storageRoot }, "agent_skills/script_agent_decision.md");

    expect(restored).toMatchObject({
      relativePath: "agent_skills/script_agent_decision.md",
      isCustomized: false,
      isDeleted: false,
      sourceExists: true,
    });
    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/script_agent_decision.md")).resolves.toBe("seed\n");
  });

  it("rejects unsafe editable skill paths", async () => {
    const root = await createTempRoot();
    const storageRoot = getStudioSkillStorageRoot(root);

    expect(() => resolveStoredStudioSkillPath(storageRoot, "../escape.md")).toThrow("Invalid studio skill path");
    expect(() => resolveStoredStudioSkillPath(storageRoot, "images/icon.png")).toThrow("Invalid studio skill path");
  });
});

describe("character truth json editable domain (10-26 角色真源JSON)", () => {
  it("syncs art_skills/<pkg>/json/<name>.json seeds while ignoring json/ 之外的包内 JSON", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    await writeText(path.join(sourceRoot, "art_skills/daojie_ink_guofeng/json/晏燎.json"), '{"zh":"canon"}\n');
    await writeText(path.join(sourceRoot, "art_skills/daojie_ink_guofeng/ma_sync/runtime-contract.json"), '{"x":1}\n');

    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });

    await expect(
      readStoredStudioSkillText(storageRoot, "art_skills/daojie_ink_guofeng/json/晏燎.json"),
    ).resolves.toBe('{"zh":"canon"}\n');
    // ma_sync 契约 JSON 不在 json/ 子目录,不进同步域(契约钉文件不卷入用户编辑层)
    await expect(
      fs.access(path.join(storageRoot, "art_skills/daojie_ink_guofeng/ma_sync/runtime-contract.json")),
    ).rejects.toThrow();
  });

  it("round-trips user edits on the storage copy and protects them from seed updates", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));
    const seedPath = path.join(sourceRoot, "art_skills/daojie_ink_guofeng/json/晏燎.json");

    await writeText(seedPath, '{"seed":1}\n');
    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });

    // 用户编辑(经可编辑域写通道,路径放行后可写)
    await writeStoredStudioSkillText(storageRoot, "art_skills/daojie_ink_guofeng/json/晏燎.json", '{"user":2}\n');
    await expect(
      readStoredStudioSkillText(storageRoot, "art_skills/daojie_ink_guofeng/json/晏燎.json"),
    ).resolves.toBe('{"user":2}\n');

    // 种子侧变更 + 重新同步:用户改动静默保护,不被覆盖
    await writeText(seedPath, '{"seed":3}\n');
    resetStudioSkillsSyncState();
    await ensureStudioSkillsSynced({ sourceRoot, storageRoot });
    await expect(
      readStoredStudioSkillText(storageRoot, "art_skills/daojie_ink_guofeng/json/晏燎.json"),
    ).resolves.toBe('{"user":2}\n');

    // 恢复种子:回到内置版本
    await restoreStoredStudioSkillFile({ sourceRoot, storageRoot }, "art_skills/daojie_ink_guofeng/json/晏燎.json");
    await expect(
      readStoredStudioSkillText(storageRoot, "art_skills/daojie_ink_guofeng/json/晏燎.json"),
    ).resolves.toBe('{"seed":3}\n');
  });

  it("keeps rejecting root-level json, json/ 之外的包内 json and traversal paths", async () => {
    const root = await createTempRoot();
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));

    await expect(writeStoredStudioSkillText(storageRoot, "foo.json", "{}")).rejects.toThrow();
    await expect(
      writeStoredStudioSkillText(storageRoot, "art_skills/daojie_ink_guofeng/qi21_bases.json", "{}"),
    ).rejects.toThrow();
    await expect(writeStoredStudioSkillText(storageRoot, "../../evil.json", "{}")).rejects.toThrow();
    await expect(writeStoredStudioSkillText(storageRoot, "art_skills/daojie_ink_guofeng/json/../../escape.json", "{}")).rejects.toThrow();

    // 合法角色真源路径仍通(负例守卫不误伤正路)
    const stat = await writeStoredStudioSkillText(storageRoot, "art_skills/daojie_ink_guofeng/json/晏燎.json", '{"ok":true}');
    expect(stat.isFile()).toBe(true);
  });
});

describe("F6 刀1(1115 补完役):装机 reseedDriftedAppSeeds(marker 驱动)", () => {
  it("app 域偏基线条目=覆盖+基线重写+.bak 备份;external 条目零触碰", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const externalRoot = path.join(root, "external");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));
    const options = { sourceRoot, fallbackSourceRoots: [externalRoot], storageRoot };
    await writeText(path.join(sourceRoot, "app-manual.md"), "# App v1\n");
    await writeText(path.join(externalRoot, "external-manual.md"), "# Ext v1\n");
    await ensureStudioSkillsSynced(options);

    // app 域(历史热补形态)与 external 域(个人资产)各造偏基线副本
    await writeStoredStudioSkillText(storageRoot, "agent_skills/app-manual.md", "# 用户热补陈留\n");
    await writeStoredStudioSkillText(storageRoot, "agent_skills/external-manual.md", "# 用户扩展编辑\n");
    // 本轮包更新:app 源升 v2
    await writeText(path.join(sourceRoot, "app-manual.md"), "# App v2\n");

    const outcomes = await reseedDriftedAppSeeds(options);
    const byPath = new Map(outcomes.map((outcome) => [outcome.relativePath, outcome]));
    expect(byPath.get("agent_skills/app-manual.md")?.action).toBe("reseeded");
    expect(byPath.get("agent_skills/external-manual.md")?.action).toBe("external");

    // 覆盖=包内 v2;.bak 留用户旧文;external 副本原样
    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/app-manual.md")).resolves.toBe("# App v2\n");
    const backupPath = byPath.get("agent_skills/app-manual.md")?.backupPath ?? "";
    expect(backupPath).toContain(".bak-pre-reseed-");
    await expect(fs.readFile(backupPath, "utf-8")).resolves.toBe("# 用户热补陈留\n");
    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/external-manual.md")).resolves.toBe("# 用户扩展编辑\n");

    // 基线已重写:reseed 后的干净副本恢复「源变更自动传播」(陈留病根治愈证明)
    await writeText(path.join(sourceRoot, "app-manual.md"), "# App v3\n");
    resetStudioSkillsSyncState();
    await ensureStudioSkillsSynced(options);
    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/app-manual.md")).resolves.toBe("# App v3\n");
  });

  it("reseed 幂等:二跑全 clean,零新 .bak;无清单条目(用户手放件)零触碰", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));
    const options = { sourceRoot, storageRoot };
    await writeText(path.join(sourceRoot, "app-manual.md"), "# App v1\n");
    await ensureStudioSkillsSynced(options);
    // 无清单手放件(用户手工放置在种子路径)
    await writeText(path.join(storageRoot, "agent_skills/user-drop.md"), "# 用户手放\n");
    await writeStoredStudioSkillText(storageRoot, "agent_skills/app-manual.md", "# 偏基线\n");

    const first = await reseedDriftedAppSeeds(options);
    expect(first.filter((outcome) => outcome.action === "reseeded")).toHaveLength(1);
    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/user-drop.md")).resolves.toBe("# 用户手放\n");

    const second = await reseedDriftedAppSeeds(options);
    expect(second.every((outcome) => outcome.action !== "reseeded")).toBe(true);
    expect(second.filter((outcome) => outcome.action === "clean")).toHaveLength(1);
  });

  it("runStudioSkillReseedIfMarkerPresent:marker 在位才执行、执行后清除;损坏 marker 也执行", async () => {
    const root = await createTempRoot();
    const sourceRoot = path.join(root, "source");
    const storageRoot = getStudioSkillStorageRoot(path.join(root, "storage"));
    const options = { sourceRoot, storageRoot };
    await writeText(path.join(sourceRoot, "app-manual.md"), "# App v1\n");
    await ensureStudioSkillsSynced(options);
    await writeStoredStudioSkillText(storageRoot, "agent_skills/app-manual.md", "# 偏基线\n");
    await writeText(path.join(sourceRoot, "app-manual.md"), "# App v2\n");

    // 无 marker=零动作
    await expect(runStudioSkillReseedIfMarkerPresent(options)).resolves.toBeNull();

    // 损坏 marker(非 JSON)也触发 reseed,payload 留 parseError
    const markerPath = getStudioSkillReseedMarkerPath(storageRoot);
    await writeText(markerPath, "not-json{{{");
    const corrupted = await runStudioSkillReseedIfMarkerPresent(options);
    expect(corrupted).not.toBeNull();
    expect((corrupted!.markerPayload as { parseError?: string }).parseError).toBeTruthy();
    expect(existsSync(markerPath)).toBe(false);
    await expect(readStoredStudioSkillText(storageRoot, "agent_skills/app-manual.md")).resolves.toBe("# App v2\n");

    // 正常 marker:执行+清除+报告
    await writeStoredStudioSkillText(storageRoot, "agent_skills/app-manual.md", "# 再偏一次\n");
    await writeText(markerPath, JSON.stringify({ version: 1, packageStudioManualsTreeHash: "a".repeat(64) }));
    const report = await runStudioSkillReseedIfMarkerPresent(options);
    expect(report).not.toBeNull();
    expect(report!.outcomes.filter((outcome) => outcome.action === "reseeded")).toHaveLength(1);
    expect((report!.markerPayload as { packageStudioManualsTreeHash: string }).packageStudioManualsTreeHash).toBe("a".repeat(64));
    expect(existsSync(markerPath)).toBe(false);
  });
});
