/**
 * 无手术验证（08-18 五缺口修复回归工具）：
 * 用 MA 项目真实 r47 video-use 产物 + 真实 Remotion 槽位，重建「手术前」的
 * 坏 EditingProject（无身份证据/无字幕归属/相对路径），走新产品投影链路
 * （authority 回退 + slot 身份合并 + 槽位路径优先）→ 编译计划 → 组合校验。
 * 修复前此链路在组合层 fail-closed（字幕归属未知 / 缺 job 身份 / EDL 派生证据）。
 * 运行: cd apps && npx vite-node --config build/timeline/vite-node.config.ts build/scripts/verify-projection-no-surgery.ts
 */
import fs from "node:fs";
import path from "node:path";
import { validateVideoUseChapterArtifact } from "@rendering/contracts/video-workflow";
import { projectVideoUseArtifactToEditingProject } from "@/lib/studio/video-workflow/editing-project-projection";
import { compileTimelineRenderPlan } from "@/lib/studio/editing/timeline-render-compiler";
import { mergeShotFxEditingEffects } from "@/lib/studio/remotion/shot-fx-decisions";
import { readRemotionCurrentShotSlotsFromWorkspace } from "@/lib/studio/remotion/remotion-current-slot";
import { buildChapterVideoCompositionProps } from "@rendering/plugins/remotion/composition/build-composition-props";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import type { EditingProjectV1 } from "@/types/editing";
import type { RemotionChapterManifestV2 } from "@/types/remotion-workspace";

const MA = "/Users/zhengbingjin/Project/IP/MA";
const PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec4";
const CHAPTER_ID = "chapter-001";
const ARTIFACT_PATH = path.join(MA, "video-use", CHAPTER_ID, "r47", "video-use-artifact.json");

