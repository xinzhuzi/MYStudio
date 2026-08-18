/**
 * HY 叠加层独立重生成（对齐新剪辑时间线）——打通 overlay→成片合成通道的第一步。
 * 背景: r47 overlay 按旧时间线(136.5s/转场重叠38.4s)生成;转场钳制手术后新片
 * 144.6s/重叠30.3s,镜头起点逐段后移,旧 overlay 特效时刻片尾提前约 8s——不能直接
 * 复用,必须按新时间线重算窗口并重渲。本脚本:
 * 1) 从 editing.json(当前 rev) 复刻 layoutVisualTimeline 的压缩起点(Σ时长−Σ重叠);
 * 2) 迁移 r47 windows(同模板/参数/时长语义,新起点,装饰槽 1.1s 上限与"不越下一镜
 *    压缩起点"两道钳制与 adapter.py 一致);
 * 3) 以已装应用 Electron(ELECTRON_RUN_AS_NODE)+HY worker 渲 r48 overlay.mov
 *    (prores-4444 alpha),产物与 artifact 落 video-use/chapter-001/r48/。
 * 运行: vite-node --config build/timeline/vite-node.config.ts build/scripts/rerender-hy-overlay.ts
 */
import fs from "node:fs";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { ensureBrowser } from "@remotion/renderer";
import { createHyperFramesAdapter } from "@rendering/plugins/hyperframes/hyperframes-adapter";

const execFileAsync = promisify(execFileCallback);

const MA = "/Users/zhengbingjin/Project/IP/MA";
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const APPS_ROOT = "/Users/zhengbingjin/Project/Github/MYStudio/apps";
const ELECTRON = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
const WORKER = "/Applications/漫影工作室.app/Contents/Resources/app.asar.unpacked/out/main/hyperframes-worker.cjs";
const PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec4";
const CHAPTER_ID = "chapter-001";
const SRC_REV = 47;
const NEW_REV = 48;
const OVERLAY_SLOT_MAX_US = 1_100_000;

async function main() {
  if (!fs.existsSync(ELECTRON)) throw new Error("缺少已装应用二进制: " + ELECTRON);
  if (!fs.existsSync(WORKER)) throw new Error("缺少 HY worker: " + WORKER);
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
      workspaceRootForProject: () => path.join(MA, "video-use"),
      workerPath: WORKER,
      resolveBrowserPath: async () => browserPath,
      // 探针/probe 走应用二进制（profile marker 校验 Electron 路径一致性），但
      // 实际 worker 执行换成系统 Node——以「漫影工作室」应用二进制长跑的进程会
      // 被周期性清场误杀(SIGTERM/143)，系统 Node 实测完整跑通（10-18 实证）。
      execFile: (file, args, options) => execFileAsync(process.execPath, args, {
        ...options,
        env: { ...options.env, MYSTUDIO_HYPERFRAMES_NODE: process.execPath },
      }),
    });
    const probe = await adapter.probe();
    if (probe.state !== "ready") throw new Error("HY 运行时未就绪: " + probe.message);
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

void main();
