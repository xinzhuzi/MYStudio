import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  ProjectMediaReference,
  RemotionChapterManifestV2,
  RemotionChapterAudioRole,
  RemotionShotAudioRole,
} from "@/types/remotion-workspace";
import {
  validateRemotionChapterManifestFingerprint,
  type RemotionAudioBindingV2,
} from "@/lib/studio/remotion/remotion-audio-fingerprint";
import { canonicalJson } from "@/lib/studio/remotion/canonical-json";
import { validateRemotionChapterManifestV2 } from "@/lib/studio/remotion/remotion-manifest-validation";
import { verifyRemotionAudioBindingSource } from "./remotion-audio-source-verification";

export type RemotionAudioImportRequest =
  | {
      projectId: string;
      chapterId: string;
      shotId: string;
      role: RemotionShotAudioRole;
      sourcePath: string;
    }
  | {
      projectId: string;
      chapterId: string;
      role: RemotionChapterAudioRole;
      sourcePath: string;
      shotId?: never;
    };

export interface RemotionImportedAudioV2 {
  source: ProjectMediaReference;
  durationUs: number;
  streams: string[];
  sizeBytes: number;
}

export interface RemotionGeneratedShotAudioWriteRequest {
  projectId: string;
  chapterId: string;
  shotId: string;
  role: RemotionShotAudioRole;
  extension: "wav";
  bytes: ArrayBuffer | Uint8Array;
}

export interface RemotionAudioProbeV2 {
  durationUs: number;
  streams: string[];
}

export interface RemotionChapterManifestWriteRequestV2 {
  projectId: string;
  chapterId: string;
  expectedRevision: number;
  manifest: RemotionChapterManifestV2;
}

export interface RemotionChapterManifestWriteResultV2 {
  status: "written";
  revision: number;
  manifestFingerprint: string;
}

export interface RemotionChapterManifestServiceOptions {
  projectRootForProject: (projectId: string) => string;
  probeMedia: (filePath: string) => Promise<RemotionAudioProbeV2>;
  now?: () => number;
}

