import { describe, expect, it } from "vitest";
import {
  buildRemotionRuntimeManifest,
  resolveRemotionCacheDir,
  resolveRemotionRuntimeDir,
  resolveRemotionRuntimeManifestPath,
} from "./remotion-runtime-manifest";

const VERSION = "4.0.499";
const USER_DATA = "/home/user/.config/MYStudio";

describe("buildRemotionRuntimeManifest", () => {
  it("builds a private, version-pinned manifest", () => {
    const manifest = buildRemotionRuntimeManifest(VERSION);
    expect(manifest).toEqual({
      name: "@mystudio/remotion-runtime",
      version: VERSION,
      private: true,
    });
  });

  it("rejects an empty Remotion version", () => {
    expect(() => buildRemotionRuntimeManifest("")).toThrow(
      "运行时 manifest 需要非空 Remotion 版本",
    );
  });
});

describe("runtime path resolution", () => {
  it("resolves the runtime dir under userData", () => {
    expect(resolveRemotionRuntimeDir(USER_DATA)).toBe(
      "/home/user/.config/MYStudio/remotion-runtime",
    );
  });

  it("resolves the manifest path inside the runtime dir", () => {
    expect(resolveRemotionRuntimeManifestPath(USER_DATA)).toBe(
      "/home/user/.config/MYStudio/remotion-runtime/package.json",
    );
  });

  it("pins the Remotion cache under the runtime node_modules", () => {
    expect(resolveRemotionCacheDir(USER_DATA)).toBe(
      "/home/user/.config/MYStudio/remotion-runtime/node_modules/.remotion",
    );
  });

  it("rejects a relative userData path", () => {
    expect(() => resolveRemotionRuntimeDir("relative/path")).toThrow(
      "userData 目录必须是绝对路径",
    );
  });
});
