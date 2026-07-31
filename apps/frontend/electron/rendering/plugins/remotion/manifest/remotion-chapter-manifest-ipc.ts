import type {
  RemotionChapterManifestV2,
  RemotionChapterAudioBindingV2,
  RemotionShotAudioBindingV2,
} from "@/types/remotion-workspace";
import type {
  RemotionAudioImportRequest,
  RemotionAudioProbeV2,
  RemotionChapterManifestWriteRequestV2,
  RemotionChapterManifestWriteResultV2,
  RemotionGeneratedShotAudioWriteRequest,
  RemotionImportedAudioV2,
} from "./remotion-chapter-manifest-service";

export const REMOTION_CHAPTER_MANIFEST_READ_CHANNEL = "remotion-chapter-manifest-read";
export const REMOTION_CHAPTER_MANIFEST_WRITE_CHANNEL = "remotion-chapter-manifest-write";
export const REMOTION_CHAPTER_AUDIO_IMPORT_CHANNEL = "remotion-chapter-audio-import";
export const REMOTION_CHAPTER_AUDIO_PROBE_CHANNEL = "remotion-chapter-audio-probe";
export const REMOTION_SHOT_AUDIO_WRITE_GENERATED_CHANNEL = "remotion-shot-audio-write-generated";

export interface RemotionChapterManifestScopeRequest {
  projectId: string;
  chapterId: string;
}

export type RemotionChapterManifestReadReply =
  | { status: "missing"; projectId: string; chapterId: string }
  | { status: "ready"; manifest: RemotionChapterManifestV2 };

export interface RemotionChapterAudioProbeRequest {
  projectId: string;
  chapterId: string;
  binding: RemotionShotAudioBindingV2 | RemotionChapterAudioBindingV2;
}

export interface RemotionChapterAudioProbeReply extends RemotionAudioProbeV2 {
  sha256: string;
}

export interface RemotionChapterManifestBridge {
  read: (scope: RemotionChapterManifestScopeRequest) => Promise<RemotionChapterManifestReadReply>;
  write: (request: RemotionChapterManifestWriteRequestV2) => Promise<RemotionChapterManifestWriteResultV2>;
  importAudio: (request: RemotionAudioImportRequest) => Promise<RemotionImportedAudioV2>;
  writeGeneratedShotAudio: (request: RemotionGeneratedShotAudioWriteRequest) => Promise<RemotionImportedAudioV2>;
  probeAudio: (request: RemotionChapterAudioProbeRequest) => Promise<RemotionChapterAudioProbeReply>;
}
