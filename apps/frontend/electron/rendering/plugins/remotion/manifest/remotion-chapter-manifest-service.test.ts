import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  RemotionChapterManifestV2,
  RemotionShotAudioBindingV2,
} from "@/types/remotion-workspace";
import {
  createRemotionAudioBindingFingerprint,
  createRemotionChapterManifestFingerprint,
} from "@/lib/studio/remotion/remotion-audio-fingerprint";
import { makeWorkspaceManifest } from "@/lib/studio/remotion/remotion-workspace-test-fixtures";
import { RemotionChapterManifestService } from "./remotion-chapter-manifest-service";

const SHA_A = "a".repeat(64);

async function createHarness() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mystudio-remotion-audio-"));
  const sourcePath = path.join(root, "voice.wav");
  await fs.promises.writeFile(sourcePath, Buffer.from("shot-voice-bytes"));
  const projectRootForProject = (projectId: string) => path.join(root, "_p", projectId);
  const service = new RemotionChapterManifestService({
    projectRootForProject,
    probeMedia: async () => ({ durationUs: 1_500_000, streams: ["audio"] }),
    now: () => 100,
  });
  return { root, sourcePath, service, projectRootForProject };
}

async function makeManifest(
  source: Awaited<ReturnType<RemotionChapterManifestService["importAudio"]>>,
): Promise<RemotionChapterManifestV2> {
  const binding: RemotionShotAudioBindingV2 = {
    schemaVersion: 2,
    bindingId: "voice-shot-001",
    bindingFingerprint: SHA_A,
    renderScope: "shot",
    projectId: "project-a",
    chapterId: "chapter-001",
    shotId: "shot-001",
    shotRevision: 1,
    role: "voice",
    source: source.source,
    sourceFingerprint: source.source.contentSha256,
    sourceDurationUs: source.durationUs,
    sourceStartUs: 0,
    shotStartUs: 0,
    durationUs: source.durationUs,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    envelope: [{ timeUs: 0, gain: 1 }],
    ttsInputFingerprint: "b".repeat(64),
  };
  binding.bindingFingerprint = await createRemotionAudioBindingFingerprint(binding);
  const manifest: RemotionChapterManifestV2 = {
    schemaVersion: 2,
    manifestFingerprint: SHA_A,
    projectId: "project-a",
    chapterId: "chapter-001",
    revision: 1,
    sourceSnapshotHash: "c".repeat(64),
    requiredShotIds: ["shot-001"],
    sharedAudioBindings: [],
    shots: [{
      shotId: "shot-001",
      storyboardId: "storyboard-001",
      index: 0,
      revision: 1,
      sourceFingerprint: "d".repeat(64),
      durationUs: 2_000_000,
      visualSource: {
        kind: "project-file",
        projectId: "project-a",
        relativePath: "images/shot-001.png",
        contentSha256: "d".repeat(64),
        provenance: { sourceKind: "generated", sourceId: "shot-001", sourceVersion: "1" },
      },
      audioBindings: [binding],
      motion: { kind: "static" },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    }],
    renderSettings: makeWorkspaceManifest().defaultRenderSettings,
    createdAt: 100,
    updatedAt: 100,
  };
  manifest.manifestFingerprint = await createRemotionChapterManifestFingerprint(manifest);
  return manifest;
}

