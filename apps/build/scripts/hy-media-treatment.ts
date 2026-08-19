/**
 * HY media-treatment 素材预处理管线（Trellis 08-18-hy-effects Phase 2）。
 * 确定性、渲染前处理分镜素材（08-15 Q6 裁定的「预处理先行」路线）。
 *
 * 管线：worker 同款 composition 骨架（#stage+data-composition 元数据——手工 HTML
 * 缺此曾致 render 卡死）+ 全帧 media img → HY CLI media-treatment --apply 写
 * data-color-grading（完整确定性 patch）→ HY render mp4 → ffmpeg 抽帧 → SSIM 基线。
 *
 * 运行: cd apps && vite-node --config build/timeline/vite-node.config.ts build/scripts/hy-media-treatment.ts
 * 参数: TREAT_FRAME=<素材帧png路径>（默认从 shot 006 抽帧）。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildHyperFramesCompositionHtml } from "@rendering/plugins/hyperframes/hyperframes-worker";

const HY = "/Users/zhengbingjin/Library/Application Support/漫影工作室/hyperframes-profile/node_modules/hyperframes/bin/hyperframes.mjs";
const SHOT = "/Users/zhengbingjin/Project/IP/MA/remotion/outputs/shots/chapter-001/sb-chapter-001-006/current.mp4";
const WORK = "/tmp/hy-mt2";
const W = 1920, H = 1080, FPS = 30, DUR_US = 1_000_000;

/** worker 骨架 + 全帧 media img（class=clip 进时序；grading 由 CLI 补写）。 */
function buildTreatmentCompositionHtml(): string {
  const skeleton = buildHyperFramesCompositionHtml({
    schemaVersion: 1,
    projectId: "hy-mt",
    chapterId: "mt",
    revision: 1,
    sourceArtifactSha256: "0".repeat(64),
    inputSha256: "0".repeat(64),
    width: W,
    height: H,
    fps: FPS,
    alphaFormat: "prores-4444-mov",
    outputPath: `${WORK}/unused.mov`,
    windows: [{
      slotId: "placeholder",
      startUs: 0,
      durationUs: DUR_US,
      templateId: "letterbox-cinematic",
      parameters: { barHeight: 0 },
    }],
  } as never, DUR_US);
  // windows 的占位 div 换成全帧 media（保留 #stage 元数据与完整 CSS 骨架）。
  return skeleton.replace(
    /<div id="hf-placeholder[^>]*><\/div>/,
    `<img id="media-frame" class="clip" src="frame.png" data-start="0" data-duration="1" data-track-index="1" style="left:50%;top:50%;width:${W}px;height:${H}px;object-fit:cover;">`,
  );
}

function run(cmd: string, args: string[], opts: { cwd?: string } = {}): string {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`${cmd} 失败(${r.status}): ${(r.stderr || r.stdout || "").slice(0, 400)}`);
  }
  return r.stdout ?? "";
}

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true });
  const project = path.join(WORK, "project");
  fs.mkdirSync(project, { recursive: true });
  fs.copyFileSync(process.env.TREAT_FRAME || extractFrame(), path.join(project, "frame.png"));

  const combos: Array<[string, Record<string, number>]> = [
    ["kuwahara-08", { kuwahara: 0.8 }],
    ["crosshatch-075", { crosshatch: 0.75 }],
    ["twoink-08", { twoInkPrint: 0.8 }],
    ["halftone-07", { halftone: 0.7 }],
  ];
  const report: Array<{ id: string; ssim: string }> = [];
  const orig = path.join(WORK, "orig.png");

  for (const [id, effects] of combos) {
    fs.writeFileSync(path.join(project, "index.html"), buildTreatmentCompositionHtml(), "utf8");
    // 1) CLI 写全量确定性 grading patch（80 键 data-color-grading）。
    const patch = JSON.stringify({ effects });
    const applied = run("node", [HY, "media-treatment", "--project", ".", "--file", "index.html",
      "--selector", "img.clip", "--grading", patch, "--apply", "--json"], { cwd: project });
    const ok = JSON.parse(applied).ok === true;
    if (!ok) throw new Error(`apply 失败: ${id}`);
    // 2) HY render（worker 同款参数；mp4 30 帧）。
    run("node", [HY, "render", project, "--format", "mp4", "--output", path.join(WORK, `${id}.mp4`),
      "--fps", String(FPS), "--quiet", "--strict-all"]);
    // 3) 抽中段帧 + SSIM。
    const frame = path.join(WORK, `${id}.png`);
    run("ffmpeg", ["-y", "-loglevel", "error", "-ss", "0.5", "-i", path.join(WORK, `${id}.mp4`),
      "-vframes", "1", frame]);
    if (!fs.existsSync(orig)) run("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(project, "frame.png"), "-pix_fmt", "yuv420p", orig]);
    const ssimR = spawnSync("ffmpeg", ["-i", orig, "-i", frame, "-filter_complex", "ssim", "-f", "null", "-"], { encoding: "utf8" });
    const m = /SSIM.*All:[\d.]+ \(([^\)]+)\)/.exec(ssimR.stderr || "");
    report.push({ id, ssim: m ? m[1] : "?" });
    console.log(`[hy-mt] ${id}: SSIM=${report[report.length - 1]!.ssim}`);
  }
  fs.writeFileSync(path.join(WORK, "ssim-baseline.json"), JSON.stringify(report, null, 2));
  console.log("[hy-mt] 基线:", path.join(WORK, "ssim-baseline.json"), "| 处理帧:", combos.map((c) => c[0]).join(", "));
}

function extractFrame(): string {
  const p = path.join(WORK, "source-frame.png");
  fs.mkdirSync(WORK, { recursive: true });
  run("ffmpeg", ["-y", "-loglevel", "error", "-ss", "0.5", "-i", SHOT, "-vframes", "1", "-vf", `scale=${W}:${H}`, p]);
  return p;
}

main().catch((err) => { console.error("[hy-mt] ❌", err); process.exit(1); });
