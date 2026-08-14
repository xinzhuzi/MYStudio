/**
 * Bind the exported chapter voice audio onto the persisted studio storyboards.
 *
 * render-shot-slots.ts compiles shot plans from `studio-workflow-store.json`
 * storyboards (NOT from the chapter manifest — it rewrites the manifest from
 * the storyboards). Baking voice into StoryboardShot renders therefore
 * requires each storyboard to carry:
 *
 *   - shotAudioBindings: the canonical voice RemotionShotAudioBindingV2
 *   - audioRef: the exact project-file mirror of the binding source
 *   - ttsJob: a completed job matching the binding's ttsInputFingerprint
 *   - subtitleAuthority: source-embedded evidence (43 张分镜图自带字幕)
 *   - stale cleared (voice import does not invalidate visuals)
 *
 * Bindings are read from the chapter manifest revision written by
 * bind-voice-audio.ts so the two stores never drift apart.
 *
 * Usage:
 *   npx vite-node --config build/timeline/vite-node.config.ts build/timeline/update-storyboards-voice.ts
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RemotionChapterManifestService } from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service";
import { probeRenderedMedia } from "../remotion/render-smoke-evidence";
import type {
  RemotionShotAudioBindingV2,
  RemotionChapterManifestV2,
} from "@/types/remotion-workspace";
import type { StoryboardItem, StoryboardTtsJobV1 } from "@/types/studio";
import { deriveStorageRoots, resolveProjectDir, resolveTimelineSourcePath } from "./storage-paths";

function toProjectFileUrl(projectId: string, relativePath: string): string {
  return `project-file://${encodeURIComponent(projectId)}/${relativePath
    .split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

async function main(): Promise<void> {
  const projectDir = resolveProjectDir();
  const roots = deriveStorageRoots(projectDir);
  const projectId = roots.projectId;
  const dataRoot = roots.dataRoot;
  const chapterId = process.env.MYSTUDIO_CHAPTER_ID ?? "chapter-001";

  // Bindings source of truth: manifest revision written by bind-voice-audio.ts.
  const manifestService = new RemotionChapterManifestService({
    projectRootForProject: (pid: string) => path.join(dataRoot, "_p", pid),
    probeMedia: async (filePath: string) => {
      const probe = await probeRenderedMedia(filePath);
      return { durationUs: Math.round(probe.duration * 1_000_000), streams: probe.streams };
    },
  });
  const manifest = await manifestService.read(projectId, chapterId) as RemotionChapterManifestV2;
  if (!manifest) throw new Error("chapter manifest 不存在，先运行 bind-voice-audio.ts");
  const bindingByShotId = new Map<string, RemotionShotAudioBindingV2>();
  for (const shot of manifest.shots) {
    const voice = shot.audioBindings.find((binding) => binding.role === "voice");
    if (!voice) throw new Error(`manifest shot ${shot.shotId} 缺少 voice binding，先运行 bind-voice-audio.ts`);
    bindingByShotId.set(shot.shotId, voice);
  }

  const storePath = path.join(projectDir, "studio-workflow-store.json");
  const store = JSON.parse(fs.readFileSync(storePath, "utf8")) as {
    state?: { storyboards?: StoryboardItem[] };
    storyboards?: StoryboardItem[];
  };
  const state = store.state ?? store;
  const storyboards = state.storyboards;
  if (!Array.isArray(storyboards)) throw new Error(`${storePath} 缺少 storyboards 数组`);

  const backupPath = `${storePath}.bak-voice-${Date.now()}`;
  fs.copyFileSync(storePath, backupPath);
  console.log(`[voice-storyboard] store 备份 → ${backupPath}`);

  const now = Date.now();
  let updated = 0;
  const note = "source-embedded: 分镜图内嵌字幕（chapter-001 r8 authority 复核口径）";
  for (const storyboard of storyboards) {
    if (storyboard.episodeId !== chapterId) continue;
    const binding = bindingByShotId.get(storyboard.id);
    if (!binding) throw new Error(`storyboard ${storyboard.id} 在 manifest 中没有对应 shot`);
    const shotRevision = Math.max(1, storyboard.outputVersion ?? 1);
    if (binding.shotRevision !== shotRevision) {
      throw new Error(`${storyboard.id}: binding shotRevision ${binding.shotRevision} ≠ storyboard revision ${shotRevision}`);
    }
    const mediaRef = storyboard.mediaRef;
    if (!mediaRef?.path) throw new Error(`${storyboard.id} 缺少 mediaRef`);
    const absoluteVisual = resolveTimelineSourcePath({
      sourcePath: mediaRef.path,
      dataRoot,
      mediaRoot: roots.mediaRoot,
    });
    const visualSha256 = mediaRef.contentSha256
      ?? crypto.createHash("sha256").update(fs.readFileSync(absoluteVisual)).digest("hex");
    const ttsJob: StoryboardTtsJobV1 = {
      schemaVersion: 1,
      projectId,
      chapterId,
      shotId: storyboard.id,
      shotRevision,
      inputFingerprint: binding.ttsInputFingerprint ?? binding.bindingFingerprint,
      status: "completed",
      attempt: 1,
      generationId: `voice-import:${binding.source.contentSha256.slice(0, 12)}`,
      emotionCapability: "metadata-only",
      createdAt: now,
      updatedAt: now,
    };
    storyboard.shotAudioBindings = [binding];
    storyboard.audioRef = {
      kind: "audio",
      path: toProjectFileUrl(projectId, binding.source.relativePath),
      contentSha256: binding.source.contentSha256,
    };
    storyboard.ttsJob = ttsJob;
    storyboard.subtitleAuthority = {
      mode: "source-embedded",
      evidence: {
        mode: "source-embedded",
        decision: "human",
        sourceFingerprint: visualSha256,
        evidencePaths: [binding.source.relativePath],
        reviewer: "human",
        reviewedAt: now,
        note,
      },
    };
    storyboard.stale = false;
    delete storyboard.staleReason;
    delete storyboard.staleSince;
    updated += 1;
  }
  if (updated !== bindingByShotId.size) {
    throw new Error(`更新的 storyboard 数 ${updated} ≠ manifest bindings ${bindingByShotId.size}`);
  }
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  console.log(`[voice-storyboard] 完成: ${updated} 个 storyboard 绑定 voice + authority + ttsJob，stale 已清除`);
}

main().catch((error) => {
  console.error("[voice-storyboard] 失败:", error);
  process.exit(1);
});
