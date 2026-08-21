/**
 * HY Registry 策展取样器(08-22-video-use-vision-release R3 步骤二)。
 *
 * 把 registry-curation-shortlist.json 的候选模板逐个铺成一条 2s/窗的
 * ProRes 轨,一次 worker 渲染全部样本;再用 ffmpeg 每窗抽 1 帧成 jpg,
 * 供视觉三审(网格判读)。参数用各模板缺省(worker 对缺 params 的模板按
 * 默认渲染),这是「看模板本体长相」的取样,不是终调参。
 *
 * 用法(须在 apps/ 下):
 *   npx vite-node --config build/timeline/vite-node.config.ts \
 *     build/timeline/sample-hy-registry-templates.ts \
 *     --shortlist <registry-curation-shortlist.json> --out <dir>
 */
import fs from "node:fs";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { ensureBrowser } from "@remotion/renderer";
import { createHyperFramesAdapter } from "@rendering/plugins/hyperframes/hyperframes-adapter";

const execFileAsync = promisify(execFileCallback);

const PROJECT_ROOT = "/Users/zhengbingjin/Project/IP/MA";
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec4";
const CHAPTER_ID = "chapter-001";
const ELECTRON = "/Applications/漫影工作室.app/Contents/MacOS/漫影工作室";
const WORKER = path.resolve(".cache/hyperframes-worker.cjs");
const WINDOW_US = 2_000_000;

function parseArgs(): { shortlist: string; out: string } {
  const argv = process.argv.slice(2);
  const read = (flag: string): string => {
    const index = argv.indexOf(flag);
    if (index < 0 || !argv[index + 1]) throw new Error(`缺少参数 ${flag}`);
    return argv[index + 1]!;
  };
  return { shortlist: read("--shortlist"), out: read("--out") };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const shortlist = JSON.parse(fs.readFileSync(args.shortlist, "utf8")) as {
    entries: Array<{ templateId: string; name: string }>;
  };
  if (!fs.existsSync(WORKER)) throw new Error(`worker 不存在: ${WORKER}(先 esbuild 重建)`);
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  // 契约要求 outputPath 落在受管章节 revision 目录;用 r9001 暂存命名空间,
  // 渲完把产物挪到 --out 研究目录并清掉暂存目录。
  const stagingDir = path.join(PROJECT_ROOT, "hyperframes", CHAPTER_ID, "r9001");
  fs.mkdirSync(stagingDir, { recursive: true });
  const overlayPath = path.join(stagingDir, "hyperframes-overlay.mov");
  if (fs.existsSync(overlayPath)) throw new Error(`暂存已存在: ${overlayPath}`);

  // 用最新 artifact 的证据哈希满足请求契约(取样用途;worker 不回查磁盘)。
  const revisions = fs.readdirSync(path.join(PROJECT_ROOT, "video-use", CHAPTER_ID))
    .filter((name) => /^r\d+$/.test(name)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  if (revisions.length === 0) throw new Error("找不到 video-use revision");
  const artifact = JSON.parse(fs.readFileSync(
    path.join(PROJECT_ROOT, "video-use", CHAPTER_ID, revisions[0]!, "video-use-artifact.json"), "utf8"));

  const windows = shortlist.entries.map((entry, index) => ({
    slotId: `sample-${index + 1}`,
    cueId: `sample-${index + 1}`,
    startUs: index * WINDOW_US,
    durationUs: WINDOW_US,
    templateId: entry.templateId,
    parameters: {},
  }));
  const request = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    chapterId: CHAPTER_ID,
    revision: 9001,
    sourceArtifactSha256: artifact.evidence.artifactSha256,
    inputSha256: artifact.evidence.inputSha256,
    width: 1280,
    height: 720,
    fps: 30,
    alphaFormat: "prores-4444-mov" as const,
    outputPath: overlayPath,
    windows,
  };

  const runtimeDir = path.join(USER_DATA, "remotion-runtime");
  const previousCwd = process.cwd();
  process.chdir(runtimeDir);
  try {
    const browser = await ensureBrowser({
      browserExecutable: undefined,
      chromiumOptions: {},
      forceDeviceScaleFactor: undefined,
      allowFallback: true,
      onBrowserDownload: () => { throw new Error("禁止隐式下载 Headless Shell"); },
    } as never);
    const browserPath = (browser as unknown as { path: string }).path;
    process.env.HYPERFRAMES_BROWSER_PATH = browserPath;
    const adapter = createHyperFramesAdapter({
      storageBasePath: USER_DATA,
      electronExecutable: ELECTRON,
      workspaceRootForProject: () => path.join(PROJECT_ROOT, "hyperframes"),
      workerPath: WORKER,
      resolveBrowserPath: async () => browserPath,
      execFile: (file, args, options) => execFileAsync(process.execPath, args, {
        ...options,
        env: { ...options.env, MYSTUDIO_HYPERFRAMES_NODE: process.execPath },
      }),
    });
    const probe = await adapter.probe();
    if (probe.state !== "ready") throw new Error(`HyperFrames 运行时未就绪: ${probe.message}`);
    const result = await adapter.renderOverlay(request);
    if (result.state !== "ready") throw new Error(`渲染失败: ${result.code} ${result.message}`);

    // 每窗抽 1 帧(窗中点)
    const framesDir = path.join(outDir, "frames");
    fs.mkdirSync(framesDir, { recursive: true });
    const manifest: Array<{ index: number; templateId: string; frame: string; tS: number }> = [];
    let failures = 0;
    for (let index = 0; index < windows.length; index += 1) {
      const tS = (index * WINDOW_US) / 1e6 + WINDOW_US / 2e6;
      const frame = path.join(framesDir, `sample-${String(index + 1).padStart(3, "0")}.jpg`);
      try {
        await execFileAsync("ffmpeg", ["-y", "-loglevel", "error", "-ss", tS.toFixed(3), "-i", overlayPath,
          "-frames:v", "1", "-vf", "scale=480:270", "-q:v", "3", frame]);
        manifest.push({ index: index + 1, templateId: windows[index]!.templateId, frame: path.basename(frame), tS });
      } catch {
        failures += 1;
      }
    }
    fs.writeFileSync(path.join(outDir, "sample-manifest.json"), `${JSON.stringify({
      total: windows.length, frames: manifest.length, failures,
    }, null, 2)}\n`, "utf8");
    // 样本轨挪到研究目录,清掉受管暂存目录(避免被 apply/重渲误消费)
    const finalTrack = path.join(outDir, "registry-sample-track.mov");
    fs.renameSync(overlayPath, finalTrack);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    process.stdout.write(`样本轨 ${finalTrack};抽帧 ${manifest.length}/${windows.length}(失败 ${failures});manifest 已写\n`);
  } finally {
    process.chdir(previousCwd);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
