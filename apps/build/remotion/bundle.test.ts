// @vitest-environment node

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BUNDLE_MANIFEST_SCHEMA_VERSION,
  BUNDLED_COMPOSITION_IDS,
  REMOTION_TEMPLATE_ID,
  REMOTION_TEMPLATE_VERSION,
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
      fields: [
        "schemaVersion",
        "templateId",
        "templateVersion",
        "remotionVersion",
        "compositionIds",
        "compositionId",
        "contentHash",
      ],
    });
  });

  it("builds a v2 manifest with the ordered parameterized registry and compatibility alias", () => {
    const contentHash = hashBundleContent("fixed-composition");
    expect(contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      buildBundleManifest({
        remotionVersion: "4.0.499",
        contentHash,
      }),
    ).toEqual({
      schemaVersion: BUNDLE_MANIFEST_SCHEMA_VERSION,
      templateId: REMOTION_TEMPLATE_ID,
      templateVersion: REMOTION_TEMPLATE_VERSION,
      remotionVersion: "4.0.499",
      compositionIds: BUNDLED_COMPOSITION_IDS,
      compositionId: "DaojieTimeline",
      contentHash,
    });
  });

  it("rejects drifted or incomplete manifest inputs", () => {
    const hash = hashBundleContent("x");
    expect(() =>
      buildBundleManifest({ remotionVersion: "^4.0.499", contentHash: hash }),
    ).toThrow("精确 Remotion semver");
    expect(() =>
      buildBundleManifest({ remotionVersion: "4.0.499", contentHash: "nope" }),
    ).toThrow("sha256 contentHash");
  });

  it("resolves the fixed output directory", () => {
    const appRoot = "/workspace/apps";
    expect(resolveCompositionEntry({ appRoot })).toBe(
      "/workspace/apps/frontend/electron/rendering/plugins/remotion/composition/entry.tsx",
    );
    expect(resolveBundleOutput({ appRoot })).toBe(
      "/workspace/apps/.cache/remotion-bundle",
    );
  });

  it("bundles once into a temporary directory and writes a pinned manifest", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-remotion-bundle-"));
    fs.mkdirSync(path.join(root, "frontend/electron/rendering/plugins/remotion/composition"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "frontend/electron/rendering/plugins/remotion/composition/entry.tsx"),
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
        templateId: REMOTION_TEMPLATE_ID,
        templateVersion: REMOTION_TEMPLATE_VERSION,
        remotionVersion: "4.0.499",
        compositionIds: BUNDLED_COMPOSITION_IDS,
        compositionId: "DaojieTimeline",
      });
      expect(fs.existsSync(path.join(result.outputDir, "manifest.json"))).toBe(true);
      expect(fs.readFileSync(path.join(result.outputDir, "bundle.js"), "utf8")).toBe("fixed");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
