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
import { readRenderHwSettings, renderChannelOptions } from "@rendering/plugins/remotion/render-hw-mode";import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildChapterVideoCompositionProps } from "@rendering/plugins/remotion/composition/build-composition-props";
import { customFontAbsolutePath } from "@/lib/studio/remotion/custom-font-store";
import { customFontFamilyForId, isCustomSubtitleFontId } from "@/lib/studio/remotion/subtitle-fonts";
import { mergeShotFxEditingEffects } from "@/lib/studio/remotion/shot-fx-decisions";
import { readStudioWorkflowStoreState } from "../timeline/storage-paths";
import type { RemotionChapterManifestV2 } from "@/types/remotion-workspace";

const MA = "/Users/zhengbingjin/Project/IP/MA";
const QUEUE = "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_remotion/queue/queue-state.json";
const CHAPTER_ID = "chapter-001";
const APPS_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps";
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";

/** BGM 节拍近似（08-18-sfx-beat）：ffmpeg 逐帧 RMS 能量包络的局部峰（间距≥0.3s）。
 * manifest 无 bgm 绑定或分析失败时返回空数组（卡点空转，不阻塞渲染）。 */
async function analyzeBgmBeats(manifest: RemotionChapterManifestV2, maRoot: string): Promise<number[]> {
  try {
    const bgm = manifest.sharedAudioBindings.find((b) => b.role === "bgm");
    if (!bgm) return [];
    // bgm 源文件定位：绑定无绝对路径契约（经 bridge），此处以 chapter 音频目录约定兜底。
    const candidates = [
      path.join(maRoot, bgm.source.relativePath),
      path.join(maRoot, "remotion/audio/chapters", path.basename(bgm.bindingId) + ".ogg"),
      path.join(maRoot, "remotion/audio", path.basename(bgm.bindingId) + ".ogg"),
      path.join(maRoot, "remotion/audio/chapters", path.basename(bgm.bindingId)),
    ];
    const file = candidates.find((c) => fs.existsSync(c));
    if (!file) return [];
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("ffmpeg", [
      "-i", file, "-af", "aresample=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
      "-f", "null", "-", "-loglevel", "info",
    ], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    const samples: Array<{ t: number; rms: number }> = [];
    let t = 0;
    for (const m of out.matchAll(/pts_time:(\d+(?:\.\d+)?)[\s\S]*?RMS_level=(-?\d+(?:\.\d+)?)/g)) {
      const rms = Number(m[2]);
      samples.push({ t: t++, rms: Number.isFinite(rms) ? rms : -90 });
    }
    // 未拿到 pts_time 时回退：帧序近似（8000Hz reset=1 逐样本过于密集,退化为无节拍）。
    if (samples.length < 10) return [];
    const frames = samples.map((x) => x.rms);
    const peaks: number[] = [];
    const MIN_GAP = 0.3; // 秒
    let lastPeakT = -MIN_GAP;
    for (let i = 2; i < frames.length - 2; i++) {
      const win = frames.slice(i - 2, i + 3);
      if (frames[i] === Math.max(...win) && frames[i] > -45 && i / 8000 - lastPeakT >= MIN_GAP) {
        const timeS = i / 8000;
        peaks.push(Math.round(timeS * 1_000_000));
        lastPeakT = timeS;
      }
    }
    console.log("bgm beats:", peaks.length);
    return peaks;
  } catch (err) {
    console.warn("bgm beat 分析跳过:", err instanceof Error ? err.message : err);
    return [];
  }
}

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

  // 决策单源重放（08-19 章节色调/字幕音效同源）：与 main.ts 投影同款——
  // store 里分镜 shotFx + workflowConfig.chapterGrade 重新 merge 进 plan.effects
  // （幂等：前缀识别旧 shotFx 条目并替换），钉死色卡时全章统一 grade。
  const sfxCategoryByStoryboardId: Record<string, string> = {};
  try {
    const store = readStudioWorkflowStoreState(MA);
    const storyboards = (store?.state.storyboards ?? []) as Array<{
      id: string; episodeId: string; prompt?: string; line?: string;
      shotFx?: { motion?: unknown; addons?: unknown; grade?: unknown; sfx?: unknown };
    }>;
    const chapterStoryboards = storyboards.filter((storyboard) => storyboard.episodeId === CHAPTER_ID);
    const workflowConfig = store?.state.workflowConfig as
      | { chapterGrade?: { lutId?: unknown; blend?: unknown }; subtitleSfxEnabled?: unknown }
      | undefined;
    let chapterGrade: { lutId: string; blend: number } | undefined;
    if (workflowConfig?.chapterGrade && typeof workflowConfig.chapterGrade.lutId === "string") {
      const blendRaw = Number(workflowConfig.chapterGrade.blend ?? 0.5);
      chapterGrade = {
        lutId: workflowConfig.chapterGrade.lutId,
        blend: Number.isFinite(blendRaw) ? Math.min(1, Math.max(0, blendRaw)) : 0.5,
      };
    }
    const shotFx = mergeShotFxEditingEffects(plan.effects, {
      planClips: plan.clips,
      storyboards: chapterStoryboards,
      ...(chapterGrade ? { chapterGrade } : {}),
    });
    plan.effects = shotFx.effects;
    console.log(`[standalone] shot-fx re-merged: motion ${shotFx.counts.motion}${chapterGrade ? ` | chapterGrade=${chapterGrade.lutId}@${chapterGrade.blend}` : ""}`);
    for (const storyboard of chapterStoryboards) {
      if (typeof storyboard.shotFx?.sfx === "string") {
        sfxCategoryByStoryboardId[storyboard.id] = storyboard.shotFx.sfx;
      }
    }
  } catch (error) {
    console.warn("studio-workflow store 读取失败（grade/sfx 按队列 plan 原样）:", error instanceof Error ? error.message : error);
  }

  const runtimeDir = path.join(USER_DATA, "remotion-runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const bundlePath = path.resolve(process.env.MYSTUDIO_REMOTION_BUNDLE || path.join(APPS_ROOT, ".cache", "remotion-bundle"));
  if (!fs.existsSync(bundlePath)) throw new Error("bundle 不存在: " + bundlePath);

  const mediaBridge = new MediaBridgeServer();
  await mediaBridge.listen();
  const session = mediaBridge.createSession();
  // HY 叠加层（可选）：与镜头素材同会话注册，窗口取自 HY artifact——
  // 时刻必须与 plan 同一时间线（rerender-hy-overlay.ts 按当前 editing 重算）。
  const overlayRevision = Number(process.env.MYSTUDIO_HY_REV ?? 49);
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
    // 成片调色 LUT 资产（08-18-haldclut-grade）：闭集见 composition/cinematic-luts.ts。
    const lutsDir = path.join(APPS_ROOT, "frontend/assets/luts");
    const lutUrlById: Record<string, string> = {};
    if (fs.existsSync(lutsDir)) {
      for (const f of fs.readdirSync(lutsDir).filter((f) => f.endsWith(".png"))) {
        session.register(`lut-${f}`, path.join(lutsDir, f));
      }
      for (const e of mediaBridge.buildUrls(session, fs.readdirSync(lutsDir).filter((f) => f.endsWith(".png")).map((f) => `lut-${f}`))) {
        lutUrlById[e.assetId.slice(4, -4)] = e.url; // lut-<id>.png → <id>
      }
      console.log("luts registered:", Object.keys(lutUrlById).length);
    }
    // 转场音效资产（08-18-sfx-beat，Kenney CC0）：注册后经 sfxUrlById 派生进 audioClips。
    const sfxDir = path.join(APPS_ROOT, "frontend/assets/sfx");
    const sfxUrlById: Record<string, string> = {};
    if (fs.existsSync(sfxDir)) {
      const files = fs.readdirSync(sfxDir).filter((f) => f.endsWith(".ogg"));
      for (const f of files) session.register(`sfx-${f}`, path.join(sfxDir, f));
      for (const e of mediaBridge.buildUrls(session, files.map((f) => `sfx-${f}`))) {
        sfxUrlById[e.assetId.slice(4, -4)] = e.url; // sfx-<name>.ogg → <name>
      }
      console.log("sfx registered:", Object.keys(sfxUrlById).length);
    }
    // BGM 节拍预计算（M11：ffmpeg 能量峰分析——渲染期禁异步 getAudioData）。
    // 当前 chapter 无 bgm 绑定时优雅空转（beatTimesUs 缺省=sfx 落转场时刻）。
    const beatTimesUs = await analyzeBgmBeats(manifest, MA);
    // bgm 绑定注册进 bridge（mediaUrlByBindingId——chapter 投影消费）。
    const mediaUrlByBindingId: Record<string, string> = {};
    for (const b of manifest.sharedAudioBindings) {
      if (b.role !== "bgm") continue;
      const bgmFile = [path.join(MA, "remotion/audio/chapters", path.basename(b.bindingId) + ".ogg"), path.join(MA, b.source.relativePath)].find((c) => fs.existsSync(c));
      if (!bgmFile) { console.warn("bgm 文件缺失:", b.bindingId); continue; }
      session.register(b.bindingId, bgmFile);
      mediaUrlByBindingId[b.bindingId] = mediaBridge.buildUrls(session, [b.bindingId])[0]!.url;
      console.log("bgm registered:", b.bindingId);
    }
    // 图层分离分层资产(08-19):静帧镜自动深度分离(缓存 <MA>/remotion/layers/),
    // 产物注册进 bridge → layerUrlByClipId → LayeredVisualClip 双层视差。
    const layerUrlByClipId: Record<string, { backgroundSrc: string; subjectSrc: string; parallax?: number }> = {};
    const imageClips = plan.clips.filter((c) => c.trackKind === "image");
    for (const clip of imageClips) {
      const dir = path.join(MA, "remotion/layers", CHAPTER_ID, clip.id);
      const bg = path.join(dir, "background.png");
      const subj = path.join(dir, "subject.png");
      try {
        if (!fs.existsSync(bg) || !fs.existsSync(subj)) {
          const srcAbs = mediaSources.find((m) => m.clipId === clip.id)?.absolutePath;
          if (!srcAbs) continue;
          fs.mkdirSync(dir, { recursive: true });
          const { execFileSync } = await import("node:child_process");
          execFileSync("python3",
            ["-m", "layer_separation.separator", "--input", srcAbs, "--subject-out", subj, "--background-out", bg],
            { cwd: path.join(APPS_ROOT, "backend"), env: { ...process.env, HF_HOME: path.join(USER_DATA, "model/depth") }, stdio: ["ignore", "pipe", "inherit"] });
        }
        session.register(`${clip.id}-layer-bg`, bg);
        session.register(`${clip.id}-layer-subj`, subj);
        const [bgUrl, subjUrl] = mediaBridge.buildUrls(session, [`${clip.id}-layer-bg`, `${clip.id}-layer-subj`]).map((e) => e.url);
        layerUrlByClipId[clip.id] = { backgroundSrc: bgUrl, subjectSrc: subjUrl, parallax: 0.5 };
        console.log("layer-sep:", clip.id);
      } catch (e) {
        console.warn("图层分离失败(跳过分层,回退单层):", clip.id, e instanceof Error ? e.message : e);
      }
    }

    const urlEntries = mediaBridge.buildUrls(session, [
      ...mediaSources.map((s) => s.clipId),
      ...(hasOverlay ? ["hyperframes-overlay"] : []),
    ]);
    const mediaUrlByClipId = Object.fromEntries(urlEntries.map((e) => [e.assetId, e.url]));
    const overlayUrl = mediaUrlByClipId["hyperframes-overlay"];

    // 自定义字幕字体（custom:*）：字体文件注册进会话，烧录端 FontFace 挂载。
    let customFontFaces: Array<{ family: string; url: string }> | undefined;
    const customFontId = plan.renderSettings.subtitleFont;
    if (isCustomSubtitleFontId(customFontId)) {
      const fontPath = customFontAbsolutePath(USER_DATA, customFontId);
      if (!fontPath) throw new Error("自定义字体文件缺失: " + customFontId);
      session.register(`custom-font-${customFontId}`, fontPath);
      const fontUrl = mediaBridge.buildUrls(session, [`custom-font-${customFontId}`])[0]!.url;
      customFontFaces = [{ family: customFontFamilyForId(customFontId), url: fontUrl }];
      console.log("customFont:", customFontId, "->", fontPath.split("/").pop());
    }
    const projected = buildChapterVideoCompositionProps({
      plan,
      currentShotSlots: slots,
      chapterManifest: manifest,
      mediaUrlByClipId,
      mediaUrlByBindingId,
      lutUrlById,
      // 字幕驱动音效（08-19 任务3）：sfxUrlById 重启——但只喂字幕派生
      // (subtitleSfxEnabled)，转场派生 transitionSfxEnabled 恒不传（转场≠音效
      // 裁定不变）。MYSTUDIO_SUBTITLE_SFX=1 可强开（验收/调试用）。
      ...(plan.renderSettings.subtitleSfxEnabled === true || process.env.MYSTUDIO_SUBTITLE_SFX === "1"
        ? { sfxUrlById, sfxCategoryByStoryboardId }
        : {}),
      ...(beatTimesUs.length > 0 ? { beatTimesUs } : {}),
      ...(Object.keys(layerUrlByClipId).length > 0 ? { layerUrlByClipId } : {}),
      ...(customFontFaces?.length ? { customFontFaces } : {}),
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
      browserExecutable: (() => {
        return renderChannelOptions(readRenderHwSettings(USER_DATA)).browserExecutable
          ?? (browser as unknown as { executablePath: string }).executablePath;
      })(),
      binariesDirectory: path.join(APPS_ROOT, "node_modules", "@remotion", "compositor-darwin-arm64"),
      chromeMode: "headless-shell", enforceAudioTrack: true, overwrite: true,
      // GL 转场（GLTransitionLayer）进组合后渲染需要 WebGL：默认 headless-shell+
      // swangle（软渲，不传则 BindToCurrentSequence 失败——PoC 实测）；D3 硬件加速
      // 开关（userData/render-hw.json 或 MYSTUDIO_RENDER_HW=1）=系统 Chrome 真 GPU。
      ...(() => {
        const channel = renderChannelOptions(readRenderHwSettings(USER_DATA));
        if (channel.browserExecutable) {
          console.log("render channel: 系统 Chrome(Metal)", channel.browserExecutable);
          return { browserExecutable: channel.browserExecutable, concurrency: 4 };
        }
        return { chromiumOptions: channel.chromiumOptions, concurrency: 2 };
      })(),
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
