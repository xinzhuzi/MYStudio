import fs from "node:fs";
import path from "node:path";
import type { RemotionAudioBindingV2 } from "@/lib/studio/remotion/remotion-audio-fingerprint";
import { validateRemotionAudioBindingFingerprint } from "@/lib/studio/remotion/remotion-audio-fingerprint";

export interface VerifiedRemotionAudioSource {
  filePath: string;
  sha256: string;
}

export async function verifyRemotionProjectFileSource(
  filePathValue: string,
  projectRootValue: string,
  expectedSha256: string,
  sourceLabel: string,
): Promise<VerifiedRemotionAudioSource> {
  if (!path.isAbsolute(filePathValue) || !path.isAbsolute(projectRootValue)) {
    throw new Error(`${sourceLabel}_path_not_absolute`);
  }
  const projectRoot = path.resolve(projectRootValue);
  const filePath = assertInside(projectRoot, path.resolve(filePathValue));
  await rejectSymlinkComponents(projectRoot, filePath);
  const [realProjectRoot, realFilePath] = await Promise.all([
    fs.promises.realpath(projectRoot),
    fs.promises.realpath(filePath),
  ]);
  assertInside(realProjectRoot, realFilePath);
  const stat = await fs.promises.stat(realFilePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`${sourceLabel}_not_file`);
  const sha256 = await sha256File(realFilePath);
  if (sha256 !== expectedSha256) throw new Error(`${sourceLabel}_sha256_mismatch`);
  return { filePath: realFilePath, sha256 };
}

export async function verifyRemotionAudioBindingSource(
  binding: RemotionAudioBindingV2,
  projectRootValue: string,
): Promise<VerifiedRemotionAudioSource> {
  const fingerprint = await validateRemotionAudioBindingFingerprint(binding);
  if (!fingerprint.success) {
    throw new Error(fingerprint.issues
      .map((issue) => `${issue.code}:${issue.path}:${issue.message}`)
      .join("; "));
  }

  const projectRoot = path.resolve(projectRootValue);
  if (!path.isAbsolute(projectRootValue) || binding.source.projectId !== binding.projectId) {
    throw new Error("projectId_mismatch");
  }
  const roleRelativePath = binding.renderScope === "shot"
    ? `remotion/audio/${binding.chapterId}/shots/${binding.shotId}/${binding.role}`
    : `remotion/audio/${binding.chapterId}/shared/${binding.role}`;
  const roleRoot = resolveInside(projectRoot, roleRelativePath);
  const sourcePath = resolveInside(projectRoot, binding.source.relativePath);
  assertInside(roleRoot, sourcePath);
  await rejectSymlinkComponents(projectRoot, sourcePath);

  const [realProjectRoot, realRoleRoot, realSourcePath] = await Promise.all([
    fs.promises.realpath(projectRoot),
    fs.promises.realpath(roleRoot),
    fs.promises.realpath(sourcePath),
  ]);
  assertInside(realProjectRoot, realRoleRoot);
  assertInside(realRoleRoot, realSourcePath);
  const stat = await fs.promises.stat(realSourcePath);
  if (!stat.isFile()) throw new Error("audio_source_not_file");
  const sha256 = await sha256File(realSourcePath);
  if (sha256 !== binding.sourceFingerprint || sha256 !== binding.source.contentSha256) {
    throw new Error("source_sha256_mismatch");
  }
  return { filePath: realSourcePath, sha256 };
}

async function rejectSymlinkComponents(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("path_escape");
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = await fs.promises.lstat(current);
    if (stat.isSymbolicLink()) throw new Error("path_escape");
  }
}

export async function rejectSymlinkComponentsUnderRoot(
  rootValue: string,
  targetValue: string,
): Promise<void> {
  if (!path.isAbsolute(rootValue) || !path.isAbsolute(targetValue)) {
    throw new Error("path_not_absolute");
  }
  const root = path.resolve(rootValue);
  const target = path.resolve(targetValue);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("path_escape");
  }
  let current = root;
  for (const segment of ["", ...relative.split(path.sep)]) {
    current = segment ? path.join(current, segment) : current;
    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(current);
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error("path_escape");
  }
}

function resolveInside(root: string, relativePath: string): string {
  return assertInside(root, path.resolve(root, relativePath));
}

function assertInside(root: string, target: string): string {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error("path_escape");
  }
  return normalizedTarget;
}

async function sha256File(filePath: string): Promise<string> {
  const crypto = await import("node:crypto");
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
