import path from "node:path";

export function isPathInsideRoots(target: string, roots: readonly string[]) {
  const normalizedTarget = path.resolve(target);
  return roots.some((root) => {
    const normalizedRoot = path.resolve(root);
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
  });
}

export function resolveSafeLocalAssetPath(value: string, roots: readonly string[]) {
  if (!path.isAbsolute(value)) return null;
  const resolved = path.resolve(value);
  return isPathInsideRoots(resolved, roots) ? resolved : null;
}

export function parseSafeRemoteAssetUrl(value: string) {
  if (!/^https:\/\//i.test(value)) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
