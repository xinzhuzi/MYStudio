/**
 * Chrome IPv4 渲染探针 —— 验证 localhost→127.0.0.1 补丁的端到端效果。
 *
 * 背景:系统 Chrome 把 `localhost` 解析为 IPv6 `::1`,而 Remotion 内部 serve
 * 在无全局 IPv6 的网络下仅绑 IPv4,导致 `FATAL: Visited http://localhost:3000
 * but got no response`。补丁(apps/patches/*)把 serveUrl 与页内 offthread 代理
 * URL 都改为 127.0.0.1。本探针用系统 Chrome 走完整生产路径:
 *   MediaBridge 会话 → selectComposition(serveUrl 链路) → renderMedia(页内
 *   offthread 代理链路)。
 *
 * 用法(apps/ 下):
 *   vite-node --config build/timeline/vite-node.config.ts \
 *     build/scripts/chrome-ipv4-render-probe.ts [媒体文件绝对路径]
 *
 * 默认媒体取道劫项目最新的镜头成片;退出码 0 = 链路全通。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { MediaBridgeServer } from "@rendering/plugins/remotion/media-bridge/media-bridge-server";
import { STORYBOARD_SHOT_COMPOSITION_ID } from "@rendering/plugins/remotion/composition/composition-id";
import type { StoryboardShotCompositionProps } from "@rendering/plugins/remotion/composition/composition-props";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appsRoot = path.resolve(scriptsDir, "../..");

const SYSTEM_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function defaultProbeMedia(): string {
  const shotRoot = "/Users/zhengbingjin/Project/IP/MA/remotion/outputs/shots/chapter-001";
  const entries = fs.existsSync(shotRoot)
    ? fs.readdirSync(shotRoot).filter((name) => name.startsWith("sb-")).sort()
    : [];
  const latest = entries.at(-1);
  if (!latest) {
    throw new Error(`探针默认媒体目录不存在或为空: ${shotRoot}`);
  }
  return path.join(shotRoot, latest, "current.mp4");
}

async function main(): Promise<void> {
  const mediaPath = path.resolve(process.argv[2] ?? defaultProbeMedia());
  if (!fs.existsSync(mediaPath)) {
    throw new Error(`媒体文件不存在: ${mediaPath}`);
  }
  if (!fs.existsSync(SYSTEM_CHROME)) {
    throw new Error(`系统 Chrome 不存在: ${SYSTEM_CHROME}`);
  }
  const bundlePath = path.join(appsRoot, ".cache", "remotion-bundle");
  if (!fs.existsSync(path.join(bundlePath, "manifest.json"))) {
    throw new Error(`固定 Remotion bundle 不存在: ${bundlePath}(先跑 pnpm remotion:bundle)`);
  }
  const binariesDirectory = path.join(appsRoot, "node_modules", "@remotion", "compositor-darwin-arm64");
  const outputPath = "/tmp/chrome-ipv4-probe-output.mp4";

  const mediaBridge = new MediaBridgeServer();
  await mediaBridge.listen();
  const session = mediaBridge.createSession();
  try {
    session.register("probe-visual", mediaPath);
    const [visual] = mediaBridge.buildUrls(session, ["probe-visual"]);
    console.log(`[probe] media bridge: ${visual.url}`);

    const durationInFrames = 12;
    const props: StoryboardShotCompositionProps = {
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames,
      visualClips: [{
        clipId: "probe-visual",
        kind: "video",
        src: visual.url,
        from: 0,
        durationInFrames,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
        audioClips: [],
        subtitles: [],
      }],
      transitions: [],
      audioClips: [],
      subtitles: [],
      target: "shot",
      projectId: "probe-project",
      chapterId: "probe-chapter",
      shotId: "probe-shot",
      shotRevision: 1,
    };

    // selectComposition 会启动内部 serve 并让 Chrome 访问 index.html——
    // 补丁前这一步即 FATAL(localhost → ::1 无监听)。
    console.log("[probe] selectComposition with system Chrome ...");
    const composition = await selectComposition({
      serveUrl: bundlePath,
      id: STORYBOARD_SHOT_COMPOSITION_ID,
      inputProps: props,
      browserExecutable: SYSTEM_CHROME,
      binariesDirectory,
      chromeMode: "headless-shell",
      onBrowserDownload: () => {
        throw new Error("禁止隐式下载 Headless Shell");
      },
    });
    console.log(`[probe] composition selected: ${composition.width}x${composition.height}@${composition.fps}`);

    console.log("[probe] renderMedia with system Chrome (exercises page-side offthread proxy) ...");
    await renderMedia({
      serveUrl: bundlePath,
      composition: { ...composition, durationInFrames },
      inputProps: props,
      outputLocation: outputPath,
      codec: "h264",
      pixelFormat: "yuv420p",
      browserExecutable: SYSTEM_CHROME,
      binariesDirectory,
      chromeMode: "headless-shell",
      concurrency: 1,
      overwrite: true,
      onBrowserDownload: () => {
        throw new Error("禁止隐式下载 Headless Shell");
      },
    });
    const size = fs.statSync(outputPath).size;
    console.log(`[probe] PASS: ${outputPath} (${size} bytes)`);
  } finally {
    await mediaBridge.revokeSession(session);
  }
}

main().catch((error: unknown) => {
  console.error(`[probe] FAIL: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
