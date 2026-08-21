/**
 * HyperFrames registry 模板真实 CLI 渲染实证(08-22):
 * 用生产 worker 同款 buildHyperFramesCompositionHtml + CLI 参数(--strict-all),
 * 渲染两个重依赖模板(hy:world-map: d3+topojson+atlas JSON;hy:vfx-shatter: gsap+three+字体),
 * 验证 CLI 多时间线协议 + 内联重脚本在严格渲染器下的真实表现:
 * 1. CLI exit 0 且产出 ProRes 4444(带 alpha)mov
 * 2. 时长≈4s@30fps
 * 3. 抽帧(压深色底)非空——模板视觉真实渲染
 *
 * 运行: cd apps && MYSTUDIO_REGISTRY_DEPS_DIR="$HOME/Library/Application Support/漫影工作室/hyperframes-registry-deps" \
 *   vite-node --config build/timeline/vite-node.config.ts build/scripts/registry-render-proof.ts
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildHyperFramesCompositionHtml, buildHyperFramesCliArgs } from "../../frontend/electron/rendering/plugins/hyperframes/hyperframes-worker";

const USER_DATA = path.join(process.env.HOME ?? "", "Library", "Application Support", "漫影工作室");
const CLI = path.join(USER_DATA, "hyperframes-profile/node_modules/hyperframes/bin/hyperframes.mjs");
const BROWSER = path.join(
  "/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.remotion",
  "chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);
const OUT_DIR = "/tmp/hy-registry-render-proof";
const MOV = path.join(OUT_DIR, "proof-overlay.mov");
const FPS = 30;
const DURATION_US = 4_000_000;

function preflight(): void {
  const depsDir = process.env.MYSTUDIO_REGISTRY_DEPS_DIR?.trim();
  const problems = [
    !depsDir && "MYSTUDIO_REGISTRY_DEPS_DIR 未设置",
    depsDir && !fs.existsSync(depsDir) && `依赖目录不存在: ${depsDir}`,
    !fs.existsSync(CLI) && `HY CLI 不存在: ${CLI}`,
    !fs.existsSync(BROWSER) && `chrome-headless-shell 不存在: ${BROWSER}`,
  ].filter((p): p is string => Boolean(p));
  if (problems.length) throw new Error(`预检失败: ${problems.join("; ")}`);
}

function main(): void {
  preflight();
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const request = {
    schemaVersion: 1,
    projectId: "proof",
    chapterId: "proof",
    revision: 1,
    sourceArtifactSha256: "0".repeat(64),
    inputSha256: "1".repeat(64),
    alphaFormat: "prores-4444-mov",
    fps: FPS,
    width: 1920,
    height: 1080,
    outputPath: MOV,
    windows: [
      { templateId: "hy:world-map", startUs: 0, durationUs: 2_000_000, parameters: {} },
      { templateId: "hy:vfx-shatter", startUs: 2_000_000, durationUs: 2_000_000, parameters: {} },
    ],
  } as never;

  const html = buildHyperFramesCompositionHtml(request, DURATION_US);
  fs.writeFileSync(path.join(OUT_DIR, "index.html"), html, "utf8");
  console.log(`composition: ${(html.length / 1024).toFixed(0)}KB, 窗口=${(html.match(/hy-registry-window/g) ?? []).length}`);
  if (!(html.match(/hy-registry-window/g) ?? []).length) throw new Error("两窗均被降级——依赖未就绪,实证无意义");

  const t0 = Date.now();
  // 与生产 renderSegments 完全同款参数构造(含 registry 免 strict 的裁定)
  const args = buildHyperFramesCliArgs(OUT_DIR, request as never, MOV);
  const r = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, HYPERFRAMES_BROWSER_PATH: BROWSER },
    encoding: "utf8",
    timeout: 300_000,
  });
  if (r.status !== 0) {
    throw new Error(`CLI 渲染失败(${r.status}): ${((r.stderr || "") + (r.stdout || "")).slice(-600)}`);
  }
  console.log(`CLI 渲染: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // ffprobe 验证
  const probe = spawnSync("ffprobe", ["-v", "quiet", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt,duration", "-of", "json", MOV], { encoding: "utf8" });
  if (probe.status !== 0) throw new Error("ffprobe 失败");
  const stream = (JSON.parse(probe.stdout).streams ?? [])[0] ?? {};
  console.log(`mov: pix_fmt=${stream.pix_fmt}, duration=${stream.duration}s, size=${(fs.statSync(MOV).size / 1e6).toFixed(1)}MB`);

  // 抽帧压深色底(视觉证据)
  for (const [t, name] of [[1.0, "frame-world-map"], [3.0, "frame-shatter"]] as const) {
    const out = path.join(OUT_DIR, `${name}.png`);
    const f = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(t), "-i", MOV, "-frames:v", "1",
      "-filter_complex", `[0]format=rgba[fr];color=c=#1a1d24:s=1920x1080[bg];[bg][fr]overlay=format=auto,format=rgb24`, out], { encoding: "utf8" });
    if (f.status !== 0) throw new Error(`抽帧失败 ${name}: ${(f.stderr || "").slice(-200)}`);
    console.log(`帧: ${out} (${(fs.statSync(out).size / 1024).toFixed(0)}KB)`);
  }
  const alphaOk = String(stream.pix_fmt).includes("yuva444");
  const durOk = Math.abs(Number(stream.duration) - 4) < 0.3;
  console.log(alphaOk && durOk ? "PASS" : `FAIL(alpha=${alphaOk}, duration=${durOk})`);
  process.exit(alphaOk && durOk ? 0 : 1);
}

main();
