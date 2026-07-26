// @vitest-environment node

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BUNDLE_MANIFEST_SCHEMA_VERSION,
  bundleManifestSchema,
  buildBundleManifest,
  hashBundleContent,
  resolveCompositionEntry,
  resolveBundleOutput,
  runBundle,
} from "./bundle.mjs";

describe("Remotion fixed bundle", () => {
  it("exposes a stable manifest schema with the fixed fields", () => {
    expect(bundleManifestSchema()).toEqual({
      schemaVersion: BUNDLE_MANIFEST_SCHEMA_VERSION,
      fields: ["schemaVersion", "remotionVersion", "compositionId", "contentHash"],
    });
  });

  it("builds a manifest only from exact version, non-empty id and sha256 hash", () => {
    const contentHash = hashBundleContent("fixed-composition");
    expect(contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      buildBundleManifest({
        remotionVersion: "4.0.499",
        compositionId: "mystudio-timeline",
        contentHash,
      }),
    ).toEqual({
      schemaVersion: BUNDLE_MANIFEST_SCHEMA_VERSION,
      remotionVersion: "4.0.499",
      compositionId: "mystudio-timeline",
      contentHash,
    });
  });

  it("rejects drifted or incomplete manifest inputs", () => {
    const hash = hashBundleContent("x");
    expect(() =>
      buildBundleManifest({ remotionVersion: "^4.0.499", compositionId: "id", contentHash: hash }),
    ).toThrow("精确 Remotion semver");
    expect(() =>
      buildBundleManifest({ remotionVersion: "4.0.499", compositionId: "", contentHash: hash }),
    ).toThrow("非空 compositionId");
    expect(() =>
      buildBundleManifest({ remotionVersion: "4.0.499", compositionId: "id", contentHash: "nope" }),
    ).toThrow("sha256 contentHash");
  });

  it("resolves the fixed output directory", () => {
    const appRoot = "/workspace/apps";
    expect(resolveCompositionEntry({ appRoot })).toBe(
      "/workspace/apps/rendering/plugins/remotion/composition/entry.tsx",
    );
    expect(resolveBundleOutput({ appRoot })).toBe(
      "/workspace/apps/.cache/remotion-bundle",
    );
  });

  it("bundles once into a temporary directory and writes a pinned manifest", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-bundle-"));
    fs.mkdirSync(path.join(root, "rendering/plugins/remotion/composition"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "rendering/plugins/remotion/composition/entry.tsx"),
      "export default {};\n",
      "utf8",
    );
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { remotion: "4.0.499" } }), "utf8");
    try {
      const calls: string[] = [];
      const result = await runBundle({
        appRoot: root,
        bundleFn: async ({ outDir, entryPoint }) => {
          calls.push(`${entryPoint}:${outDir}`);
          fs.writeFileSync(path.join(outDir, "bundle.js"), "fixed", "utf8");
        },
      });
      expect(calls).toHaveLength(1);
      expect(result.outputDir).toBe(path.join(root, ".cache/remotion-bundle"));
      expect(result.manifest).toMatchObject({
        schemaVersion: BUNDLE_MANIFEST_SCHEMA_VERSION,
        remotionVersion: "4.0.499",
        compositionId: "DaojieTimeline",
      });
      expect(fs.existsSync(path.join(result.outputDir, "manifest.json"))).toBe(true);
      expect(fs.readFileSync(path.join(result.outputDir, "bundle.js"), "utf8")).toBe("fixed");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
