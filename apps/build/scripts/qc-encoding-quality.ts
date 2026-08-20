/**
 * 渲染后自动编码质量 QC（Trellis 08-18-effect-upgrade）。
 * 在成片输出后自动执行：渲 N 帧无损参考 → 与 h264 解码帧比对 → PSNR/SSIM 报告。
 *
 * 用法:
 *   独立跑: npx vite-node --config build/timeline/vite-node.config.ts build/scripts/qc-encoding-quality.ts
 *   接渲染链: 在 render-chapter-standalone.ts 渲完后 require 本模块
 *
 * 门禁: PSNR 均值 < 30dB 或 SSIM < 0.90 → exit 1(失败)
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureBrowser, selectComposition, renderStill } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { buildChapterVideoCompositionProps } from "@rendering/plugins/remotion/composition/build-composition-props";
import { mergeShotFxEditingEffects } from "@/lib/studio/remotion/shot-fx-decisions";
import { readStudioWorkflowStoreState } from "../timeline/storage-paths";

const MA = "/Users/zhengbingjin/Project/IP/MA";
const QUEUE = "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_remotion/queue/queue-state.json";
const APPS_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps";
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const OUT_MP4 = path.join(MA, "remotion/outputs/chapters/chapter-001/current.mp4");
const REPORT_PATH = path.join(MA, "remotion/outputs/chapters/chapter-001/qc-encoding-report.json");

/** 抽样帧位置(均匀覆盖+关键点:转场/LUT/结尾) */
function sampleFrames(durationInFrames: number): number[] {
  const positions = [0.05, 0.15, 0.30, 0.45, 0.60, 0.75, 0.90, 0.98];
  return positions.map((p) => Math.round(durationInFrames * p));
}

const PSNR_FLOOR = 30; // dB — 低于此值=编码质量问题
const SSIM_FLOOR = 0.90; // 低于此值=结构性失真

/** 队列/plan/slot 的最小结构形状(只声明本脚本用到的字段) */
interface QcClip { id: string; trackKind?: string; source?: { evidence?: { storyboardId?: string } } }
interface QcPlan { clips: QcClip[] }
interface QcSlot { target?: { kind?: string; shotId?: string }; evidence: { outputPath: string } }
interface QcEntry { job?: { target?: { kind?: string } }; plan: QcPlan; currentShotSlots: QcSlot[] }

