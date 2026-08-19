/**
 * HY overlay 独立渲染——完全自包含（不 import worker 模块,避免 Electron guard 干扰）。
 * 直接用 HY CLI + Chromium headless shell,每段渲 mov 后 ffmpeg 拼接 ProRes 4444。
 * 运行: cd apps && npx vite-node --config build/timeline/vite-node.config.ts build/scripts/render-hy-overlay.ts
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MA = "/Users/zhengbingjin/Project/IP/MA";
const QUEUE = "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_remotion/queue/queue-state.json";
const USER_DATA = "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const CHAPTER = "chapter-001";
const REV = 49;
const FPS = 30, W = 1920, H = 1080;
const CLI = path.join(USER_DATA, "hyperframes-profile/node_modules/hyperframes/bin/hyperframes.mjs");
const NODE = process.execPath;
const BROWSER = "/Users/zhengbingjin/Project/Github/MYStudio/apps/node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const OUT_DIR = path.join(MA, "video-use", CHAPTER, `r${REV}`);
const OVERLAY_MOV = path.join(OUT_DIR, "hyperframes-overlay.mov");
const MAX_PER_SEG = 8;

// ── 模板 CSS(与 worker 的 buildHyperFramesCompositionHtml 同款——手动内联) ──
const TEMPLATE_CSS = `
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
#stage{position:relative;width:${W}px;height:${H}px;background:transparent;overflow:hidden}
.clip{position:absolute;transform:translate(-50%,-50%);opacity:0;white-space:nowrap;animation:hf-in .24s ease-out forwards}
@keyframes hf-in{from{opacity:0}to{opacity:1}}
.hf-light-leak{width:100%;height:100%;left:0;top:0;transform:none;opacity:calc(var(--hf-intensity,.6));background:radial-gradient(ellipse at 30% 20%,hsla(var(--hf-hue,30deg),90%,60%,.7) 0%,transparent 70%);mix-blend-mode:screen;animation:hf-leak 8s ease-in-out infinite alternate}
@keyframes hf-leak{from{transform:translateX(-3%)}to{transform:translateX(3%)}}
.hf-film-grain{width:100%;height:100%;left:0;top:0;transform:none;opacity:var(--hf-grain-opacity,.15);background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/></svg>");mix-blend-mode:overlay}
.hf-lens-flare{width:var(--hf-flare-size,200px);height:var(--hf-flare-size,200px);background:radial-gradient(circle,rgba(255,255,255,.8) 0%,rgba(255,200,100,.4) 8%,transparent 40%);mix-blend-mode:screen;animation:hf-flare 4s ease-in-out infinite alternate}
@keyframes hf-flare{from{opacity:.5}to{opacity:1}}
.hf-vignette-pulse{width:100%;height:100%;left:0;top:0;transform:none;background:radial-gradient(ellipse at center,transparent 40%,rgba(0,0,0,var(--hf-vignette,.5)) 100%);animation:hf-vp var(--hf-pulse-speed,2s) ease-in-out infinite alternate}
@keyframes hf-vp{from{opacity:.7}to{opacity:1}}
.hf-particle-dust{width:100%;height:100%;left:0;top:0}
.hf-dust-particle{position:absolute;width:3px;height:3px;border-radius:50%;background:rgba(255,255,200,.5);mix-blend-mode:screen;animation:hf-dust linear infinite}
@keyframes hf-dust{to{transform:translateY(-40px)}}
.hf-letterbox{width:100%;height:100%;left:0;top:0;transform:none}
.hf-letterbox::before,.hf-letterbox::after{content:"";position:absolute;left:0;width:100%;height:var(--hf-bar-height,12%);background:#000;transition:opacity var(--hf-letterbox-fade,.25s)}
.hf-letterbox::before{top:0}.hf-letterbox::after{bottom:0}
.hf-highlight{width:24%;height:14%;border:4px solid currentColor;border-radius:18px;box-shadow:0 0 26px currentColor}
/* 08-18-hy-effects 本地模板 */
.hf-ink-bloom{width:60%;height:60%;border-radius:50%;background:radial-gradient(circle,hsla(220,15%,30%,calc(var(--hf-ink,.5)*.55)) 0%,transparent 70%);mix-blend-mode:screen;animation:hf-ink 7s ease-out infinite}
@keyframes hf-ink{0%{transform:translate(-50%,-50%) scale(.4);opacity:0}30%{opacity:1}100%{transform:translate(-50%,-50%) scale(1.25);opacity:.25}}
.hf-mist-drift{width:100%;height:100%;left:0;top:0;background:radial-gradient(ellipse 60% 38% at 30% 72%,hsla(210,20%,88%,var(--hf-mist,.25)),transparent 70%);mix-blend-mode:screen;animation:hf-mist var(--hf-mist-speed,14s) ease-in-out infinite alternate}
@keyframes hf-mist{from{transform:translateX(-6%)}to{transform:translateX(6%)}}
.hf-gold-flecks{width:100%;height:100%;left:0;top:0}
.hf-fleck{position:absolute;width:5px;height:5px;border-radius:50%;background:radial-gradient(circle,hsla(43,90%,68%,.9),transparent 70%);opacity:calc(var(--hf-fleck,.5)*.9);mix-blend-mode:screen;animation:hf-fleck 5s ease-in-out infinite alternate}
@keyframes hf-fleck{from{transform:translateY(0)}to{transform:translateY(-26px)}}
.hf-brush-sweep{width:100%;height:100%;left:0;top:0;background:linear-gradient(105deg,transparent 40%,hsla(var(--hf-brush-hue,210deg),35%,72%,.3) 50%,transparent 60%);mix-blend-mode:screen;animation:hf-brush var(--hf-brush-speed,3s) ease-in-out infinite}
@keyframes hf-brush{0%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
.hf-paper-breath{width:100%;height:100%;left:0;top:0;background:radial-gradient(ellipse at 50% 45%,hsla(38,42%,86%,calc(var(--hf-warmth,.15)*.8)),transparent 75%);mix-blend-mode:soft-light;animation:hf-breath var(--hf-breath-speed,6s) ease-in-out infinite alternate}
@keyframes hf-breath{from{opacity:.55}to{opacity:1}}
.hf-candle-flicker{width:55%;height:55%;background:radial-gradient(circle,hsla(36,88%,64%,calc(var(--hf-candle,.4)*.85)) 0%,transparent 72%);mix-blend-mode:screen;animation:hf-candle 1.6s steps(3,end) infinite alternate}
@keyframes hf-candle{0%{transform:translate(-50%,-50%) scale(1)}100%{transform:translate(-50%,-50%) scale(.94)}}
.hf-moon-glow{width:var(--hf-moon-size,260px);height:var(--hf-moon-size,260px);border-radius:50%;background:radial-gradient(circle,hsla(210,30%,92%,.95) 0%,transparent 72%);mix-blend-mode:screen}
.hf-rain-streaks{width:100%;height:100%;left:0;top:0}
.hf-rain{position:absolute;top:-12%;width:1.5px;height:13%;background:linear-gradient(to bottom,transparent,hsla(205,34%,84%,.55),transparent);mix-blend-mode:screen;animation:hf-rain-fall linear infinite}
@keyframes hf-rain-fall{to{transform:translateY(115vh)}}
.hf-snow-drift{width:100%;height:100%;left:0;top:0}
.hf-snow{position:absolute;top:-6%;width:6px;height:6px;border-radius:50%;background:radial-gradient(circle,hsla(0,0%,98%,.9),transparent 75%);mix-blend-mode:screen;animation:hf-snow-fall ease-in-out infinite}
@keyframes hf-snow-fall{to{transform:translate(24px,115vh)}}
.hf-aura-pulse{width:100%;height:100%;left:0;top:0;background:radial-gradient(circle at 50% 52%,transparent 34%,hsla(160,55%,70%,calc(var(--hf-aura,.35)*.5)) 48%,transparent 62%);mix-blend-mode:screen;animation:hf-aura var(--hf-aura-speed,2.5s) ease-in-out infinite}
@keyframes hf-aura{0%{transform:scale(.85);opacity:.2}50%{opacity:1}100%{transform:scale(1.1);opacity:.2}}
.hf-sword-flash{width:100%;height:100%;left:0;top:0;background:linear-gradient(to bottom,transparent 46%,hsla(48,95%,88%,.9) 50%,transparent 54%);mix-blend-mode:screen;animation:hf-sword 2.4s ease-out infinite}
@keyframes hf-sword{0%{transform:rotate(var(--hf-sword-angle,24deg)) translateX(-90%);opacity:0}18%{opacity:1}45%{transform:rotate(var(--hf-sword-angle,24deg)) translateX(70%);opacity:0}100%{opacity:0}}
.hf-seal-glow{width:34%;height:26%;right:4%;bottom:6%;background:radial-gradient(ellipse,hsla(6,72%,52%,calc(var(--hf-seal,.3)*.75)),transparent 70%);mix-blend-mode:screen;animation:hf-seal 4.5s ease-in-out infinite alternate}
@keyframes hf-seal{from{opacity:.4}to{opacity:1}}
.hf-dust-motes{width:100%;height:100%;left:0;top:0}
.hf-mote{position:absolute;width:7px;height:7px;border-radius:50%;background:radial-gradient(circle,hsla(44,70%,84%,.5),transparent 72%);mix-blend-mode:screen;animation:hf-mote ease-in-out infinite alternate}
@keyframes hf-mote{from{transform:translate(0,0)}to{transform:translate(18px,-38px)}}
`;

// ── 模板渲染(与 worker renderWindow 同款逻辑) ──
function renderWindow(w: any, idx: number): string {
  const id = `hf-${w.slotId.replace(/[^A-Za-z0-9_-]/g, "-")}-${idx + 1}`;
  const startS = (w.startUs / 1e6).toFixed(3);
  const durS = (w.durationUs / 1e6).toFixed(3);
  const cls = `clip hf-${w.templateId}`;
  const base = `id="${id}" class="${cls}" data-start="${startS}" data-duration="${durS}" data-track-index="${idx + 1}"`;
  const p = w.parameters ?? {};
  const n = (k: string, d: number) => Number(p[k] ?? d);
  let style = "";
  switch (w.templateId) {
    case "light-leak": style = `--hf-intensity:${n("intensity", .42)};--hf-hue:${n("hue", 0)}deg`; break;
    case "film-grain": style = `--hf-grain-opacity:${n("opacity", .15)}`; break;
    case "lens-flare": style = `left:${n("x", 18)}%;top:${n("y", 24)}%;--hf-flare-size:${n("size", 260)}px`; break;
    case "vignette-pulse": style = `--hf-vignette:${n("darkness", .42)};--hf-pulse-speed:${n("speed", 2.4)}s`; break;
    case "letterbox-cinematic": style = `--hf-bar-height:${n("barHeight", 12)}%;--hf-letterbox-fade:${n("fadeIn", .25)}s`; break;
    case "ink-bloom": style = `left:${n("x", 50)}%;top:${n("y", 45)}%;--hf-ink:${n("intensity", .5)}`; break;
    case "mist-drift": style = `--hf-mist:${n("opacity", .25)};--hf-mist-speed:${n("speed", 14)}s`; break;
    case "brush-sweep": style = `--hf-brush-hue:${n("hue", 210)}deg;--hf-brush-speed:${n("speed", 3)}s`; break;
    case "paper-breath": style = `--hf-warmth:${n("warmth", .15)};--hf-breath-speed:${n("speed", 6)}s`; break;
    case "candle-flicker": style = `left:${n("x", 70)}%;top:${n("y", 65)}%;--hf-candle:${n("intensity", .4)}`; break;
    case "moon-glow": style = `left:${n("x", 24)}%;top:${n("y", 22)}%;--hf-moon-size:${n("size", 260)}px`; break;
    case "aura-pulse": style = `--hf-aura:${n("intensity", .35)};--hf-aura-speed:${n("speed", 2.5)}s`; break;
    case "sword-flash": style = `--hf-sword-angle:${n("angle", 24)}deg`; break;
    case "seal-glow": style = `--hf-seal:${n("intensity", .3)}`; break;
  }
  // 粒子类
  if (["particle-dust", "gold-flecks", "rain-streaks", "snow-drift", "dust-motes"].includes(w.templateId)) {
    const count = Math.round(n("count", 10));
    const speed = n("speed", 8);
    const span = w.templateId === "particle-dust" ? "hf-dust-particle" : w.templateId === "gold-flecks" ? "hf-fleck" : w.templateId === "rain-streaks" ? "hf-rain" : w.templateId === "snow-drift" ? "hf-snow" : "hf-mote";
    let particles = "";
    for (let i = 0; i < count; i++) {
      const px = (i * 37 + 7) % 100, py = (i * 53 + 13) % 100;
      const delay = ((i * 0.4) % 3).toFixed(1);
      particles += `<span class="${span}" style="left:${px}%;top:${py}%;animation-delay:${delay}s;animation-duration:${speed}s;"></span>`;
    }
    return `<div ${base} style="${style}">${particles}</div>`;
  }
  return `<div ${base} style="${style}"></div>`;
}

function buildHtml(windows: any[], durationUs: number): string {
  const durS = (durationUs / 1e6).toFixed(3);
  const divs = windows.map((w, i) => renderWindow(w, i)).join("\n");
  return `<!doctype html>\n<html><head><meta charset="utf-8"><style>${TEMPLATE_CSS}</style></head>\n<body>\n<div id="stage" data-composition-id="mystudio-overlay" data-no-timeline data-start="0" data-duration="${durS}" data-width="${W}" data-height="${H}" data-fps="${FPS}">\n${divs}\n</div></body></html>`;
}

// ── 决策表(与 adapter.py 同款) ──
const TEMPLATES = ["light-leak","film-grain","lens-flare","vignette-pulse","particle-dust","letterbox-cinematic","highlight-box",
  "ink-bloom","mist-drift","gold-flecks","brush-sweep","paper-breath","candle-flicker","moon-glow","rain-streaks","snow-drift","aura-pulse","sword-flash","seal-glow","dust-motes"];
const DEFAULTS: Record<string, Record<string, number>> = {
  "light-leak": { intensity: .42, hue: 0 }, "film-grain": { opacity: .2 },
  "lens-flare": { x: 18, y: 24, size: 260 }, "vignette-pulse": { darkness: .42, speed: 2.4 },
  "particle-dust": { count: 40, speed: 7 }, "letterbox-cinematic": { barHeight: 12, fadeIn: .25 },
  "highlight-box": { x: 50, y: 50 }, "ink-bloom": { intensity: .5, x: 50, y: 45 },
  "mist-drift": { opacity: .25, speed: 14 }, "gold-flecks": { count: 8, intensity: .5 },
  "brush-sweep": { hue: 210, speed: 3 }, "paper-breath": { warmth: .15, speed: 6 },
  "candle-flicker": { intensity: .4, x: 70, y: 65 }, "moon-glow": { x: 24, y: 22, size: 260 },
  "rain-streaks": { count: 10, speed: 1.2 }, "snow-drift": { count: 10, speed: 9 },
  "aura-pulse": { intensity: .35, speed: 2.5 }, "sword-flash": { angle: 24 },
  "seal-glow": { intensity: .3 }, "dust-motes": { count: 12, speed: 18 },
};
const ENH: Record<string, [string, Record<string, number>]> = {
  "crossfade": ["mist-drift", { opacity: .22, speed: 12 }], "fade": ["paper-breath", { warmth: .12, speed: 5 }],
  "flash": ["sword-flash", { angle: 24 }], "blackout": ["seal-glow", { intensity: .25 }],
};
const glE = (n: string): [string, Record<string, number>] => {
  if (/zoom|scale|push|slide|wipe|directional|leftright|radial/i.test(n)) return ["brush-sweep", { hue: 210, speed: 2 }];
  if (/dissolve|melt|wave|swap|fade|pixel|butterfly|mosaic|polka/i.test(n)) return ["ink-bloom", { intensity: .45, x: 50, y: 45 }];
  if (/glitch|morph|burn|dreamy|cross/i.test(n)) return ["aura-pulse", { intensity: .4, speed: 2 }];
  return ["dust-motes", { count: 12, speed: 14 }];
};

// ── 主逻辑 ──
function main() {
  const q = JSON.parse(fs.readFileSync(QUEUE, "utf8"));
  const jobs = (q as any).jobs ?? (q as any).state.jobs;
  const plan = jobs.filter((j: any) => j?.job?.target?.kind === "chapter").pop().plan;
  const clips = plan.clips.filter((c: any) => c.trackKind === "video" || c.trackKind === "image")
    .filter((c: any) => c.id.startsWith("visual-sb")).sort((a: any, b: any) => a.id.localeCompare(b.id));
  const trs = new Map(plan.transitions.map((t: any) => [t.fromClipId, t]));
  const starts: number[] = []; let acc = 0;
  for (const c of clips) {
    starts.push(acc);
    const t = trs.get(c.id);
    acc += Math.round(c.durationUs * FPS / 1e6) - (t && t.effectId !== "cut" ? Math.round(t.durationUs * FPS / 1e6) : 0);
  }
  const windows: any[] = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i], start = starts[i];
    const t = trs.get(clip.id);
    const next = i + 1 < starts.length ? starts[i + 1] : start + 999;
    let enhMs = 0;
    if (t && t.effectId !== "cut") {
      const e = t.effectId.startsWith("gl:") ? glE(t.effectId.slice(3)) : ENH[t.effectId];
      if (e) {
        enhMs = Math.min(Math.round(t.durationUs / 1000), Math.max(1, next - start - 1), 1100);
        windows.push({ slotId: `teh-${clip.id}`, cueId: `teh-${i+1}`, startUs: Math.round((next - enhMs) * 1e6 / FPS), durationUs: enhMs * 1000, templateId: e[0], parameters: e[1] });
      }
    }
    const tid = TEMPLATES[i % TEMPLATES.length];
    const decMs = Math.min(Math.round(clip.durationUs / 1000), next - start - enhMs, 1100);
    if (decMs > 0) {
      const params = { ...DEFAULTS[tid] ?? {} };
      if (tid === "light-leak") params.hue = (i * 31) % 360;
      windows.push({ slotId: `fx-${clip.id}`, cueId: `fx-${i+1}`, startUs: Math.round(start * 1e6 / FPS), durationUs: decMs * 1000, templateId: tid, parameters: params });
    }
  }
  windows.sort((a, b) => a.startUs - b.startUs);
  console.log(`windows: ${windows.length}`);

  // 分段(≤8 窗/段,连续帧边界)
  const segs: any[][] = [];
  for (let i = 0; i < windows.length; i += MAX_PER_SEG) segs.push(windows.slice(i, i + MAX_PER_SEG));
  console.log(`segments: ${segs.length}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const segDir = fs.mkdtempSync(path.join(OUT_DIR, ".hy-segs-"));
  const env = { ...process.env, HYPERFRAMES_BROWSER_PATH: BROWSER };
  const segMovs: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const segWindows = segs[i];
    const segDurUs = Math.max(...segWindows.map((w) => w.startUs + w.durationUs)) - Math.min(...segWindows.map((w) => w.startUs));
    const offsetUs = Math.min(...segWindows.map((w) => w.startUs));
    // 段内窗口时间归零(每段独立渲)
    const localWindows = segWindows.map((w) => ({ ...w, startUs: w.startUs - offsetUs }));
    const html = buildHtml(localWindows, segDurUs + 200_000);
    const segProj = path.join(segDir, `s${String(i + 1).padStart(2, "0")}`);
    fs.mkdirSync(segProj, { recursive: true });
    fs.writeFileSync(path.join(segProj, "index.html"), html, "utf8");
    const segMov = path.join(segDir, `s${String(i + 1).padStart(2, "0")}.mov`);
    console.log(`  段${i + 1}/${segs.length}: ${segWindows.length} 窗, ${(segDurUs / 1e6).toFixed(1)}s`);
    const r = spawnSync(NODE, [CLI, "render", segProj, "--format", "mov", "--output", segMov, "--fps", String(FPS), "--quiet", "--strict-all"], { env, encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) throw new Error(`HY CLI 段${i + 1} 失败(${r.status}): ${(r.stderr || r.stdout || "").slice(-300)}`);
    segMovs.push(segMov);
  }
  // ffmpeg 拼接
  if (segMovs.length === 1) { fs.copyFileSync(segMovs[0], OVERLAY_MOV); }
  else {
    const listFile = path.join(segDir, "concat.txt");
    fs.writeFileSync(listFile, segMovs.map((f) => `file '${f}'`).join("\n"), "utf8");
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", OVERLAY_MOV], { encoding: "utf8" });
  }
  fs.rmSync(segDir, { recursive: true, force: true });
  const stat = fs.statSync(OVERLAY_MOV);
  console.log(`✅ overlay 渲成: ${OVERLAY_MOV} (${(stat.size / 1e6).toFixed(1)}MB)`);
}
main();
