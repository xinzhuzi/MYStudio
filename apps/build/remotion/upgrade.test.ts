// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildUpgradePlan,
  restoreUnmanagedDependencySpecs,
  validateUpgradeTarget,
} from "./upgrade.mjs";

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

  it("uses the local CLI, official registry, skills update and complete gates", () => {
    const plan = buildUpgradePlan({
      appRoot: "/workspace/apps",
      targetVersion: "4.0.500",
    });
    expect(plan[0]).toEqual({
      command: "/workspace/apps/node_modules/.bin/remotion",
      args: [
        "upgrade",
        "--version=4.0.500",
        "--package-manager=npm",
        "--save-exact",
        "--no-fund",
        "--no-audit",
        "--registry=https://registry.npmjs.org/",
      ],
      cwd: "/workspace/apps",
    });
    expect(plan).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: ["skills", "update"], cwd: "/workspace" }),
      expect.objectContaining({ args: ["run", "remotion:bundle"] }),
      expect.objectContaining({ args: ["run", "typecheck"] }),
      expect.objectContaining({ args: ["run", "lint"] }),
      expect.objectContaining({ args: ["test"] }),
    ]));
  });
});
