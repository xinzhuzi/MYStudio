// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  REQUIRED_REMOTION_PACKAGES,
  verifyRemotionVersions,
} from "./verify-versions.mjs";

const temporaryRoots: string[] = [];

afterEach(() => {
  temporaryRoots.splice(0).forEach((root) => {
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("verifyRemotionVersions", () => {
  it("accepts the installed MYStudio Remotion dependency set", () => {
    expect(verifyRemotionVersions()).toMatchObject({
      success: true,
      expectedRemotionVersion: "4.0.499",
      expectedMediabunnyVersion: "1.50.8",
      errors: [],
    });
  });

  it("detects version drift and forbidden transitions", () => {
    const root = fixtureRoot();
    const manifestPath = path.join(root, "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.dependencies["@remotion/player"] = "4.0.498";
    manifest.dependencies["@remotion/transitions"] = "4.0.499";
    writeJson(manifestPath, manifest);

    const result = verifyRemotionVersions({ root });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "dependencies.@remotion/player 必须精确等于 4.0.499",
      "dependencies.@remotion/player 版本漂移: 4.0.498",
      "dependencies 禁止安装 @remotion/transitions",
    ]));
  });

  it("detects Mediabunny lockfile drift", () => {
    const root = fixtureRoot();
    const lockPath = path.join(root, "pnpm-lock.yaml");
    fs.writeFileSync(lockPath, fs.readFileSync(lockPath, "utf8")
      .replace("mediabunny: 1.50.8", "mediabunny: 1.50.7")
      .replace("mediabunny@1.50.8", "mediabunny@1.50.6"), "utf8");

    const result = verifyRemotionVersions({ root });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "pnpm-lock mediabunny 说明符必须精确等于 1.50.8: 1.50.7",
      "pnpm-lock mediabunny@1.50.6 锁定版本漂移(期望 1.50.8)",
    ]));
  });

  it("rejects a locked @remotion/transitions in pnpm-lock", () => {
    const root = fixtureRoot();
    fs.appendFileSync(
      path.join(root, "pnpm-lock.yaml"),
      "  '@remotion/transitions@4.0.499':\n    resolution: {integrity: x}\n",
    );
    const result = verifyRemotionVersions({ root });
    expect(result.errors).toContain("pnpm-lock 禁止锁定 @remotion/transitions");
  });

  it("only requires a platform-specific optional native package on its matching runner", () => {
    const root = fixtureRoot();
    const optionalPackagePath = path.join(
      root,
      "node_modules",
      "@remotion",
      "compositor-darwin-arm64",
      "package.json",
    );
    fs.rmSync(path.dirname(optionalPackagePath), { recursive: true, force: true });

    expect(verifyRemotionVersions({ root, platform: "linux", arch: "x64" })).toMatchObject({
      success: true,
      errors: [],
    });

    const matchingRunner = verifyRemotionVersions({ root, platform: "darwin", arch: "arm64" });
    expect(matchingRunner.success).toBe(false);
    expect(matchingRunner.errors).toContain("缺少已安装包: @remotion/compositor-darwin-arm64");
  });
});

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-versions-"));
  temporaryRoots.push(root);
  const version = "4.0.499";
  const mediaVersion = "1.50.8";
  const manifest = {
    dependencies: { mediabunny: mediaVersion },
    devDependencies: {},
    optionalDependencies: {},
  };
  const lockLines: string[] = ["lockfileVersion: '10.0'", "importers:", "  .:", "    dependencies:", `      mediabunny: ${mediaVersion}`];
  const packagesLines: string[] = ["packages:"];
  const keyOf = (packageName: string, pkgVersion: string) => (
    packageName.startsWith("@") ? `'${packageName}@${pkgVersion}'` : `${packageName}@${pkgVersion}`
  );
  for (const [section, packageNames] of Object.entries(REQUIRED_REMOTION_PACKAGES)) {
    for (const packageName of packageNames) {
      manifest[section][packageName] = version;
      lockLines.push(`      ${packageName}: ${version}`);
      packagesLines.push(`  ${keyOf(packageName, version)}:`);
      writeJson(path.join(root, "node_modules", packageName, "package.json"), {
        name: packageName,
        version,
        ...(packageName === "@remotion/media"
          ? { dependencies: { mediabunny: mediaVersion } }
          : {}),
      });
    }
  }
  writeJson(path.join(root, "node_modules", "mediabunny", "package.json"), {
    name: "mediabunny",
    version: mediaVersion,
  });
  packagesLines.push(`  ${keyOf("mediabunny", mediaVersion)}:`);
  writeJson(path.join(root, "package.json"), manifest);
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), `${[...lockLines, ...packagesLines].join("\n")}\n`, "utf8");
  return root;
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