describe("RemotionChapterManifestService", () => {
  it("imports shot audio into the exact project/chapter/shot role root and reuses identical bytes", async () => {
    const { sourcePath, service } = await createHarness();
    const first = await service.importAudio({
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      role: "voice",
      sourcePath,
    });
    const second = await service.importAudio({
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      role: "voice",
      sourcePath,
    });
    expect(first).toEqual(second);
    expect(first.source.relativePath).toMatch(
      /^remotion\/audio\/chapter-001\/shots\/shot-001\/voice\/[a-f0-9]{64}\.wav$/,
    );
    expect(first.source.contentSha256).toBe(
      crypto.createHash("sha256").update("shot-voice-bytes").digest("hex"),
    );
    expect(first.durationUs).toBe(1_500_000);
  });

  it("writes generated shot audio by byte SHA with exact scope and provenance", async () => {
    const { service, projectRootForProject } = await createHarness();
    const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    const sourceSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const request = {
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      role: "voice" as const,
      extension: "wav" as const,
      bytes,
    };

    const first = await service.writeGeneratedShotAudio(request);
    const second = await service.writeGeneratedShotAudio(request);

    expect(second).toEqual(first);
    expect(first).toEqual({
      source: {
        kind: "project-file",
        projectId: "project-a",
        relativePath: `remotion/audio/chapter-001/shots/shot-001/voice/${sourceSha256}.wav`,
        contentSha256: sourceSha256,
        provenance: {
          sourceKind: "generated",
          sourceId: sourceSha256,
          sourceVersion: `sha256:${sourceSha256}`,
        },
      },
      durationUs: 1_500_000,
      streams: ["audio"],
      sizeBytes: bytes.byteLength,
    });
    await expect(fs.promises.readFile(
      path.join(projectRootForProject("project-a"), first.source.relativePath),
    )).resolves.toEqual(Buffer.from(bytes));

    await expect(service.writeGeneratedShotAudio({ ...request, bytes: new Uint8Array() }))
      .rejects.toThrow("audio_bytes_empty");
    await expect(service.writeGeneratedShotAudio({ ...request, role: "bgm" } as never))
      .rejects.toThrow("role_invalid");
    await expect(service.writeGeneratedShotAudio({ ...request, extension: "mp3" } as never))
      .rejects.toThrow("audio_extension_invalid");
    await expect(service.writeGeneratedShotAudio({ ...request, shotId: "../escape" }))
      .rejects.toThrow("shotId_invalid");
  });

  it("writes and reads a fingerprinted V2 manifest with monotonic CAS revision", async () => {
    const { sourcePath, service } = await createHarness();
    const imported = await service.importAudio({
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      role: "voice",
      sourcePath,
    });
    const manifest = await makeManifest(imported);
    await expect(service.writeCas({
      projectId: "project-a",
      chapterId: "chapter-001",
      expectedRevision: 0,
      manifest,
    })).resolves.toEqual({ status: "written", revision: 1, manifestFingerprint: manifest.manifestFingerprint });
    await expect(service.read("project-a", "chapter-001")).resolves.toEqual(manifest);

    await expect(service.writeCas({
      projectId: "project-a",
      chapterId: "chapter-001",
      expectedRevision: 0,
      manifest,
    })).rejects.toThrow("revision_conflict");
  });

  it("fails closed on actual-byte SHA drift and legacy V1 manifests", async () => {
    const { sourcePath, service, projectRootForProject } = await createHarness();
    const imported = await service.importAudio({
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      role: "voice",
      sourcePath,
    });
    const manifest = await makeManifest(imported);
    await service.writeCas({
      projectId: "project-a",
      chapterId: "chapter-001",
      expectedRevision: 0,
      manifest,
    });
    const importedPath = path.join(projectRootForProject("project-a"), imported.source.relativePath);
    await fs.promises.writeFile(importedPath, Buffer.from("tampered"));
    await expect(service.read("project-a", "chapter-001")).rejects.toThrow("source_sha256_mismatch");

    const manifestPath = path.join(projectRootForProject("project-a"), "remotion", "chapters", "chapter-001.json");
    await fs.promises.writeFile(manifestPath, JSON.stringify({ ...manifest, schemaVersion: 1 }));
    await expect(service.read("project-a", "chapter-001")).rejects.toThrow("schema_upgrade_required");
  });

  it("rejects role/scope mismatches, cross-project writes and symlink escapes", async () => {
    const { root, sourcePath, service } = await createHarness();
    await expect(service.importAudio({
      projectId: "project-a",
      chapterId: "chapter-001",
      role: "voice",
      sourcePath,
    } as never)).rejects.toThrow("shotId");
    await expect(service.importAudio({
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      role: "bgm",
      sourcePath,
    } as never)).rejects.toThrow("shotId");

    const imported = await service.importAudio({
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      role: "voice",
      sourcePath,
    });
    const manifest = await makeManifest(imported);
    await expect(service.writeCas({
      projectId: "project-b",
      chapterId: "chapter-001",
      expectedRevision: 0,
      manifest,
    })).rejects.toThrow("projectId");

    const outside = path.join(root, "outside.wav");
    await fs.promises.writeFile(outside, Buffer.from("outside"));
    const roleRoot = path.join(root, "_p", "project-a", "remotion", "audio", "chapter-001", "shots", "shot-001", "voice");
    await fs.promises.mkdir(roleRoot, { recursive: true });
    const linkPath = path.join(roleRoot, "escape.wav");
    await fs.promises.symlink(outside, linkPath);
    const escaped = await makeManifest(imported);
    const escapedBinding = escaped.shots[0].audioBindings[0];
    escapedBinding.source = {
      ...escapedBinding.source,
      relativePath: "remotion/audio/chapter-001/shots/shot-001/voice/escape.wav",
      contentSha256: crypto.createHash("sha256").update("outside").digest("hex"),
    };
    escapedBinding.sourceFingerprint = escapedBinding.source.contentSha256;
    escapedBinding.bindingFingerprint = await createRemotionAudioBindingFingerprint(escapedBinding);
    escaped.manifestFingerprint = await createRemotionChapterManifestFingerprint(escaped);
    await expect(service.writeCas({
      projectId: "project-a",
      chapterId: "chapter-001",
      expectedRevision: 0,
      manifest: escaped,
    })).rejects.toThrow("path_escape");
  });

  it("rejects symlinked import destinations before copying bytes", async () => {
    const { root, sourcePath, service, projectRootForProject } = await createHarness();
    const outsideDirectory = path.join(root, "outside-import");
    await fs.promises.mkdir(outsideDirectory, { recursive: true });
    const roleRoot = path.join(
      projectRootForProject("project-a"),
      "remotion/audio/chapter-001/shots/shot-001",
    );
    await fs.promises.mkdir(path.dirname(roleRoot), { recursive: true });
    await fs.promises.symlink(outsideDirectory, roleRoot);
    await expect(service.importAudio({
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      role: "voice",
      sourcePath,
    })).rejects.toThrow("path_escape");
    await expect(fs.promises.readdir(outsideDirectory)).resolves.toEqual([]);
  });

  it("rejects symlinked generated destinations before writing bytes", async () => {
    const { root, service, projectRootForProject } = await createHarness();
    const bytes = new Uint8Array([82, 73, 70, 70, 9, 8, 7, 6]);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const outsideDirectory = path.join(root, "outside-generated");
    await fs.promises.mkdir(outsideDirectory, { recursive: true });
    const roleRoot = path.join(
      projectRootForProject("project-a"),
      "remotion/audio/chapter-001/shots/shot-001",
    );
    await fs.promises.mkdir(path.dirname(roleRoot), { recursive: true });
    await fs.promises.symlink(outsideDirectory, roleRoot);
    await expect(service.writeGeneratedShotAudio({
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      role: "voice",
      extension: "wav",
      bytes,
    })).rejects.toThrow("path_escape");
    await expect(fs.promises.access(path.join(outsideDirectory, `${sha256}.wav`))).rejects.toThrow();
  });

  it("rejects symlinked content-addressed destination files", async () => {
    const { root, sourcePath, service, projectRootForProject } = await createHarness();
    const outsideFile = path.join(root, "outside-destination.wav");
    await fs.promises.writeFile(outsideFile, Buffer.from("outside"));
    const importedSha = crypto.createHash("sha256").update("shot-voice-bytes").digest("hex");
    const voiceRoot = path.join(
      projectRootForProject("project-a"),
      "remotion/audio/chapter-001/shots/shot-001/voice",
    );
    await fs.promises.mkdir(voiceRoot, { recursive: true });
    await fs.promises.symlink(outsideFile, path.join(voiceRoot, `${importedSha}.wav`));
    await expect(service.importAudio({
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      role: "voice",
      sourcePath,
    })).rejects.toThrow("path_escape");

    const generatedBytes = new Uint8Array([1, 3, 5, 7]);
    const generatedSha = crypto.createHash("sha256").update(generatedBytes).digest("hex");
    const sfxRoot = path.join(
      projectRootForProject("project-a"),
      "remotion/audio/chapter-001/shots/shot-001/sfx",
    );
    await fs.promises.mkdir(sfxRoot, { recursive: true });
    await fs.promises.symlink(outsideFile, path.join(sfxRoot, `${generatedSha}.wav`));
    await expect(service.writeGeneratedShotAudio({
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      role: "sfx",
      extension: "wav",
      bytes: generatedBytes,
    })).rejects.toThrow("path_escape");
  });

  it("rejects a symlinked chapter manifest before reading it", async () => {
    const { root, sourcePath, service, projectRootForProject } = await createHarness();
    const imported = await service.importAudio({
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      role: "voice",
      sourcePath,
    });
    const manifest = await makeManifest(imported);
    await service.writeCas({
      projectId: "project-a",
      chapterId: "chapter-001",
      expectedRevision: 0,
      manifest,
    });

    const manifestPath = path.join(
      projectRootForProject("project-a"),
      "remotion/chapters/chapter-001.json",
    );
    const outsideManifest = path.join(root, "outside-manifest.json");
    await fs.promises.rename(manifestPath, outsideManifest);
    await fs.promises.symlink(outsideManifest, manifestPath);

    await expect(service.read("project-a", "chapter-001")).rejects.toThrow("path_escape");
  });
});
