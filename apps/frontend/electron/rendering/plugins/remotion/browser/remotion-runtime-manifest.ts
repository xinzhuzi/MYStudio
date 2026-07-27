import path from "node:path";

// Design §5: before spawning the browser controller / render worker, write a
// minimal private package.json into <userData>/remotion-runtime and set the
// worker cwd there, so Remotion pins its browser cache to
// <userData>/remotion-runtime/node_modules/.remotion instead of a shared or
// read-only app path. This builder is pure so it can be unit-tested without
// touching the real userData directory.

export const REMOTION_RUNTIME_DIR_NAME = "remotion-runtime";

// Private, never-published manifest. `private: true` keeps npm from ever
// treating this as a publishable package; the name is namespaced and fixed.
export interface RemotionRuntimeManifest {
  name: string;
  version: string;
  private: true;
}

export function buildRemotionRuntimeManifest(
  remotionVersion: string,
): RemotionRuntimeManifest {
  if (typeof remotionVersion !== "string" || remotionVersion.trim().length === 0) {
    throw new Error("运行时 manifest 需要非空 Remotion 版本");
  }
  return {
    name: "@mystudio/remotion-runtime",
    version: remotionVersion,
    private: true,
  };
}

export function resolveRemotionRuntimeDir(userDataDir: string): string {
  if (!path.isAbsolute(userDataDir)) {
    throw new Error(`userData 目录必须是绝对路径: ${userDataDir}`);
  }
  return path.join(userDataDir, REMOTION_RUNTIME_DIR_NAME);
}

export function resolveRemotionRuntimeManifestPath(userDataDir: string): string {
  return path.join(resolveRemotionRuntimeDir(userDataDir), "package.json");
}

// The pinned Remotion browser cache directory, derived from the runtime cwd.
export function resolveRemotionCacheDir(userDataDir: string): string {
  return path.join(
    resolveRemotionRuntimeDir(userDataDir),
    "node_modules",
    ".remotion",
  );
}
