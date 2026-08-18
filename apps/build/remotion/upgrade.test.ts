// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildUpgradePlan,
  restoreUnmanagedDependencySpecs,
  validateUpgradeTarget,
  verifyProjectRemotionSkills,
} from "./upgrade.mjs";

const temporaryRoots: string[] = [];

afterEach(() => {
  temporaryRoots.splice(0).forEach((root) => {
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("Remotion upgrade governance", () => {
  it("accepts only exact 4.x targets", () => {
    expect(() => validateUpgradeTarget("4.0.499", "4.0.500")).not.toThrow();
    expect(() => validateUpgradeTarget("4.0.499", "5.0.0")).toThrow(
      "拒绝跨大版本升级 4.0.499 -> 5.0.0；请新建 Trellis 迁移任务",
    );
    expect(() => validateUpgradeTarget("4.0.499", "latest")).toThrow(
      "Remotion 升级目标必须是精确 semver",
    );
  });

  it("preserves dependency specs outside the Remotion upgrade set", () => {
    const before = {
      dependencies: {
        remotion: "4.0.499",
        mediabunny: "1.50.8",
        zod: "^4.3.5",
      },
    };
    const after = {
      dependencies: {
        remotion: "4.0.500",
        mediabunny: "1.50.9",
        zod: "4.4.3",
        unexpected: "1.0.0",
      },
    };
    expect(restoreUnmanagedDependencySpecs(before, after)).toEqual({
      dependencies: {
        remotion: "4.0.500",
        mediabunny: "1.50.9",
        zod: "^4.3.5",
      },
    });
  });

  it("uses the local CLI, official registry, pinned skills installer and complete gates", () => {
    const plan = buildUpgradePlan({
      appRoot: "/workspace/apps",
      targetVersion: "4.0.500",
    });
    expect(plan[0]).toEqual({
      command: "/workspace/apps/node_modules/.bin/remotion",
      args: [
        "upgrade",
        "--version=4.0.500",
        "--package-manager=pnpm",
        "--save-exact",
        "--no-fund",
        "--no-audit",
        "--registry=https://registry.npmjs.org/",
      ],
      cwd: "/workspace/apps",
    });
    expect(plan).toEqual(expect.arrayContaining([
      {
        command: "npx",
        args: [
          "-y",
          "--loglevel=error",
          "skills@1.2.0",
          "add",
          "remotion-dev/skills",
          "--skill",
          "remotion-best-practices",
          "--agent",
          "codex",
          "-y",
        ],
        cwd: "/workspace",
      },
      {
        command: "node",
        args: ["/workspace/apps/build/remotion/upgrade.mjs", "--verify-remotion-skills"],
        cwd: "/workspace/apps",
      },
      expect.objectContaining({ args: ["run", "remotion:bundle"] }),
      expect.objectContaining({ args: ["run", "typecheck"] }),
      expect.objectContaining({ args: ["run", "lint"] }),
      expect.objectContaining({ args: ["test"] }),
    ]));
  });

  it("verifies project Remotion skills after installation", () => {
    const root = skillFixtureRoot();

    expect(verifyProjectRemotionSkills({ repositoryRoot: root })).toMatchObject({
      success: true,
      errors: [],
    });
  });

  it("fails closed when project Remotion skills are incomplete", () => {
    const root = skillFixtureRoot({ skillName: "wrong-skill" });
    fs.rmSync(
      path.join(root, ".agents", "skills", "remotion-best-practices", "remotion-upgrade", "REFERENCE.md"),
      { force: true },
    );

    const result = verifyProjectRemotionSkills({ repositoryRoot: root });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      ".agents/skills/remotion-best-practices/SKILL.md frontmatter name 必须是 remotion-best-practices",
      ".agents/skills/remotion-best-practices/remotion-upgrade/REFERENCE.md 缺失",
    ]));
  });

  it("fails closed when the Remotion upgrade reference drifts from the pinned skills installer", () => {
    const root = skillFixtureRoot({ upgradeReference: "npx remotion skills update\n" });

    const result = verifyProjectRemotionSkills({ repositoryRoot: root });

    expect(result.success).toBe(false);
    expect(result.errors).toContain(
      ".agents/skills/remotion-best-practices/remotion-upgrade/REFERENCE.md 必须记录 pinned Remotion Skills 安装命令",
    );
  });
});

function skillFixtureRoot({
  skillName = "remotion-best-practices",
  upgradeReference =
    "npx -y --loglevel=error skills@1.2.0 add remotion-dev/skills --skill remotion-best-practices --agent codex -y\n",
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-skills-"));
  temporaryRoots.push(root);
  const skillRoot = path.join(root, ".agents", "skills", "remotion-best-practices");
  fs.mkdirSync(path.join(skillRoot, "remotion-upgrade"), { recursive: true });
  fs.writeFileSync(path.join(skillRoot, "SKILL.md"), `---
name: ${skillName}
---

# Remotion
`, "utf8");
  fs.writeFileSync(
    path.join(skillRoot, "remotion-upgrade", "REFERENCE.md"),
    upgradeReference,
    "utf8",
  );
  return root;
}
