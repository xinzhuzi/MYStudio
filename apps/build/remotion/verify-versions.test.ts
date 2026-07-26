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
    const lockPath = path.join(root, "package-lock.json");
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    lock.packages[""].dependencies.mediabunny = "1.50.7";
    lock.packages["node_modules/mediabunny"].version = "1.50.6";
    writeJson(lockPath, lock);

    const result = verifyRemotionVersions({ root });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "package-lock root dependencies.mediabunny 必须精确等于 1.50.8",
      "package-lock node_modules/mediabunny 版本漂移: 1.50.6",
    ]));
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
  const lockRoot = {
    dependencies: { mediabunny: mediaVersion },
    devDependencies: {},
    optionalDependencies: {},
  };
  const lockPackages = { "": lockRoot };
  for (const [section, packageNames] of Object.entries(REQUIRED_REMOTION_PACKAGES)) {
    for (const packageName of packageNames) {
      manifest[section][packageName] = version;
      lockRoot[section][packageName] = version;
      lockPackages[`node_modules/${packageName}`] = { version };
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
  lockPackages["node_modules/mediabunny"] = { version: mediaVersion };
  writeJson(path.join(root, "package.json"), manifest);
  writeJson(path.join(root, "package-lock.json"), { packages: lockPackages });
  return root;
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
