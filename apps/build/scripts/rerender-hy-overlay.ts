/**
 * HY 叠加层独立重生成（对齐新剪辑时间线）——打通 overlay→成片合成通道的第一步。
 * 背景: r47 overlay 按旧时间线(136.5s/转场重叠38.4s)生成;转场钳制手术后新片
 * 144.6s/重叠30.3s,镜头起点逐段后移,旧 overlay 特效时刻片尾提前约 8s——不能直接
 * 复用,必须按新时间线重算窗口并重渲。本脚本:
 * 1) 从 editing.json(当前 rev) 复刻 layoutVisualTimeline 的压缩起点(Σ时长−Σ重叠);
 * 2) 迁移 r47 windows(同模板/参数/时长语义,新起点,装饰槽 1.1s 上限与"不越下一镜
 *    压缩起点"两道钳制与 adapter.py 一致);
 * 3) 位置重定位(08-18 用户裁定:特效落点必须与画面内容对应):r47 的 x,y 是
 *    静态分镜图的最亮质心,但工笔画最亮处是纸底/天空(空白),主体(人物)反而是
 *    墨线密集区——实证镜头001:主体(40,75) vs 亮心(62,23)差半屏,特效落空白=
 *    废片。改为「主体锚定」:从每镜 MP4 特效时刻(+0.55s=窗口中点)抽真实帧,
 *    ffmpeg 缩 64x36 灰度,取梯度强度(笔画/细节密度)前 25% 加权质心——墨线
 *    密集处即主体;排除底部 25%(字幕烧录区)与顶部 8%,防文字笔画劫持质心;
 * 4) 以系统 Node 跑 HY worker 渲 overlay(prores-4444 alpha),产物与 artifact 落
 *    video-use/chapter-001/r49/(应用二进制长跑会被周期清场 SIGTERM;工具壳下
 *    后台跑会被整树收割,须前台直跑——两次实证)。
 * 运行: vite-node --config build/timeline/vite-node.config.ts build/scripts/rerender-hy-overlay.ts
 */
import fs from "node:fs";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { ensureBrowser } from "@remotion/renderer";
import { createHyperFramesAdapter } from "@rendering/plugins/hyperframes/hyperframes-adapter";

const execFileAsync = promisify(execFileCallback);
const FFMPEG = process.env.MYSTUDIO_FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg";

const MA = "/Users/zhengbingjin/Project/IP/MA";
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const REPO_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio";
const ELECTRON = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
/** worker 优先取已装应用;应用被并行会话重建时降级 dmg 抽取的缓存副本。 */
const WORKER = fs.existsSync("/Applications/漫影工作室.app/Contents/Resources/app.asar.unpacked/out/main/hyperframes-worker.cjs")
  ? "/Applications/漫影工作室.app/Contents/Resources/app.asar.unpacked/out/main/hyperframes-worker.cjs"
  : path.join(REPO_ROOT, "apps/.cache/hy-runtime/hyperframes-worker.cjs");
const QUEUE = path.join(USER_DATA, "projects/_remotion/queue/queue-state.json");
const _PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec4";
const CHAPTER_ID = "chapter-001";
const SRC_REV = 47;
const NEW_REV = 49;
const OVERLAY_SLOT_MAX_US = 1_100_000;
/** 位置敏感模板：x,y 必须贴画面内容;其余(grain/vignette/letterbox/light-leak)全幅无坐标。 */
const POSITION_TEMPLATES = new Set(["lens-flare", "highlight-box"]);
/** 抽帧时刻=窗口中点(窗口 1.1s 起于镜压缩起点)。 */
const SAMPLE_AT_S = 0.55;

