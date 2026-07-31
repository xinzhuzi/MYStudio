// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMOTION_CHAPTER_AUDIO_IMPORT_CHANNEL,
  REMOTION_CHAPTER_AUDIO_PROBE_CHANNEL,
  REMOTION_CHAPTER_MANIFEST_READ_CHANNEL,
  REMOTION_CHAPTER_MANIFEST_WRITE_CHANNEL,
  REMOTION_SHOT_AUDIO_WRITE_GENERATED_CHANNEL,
} from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-ipc";

type Handler = (...args: unknown[]) => unknown;
const state = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), removed: [] as string[] }));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Handler) => state.handlers.set(channel, handler)),
    removeHandler: vi.fn((channel: string) => {
      state.removed.push(channel);
      state.handlers.delete(channel);
    }),
  },
}));

import { registerRemotionChapterManifestIpcHandlers } from "./remotion-chapter-manifest-ipc";

beforeEach(() => {
  state.handlers.clear();
  state.removed.length = 0;
});

describe("Remotion chapter manifest IPC", () => {
  it("registers only narrow read/write/import/probe channels and rejects caller-controlled fields", async () => {
    const service = {
      read: vi.fn(async () => undefined),
      writeCas: vi.fn(),
      importAudio: vi.fn(),
      writeGeneratedShotAudio: vi.fn(),
      probeBindingSource: vi.fn(),
    };
    const registration = registerRemotionChapterManifestIpcHandlers(service as never);
    expect([...state.handlers.keys()].sort()).toEqual([
      REMOTION_CHAPTER_AUDIO_IMPORT_CHANNEL,
      REMOTION_CHAPTER_AUDIO_PROBE_CHANNEL,
      REMOTION_CHAPTER_MANIFEST_READ_CHANNEL,
      REMOTION_CHAPTER_MANIFEST_WRITE_CHANNEL,
      REMOTION_SHOT_AUDIO_WRITE_GENERATED_CHANNEL,
    ].sort());

    await expect(state.handlers.get(REMOTION_CHAPTER_MANIFEST_READ_CHANNEL)!({}, {
      projectId: "project-a",
      chapterId: "chapter-001",
      absolutePath: "/tmp/escape.json",
    })).rejects.toThrow("fields_invalid");
    expect(service.read).not.toHaveBeenCalled();

    await expect(state.handlers.get(REMOTION_CHAPTER_AUDIO_IMPORT_CHANNEL)!({}, {
      projectId: "project-a",
      chapterId: "chapter-001",
      role: "voice",
      sourcePath: "/tmp/voice.wav",
    })).rejects.toThrow("shotId");
    expect(service.importAudio).not.toHaveBeenCalled();

    registration.dispose();
    expect(state.removed.sort()).toEqual([
      REMOTION_CHAPTER_AUDIO_IMPORT_CHANNEL,
      REMOTION_CHAPTER_AUDIO_PROBE_CHANNEL,
      REMOTION_CHAPTER_MANIFEST_READ_CHANNEL,
      REMOTION_CHAPTER_MANIFEST_WRITE_CHANNEL,
      REMOTION_SHOT_AUDIO_WRITE_GENERATED_CHANNEL,
    ].sort());
  });

  it("returns an explicit missing manifest and binds probe scope to the binding identity", async () => {
    const service = {
      read: vi.fn(async () => undefined),
      writeCas: vi.fn(),
      importAudio: vi.fn(),
      writeGeneratedShotAudio: vi.fn(),
      probeBindingSource: vi.fn(async () => ({ durationUs: 1, streams: ["audio"], sha256: "a".repeat(64) })),
    };
    registerRemotionChapterManifestIpcHandlers(service as never);
    await expect(state.handlers.get(REMOTION_CHAPTER_MANIFEST_READ_CHANNEL)!({}, {
      projectId: "project-a",
      chapterId: "chapter-001",
    })).resolves.toEqual({ status: "missing", projectId: "project-a", chapterId: "chapter-001" });

    await expect(state.handlers.get(REMOTION_CHAPTER_AUDIO_PROBE_CHANNEL)!({}, {
      projectId: "project-a",
      chapterId: "chapter-001",
      binding: { projectId: "project-b", chapterId: "chapter-001" },
    })).rejects.toThrow("projectId_mismatch");
    expect(service.probeBindingSource).not.toHaveBeenCalled();
  });

  it("validates and forwards generated shot audio without widening the payload", async () => {
    const imported = {
      source: {
        kind: "project-file" as const,
        projectId: "project-a",
        relativePath: `remotion/audio/chapter-001/shots/shot-001/voice/${"a".repeat(64)}.wav`,
        contentSha256: "a".repeat(64),
        provenance: {
          sourceKind: "generated" as const,
          sourceId: "a".repeat(64),
          sourceVersion: `sha256:${"a".repeat(64)}`,
        },
      },
      durationUs: 1_000_000,
      streams: ["audio"],
      sizeBytes: 4,
    };
    const service = {
      read: vi.fn(),
      writeCas: vi.fn(),
      importAudio: vi.fn(),
      writeGeneratedShotAudio: vi.fn(async () => imported),
      probeBindingSource: vi.fn(),
    };
    registerRemotionChapterManifestIpcHandlers(service as never);
    const handler = state.handlers.get(REMOTION_SHOT_AUDIO_WRITE_GENERATED_CHANNEL)!;
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const payload = {
      projectId: "project-a",
      chapterId: "chapter-001",
      shotId: "shot-001",
      role: "voice",
      extension: "wav",
      bytes,
    };

    await expect(handler({}, payload)).resolves.toEqual(imported);
    expect(service.writeGeneratedShotAudio).toHaveBeenCalledWith(payload);

    for (const invalid of [
      { ...payload, role: "bgm" },
      { ...payload, extension: "mp3" },
      { ...payload, bytes: "raw" },
      { ...payload, shotId: "../escape" },
      { ...payload, absolutePath: "/tmp/escape.wav" },
    ]) {
      await expect(handler({}, invalid)).rejects.toThrow();
    }
    expect(service.writeGeneratedShotAudio).toHaveBeenCalledTimes(1);
  });
});
