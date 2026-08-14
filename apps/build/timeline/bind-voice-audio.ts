/**
 * Bind exported per-shot TTS voice audio into the chapter manifest.
 *
 * The chapter-001 automation writes per-shot TTS wav files to
 * `exports/<chapterId>/voice-audio/shot-XXX.wav` but never binds them into the
 * Remotion chapter manifest, so StoryboardShot renders stay silent and the
 * final ChapterVideo render produces a silent film. This script closes that
 * gap through the canonical service path:
 *
 *   1. RemotionChapterManifestService.importAudio() copies each wav into the
 *      project-managed `remotion/audio/...` tree (SHA-addressed, CAS).
 *   2. Each shot gets a `voice` RemotionShotAudioBindingV2 built with the same
 *      semantics as `createStoryboardVoiceBinding` (fingerprint included), and
 *      shot durationUs extends to voiceEnd + 400ms like the shot-plan builder.
 *   3. writeCas() persists manifest revision+1 with full structural +
 *      fingerprint + audio-bytes validation.
 *
 * Usage:
 *   npx vite-node --config build/timeline/vite-node.config.ts build/timeline/bind-voice-audio.ts
 */
import fs from "node:fs";
import path from "node:path";
import { RemotionChapterManifestService } from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service";
import { probeRenderedMedia } from "../remotion/render-smoke-evidence";
import { sha256CanonicalJson } from "@/lib/studio/remotion/canonical-json";
import {
  createRemotionAudioBindingFingerprint,
  createRemotionChapterManifestFingerprint,
} from "@/lib/studio/remotion/remotion-audio-fingerprint";
import type {
  RemotionChapterManifestV2,
  RemotionShotAudioBindingV2,
} from "@/types/remotion-workspace";
import { deriveStorageRoots, resolveProjectDir } from "./storage-paths";

const VOICE_TAIL_PAD_US = 400_000;
const args = process.argv.slice(2);
const voiceDirOverride = args.find((a) => a.startsWith("--voice-dir="))?.slice("--voice-dir=".length);

async function main(): Promise<void> {
  const projectDir = resolveProjectDir();
  const roots = deriveStorageRoots(projectDir);
  const projectId = roots.projectId;
  const dataRoot = roots.dataRoot;
  const chapterId = process.env.MYSTUDIO_CHAPTER_ID ?? "chapter-001";

  const manifestService = new RemotionChapterManifestService({
    projectRootForProject: (pid: string) => path.join(dataRoot, "_p", pid),
    probeMedia: async (filePath: string) => {
      const probe = await probeRenderedMedia(filePath);
      return { durationUs: Math.round(probe.duration * 1_000_000), streams: probe.streams };
    },
  });

  const current = await manifestService.read(projectId, chapterId);
  if (!current) throw new Error(`chapter manifest 不存在: ${projectId}/${chapterId}`);
  console.log(`[bind-voice] manifest revision ${current.revision}, shots: ${current.shots.length}`);

  const existingVoice = current.shots.filter((shot) =>
    shot.audioBindings.some((binding) => binding.role === "voice"));
  if (existingVoice.length > 0) {
    throw new Error(`已有 ${existingVoice.length} 个 shot 带 voice binding，拒绝重复绑定（先回滚 manifest 或人工处理）`);
  }

  const voiceDir = voiceDirOverride
    ?? path.join(projectDir, "exports", chapterId, "voice-audio");
  if (!fs.existsSync(voiceDir)) throw new Error(`voice 目录不存在: ${voiceDir}`);

  const nextShots: RemotionChapterManifestV2["shots"] = [];
  for (const shot of current.shots) {
    const wavPath = path.join(voiceDir, `shot-${String(shot.index).padStart(3, "0")}.wav`);
    if (!fs.existsSync(wavPath)) {
      throw new Error(`shot ${shot.shotId} (index ${shot.index}) 缺少 voice wav: ${wavPath}`);
    }
    const imported = await manifestService.importAudio({
      projectId,
      chapterId,
      shotId: shot.shotId,
      role: "voice",
      sourcePath: wavPath,
    });
    const ttsInputFingerprint = await sha256CanonicalJson({
      schemaVersion: 1,
      kind: "exported-voice-import",
      projectId,
      chapterId,
      shotId: shot.shotId,
      audioContentSha256: imported.source.contentSha256,
    });
    const binding: RemotionShotAudioBindingV2 = {
      schemaVersion: 2,
      bindingId: `voice:${shot.shotId}:${ttsInputFingerprint}`,
      bindingFingerprint: "0".repeat(64),
      renderScope: "shot",
      projectId,
      chapterId,
      shotId: shot.shotId,
      shotRevision: shot.revision,
      role: "voice",
      source: imported.source,
      sourceFingerprint: imported.source.contentSha256,
      sourceDurationUs: imported.durationUs,
      sourceStartUs: 0,
      shotStartUs: 0,
      durationUs: imported.durationUs,
      volume: 1,
      fadeInUs: 0,
      fadeOutUs: 0,
      envelope: [{ timeUs: 0, gain: 1 }],
      ttsInputFingerprint,
    };
    binding.bindingFingerprint = await createRemotionAudioBindingFingerprint(binding);
    // 与 remotion-shot-plan-builder 相同的时长语义：视觉时长不得短于 voice + 400ms 尾垫。
    const voiceEndUs = binding.shotStartUs + binding.durationUs;
    const durationUs = Math.max(shot.durationUs, voiceEndUs + VOICE_TAIL_PAD_US);
    nextShots.push({
      ...shot,
      durationUs,
      audioBindings: [...shot.audioBindings, binding],
    });
    console.log(
      `  [bind-voice] ${shot.shotId}: voice=${(imported.durationUs / 1e6).toFixed(2)}s ` +
      `shot ${shot.durationUs / 1e6}s → ${durationUs / 1e6}s`,
    );
  }

  const next: RemotionChapterManifestV2 = {
    ...current,
    revision: current.revision + 1,
    shots: nextShots,
    updatedAt: Date.now(),
  };
  next.manifestFingerprint = await createRemotionChapterManifestFingerprint(next);

  const result = await manifestService.writeCas({
    projectId,
    chapterId,
    expectedRevision: current.revision,
    manifest: next,
  });
  console.log(`[bind-voice] manifest written: revision ${result.revision}, fingerprint ${result.manifestFingerprint.slice(0, 16)}...`);
  const extended = nextShots.filter((shot, i) => shot.durationUs !== current.shots[i]!.durationUs).length;
  console.log(`[bind-voice] 完成: ${nextShots.length} bindings, ${extended} 镜延长时长`);
}

main().catch((error) => {
  console.error("[bind-voice] 失败:", error);
  process.exit(1);
});