async function main() {
  if (!fs.existsSync(WORKER)) throw new Error("缺少 HY worker: " + WORKER);
  const hasAppBinary = fs.existsSync(ELECTRON);
  if (!hasAppBinary) {
    console.log(`⚠️ 已装应用缺失(并行会话重建中)——降级:缓存 worker + 系统 Node + 跳过探针`);
  }
  // 共享工具链探测走 MYSTUDIO_FFMPEG/FFPROBE 环境变量（应用内由 main.ts 的
  // selectSharedVideoToolchain 统一注入;独立宿主自行选 Homebrew 对,与应用同源策略）。
  for (const [envKey, candidate] of [
    ["MYSTUDIO_FFMPEG_PATH", "/opt/homebrew/bin/ffmpeg"],
    ["MYSTUDIO_FFPROBE_PATH", "/opt/homebrew/bin/ffprobe"],
  ] as const) {
    if (!process.env[envKey]) {
      if (!fs.existsSync(candidate)) throw new Error(`缺少共享工具链 ${envKey}: ${candidate}`);
      process.env[envKey] = candidate;
    }
  }

  // 1. 新压缩时间线（与 composition layoutVisualTimeline 同式：帧级 Math.round 差
  //    足以被 1.1s 装饰槽钳制吸收，µs 直算即可）。
  const editing = JSON.parse(fs.readFileSync(path.join(MA, "editing.json"), "utf8")) as {
    state: { editingProjects: Record<string, EditingLike> };
  };
  const project = Object.values(editing.state.editingProjects)[0]!;
  const vis = project.clips
    .filter((c) => c.trackId.endsWith("main-visual"))
    .sort((a, b) => a.startUs - b.startUs);
  const transitions = new Map((project.transitions ?? []).map((t) => [t.fromClipId, t]));
  const starts: number[] = [];
  let cursor = 0;
  for (let i = 0; i < vis.length; i += 1) {
    if (i > 0) {
      const t = transitions.get(vis[i - 1]!.id);
      const overlap = t && t.effectId !== "cut" ? Math.max(0, t.durationUs) : 0;
      cursor = cursor + vis[i - 1]!.durationUs - overlap;
    }
    starts.push(cursor);
  }

  // 2. r47 windows → 新起点（窗口序=镜头序，r47 生成时即按 shot 顺序排布）。
  const srcDir = path.join(MA, "video-use", CHAPTER_ID, `r${SRC_REV}`);
  const srcArtifact = JSON.parse(fs.readFileSync(path.join(srcDir, "hyperframes-artifact.json"), "utf8")) as {
    windows: Array<Record<string, unknown> & { startUs: number; durationUs: number }>;
  };
  const srcRequest = JSON.parse(fs.readFileSync(path.join(srcDir, "hyperframes-request.json"), "utf8")) as Record<string, unknown>;
  if (srcArtifact.windows.length !== starts.length) {
    throw new Error(`窗口数(${srcArtifact.windows.length})与镜头数(${starts.length})不一致`);
  }
  const windows = srcArtifact.windows.map((window, i) => ({
    ...window,
    startUs: starts[i]!,
    durationUs: Math.max(1, Math.min(
      window.durationUs,
      OVERLAY_SLOT_MAX_US,
      i + 1 < starts.length ? Math.max(1, starts[i + 1]! - starts[i]!) : OVERLAY_SLOT_MAX_US,
    )),
  }));
  for (let i = 1; i < windows.length; i += 1) {
    if (windows[i]!.startUs < windows[i - 1]!.startUs) throw new Error(`窗口 ${i} 起点回退`);
  }

  // 3. 位置重定位：从镜片 MP4 的特效时刻抽真实帧算亮度质心。
  const shotMp4ByShotId = readShotMp4Paths();
  let repositioned = 0;
  let kept = 0;
  for (const window of windows) {
    const templateId = String(window.templateId ?? "");
    if (!POSITION_TEMPLATES.has(templateId)) continue;
    const shotId = String(window.slotId ?? "").replace(/^effect-/, "");
    const mp4 = shotMp4ByShotId.get(shotId);
    if (!mp4) { kept += 1; continue; }
    const centroid = await subjectCentroidAt(mp4, SAMPLE_AT_S);
    if (!centroid) { kept += 1; continue; }
    const params = { ...(window.parameters as Record<string, unknown>) };
    params.x = centroid.x;
    params.y = templateId === "lens-flare" ? Math.max(8, centroid.y - 10) : centroid.y;
    if (templateId === "lens-flare") params.size = Math.max(Number(params.size ?? 0), 480);
    window.parameters = params;
    repositioned += 1;
  }
  console.log(`位置重定位: ${repositioned} 处按真实帧质心落位, ${kept} 处保留原值(缺视频/抽帧失败)`);

  // 3. r48 请求 → HY worker 渲染。
  const newDir = path.join(MA, "video-use", CHAPTER_ID, `r${NEW_REV}`);
  const request = {
    ...srcRequest,
    revision: NEW_REV,
    outputPath: path.join(newDir, "hyperframes-overlay.mov"),
    windows,
  };
  const runtimeDir = path.join(USER_DATA, "remotion-runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  const prevCwd = process.cwd();
  process.chdir(runtimeDir);
  try {
    const browser = await ensureBrowser({ browserExecutable: undefined, chromiumOptions: {}, forceDeviceScaleFactor: undefined, allowFallback: true, onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); } } as never);
    // ensureBrowser 返回 { path, type }；默认 probe 从环境变量解析浏览器路径。
    const browserPath = (browser as unknown as { path: string }).path;
    process.env.HYPERFRAMES_BROWSER_PATH = browserPath;
    const adapter = createHyperFramesAdapter({
      storageBasePath: USER_DATA,
      electronExecutable: ELECTRON,
      workspaceRootForProject: () => path.join(MA, "hyperframes"),
      workerPath: WORKER,
      resolveBrowserPath: async () => browserPath,
      // 应用缺失时探针必败(electron 可执行文件/profile marker 校验)——standalone
      // 降级直接放行,worker 本身由系统 Node 执行不依赖应用。
      ...(hasAppBinary ? {} : {
        probeRuntime: async () => ({ state: "ready", message: "standalone 降级(无应用二进制)", paths: {} as never, missing: [], versions: {} }),
      }),
      // 探针/probe 走应用二进制（profile marker 校验 Electron 路径一致性），但
      // 实际 worker 执行换成系统 Node——以「漫影工作室」应用二进制长跑的进程会
      // 被周期性清场误杀(SIGTERM/143)，系统 Node 实测完整跑通（10-18 实证）。
      execFile: (file, args, options) => execFileAsync(process.execPath, args, {
        ...options,
        env: { ...options.env, MYSTUDIO_HYPERFRAMES_NODE: process.execPath },
      }),
    });
    if (hasAppBinary) {
      const probe = await adapter.probe();
      if (probe.state !== "ready") throw new Error("HY 运行时未就绪: " + probe.message);
    }
    const result = await adapter.renderOverlay(request as never);
    if (result.state !== "ready") throw new Error(`HY 渲染失败: ${result.code} ${result.message}`);
    const mov = result.artifact.outputPath;
    const size = fs.statSync(mov).size;
    console.log("✅ overlay 渲成:", mov, `${(size / 1e6).toFixed(1)}MB`, `| windows: ${result.artifact.windows.length}`);
  } finally {
    process.chdir(prevCwd);
  }
}

