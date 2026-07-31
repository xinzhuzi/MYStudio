import { ipcMain } from "electron";
import type {
  RemotionAudioImportRequest,
  RemotionChapterManifestService,
  RemotionChapterManifestWriteRequestV2,
  RemotionGeneratedShotAudioWriteRequest,
} from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service";
import {
  REMOTION_CHAPTER_AUDIO_IMPORT_CHANNEL,
  REMOTION_CHAPTER_AUDIO_PROBE_CHANNEL,
  REMOTION_CHAPTER_MANIFEST_READ_CHANNEL,
  REMOTION_CHAPTER_MANIFEST_WRITE_CHANNEL,
  REMOTION_SHOT_AUDIO_WRITE_GENERATED_CHANNEL,
  type RemotionChapterAudioProbeRequest,
  type RemotionChapterManifestReadReply,
  type RemotionChapterManifestScopeRequest,
} from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-ipc";

const SHOT_ROLES = new Set(["voice", "sfx"]);
const CHAPTER_ROLES = new Set(["bgm", "ambience"]);

export function registerRemotionChapterManifestIpcHandlers(
  service: RemotionChapterManifestService,
): { dispose: () => void } {
  ipcMain.handle(REMOTION_CHAPTER_MANIFEST_READ_CHANNEL, async (_event, payload: unknown): Promise<RemotionChapterManifestReadReply> => {
    const request = parseScope(payload);
    const manifest = await service.read(request.projectId, request.chapterId);
    return manifest
      ? { status: "ready", manifest }
      : { status: "missing", projectId: request.projectId, chapterId: request.chapterId };
  });
  ipcMain.handle(REMOTION_CHAPTER_MANIFEST_WRITE_CHANNEL, async (_event, payload: unknown) => (
    service.writeCas(parseWrite(payload))
  ));
  ipcMain.handle(REMOTION_CHAPTER_AUDIO_IMPORT_CHANNEL, async (_event, payload: unknown) => (
    service.importAudio(parseImport(payload))
  ));
  ipcMain.handle(REMOTION_SHOT_AUDIO_WRITE_GENERATED_CHANNEL, async (_event, payload: unknown) => (
    service.writeGeneratedShotAudio(parseGeneratedAudio(payload))
  ));
  ipcMain.handle(REMOTION_CHAPTER_AUDIO_PROBE_CHANNEL, async (_event, payload: unknown) => {
    const request = parseProbe(payload);
    return service.probeBindingSource(request.binding);
  });
  return {
    dispose() {
      ipcMain.removeHandler(REMOTION_CHAPTER_MANIFEST_READ_CHANNEL);
      ipcMain.removeHandler(REMOTION_CHAPTER_MANIFEST_WRITE_CHANNEL);
      ipcMain.removeHandler(REMOTION_CHAPTER_AUDIO_IMPORT_CHANNEL);
      ipcMain.removeHandler(REMOTION_SHOT_AUDIO_WRITE_GENERATED_CHANNEL);
      ipcMain.removeHandler(REMOTION_CHAPTER_AUDIO_PROBE_CHANNEL);
    },
  };
}

function parseGeneratedAudio(value: unknown): RemotionGeneratedShotAudioWriteRequest {
  const record = exactRecord(
    value,
    ["projectId", "chapterId", "shotId", "role", "extension", "bytes"],
    "generated shot audio write",
  );
  if (record.role !== "voice" && record.role !== "sfx") throw new Error("role_invalid");
  if (record.extension !== "wav") throw new Error("audio_extension_invalid");
  if (!(record.bytes instanceof ArrayBuffer) && !(record.bytes instanceof Uint8Array)) {
    throw new Error("audio_bytes_invalid");
  }
  return {
    projectId: parseId(record.projectId, "projectId"),
    chapterId: parseId(record.chapterId, "chapterId"),
    shotId: parseId(record.shotId, "shotId"),
    role: record.role,
    extension: record.extension,
    bytes: record.bytes,
  };
}

function parseScope(value: unknown): RemotionChapterManifestScopeRequest {
  const record = exactRecord(value, ["projectId", "chapterId"], "chapter manifest scope");
  return { projectId: parseId(record.projectId, "projectId"), chapterId: parseId(record.chapterId, "chapterId") };
}

function parseWrite(value: unknown): RemotionChapterManifestWriteRequestV2 {
  const record = exactRecord(value, ["projectId", "chapterId", "expectedRevision", "manifest"], "chapter manifest write");
  if (!Number.isSafeInteger(record.expectedRevision) || (record.expectedRevision as number) < 0) {
    throw new Error("expectedRevision_invalid");
  }
  if (!isRecord(record.manifest)) throw new Error("manifest_invalid");
  return {
    projectId: parseId(record.projectId, "projectId"),
    chapterId: parseId(record.chapterId, "chapterId"),
    expectedRevision: record.expectedRevision as number,
    manifest: record.manifest as unknown as RemotionChapterManifestWriteRequestV2["manifest"],
  };
}

function parseImport(value: unknown): RemotionAudioImportRequest {
  if (!isRecord(value)) throw new Error("chapter audio import_invalid");
  const role = value.role;
  const isShotRole = typeof role === "string" && SHOT_ROLES.has(role);
  const isChapterRole = typeof role === "string" && CHAPTER_ROLES.has(role);
  if (!isShotRole && !isChapterRole) throw new Error("role_invalid");
  if (isShotRole && !Object.prototype.hasOwnProperty.call(value, "shotId")) {
    throw new Error("shotId_required_for_shot_audio");
  }
  if (isChapterRole && Object.prototype.hasOwnProperty.call(value, "shotId")) {
    throw new Error("shotId_forbidden_for_chapter_audio");
  }
  const keys = isShotRole
    ? ["projectId", "chapterId", "shotId", "role", "sourcePath"]
    : ["projectId", "chapterId", "role", "sourcePath"];
  const record = exactRecord(value, keys, "chapter audio import");
  if (typeof record.sourcePath !== "string" || !record.sourcePath) throw new Error("sourcePath_invalid");
  if (isShotRole) {
    return {
      projectId: parseId(record.projectId, "projectId"),
      chapterId: parseId(record.chapterId, "chapterId"),
      shotId: parseId(record.shotId, "shotId"),
      role: role as "voice" | "sfx",
      sourcePath: record.sourcePath,
    };
  }
  return {
    projectId: parseId(record.projectId, "projectId"),
    chapterId: parseId(record.chapterId, "chapterId"),
    role: role as "bgm" | "ambience",
    sourcePath: record.sourcePath,
  };
}

function parseProbe(value: unknown): RemotionChapterAudioProbeRequest {
  const record = exactRecord(value, ["projectId", "chapterId", "binding"], "chapter audio probe");
  const projectId = parseId(record.projectId, "projectId");
  const chapterId = parseId(record.chapterId, "chapterId");
  if (!isRecord(record.binding)) throw new Error("binding_invalid");
  if (record.binding.projectId !== projectId) throw new Error("projectId_mismatch");
  if (record.binding.chapterId !== chapterId) throw new Error("chapterId_mismatch");
  return { projectId, chapterId, binding: record.binding as unknown as RemotionChapterAudioProbeRequest["binding"] };
}

function exactRecord(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label}_invalid`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label}_fields_invalid`);
  }
  return value;
}

function parseId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value === "." || value === ".." || /[\\/\0]/.test(value)) {
    throw new Error(`${label}_invalid`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
