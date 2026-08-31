/**
 * 一次性修复(2026-08-28,不入库):SFX 跨代错位回正
 *
 * 背景:batch-shot-sfx 把按「现行 38 镜新代表」sound 描述生成的 SFX,
 * 绑进了「旧代 43 镜 manifest」(r68)——同 id 两代内容不同(如 manifest sb-003
 * =旧#3「误了仙舟」而现行 sb-003=旧#4+5 合并),内容错位。
 *
 * 修复两步:
 * 1. 旧 manifest:剥离全部 sfx 绑定 → r69(音频面回到 r67 状态;错位 sfx 不留雷);
 * 2. store(现行 38 镜新代表):38 条 sfx 绑定的 shotRevision 对齐
 *    Math.max(1, outputVersion) 并重封 bindingFingerprint——供新代出片构建
 *    (chapter-auto-video 以 outputVersion 为 shotRevision,错代 revision 会被硬门拦)。
 *
 * Usage:
 *   cd apps && MYSTUDIO_SFX_REALIGN=1 npx vite-node --config build/timeline/vite-node.config.ts \
 *     build/scripts/sfx-crossgen-realign.ts --project /Users/zhengbingjin/Project/IP/MA
 */
import path from "node:path";
import { RemotionChapterManifestService } from "@rendering/plugins/remotion/manifest/remotion-chapter-manifest-service";
import {
  createRemotionAudioBindingFingerprint,
  createRemotionChapterManifestFingerprint,
} from "@/lib/studio/remotion/remotion-audio-fingerprint";
import type {
  RemotionChapterManifestV2,
  RemotionShotAudioBindingV2,
} from "@/types/remotion-workspace";
import type { StoryboardItem } from "@/types/studio";
import { probeRenderedMedia } from "../remotion/render-smoke-evidence";
import {
  deriveStorageRoots,
  readStudioWorkflowStoreState,
  resolveProjectDir,
} from "../timeline/storage-paths";
import { writeStudioWorkflowStore } from "../../frontend/electron/storage/studio-workflow-store-io";

async function main(): Promise<void> {
  const projectDirArg = process.argv.find((_, i, a) => a[i - 1] === "--project");
  const projectDir = path.resolve(projectDirArg ?? resolveProjectDir());
  const chapterId = "chapter-001";
  const roots = deriveStorageRoots(projectDir);
  const projectId = roots.projectId;

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

  // ── 修一:旧 manifest 剥离 sfx ──
  const current = await manifestService.read(projectId, chapterId);
  if (!current) throw new Error("manifest 不存在");
  const sfxCount = current.shots.reduce(
    (sum, shot) => sum + shot.audioBindings.filter((b) => b.role === "sfx").length, 0);
  console.log(`[realign] manifest r${current.revision} 携带 sfx ${sfxCount} 条`);
  if (sfxCount > 0) {
    const next: RemotionChapterManifestV2 = {
      ...current,
      revision: current.revision + 1,
      updatedAt: Date.now(),
      shots: current.shots.map((shot) => ({
        ...shot,
        audioBindings: shot.audioBindings.filter((b) => b.role !== "sfx"),
      })),
      manifestFingerprint: "",
    };
    next.manifestFingerprint = await createRemotionChapterManifestFingerprint(next);
    const result = await manifestService.writeCas({
      projectId, chapterId, expectedRevision: current.revision, manifest: next,
    });
    if (result.status !== "written") throw new Error(`manifest CAS 失败: ${JSON.stringify(result)}`);
    console.log(`[realign] manifest r${current.revision}→r${next.revision},已剥离全部 sfx`);
  }

  // ── 修二:store 绑定 revision 对齐 + 重封 ──
  const snapshot = readStudioWorkflowStoreState(projectDir);
  if (!snapshot) throw new Error("store 不可读");
  const storyboards = snapshot.state.storyboards as StoryboardItem[];
  let realigned = 0;
  const nextStoryboards = storyboards.map((storyboard) => {
    const sfxBindings = (storyboard.shotAudioBindings ?? []).filter((b) => b.role === "sfx");
    if (sfxBindings.length === 0) return storyboard;
    const shotRevision = Math.max(1, storyboard.outputVersion ?? 1);
    return {
      ...storyboard,
      shotAudioBindings: (storyboard.shotAudioBindings ?? []).map((binding) => {
        if (binding.role !== "sfx" || binding.shotRevision === shotRevision) return binding;
        realigned += 1;
        return { ...binding, shotRevision } as RemotionShotAudioBindingV2;
      }),
    };
  });
  // 重封(指纹覆盖 shotRevision,凡改过必重算)
  let resealed = 0;
  for (const storyboard of nextStoryboards) {
    const bindings = (storyboard.shotAudioBindings ?? []) as RemotionShotAudioBindingV2[];
    for (let i = 0; i < bindings.length; i += 1) {
      const binding = bindings[i];
      if (binding.role !== "sfx") continue;
      const expected = await createRemotionAudioBindingFingerprint(binding);
      if (binding.bindingFingerprint !== expected) {
        binding.bindingFingerprint = expected;
        resealed += 1;
      }
    }
  }
  console.log(`[realign] store:revision 对齐 ${realigned} 条,重封 ${resealed} 条`);
  if (realigned > 0 || resealed > 0) {
    const writeResult = writeStudioWorkflowStore(
      roots.dataRoot,
      projectId,
      JSON.stringify({ state: { ...snapshot.state, storyboards: nextStoryboards }, version: snapshot.version }),
    );
    console.log(`[realign] store 分片写回 ${writeResult.shardNames.length} 片`);
  }
  console.log("[realign] 完成");
}

main().catch((error: unknown) => {
  console.error("[realign] 失败:", error);
  process.exit(1);
});