async function main() {
  const artifactRaw = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
  const hadPersistedAuthority = Boolean((artifactRaw as { subtitleAuthority?: unknown }).subtitleAuthority);
  // r47 产物文件被 08-17 数据手术注入过 authority——剥掉以真正锻炼「无 authority
  // 产物」的回退路径（等价于全新 video-use 产物的原生状态）。
  delete (artifactRaw as { subtitleAuthority?: unknown }).subtitleAuthority;
  const checked = validateVideoUseChapterArtifact(artifactRaw);
  if (!checked.success) throw new Error("r47 产物校验失败: " + checked.issues.map((i) => `${i.path}: ${i.message}`).join("；"));
  const artifact = checked.value;
  console.log("r47 产物: mode =", artifact.mode, "| shots =", artifact.edl.length, "| 原文件带 authority =", hadPersistedAuthority, "(已剥除,锻炼回退)");

  const slots = await readRemotionCurrentShotSlotsFromWorkspace(path.join(MA, "remotion"), PROJECT_ID, CHAPTER_ID);
  console.log("真实槽位:", slots.length);

  // r47 是转场钳制(08-18 上午)之前的旧产物——模拟今日 adapter 行为，把
  // 转场重叠钳到上一镜语音结束后的静默尾（与 adapter.py/数据手术同口径）。
  const manifestForClamp = JSON.parse(fs.readFileSync(path.join(MA, "remotion/chapters", `${CHAPTER_ID}.json`), "utf8")) as RemotionChapterManifestV2;
  const voiceEndByShotId = new Map<string, number>();
  for (const shot of manifestForClamp.shots) {
    voiceEndByShotId.set(shot.storyboardId, Math.max(
      0,
      ...shot.audioBindings.map((b) => b.shotStartUs + b.durationUs),
    ));
  }
  let clamped = 0;
  for (const entry of artifact.edl) {
    const transition = entry.transitionToNext;
    if (!transition || transition.effectId === "cut") continue;
    const voiceEnd = voiceEndByShotId.get(entry.shotId) ?? 0;
    const tailUs = Math.round(entry.durationS * 1_000_000) - Math.round(voiceEnd * 1_000);
    if (tailUs < 200_000) {
      delete entry.transitionToNext;
      clamped += 1;
      continue;
    }
    const safe = Math.min(transition.durationUs, tailUs);
    if (safe < transition.durationUs) {
      transition.durationUs = safe;
      clamped += 1;
    }
  }
  console.log("转场钳制(模拟今日 adapter):", clamped, "处");

  // 重建「手术前」坏状态：以现 rev5 为基线回退身份与归属。
  const editing = JSON.parse(fs.readFileSync(path.join(MA, "editing.json"), "utf8"));
  const current = list(editing)[0] as EditingProjectV1;
  const broken: EditingProjectV1 = JSON.parse(JSON.stringify(current));
  broken.revision = 46; // r47 必须作为下一 revision 应用
  const textTrackIds = new Set(broken.tracks.filter((t) => t.kind === "text").map((t) => t.id));
  broken.clips = broken.clips.filter((c) => {
    if (textTrackIds.has(c.trackId)) return false; // 投影会重建字幕轨
    if (c.trackId.endsWith("main-visual")) {
      const evidence = c.source.evidence as Record<string, unknown>;
      delete evidence.remotionJobId;
      delete evidence.remotionEvidenceSha256;
      delete evidence.outputVersion;
      delete evidence.subtitleAuthority;
      c.source.path = path.join(MA, "remotion", `outputs/shots/${evidence.storyboardId}/current.mp4`); // 旧相对路径形态
      return true;
    }
    return true;
  });
  broken.tracks = broken.tracks.filter((t) => !textTrackIds.has(t.id));
  broken.transitions = [];
  broken.renderSettings = { ...broken.renderSettings, subtitleMode: "none" };
  console.log("坏状态基线: rev", broken.revision, "| visual =", broken.clips.filter((c) => c.trackId.endsWith("main-visual")).length, "| subtitleMode =", broken.renderSettings.subtitleMode);

  // —— 新产品链路 ——
  const projected = projectVideoUseArtifactToEditingProject({ project: broken, artifact, now: Date.now(), shotSlots: slots });
  if (!projected.success) throw new Error("投影失败: " + projected.issues.map((i) => `${i.path}: ${i.message}`).join("；"));
  const project = projected.project;
  const visual = project.clips.filter((c) => c.source.kind === "storyboardVideo");
  const withIdentity = visual.filter((c) => c.source.evidence.remotionJobId && c.source.evidence.subtitleAuthority);
  console.log(`投影后: rev ${project.revision} | visual ${visual.length} | 带身份+归属 ${withIdentity.length} | subtitleMode = ${project.renderSettings.subtitleMode}`);

  const compiledResult = compileTimelineRenderPlan(project, { jobId: `verify-no-surgery`, createdAt: 1 });
  if (!compiledResult.success) throw new Error("计划编译失败: " + compiledResult.issues.map((i) => `${i.path}: ${i.message}`).join("；"));
  const compiled = compiledResult.value;
  // shotFx 合并：分片 store(与 craft-chapter-job 同口径)
  const shardDir = path.join(
    fs.existsSync(path.join(MA, "store")) ? path.join(MA, "store") : MA,
    "studio-workflow",
  );
  const storyboards: unknown[] = [];
  for (const shard of fs.readdirSync(shardDir).filter((f) => f.startsWith("storyboards-") && f.endsWith(".json"))) {
    const d = JSON.parse(fs.readFileSync(path.join(shardDir, shard), "utf8"));
    const list = (d.state ?? d).storyboards ?? (Array.isArray(d) ? d : []);
    if (Array.isArray(list)) storyboards.push(...list);
  }
  const merged = mergeShotFxEditingEffects(compiled.effects, {
    planClips: compiled.clips as never,
    storyboards: storyboards as never,
  });
  const plan = { ...compiled, effects: merged.effects };

  const manifest = JSON.parse(fs.readFileSync(path.join(MA, "remotion/chapters", `${CHAPTER_ID}.json`), "utf8")) as RemotionChapterManifestV2;
  const bridge = new MediaBridgeServer();
  await bridge.listen();
  const session = bridge.createSession();
  try {
    const resolveMedia = (p: string) => path.isAbsolute(p)
      ? p
      : p.startsWith("remotion/")
        ? path.join(MA, p)
        : path.join(MA, "remotion", p); // slot.outputPath 相对 remotion 工作区根
    const mediaClips = plan.clips.filter((c) => c.trackKind === "video" || c.trackKind === "image");
    for (const clip of mediaClips) {
      session.register(clip.id, resolveMedia(clip.source.path!));
    }
    const urls = bridge.buildUrls(session, mediaClips.map((c) => c.id));
    const projected2 = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: slots,
      chapterManifest: manifest,
      mediaUrlByClipId: Object.fromEntries(urls.map((e) => [e.assetId, e.url])),
      mediaUrlByBindingId: {},
    } as never);
    if (!projected2.success) throw new Error("组合校验失败:\n  " + projected2.issues.map((i) => `${i.path}: ${i.message}`).join("\n  "));
    console.log(`✅ 无手术链路全通: 组合时长 ${projected2.value.durationInFrames} 帧 | 字幕 ${projected2.value.subtitles.length} 条 | visualClips ${projected2.value.visualClips.length}`);
  } finally {
    await bridge.close?.().catch?.(() => {}) ?? bridge.stop?.();
  }
}

function list(editing: { state: { editingProjects: Record<string, EditingProjectV1> } }): EditingProjectV1[] {
  return Object.values(editing.state.editingProjects);
}

void main();
