/**
 * 章节独立渲染（无应用进程，免疫并行清场）——字幕修复版出品工具。
 * 输入=queue-state.json 里最新铸造的 chapter 条目(plan+slots)+章节 manifest；
 * 组合=buildChapterVideoCompositionProps(与队列渲染器同款,无 overlay)；
 * 渲染=@remotion/renderer renderMedia(crf16/slow, headless-shell, 禁隐式下载)。
 * 运行: vite-node --config build/timeline/vite-node.config.ts build/scripts/render-chapter-standalone.ts
 */
import fs from "node:fs";
import path from "node:path";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildChapterVideoCompositionProps } from "@rendering/plugins/remotion/composition/build-composition-props";
import type { RemotionChapterManifestV2 } from "@/types/remotion-workspace";

const MA = "/Users/zhengbingjin/Project/IP/MA";
const QUEUE = "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_remotion/queue/queue-state.json";
const CHAPTER_ID = "chapter-001";
const APPS_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps";
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";

async function main() {
  const q = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
  const jobs = (q as { jobs?: unknown[] }).jobs ?? (q as { state?: { jobs?: unknown[] } }).state!.jobs!;
  const entry = (jobs as Array<{ job: { target?: { kind?: string } }; plan?: unknown; currentShotSlots?: unknown[] }>)
    .filter((it) => it.job.target?.kind === "chapter").pop();
  if (!entry?.plan || !entry.currentShotSlots) throw new Error("无铸造的 chapter 条目");
  const plan = entry.plan as never as import("@/types/editing").TimelineRenderPlan;
  const slots = entry.currentShotSlots as never;
  console.log("plan.effects:", plan.effects.length, "| text clips:", plan.clips.filter((c) => c.trackKind === "text").length,
    "| subtitleMode:", plan.renderSettings.subtitleMode);

  const manifest = JSON.parse(
    fs.readFileSync(path.join(MA, "remotion/chapters", CHAPTER_ID + ".json"), "utf8"),
  ) as RemotionChapterManifestV2;

  const remotionVersion = "4.0.499";
  const runtimeDir = path.join(USER_DATA, "remotion-runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const bundlePath = path.resolve(process.env.MYSTUDIO_REMOTION_BUNDLE || path.join(APPS_ROOT, ".cache", "remotion-bundle"));
  if (!fs.existsSync(bundlePath)) throw new Error("bundle 不存在: " + bundlePath);

  const mediaBridge = new MediaBridgeServer();
  await mediaBridge.listen();
  const session = mediaBridge.createSession();
  // HY 叠加层（可选）：与镜头素材同会话注册，窗口取自 HY artifact——
  // 时刻必须与 plan 同一时间线（rerender-hy-overlay.ts 按当前 editing 重算）。
  const overlayRevision = Number(process.env.MYSTUDIO_HY_REV ?? 48);
  const overlayDir = path.join(MA, "video-use", CHAPTER_ID, `r${overlayRevision}`);
  const overlayMov = path.join(overlayDir, "hyperframes-overlay.mov");
  const overlayArtifactPath = path.join(overlayDir, "hyperframes-artifact.json");
  const hasOverlay = fs.existsSync(overlayMov) && fs.existsSync(overlayArtifactPath);
  const overlayWindows = hasOverlay
    ? (JSON.parse(fs.readFileSync(overlayArtifactPath, "utf8")) as { windows: unknown[] }).windows
    : [];
  console.log("hyperframes overlay:", hasOverlay ? `r${overlayRevision} (${overlayWindows.length} windows)` : "无");
  const outputPath = path.join(MA, "remotion/outputs/chapters", CHAPTER_ID, "current.mp4");
  const staged = outputPath + ".staged.mp4";

  const prevCwd = process.cwd();
  process.chdir(runtimeDir);
  try {
    const browser = await ensureBrowser({ browserExecutable: undefined, chromiumOptions: {}, forceDeviceScaleFactor: undefined, allowFallback: true, onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); } } as never);
    const mediaSources = plan.clips
      .filter((clip) => clip.trackKind === "video" || clip.trackKind === "image")
      .map((clip) => {
        const evd = (clip.source as { evidence?: { storyboardId?: string } }).evidence;
        const sid = evd?.storyboardId;
        const slot = (slots as Array<{ target?: { kind?: string; shotId?: string }; evidence?: { outputPath?: string } }>)
          .find((s) => s.target?.kind === "shot" && s.target.shotId === sid);
        if (!slot?.evidence?.outputPath) throw new Error(`缺槽位输出: ${sid}`);
        return { clipId: clip.id, absolutePath: path.join(MA, "remotion", slot.evidence.outputPath) };
      });
    for (const src of mediaSources) session.register(src.clipId, src.absolutePath);
    if (hasOverlay) session.register("hyperframes-overlay", overlayMov);
    const urlEntries = mediaBridge.buildUrls(session, [
      ...mediaSources.map((s) => s.clipId),
      ...(hasOverlay ? ["hyperframes-overlay"] : []),
    ]);
    const mediaUrlByClipId = Object.fromEntries(urlEntries.map((e) => [e.assetId, e.url]));
    const overlayUrl = mediaUrlByClipId["hyperframes-overlay"];

    const projected = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: slots,
      chapterManifest: manifest,
      mediaUrlByClipId,
      mediaUrlByBindingId: {},
      ...(hasOverlay && overlayUrl ? { hyperFramesOverlay: { src: overlayUrl, windows: overlayWindows } } : {}),
    } as never);
    if (!projected.success) throw new Error("composition 失败: " + projected.issues.map((i) => `${i.path}: ${i.message}`).join("；"));
    const props = projected.value;
    console.log("subtitles:", props.subtitles.length, "| visualClips:", props.visualClips.length,
      "| overlayClips:", props.overlayClips?.length ?? 0, "| duration:", props.durationInFrames, "frames");

    const composition = await selectComposition({ serveUrl: bundlePath, id: "ChapterVideo", inputProps: props as never });
    const t0 = Date.now();
    await renderMedia({
      serveUrl: bundlePath, composition, inputProps: props as never, outputLocation: staged,
      codec: "h264", pixelFormat: "yuv420p", audioCodec: "aac", crf: 16, x264Preset: "slow",
      browserExecutable: (browser as unknown as { executablePath: string }).executablePath,
      binariesDirectory: path.join(APPS_ROOT, "node_modules", "@remotion", "compositor-darwin-arm64"),
      chromeMode: "headless-shell", enforceAudioTrack: true, overwrite: true,
      onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); },
    } as never);
    fs.copyFileSync(staged, outputPath);
    fs.rmSync(staged, { force: true });
    console.log("✅ 渲染完成:", outputPath, `(${((Date.now() - t0) / 1000).toFixed(0)}s)`, (fs.statSync(outputPath).size / 1e6).toFixed(1) + "MB");
  } finally {
    process.chdir(prevCwd);
    await mediaBridge.close?.().catch?.(() => {}) ?? mediaBridge.stop?.();
  }
}

void main();