export async function runEncodingQc(): Promise<{ pass: boolean; report: object }> {
  const t0 = Date.now();
  // ── 构造 props(与 standalone 渲染器同款) ──
  const q = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
  const jobs = (q as { jobs?: QcEntry[] }).jobs ?? (q as { state?: { jobs?: QcEntry[] } }).state!.jobs!;
  const entry = jobs.filter((j) => j?.job?.target?.kind === "chapter").pop();
  const plan = entry.plan;
  const slots = entry.currentShotSlots;
  const manifest = JSON.parse(fs.readFileSync(path.join(MA, "remotion/chapters/chapter-001.json"), "utf8"));
  // 决策单源重merge(08-20 补,与 render-chapter-standalone 同款):QC 参考帧必须
  // 复刻渲染链的 store 决策(storyboards shotFx + workflowConfig.chapterGrade 钉死),
  // 否则参考与成片在 grade 覆盖面上错位 → 全片 ~20dB 假性色差(帧 3961 单镜
  // 偶合通过 42dB 的实测定位)。
  try {
    const store = readStudioWorkflowStoreState(MA);
    const storyboards = ((store?.state.storyboards ?? []) as unknown[]).filter(
      (sb) => (sb as { episodeId?: string }).episodeId === "chapter-001",
    );
    const workflowConfig = store?.state.workflowConfig as
      | { chapterGrade?: { lutId?: unknown; blend?: unknown } }
      | undefined;
    let chapterGrade: { lutId: string; blend: number } | undefined;
    if (workflowConfig?.chapterGrade && typeof workflowConfig.chapterGrade.lutId === "string") {
      const blendRaw = Number(workflowConfig.chapterGrade.blend ?? 0.5);
      chapterGrade = {
        lutId: workflowConfig.chapterGrade.lutId,
        blend: Number.isFinite(blendRaw) ? Math.min(1, Math.max(0, blendRaw)) : 0.5,
      };
    }
    const merged = mergeShotFxEditingEffects(plan.effects, {
      planClips: plan.clips as never,
      storyboards: storyboards as never,
      ...(chapterGrade ? { chapterGrade } : {}),
    });
    plan.effects = merged.effects;
  } catch (err) {
    console.warn("[QC] store 决策重merge失败(按队列 plan 原样):", err instanceof Error ? err.message : err);
  }

  const mediaBridge = new MediaBridgeServer();
  await mediaBridge.listen();
  const session = mediaBridge.createSession();
  const mediaSources = plan.clips
    .filter((c) => c.trackKind === "video" || c.trackKind === "image")
    .map((c) => {
      const sid = c.source?.evidence?.storyboardId;
      const slot = slots.find((s) => s.target?.kind === "shot" && s.target.shotId === sid);
      return { clipId: c.id, absolutePath: path.join(MA, "remotion", slot.evidence.outputPath) };
    });
  for (const src of mediaSources) session.register(src.clipId, src.absolutePath);

  const lutsDir = path.join(APPS_ROOT, "frontend/assets/luts");
  const lutUrlById: Record<string, string> = {};
  const lutFiles = fs.existsSync(lutsDir) ? fs.readdirSync(lutsDir).filter((f: string) => f.endsWith(".png")) : [];
  for (const f of lutFiles) session.register(`lut-${f}`, path.join(lutsDir, f));
  for (const e of mediaBridge.buildUrls(session, lutFiles.map((f: string) => `lut-${f}`))) {
    lutUrlById[e.assetId.slice(4, -4)] = e.url;
  }

  const mediaUrlByBindingId: Record<string, string> = {};
  for (const b of manifest.sharedAudioBindings ?? []) {
    if (b.role !== "bgm") continue;
    const bgmFile = [path.join(MA, "remotion/audio/chapters", path.basename(b.bindingId) + ".ogg"), path.join(MA, b.source?.relativePath ?? "")].find((f: string) => fs.existsSync(f));
    if (bgmFile) {
      session.register(b.bindingId, bgmFile);
      mediaUrlByBindingId[b.bindingId] = mediaBridge.buildUrls(session, [b.bindingId])[0].url;
    }
  }

  const overlayMov = path.join(MA, "video-use/chapter-001/r49/hyperframes-overlay.mov");
  const overlayArt = path.join(MA, "video-use/chapter-001/r49/hyperframes-artifact.json");
  const hasOverlay = fs.existsSync(overlayMov) && fs.existsSync(overlayArt);
  const overlayWindows = hasOverlay ? (JSON.parse(fs.readFileSync(overlayArt, "utf8")).windows ?? []) : [];
  if (hasOverlay) session.register("hyperframes-overlay", overlayMov);
  const allUrls = mediaBridge.buildUrls(session, [...mediaSources.map((s) => s.clipId), ...(hasOverlay ? ["hyperframes-overlay"] : [])]);
  const mediaUrlByClipId = Object.fromEntries(allUrls.map((e) => [e.assetId, e.url]));

  const projected = buildChapterVideoCompositionProps({
    plan, currentShotSlots: slots, chapterManifest: manifest,
    mediaUrlByClipId, mediaUrlByBindingId,
    ...(Object.keys(lutUrlById).length > 0 ? { lutUrlById } : {}),
    ...(hasOverlay ? { hyperFramesOverlay: { src: mediaUrlByClipId["hyperframes-overlay"], windows: overlayWindows } } : {}),
  } as never);
  if (!projected.success) throw new Error("props 失败: " + projected.issues.map((i) => i.message).join(";"));
  const props = projected.value;

  // ── renderStill 渲参考帧 ──
  const frames = sampleFrames(props.durationInFrames);
  const qcDir = fs.mkdtempSync("/tmp/qc-frames-");
  const bundlePath = path.join(APPS_ROOT, ".cache/remotion-bundle");
  const runtimeDir = path.join(USER_DATA, "remotion-runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const prevCwd = process.cwd();
  process.chdir(runtimeDir);
  try {
    const browser = await ensureBrowser({ browserExecutable: undefined, chromiumOptions: {}, forceDeviceScaleFactor: undefined, allowFallback: true, onBrowserDownload: () => { throw new Error("禁止下载"); } } as never);
    const browserPath = (browser as { path?: string }).path;
    const composition = await selectComposition({ serveUrl: bundlePath, id: "ChapterVideo", inputProps: props as never, browserExecutable: browserPath, chromiumOptions: { gl: "swangle" } });
    for (const frame of frames) {
      await renderStill({ composition, serveUrl: bundlePath, output: path.join(qcDir, `ref-${frame}.png`), frame, inputProps: props as never, browserExecutable: browserPath, chromiumOptions: { gl: "swangle" } } as never);
    }
  } finally { process.chdir(prevCwd); }

  // ── h264 解码帧 ──
  const results: Array<{ frame: number; psnr: number; ssim: number }> = [];
  for (const frame of frames) {
    const h264Png = path.join(qcDir, `h264-${frame}.png`);
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", OUT_MP4, "-vf", `select='eq(n\\,${frame})'`, "-vframes", "1", h264Png]);
    if (!fs.existsSync(h264Png)) continue;
    const rp = spawnSync("ffmpeg", ["-i", path.join(qcDir, `ref-${frame}.png`), "-i", h264Png, "-lavfi", "psnr", "-f", "null", "-"], { encoding: "utf8" });
    const rs = spawnSync("ffmpeg", ["-i", path.join(qcDir, `ref-${frame}.png`), "-i", h264Png, "-lavfi", "ssim", "-f", "null", "-"], { encoding: "utf8" });
    const pm = /average:([\d.]+)/.exec(rp.stderr || "");
    const sm = /All:([\d.]+)/.exec(rs.stderr || "");
    if (pm && sm) results.push({ frame, psnr: parseFloat(pm[1]), ssim: parseFloat(sm[1]) });
  }
  if (process.env.MYSTUDIO_QC_KEEP_FRAMES !== "1") fs.rmSync(qcDir, { recursive: true, force: true });

  // ── 汇总+门禁 ──
  const avgPsnr = results.reduce((s, r) => s + r.psnr, 0) / results.length;
  const avgSsim = results.reduce((s, r) => s + r.ssim, 0) / results.length;
  const minPsnr = Math.min(...results.map((r) => r.psnr));
  const pass = avgPsnr >= PSNR_FLOOR && avgSsim >= SSIM_FLOOR;

  const report = {
    timestamp: new Date().toISOString(),
    output: OUT_MP4,
    sampleCount: results.length,
    frames: results,
    summary: { avgPsnr, avgSsim, minPsnr, pass, psnrFloor: PSNR_FLOOR, ssimFloor: SSIM_FLOOR },
    elapsedMs: Date.now() - t0,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`\n[QC] 编码质量: PSNR均值=${avgPsnr.toFixed(1)}dB SSIM均值=${avgSsim.toFixed(4)} 最低帧=${minPsnr.toFixed(1)}dB`);
  console.log(`[QC] ${pass ? "✅ 通过" : `❌ 未过(门禁 PSNR≥${PSNR_FLOOR}dB SSIM≥${SSIM_FLOOR})`}`);
  console.log(`[QC] 报告: ${REPORT_PATH} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  return { pass, report };
}

// CLI 独立跑
runEncodingQc().then((r) => process.exit(r.pass ? 0 : 1)).catch((e) => { console.error("[QC] ❌", e.message); process.exit(1); });
