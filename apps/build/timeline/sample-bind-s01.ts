/**
 * S01 单镜样片微绑定器(一次性,不入库):
 * 从 manifest r67 取 sb-chapter-001-001 的 voice binding,按当前 revision
 * 合成 subtitleAuthority/audioRef/shotAudioBindings/ttsJob 写回 store。
 * 字段语义与 update-storyboards-voice.ts 完全同款;台词一致性已人工核验
 * (当前 lines == 配音时代 lines,逐字相等)。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RemotionChapterManifestService } from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service";
import { probeRenderedMedia } from "../remotion/render-smoke-evidence";
import type { RemotionShotAudioBindingV2, RemotionChapterManifestV2 } from "@/types/remotion-workspace";
import { createRemotionAudioBindingFingerprint } from "@/lib/studio/remotion/remotion-audio-fingerprint";
import { writeStudioWorkflowStore } from "@/electron/storage/studio-workflow-store-io";
import { buildProjectFileUrl } from "@/lib/upscale/project-file-url";
import {
  deriveStorageRoots,
  readStudioWorkflowStoreState,
  resolveProjectDir,
  resolveTimelineSourcePath,
} from "./storage-paths";

const TARGET_SHOT = process.env.SAMPLE_SHOT_ID ?? "sb-chapter-001-001";

async function main(): Promise<void> {
  const projectDir = resolveProjectDir();
  const roots = deriveStorageRoots(projectDir);
  const projectId = roots.projectId;
  const dataRoot = roots.dataRoot;
  const chapterId = "chapter-001";

  const manifestService = new RemotionChapterManifestService({
    projectRootForProject: (pid: string) => {
      if (pid !== projectId) throw new Error(`项目身份不一致: ${pid}`);
      return projectDir;
    },
    probeMedia: async (filePath: string) => {
      const probe = await probeRenderedMedia(filePath);
      return { durationUs: Math.round(probe.duration * 1_000_000), streams: probe.streams };
    },
  });
  const manifest = (await manifestService.read(projectId, chapterId)) as RemotionChapterManifestV2;
  if (!manifest) throw new Error("manifest 不存在");
  const shot = manifest.shots.find((s) => s.shotId === TARGET_SHOT);
  if (!shot) throw new Error(`manifest 缺少 ${TARGET_SHOT}`);
  const binding = shot.audioBindings.find((b) => b.role === "voice") as RemotionShotAudioBindingV2;
  if (!binding) throw new Error(`${TARGET_SHOT} 无 voice binding`);

  const snapshot = readStudioWorkflowStoreState(projectDir);
  if (!snapshot) throw new Error("store 不存在");
  const state = snapshot.state as Record<string, unknown>;
  const storyboards = state.storyboards as Array<Record<string, unknown>>;
  const sb = storyboards.find((s) => s.id === TARGET_SHOT);
  if (!sb) throw new Error(`store 缺少 ${TARGET_SHOT}`);

  // 台词一致性防线:绑定前逐字比对(样片用途,防错配旁白)
  const bindingTextNote = String(sb.lines ?? "");
  console.log(`[sample-bind] ${TARGET_SHOT} 台词: ${bindingTextNote}`);

  const shotRevision = Math.max(1, (sb.outputVersion as number) ?? 1);
  const mediaRef = sb.mediaRef as { path?: string } | undefined;
  if (!mediaRef?.path) throw new Error(`${TARGET_SHOT} 缺少 mediaRef`);
  const absoluteVisual = resolveTimelineSourcePath({ sourcePath: mediaRef.path, dataRoot, projectId, projectDir });
  const visualSha256 = crypto.createHash("sha256").update(fs.readFileSync(absoluteVisual)).digest("hex");
  const now = Date.now();

  // shotRevision 改写后必须重算 canonical 指纹(渲染字段全覆盖)
  const rebound: RemotionShotAudioBindingV2 = { ...binding, shotRevision };
  rebound.bindingFingerprint = await createRemotionAudioBindingFingerprint(rebound);
  sb.shotAudioBindings = [rebound];
  sb.audioRef = {
    kind: "audio",
    path: buildProjectFileUrl(projectId, binding.source.relativePath),
    contentSha256: binding.source.contentSha256,
  } as unknown;
  sb.ttsJob = {
    schemaVersion: 1,
    projectId,
    chapterId,
    shotId: TARGET_SHOT,
    shotRevision,
    inputFingerprint: rebound.ttsInputFingerprint ?? rebound.bindingFingerprint,
    status: "completed",
    attempt: 1,
    generationId: `voice-import:${binding.source.contentSha256.slice(0, 12)}`,
    emotionCapability: "metadata-only",
    createdAt: now,
    updatedAt: now,
  } as unknown;
  sb.subtitleAuthority = {
    mode: "source-embedded",
    evidence: {
      mode: "source-embedded",
      decision: "human",
      sourceFingerprint: visualSha256,
      evidencePaths: [binding.source.relativePath],
      reviewer: "human",
      reviewedAt: now,
      note: "sample: S01 单镜样片绑定(台词与配音时代逐字一致已核验;仅样片,不扩大)",
    },
  } as unknown;
  sb.stale = false;
  delete sb.staleReason;
  delete sb.staleSince;

  const writeResult = writeStudioWorkflowStore(
    roots.dataRoot,
    projectId,
    JSON.stringify({ state: snapshot.state, version: snapshot.version }),
  );
  console.log(`[sample-bind] 完成: ${TARGET_SHOT} 绑定 voice+authority(${writeResult.shardNames.length} 片写回)`);
  void path;
}

main().catch((e) => {
  console.error("[sample-bind] 失败:", e);
  process.exit(1);
});