interface EditingLike {
  clips: Array<{ id: string; trackId: string; startUs: number; durationUs: number }>;
  transitions?: Array<{ fromClipId: string; effectId: string; durationUs: number }>;
}

/** 队列最新章节条目里每个 shot 的 current slot 输出（绝对路径）。 */
function readShotMp4Paths(): Map<string, string> {
  const queue = JSON.parse(fs.readFileSync(QUEUE, "utf8")) as {
    jobs?: Array<{ kind?: string; currentShotSlots?: Array<{ target?: { shotId?: string }; evidence?: { outputPath?: string } }> }>;
  };
  const chapter = (queue.jobs ?? []).filter((job) => job.kind === "chapter").pop();
  const map = new Map<string, string>();
  for (const slot of chapter?.currentShotSlots ?? []) {
    const shotId = slot.target?.shotId;
    const outputPath = slot.evidence?.outputPath;
    if (shotId && outputPath) {
      const abs = path.isAbsolute(outputPath) ? outputPath : path.join(MA, "remotion", outputPath);
      if (fs.existsSync(abs)) map.set(shotId, abs);
    }
  }
  return map;
}

/**
 * 视频指定时刻的主体锚定点（百分比坐标）。工笔画主体(人物)先验:发/眼/深衣的
 * 浓墨核心——取 64x36 灰度帧最暗 15% 像素的加权质心;排除底部 25%(字幕区)与
 * 顶部 8%。实证镜头001:浓墨质心(16,50) 正落视觉判读的人物包围盒(左0-29%全高)
 * 中心,而亮度质心(62,23) 落空白天空;梯度质心会被背景树石墨线骗走。
 * lens-flare 在锚点上浮 10%(光自主体上方来),highlight-box 直接落锚点。
 */
async function subjectCentroidAt(mp4: string, atSeconds: number): Promise<{ x: number; y: number } | null> {
  try {
    const { stdout } = await execFileAsync(FFMPEG, [
      "-v", "error", "-ss", atSeconds.toFixed(2), "-i", mp4,
      "-vf", "scale=64:36", "-frames:v", "1",
      "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ], { timeout: 30_000, maxBuffer: 64 * 1024, encoding: "buffer" });
    const px = stdout;
    if (px.length < 64 * 36) return null;
    const candidates: Array<{ index: number; value: number }> = [];
    for (let y = 3; y < 28; y += 1) { // 行 0-2 顶部排除;28-35 底部字幕区排除
      for (let x = 0; x < 64; x += 1) {
        candidates.push({ index: y * 64 + x, value: px[y * 64 + x] ?? 0 });
      }
    }
    candidates.sort((a, b) => a.value - b.value);
    const threshold = candidates[Math.floor(candidates.length * 0.15)]!.value;
    let total = 0;
    let sumX = 0;
    let sumY = 0;
    for (const { index, value } of candidates) {
      if (value <= threshold) {
        const weight = threshold - value + 1;
        sumX += (index % 64) * weight;
        sumY += Math.floor(index / 64) * weight;
        total += weight;
      }
    }
    if (total <= 0) return null;
    const x = Math.max(5, Math.min(95, Math.round((sumX / total / 63) * 100)));
    const y = Math.max(8, Math.min(92, Math.round((sumY / total / 35) * 100)));
    return { x, y };
  } catch {
    return null;
  }
}

void main();