const SHOT_ROLES = new Set<RemotionShotAudioRole>(["voice", "sfx"]);
const CHAPTER_ROLES = new Set<RemotionChapterAudioRole>(["bgm", "ambience"]);
const AUDIO_EXTENSIONS = new Set([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"]);

export class RemotionChapterManifestService {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly now: () => number;

  constructor(private readonly options: RemotionChapterManifestServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async importAudio(request: RemotionAudioImportRequest): Promise<RemotionImportedAudioV2> {
    const projectId = parseId(request.projectId, "projectId");
    const chapterId = parseId(request.chapterId, "chapterId");
    const role = request.role;
    const isShotRole = SHOT_ROLES.has(role as RemotionShotAudioRole);
    const isChapterRole = CHAPTER_ROLES.has(role as RemotionChapterAudioRole);
    if (!isShotRole && !isChapterRole) throw new Error("role_invalid");
    if (isShotRole && !("shotId" in request && request.shotId)) {
      throw new Error("shotId_required_for_shot_audio");
    }
    if (isChapterRole && "shotId" in request && request.shotId !== undefined) {
      throw new Error("shotId_forbidden_for_chapter_audio");
    }
    if (!path.isAbsolute(request.sourcePath)) throw new Error("sourcePath_must_be_absolute");
    const sourceStat = await fs.promises.lstat(request.sourcePath);
    if (!sourceStat.isFile()) throw new Error("sourcePath_must_be_regular_file");
    const extension = path.extname(request.sourcePath).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(extension)) throw new Error("sourcePath_audio_extension_invalid");
    const sourceSha256 = await sha256File(request.sourcePath);
    const relativeDir = isShotRole
      ? `remotion/audio/${chapterId}/shots/${parseId(request.shotId!, "shotId")}/${role}`
      : `remotion/audio/${chapterId}/shared/${role}`;
    const relativePath = `${relativeDir}/${sourceSha256}${extension}`;
    const projectRoot = this.projectRoot(projectId);
    const destination = resolveInside(projectRoot, relativePath, "path_escape");
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.promises.copyFile(request.sourcePath, destination, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      if (await sha256File(destination) !== sourceSha256) throw new Error("destination_sha256_mismatch");
    }
    const probe = await this.options.probeMedia(destination);
    if (!Number.isSafeInteger(probe.durationUs) || probe.durationUs <= 0) {
      throw new Error("audio_duration_invalid");
    }
    if (!Array.isArray(probe.streams) || !probe.streams.includes("audio")) {
      throw new Error("audio_stream_missing");
    }
    const copiedStat = await fs.promises.stat(destination);
    return {
      source: {
        kind: "local-import",
        projectId,
        relativePath,
        contentSha256: sourceSha256,
        provenance: {
          sourceKind: "imported",
          sourceId: sourceSha256,
          sourceVersion: `sha256:${sourceSha256}`,
        },
      },
      durationUs: probe.durationUs,
      streams: [...probe.streams],
      sizeBytes: copiedStat.size,
    };
  }

  async writeGeneratedShotAudio(
    request: RemotionGeneratedShotAudioWriteRequest,
  ): Promise<RemotionImportedAudioV2> {
    const projectId = parseId(request.projectId, "projectId");
    const chapterId = parseId(request.chapterId, "chapterId");
    const shotId = parseId(request.shotId, "shotId");
    if (!SHOT_ROLES.has(request.role)) throw new Error("role_invalid");
    if (request.extension !== "wav") throw new Error("audio_extension_invalid");
    const buffer = Buffer.from(
      request.bytes instanceof Uint8Array ? request.bytes : new Uint8Array(request.bytes),
    );
    if (buffer.byteLength === 0) throw new Error("audio_bytes_empty");
    const sourceSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const relativePath = `remotion/audio/${chapterId}/shots/${shotId}/${request.role}/${sourceSha256}.wav`;
    const destination = resolveInside(this.projectRoot(projectId), relativePath, "path_escape");
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    try {
      await fs.promises.writeFile(destination, buffer, { flag: "wx" });
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      if (await sha256File(destination) !== sourceSha256) throw new Error("destination_sha256_mismatch");
    }
    const probe = await this.options.probeMedia(destination);
    if (!Number.isSafeInteger(probe.durationUs) || probe.durationUs <= 0 || !probe.streams.includes("audio")) {
      throw new Error("audio_probe_invalid");
    }
    const stat = await fs.promises.stat(destination);
    return {
      source: {
        kind: "project-file",
        projectId,
        relativePath,
        contentSha256: sourceSha256,
        provenance: {
          sourceKind: "generated",
          sourceId: sourceSha256,
          sourceVersion: `sha256:${sourceSha256}`,
        },
      },
      durationUs: probe.durationUs,
      streams: [...probe.streams],
      sizeBytes: stat.size,
    };
  }

  async read(projectIdValue: string, chapterIdValue: string): Promise<RemotionChapterManifestV2 | undefined> {
    const projectId = parseId(projectIdValue, "projectId");
    const chapterId = parseId(chapterIdValue, "chapterId");
    const manifestPath = this.manifestPath(projectId, chapterId);
    let raw: string;
    try {
      raw = await fs.promises.readFile(manifestPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("chapter_manifest_json_invalid");
    }
    const manifest = await this.validateManifest(parsed, projectId, chapterId);
    await this.verifyManifestAudioBytes(manifest);
    return manifest;
  }

  async writeCas(request: RemotionChapterManifestWriteRequestV2): Promise<RemotionChapterManifestWriteResultV2> {
    const projectId = parseId(request.projectId, "projectId");
    const chapterId = parseId(request.chapterId, "chapterId");
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
      throw new Error("expectedRevision_invalid");
    }
    const manifestPath = this.manifestPath(projectId, chapterId);
    return this.withLock(manifestPath, async () => {
      const current = await this.read(projectId, chapterId);
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== request.expectedRevision) {
        throw new Error(`revision_conflict:${currentRevision}`);
      }
      if (request.manifest.revision !== request.expectedRevision + 1) {
        throw new Error("manifest_revision_must_increment_by_one");
      }
      const manifest = await this.validateManifest(request.manifest, projectId, chapterId);
      await this.verifyManifestAudioBytes(manifest);
      await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
      const temporaryPath = path.join(
        path.dirname(manifestPath),
        `.${chapterId}.${this.now()}.${crypto.randomUUID()}.tmp`,
      );
      await fs.promises.writeFile(temporaryPath, `${canonicalJson(manifest)}\n`, { flag: "wx" });
      await fs.promises.rename(temporaryPath, manifestPath);
      return {
        status: "written",
        revision: manifest.revision,
        manifestFingerprint: manifest.manifestFingerprint,
      };
    });
  }

  async probeBindingSource(binding: RemotionAudioBindingV2): Promise<RemotionAudioProbeV2 & { sha256: string }> {
    const projectId = parseId(binding.projectId, "projectId");
    const { filePath, sha256 } = await verifyRemotionAudioBindingSource(
      binding,
      this.projectRoot(projectId),
    );
    const probe = await this.options.probeMedia(filePath);
    if (!probe.streams.includes("audio") || probe.durationUs !== binding.sourceDurationUs) {
      throw new Error("source_probe_mismatch");
    }
    return { ...probe, sha256 };
  }

  private projectRoot(projectId: string): string {
    const root = path.resolve(this.options.projectRootForProject(projectId));
    if (!path.isAbsolute(root)) throw new Error("project_root_invalid");
    return root;
  }

  private manifestPath(projectId: string, chapterId: string): string {
    return resolveInside(
      this.projectRoot(projectId),
      `remotion/chapters/${chapterId}.json`,
      "path_escape",
    );
  }

  private async validateManifest(
    value: unknown,
    projectId: string,
    chapterId: string,
  ): Promise<RemotionChapterManifestV2> {
    const structural = validateRemotionChapterManifestV2(value);
    if (!structural.success) throw new Error(formatIssues(structural.issues));
    if (structural.value.projectId !== projectId) throw new Error("projectId_mismatch");
    if (structural.value.chapterId !== chapterId) throw new Error("chapterId_mismatch");
    const fingerprints = await validateRemotionChapterManifestFingerprint(structural.value);
    if (!fingerprints.success) throw new Error(formatIssues(fingerprints.issues));
    return fingerprints.value;
  }

  private async verifyManifestAudioBytes(manifest: RemotionChapterManifestV2): Promise<void> {
    for (const binding of manifest.sharedAudioBindings) {
      await this.verifyBindingAudioBytes(binding, manifest.projectId);
    }
    for (const shot of manifest.shots) {
      for (const binding of shot.audioBindings) {
        await this.verifyBindingAudioBytes(binding, manifest.projectId);
      }
    }
  }

  private async verifyBindingAudioBytes(binding: RemotionAudioBindingV2, projectId: string): Promise<void> {
    if (binding.projectId !== projectId) throw new Error("projectId_mismatch");
    await verifyRemotionAudioBindingSource(binding, this.projectRoot(projectId));
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.locks.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}

function parseId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value === "." || value === ".." || /[\\/\0]/.test(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

function resolveInside(root: string, relativePath: string, errorCode: string): string {
  const target = path.resolve(root, relativePath);
  return assertInside(path.resolve(root), target, errorCode);
}

function assertInside(root: string, target: string, errorCode: string): string {
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(errorCode);
  return target;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function formatIssues(issues: Array<{ code: string; path: string; message: string }>): string {
  return issues.map((issue) => `${issue.code}:${issue.path}:${issue.message}`).join("; ");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
