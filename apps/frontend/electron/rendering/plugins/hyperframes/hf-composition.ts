import { HyperFramesOverlayRequestV1 } from "@rendering/contracts/video-workflow";
import { isRegistryTemplate, materializeRegistryTemplate } from "./hf-templates";
import { renderWindow } from "./hf-window";

/**
 * HyperFrames 组装——合成 HTML/降级清单/CLI 参数。file-size-reduction P1 拆出,体逐字保留。
 */
export function collectDegradedRegistryTemplates(request: HyperFramesOverlayRequestV1): string[] {
  const degraded = new Set<string>();
  for (const window of request.windows) {
    if (isRegistryTemplate(window.templateId) && materializeRegistryTemplate(window.templateId) === null) {
      degraded.add(window.templateId);
    }
  }
  return [...degraded];
}

export function buildHyperFramesCompositionHtml(request: HyperFramesOverlayRequestV1, durationUs?: number): string {
  const derivedDurationUs = Math.max(...request.windows.map((window) => window.startUs + window.durationUs), 1_000);
  const compositionDurationUs = durationUs ?? derivedDurationUs;
  if (!Number.isSafeInteger(compositionDurationUs) || compositionDurationUs <= 0) {
    throw new Error("HyperFrames composition 时长必须是正整数微秒");
  }
  const durationS = compositionDurationUs / 1_000_000;
  // 同段内同模板只渲染首个窗:模板 DOM id 全局唯一,重复渲染必串台
  // (跨段无碍——每段是独立 composition 文档)
  const renderedRegistryBodies = new Set<string>();
  const windows = request.windows
    .map((window, index) => {
      if (!isRegistryTemplate(window.templateId)) return renderWindow(window, index);
      if (renderedRegistryBodies.has(window.templateId)) {
        console.warn(`[hyperframes-worker] ${window.templateId} 同段重复选用,后续窗口丢弃(重复 DOM id 会串台)`);
        return "";
      }
      renderedRegistryBodies.add(window.templateId);
      return renderWindow(window, index);
    })
    .join("\n");
  // 收集 hy:* registry 模板的物化产物:styles/scripts/JS库/字体/数据 注入 composition
  const registryStyles: string[] = [];
  const registryScripts: string[] = [];
  const registryLibScripts: string[] = [];
  const registryFontStyles: string[] = [];
  const registryDataPreloads: string[] = [];
  const seenLibRels = new Set<string>();
  const seenTemplates = new Set<string>(); // 同模板多窗:body 逐窗渲染,脚本/样式只注入一次
  for (const window of request.windows) {
    if (isRegistryTemplate(window.templateId)) {
      const template = materializeRegistryTemplate(window.templateId);
      if (!template) continue; // 依赖缺失,renderWindow 已同步降级丢弃
      if (seenTemplates.has(window.templateId)) continue;
      seenTemplates.add(window.templateId);
      if (template.styles) registryStyles.push(template.styles);
      if (template.scripts) {
        // 每模板独立 IIFE+try/catch:34 个非 IIFE 模板的顶层标识符互不冲突,
        // 单模板脚本失败不连坐(此前多模板脚本拼进同一 <script>,一错全灭)
        const tag = window.templateId.replace(/[^A-Za-z0-9:-]/g, "");
        registryScripts.push(`;(function(){try{\n${template.scripts}\n}catch(e){console.warn('[hy-registry:${tag}] script failed:',e)}})();`);
      }
      if (template.fontStyles) registryFontStyles.push(template.fontStyles);
      if (template.dataPreload) registryDataPreloads.push(template.dataPreload);
      // 同一库多窗复用时只内联一次:以内容前缀粗判去重(libScripts 按模板聚合)
      for (const lib of template.libScripts) {
        const key = lib.slice(0, 128);
        if (seenLibRels.has(key)) continue;
        seenLibRels.add(key);
        registryLibScripts.push(lib);
      }
    }
  }
  const registryHeadInjection = [
    registryFontStyles.length ? `<style>/* --- Registry fonts (inlined, data-URI) --- */\n${registryFontStyles.join("\n")}\n</style>` : "",
    registryLibScripts.length || registryDataPreloads.length
      ? `<script>/* --- Registry deps (inlined) --- */\n${registryDataPreloads.join("\n")}\n${registryLibScripts.join("\n;\n")}\n</script>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
#stage{position:relative;width:${request.width}px;height:${request.height}px;background:transparent;overflow:hidden}
.clip{position:absolute;transform:translate(-50%,-50%);opacity:0;white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-weight:700;text-shadow:0 3px 12px rgba(0,0,0,.45);animation:hf-in .24s ease-out forwards}
.clip.hy-registry-window{transform:none;left:0;top:0;white-space:normal;opacity:1;animation:none;text-shadow:none;font-weight:400}
.hf-caption{padding:.22em .48em;border-radius:.22em;background:rgba(0,0,0,.48);letter-spacing:.02em}
.hf-title{letter-spacing:.04em}
.hf-highlight{width:24%;height:14%;border:4px solid currentColor;border-radius:18px;box-shadow:0 0 26px currentColor}

/* --- Cinematic overlay templates --- */
.hf-light-leak{width:100%;height:100%;left:0;top:0;transform:none;opacity:calc(var(--hf-intensity,.6));background:radial-gradient(ellipse at 30% 20%,hsla(var(--hf-hue,30deg),90%,60%,.7) 0%,hsla(calc(var(--hf-hue,30deg) + 40deg),80%,50%,.3) 35%,transparent 70%);mix-blend-mode:screen;animation:hf-leak-drift 8s ease-in-out infinite alternate}
@keyframes hf-leak-drift{from{transform:translateX(-3%) scale(1.05)}to{transform:translateX(3%) scale(1.1)}}

.hf-film-grain{width:100%;height:100%;left:0;top:0;transform:none;opacity:var(--hf-grain-opacity,.15);background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .6 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");mix-blend-mode:overlay;animation:hf-grain-shift .15s steps(4) infinite}
@keyframes hf-grain-shift{from{transform:translate(0,0)}to{transform:translate(-8px,-8px)}}

.hf-lens-flare{transform:translate(-50%,-50%);width:var(--hf-flare-size,200px);height:var(--hf-flare-size,200px);background:radial-gradient(circle,rgba(255,255,255,.8) 0%,rgba(255,200,100,.4) 8%,rgba(100,150,255,.15) 20%,transparent 40%);mix-blend-mode:screen;animation:hf-flare-pulse 4s ease-in-out infinite alternate}
@keyframes hf-flare-pulse{from{opacity:.5;transform:translate(-50%,-50%) scale(.9)}to{opacity:1;transform:translate(-50%,-50%) scale(1.1)}}

.hf-vignette-pulse{width:100%;height:100%;left:0;top:0;transform:none;background:radial-gradient(ellipse at center,transparent 40%,rgba(0,0,0,var(--hf-vignette,.5)) 100%);animation:hf-vignette-breath var(--hf-pulse-speed,2s) ease-in-out infinite alternate}
@keyframes hf-vignette-breath{from{opacity:.7}to{opacity:1}}

.hf-particle-dust{width:100%;height:100%;left:0;top:0;transform:none}
.hf-dust-particle{position:absolute;width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.4);box-shadow:0 0 4px rgba(255,255,255,.2);animation:hf-dust-float linear infinite}
@keyframes hf-dust-float{0%{transform:translate(0,0) scale(.5);opacity:0}20%{opacity:.6}80%{opacity:.4}100%{transform:translate(20px,-60px) scale(1);opacity:0}}

.hf-letterbox{width:100%;height:100%;left:0;top:0;transform:none;opacity:0;animation:hf-letterbox-in var(--hf-letterbox-fade,.5s) ease-out forwards}
/* 08-18-hy-effects Phase 1 本地自写装饰模板——CSS 与 renderWindow 分支一一对应。
   全部 mix-blend-mode:screen/overlay+透明渐变(alpha overlay 语义);渐变/滤镜元素数
   控制在 lint 阈值内(单窗<30)。 */
.hf-ink-bloom{width:60%;height:60%;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,hsla(220,15%,30%,calc(var(--hf-ink,.5)*.55)) 0%,hsla(220,10%,40%,calc(var(--hf-ink,.5)*.28)) 40%,transparent 70%);mix-blend-mode:multiply;animation:hf-ink-spread 7s ease-out infinite}
@keyframes hf-ink-spread{0%{transform:translate(-50%,-50%) scale(.4);opacity:0}30%{opacity:1}100%{transform:translate(-50%,-50%) scale(1.25);opacity:.25}}
.hf-mist-drift{width:100%;height:100%;left:0;top:0;background:radial-gradient(ellipse 60% 38% at 30% 72%,hsla(210,20%,88%,var(--hf-mist,.25)),transparent 70%),radial-gradient(ellipse 50% 30% at 70% 40%,hsla(200,15%,85%,calc(var(--hf-mist,.25)*.7)),transparent 70%);mix-blend-mode:screen;animation:hf-mist-move var(--hf-mist-speed,14s) ease-in-out infinite alternate}
@keyframes hf-mist-move{from{transform:translateX(-6%)}to{transform:translateX(6%)}}
.hf-gold-flecks{width:100%;height:100%;left:0;top:0}
.hf-fleck{position:absolute;width:5px;height:5px;border-radius:50%;background:radial-gradient(circle,hsla(43,90%,68%,.9),transparent 70%);opacity:calc(var(--hf-fleck,.5)*.9);mix-blend-mode:screen;animation:hf-fleck-float 5s ease-in-out infinite alternate}
@keyframes hf-fleck-float{from{transform:translateY(0) scale(.8)}to{transform:translateY(-26px) scale(1.15)}}
.hf-brush-sweep{width:100%;height:100%;left:0;top:0;background:linear-gradient(105deg,transparent 30%,hsla(var(--hf-brush-hue,210deg),35%,72%,.34) 47%,hsla(calc(var(--hf-brush-hue,210deg) + 24deg),45%,80%,.5) 50%,hsla(var(--hf-brush-hue,210deg),35%,72%,.34) 53%,transparent 70%);mix-blend-mode:screen;animation:hf-brush-move var(--hf-brush-speed,3s) ease-in-out infinite}
@keyframes hf-brush-move{0%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
.hf-paper-breath{width:100%;height:100%;left:0;top:0;background:radial-gradient(ellipse at 50% 45%,hsla(38,42%,86%,calc(var(--hf-warmth,.15)*.8)),transparent 75%);mix-blend-mode:soft-light;animation:hf-paper-pulse var(--hf-breath-speed,6s) ease-in-out infinite alternate}
@keyframes hf-paper-pulse{from{opacity:.55}to{opacity:1}}
.hf-candle-flicker{width:55%;height:55%;transform:translate(-50%,-50%);background:radial-gradient(circle,hsla(36,88%,64%,calc(var(--hf-candle,.4)*.85)) 0%,hsla(28,80%,52%,calc(var(--hf-candle,.4)*.4)) 45%,transparent 72%);mix-blend-mode:overlay;animation:hf-candle-flk 1.6s steps(3,end) infinite alternate}
@keyframes hf-candle-flk{0%{transform:translate(-50%,-50%) scale(1)}40%{transform:translate(-50%,-50%) scale(1.08) translateY(-1%)}100%{transform:translate(-50%,-50%) scale(.94)}}
.hf-moon-glow{width:var(--hf-moon-size,260px);height:var(--hf-moon-size,260px);transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,hsla(210,30%,92%,.95) 0%,hsla(205,32%,84%,.6) 32%,hsla(200,28%,78%,.25) 55%,transparent 72%);mix-blend-mode:screen;animation:hf-moon-breathe 9s ease-in-out infinite alternate}
@keyframes hf-moon-breathe{from{filter:brightness(.92)}to{filter:brightness(1.08)}}
.hf-rain-streaks{width:100%;height:100%;left:0;top:0}
.hf-rain{position:absolute;top:-12%;width:1.5px;height:13%;background:linear-gradient(to bottom,transparent,hsla(205,34%,84%,.55),transparent);mix-blend-mode:screen;animation:hf-rain-fall linear infinite}
@keyframes hf-rain-fall{to{transform:translateY(125vh)}}
.hf-snow-drift{width:100%;height:100%;left:0;top:0}
.hf-snow{position:absolute;top:-6%;width:6px;height:6px;border-radius:50%;background:radial-gradient(circle,hsla(0,0%,98%,.9),transparent 75%);mix-blend-mode:screen;animation:hf-snow-fall ease-in-out infinite}
@keyframes hf-snow-fall{to{transform:translate(24px,115vh)}}
.hf-aura-pulse{width:100%;height:100%;left:0;top:0;background:radial-gradient(circle at 50% 52%,transparent 34%,hsla(160,55%,70%,calc(var(--hf-aura,.35)*.5)) 48%,transparent 62%);mix-blend-mode:screen;animation:hf-aura-ring var(--hf-aura-speed,2.5s) ease-in-out infinite}
@keyframes hf-aura-ring{0%{transform:scale(.85);opacity:.2}50%{opacity:1}100%{transform:scale(1.1);opacity:.2}}
.hf-sword-flash{width:100%;height:100%;left:0;top:0;background:linear-gradient(to bottom,transparent 46%,hsla(48,95%,88%,.9) 50%,transparent 54%);mix-blend-mode:screen;animation:hf-sword-slash 2.4s ease-out infinite}
@keyframes hf-sword-slash{0%{transform:rotate(var(--hf-sword-angle,24deg)) translateX(-90%);opacity:0}18%{opacity:1}45%{transform:rotate(var(--hf-sword-angle,24deg)) translateX(70%);opacity:0}100%{opacity:0}}
.hf-seal-glow{width:34%;height:26%;right:4%;bottom:6%;background:radial-gradient(ellipse,hsla(6,72%,52%,calc(var(--hf-seal,.3)*.75)),transparent 70%);mix-blend-mode:screen;animation:hf-seal-pulse 4.5s ease-in-out infinite alternate}
@keyframes hf-seal-pulse{from{opacity:.4}to{opacity:1}}
/* 2026-08-19 动画手法：速度线/冲击波纹/呼吸光 */
.hf-speed-lines{width:100%;height:100%;left:0;top:0;transform:none;--hf-sp-count:24;opacity:var(--hf-speed,.5);background:repeating-conic-gradient(from var(--hf-speed-dir,0deg) at 50% 50%,transparent 0deg,rgba(255,255,255,.6) .5deg,transparent 1deg,transparent 15deg);mask-image:radial-gradient(circle,transparent 20%,black 40%,black 100%);-webkit-mask-image:radial-gradient(circle,transparent 20%,black 40%,black 100%);mix-blend-mode:screen;animation:hf-speed-pulse .15s steps(2) infinite}
@keyframes hf-speed-pulse{from{opacity:calc(var(--hf-speed,.5)*.7)}to{opacity:var(--hf-speed,.5)}}
.hf-shockwave{width:100%;height:100%;left:0;top:0;transform:none;opacity:var(--hf-wave,.6)}
.hf-shockwave::before,.hf-shockwave::after{content:"";position:absolute;left:50%;top:50%;width:8px;height:8px;border:3px solid rgba(255,255,255,.9);border-radius:50%;transform:translate(-50%,-50%);animation:hf-wave-expand var(--hf-wave-speed,1.5s) ease-out infinite}
.hf-shockwave::after{animation-delay:calc(var(--hf-wave-speed,1.5s)*.3);border-color:rgba(255,220,120,.7)}
@keyframes hf-wave-expand{from{width:8px;height:8px;opacity:1}to{width:120%;height:120%;opacity:0}}
.hf-breathing-light{width:100%;height:100%;left:0;top:0;transform:none;background:radial-gradient(ellipse at 50% 40%,hsla(var(--hf-breathe-hue,45deg),80%,70%,calc(var(--hf-breathe-l,.35)*.5)),transparent 65%);mix-blend-mode:screen;animation:hf-breathe-glow var(--hf-breathe-speed,3s) ease-in-out infinite alternate}
@keyframes hf-breathe-glow{from{opacity:.3}to{opacity:1}}
.hf-dust-motes{width:100%;height:100%;left:0;top:0}
.hf-mote{position:absolute;width:7px;height:7px;border-radius:50%;background:radial-gradient(circle,hsla(44,70%,84%,.5),transparent 72%);mix-blend-mode:screen;animation:hf-mote-drift ease-in-out infinite alternate}
@keyframes hf-mote-drift{from{transform:translate(0,0)}to{transform:translate(18px,-38px)}}
.hf-letterbox::before,.hf-letterbox::after{content:"";position:absolute;left:0;width:100%;height:var(--hf-bar-height,10%);background:#000}
.hf-letterbox::before{top:0}
.hf-letterbox::after{bottom:0}
@keyframes hf-letterbox-in{from{opacity:0}to{opacity:1}}

@keyframes hf-in{from{opacity:0;transform:translate(-50%,-50%) scale(.96)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
${registryStyles.length ? `\n/* --- Registry templates (${registryStyles.length}) --- */\n${registryStyles.join("\n")}\n` : ""}

/* --- 08-21 剪映风格特效 CSS(20 新) --- */
/* 故障/复古类 */
.hf-glitch-rgb{width:100%;height:100%;left:0;top:0;transform:none;mix-blend-mode:screen;opacity:var(--hf-glitch-i,.6);background:linear-gradient(90deg,rgba(255,0,60,.3) 0%,transparent 20%,rgba(0,255,255,.3) 80%,rgba(255,0,60,.3) 100%);animation:hf-glitch-shift var(--hf-glitch-spd,3s) steps(2) infinite}
@keyframes hf-glitch-shift{0%{transform:translateX(0)}25%{transform:translateX(-6px)}50%{transform:translateX(4px)}75%{transform:translateX(-2px)}100%{transform:translateX(0)}}
.hf-glitch-slice{width:100%;height:100%;left:0;top:0;transform:none;overflow:hidden;opacity:var(--hf-slice-i,.5)}
.hf-glitch-strip{position:absolute;left:0;width:100%;height:16%;background:rgba(0,255,240,.08);border-top:1px solid rgba(255,0,60,.3);animation:hf-strip-jitter .3s steps(3) infinite}
@keyframes hf-strip-jitter{0%{transform:translateX(0)}50%{transform:translateX(8px)}100%{transform:translateX(-4px)}}
.hf-glitch-scanline{width:100%;height:100%;left:0;top:0;transform:none;opacity:var(--hf-scan-i,.4);background:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,255,255,.15) 2px 3px);animation:hf-scan-move var(--hf-scan-spd,8s) linear infinite}
@keyframes hf-scan-move{from{background-position-y:0}to{background-position-y:100px}}
.hf-vhs-rewind{width:100%;height:100%;left:0;top:0;transform:none;opacity:var(--hf-vhs-i,.5);background:linear-gradient(180deg,hsla(var(--hf-vhs-hue,280deg),80%,60%,.15) 0%,transparent 40%,hsla(120,80%,60%,.1) 100%);mix-blend-mode:screen;animation:hf-vhs-noise .2s steps(2) infinite}
@keyframes hf-vhs-noise{0%{filter:hue-rotate(0deg) contrast(1.2)}50%{filter:hue-rotate(30deg) contrast(1.4)}100%{filter:hue-rotate(0deg) contrast(1.2)}}
.hf-pixel-blur{width:100%;height:100%;left:0;top:0;transform:none;opacity:var(--hf-pixel-i,.5);backdrop-filter:blur(var(--hf-pixel-size,12px)) contrast(1.5) saturate(1.5);animation:hf-pixel-pulse 2s ease-in-out infinite alternate}
@keyframes hf-pixel-pulse{from{opacity:var(--hf-pixel-i,.5)}to{opacity:calc(var(--hf-pixel-i,.5) * .5)}}

/* 光效/粒子类 */
.hf-strobe-flash{width:100%;height:100%;left:0;top:0;transform:none;background:hsla(var(--hf-strobe-hue,60deg),100%,80%,.6);mix-blend-mode:screen;animation:hf-strobe-blink var(--hf-strobe-spd,4s) steps(1) infinite}
@keyframes hf-strobe-blink{0%,49%{opacity:0}50%,54%{opacity:.7}55%,100%{opacity:0}}
.hf-neon-glow{width:100%;height:100%;left:0;top:0;transform:none;background:radial-gradient(ellipse at 50% 50%,hsla(var(--hf-neon-hue,190deg),100%,60%,calc(var(--hf-neon-i,.7)*.3)),hsla(calc(var(--hf-neon-hue,190deg) + 60deg),100%,50%,calc(var(--hf-neon-i,.7)*.1)) 50%,transparent 80%);mix-blend-mode:screen;animation:hf-neon-pulse 2s ease-in-out infinite alternate}
@keyframes hf-neon-pulse{from{filter:brightness(1)}to{filter:brightness(1.4)}}
.hf-bokeh-lights{width:100%;height:100%;left:0;top:0}
.hf-bokeh{position:absolute;border-radius:50%;background:radial-gradient(circle,hsla(var(--hf-bokeh-hue,40deg),80%,70%,.5) 0%,transparent 70%);mix-blend-mode:screen;animation:hf-bokeh-drift ease-in-out infinite alternate}
@keyframes hf-bokeh-drift{from{transform:translate(0,0) scale(.8);opacity:.4}to{transform:translate(15px,-25px) scale(1.1);opacity:.7}}
.hf-star-twinkle{width:100%;height:100%;left:0;top:0}
.hf-star{position:absolute;width:8px;height:8px;background:radial-gradient(circle,white 0%,rgba(255,255,200,.5) 40%,transparent 70%);clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);animation:hf-star-blink ease-in-out infinite alternate}
@keyframes hf-star-blink{from{opacity:.2;transform:scale(.6) rotate(0deg)}to{opacity:1;transform:scale(1.2) rotate(15deg)}}
.hf-confetti-burst{width:100%;height:100%;left:0;top:0}
.hf-confetti{position:absolute;top:-3%;width:10px;height:16px;border-radius:2px;animation:hf-confetti-fall linear infinite}
@keyframes hf-confetti-fall{from{transform:translateY(-10px) rotate(0deg);opacity:1}to{transform:translateY(110vh) rotate(360deg);opacity:.6}}
.hf-heart-float{width:100%;height:100%;left:0;top:0}
.hf-heart{position:absolute;bottom:-5%;color:rgba(255,80,120,.7);text-shadow:0 0 10px rgba(255,80,120,.4);animation:hf-heart-up linear infinite}
@keyframes hf-heart-up{from{transform:translateY(0) scale(.8);opacity:.8}to{transform:translateY(-110vh) scale(1.2) rotate(20deg);opacity:.3}}
.hf-bubble-rise{width:100%;height:100%;left:0;top:0}
.hf-bubble{position:absolute;bottom:-5%;border-radius:50%;border:2px solid rgba(100,200,255,.3);background:radial-gradient(circle at 30% 30%,rgba(255,255,255,.3),rgba(100,200,255,.1) 60%,transparent);animation:hf-bubble-up linear infinite}
@keyframes hf-bubble-up{from{transform:translateY(0);opacity:.5}to{transform:translateY(-110vh) translateX(10px);opacity:.2}}

/* 动态/过渡类 */
.hf-zoom-pulse{width:100%;height:100%;left:0;top:0;transform:scale(1);backdrop-filter:brightness(1.05);animation:hf-zoom-breath var(--hf-zoom-spd,2s) ease-in-out infinite alternate}
@keyframes hf-zoom-breath{from{transform:scale(1)}to{transform:scale(calc(1 + var(--hf-zoom-i,.06)))}}
.hf-shake-eq{width:100%;height:100%;left:0;top:0;transform:none;animation:hf-shake-rumble var(--hf-shake-spd,.1s) linear infinite}
@keyframes hf-shake-rumble{0%{transform:translate(var(--hf-shake-i,8px),0)}25%{transform:translate(calc(var(--hf-shake-i,8px) * -.5),calc(var(--hf-shake-i,8px) * .5))}50%{transform:translate(calc(var(--hf-shake-i,8px) * .7),calc(var(--hf-shake-i,8px) * -.3))}75%{transform:translate(calc(var(--hf-shake-i,8px) * -.3),calc(var(--hf-shake-i,8px) * .7))}100%{transform:translate(var(--hf-shake-i,8px),0)}}
.hf-wobble-jelly{width:100%;height:100%;left:0;top:0;transform:none;animation:hf-wobble-jello var(--hf-wobble-spd,3s) ease-in-out infinite}
@keyframes hf-wobble-jello{0%,100%{transform:skewX(0deg) skewY(0deg)}25%{transform:skewX(calc(var(--hf-wobble-i,.02) * 100deg)) skewY(calc(var(--hf-wobble-i,.02) * -50deg))}50%{transform:skewX(calc(var(--hf-wobble-i,.02) * -100deg)) skewY(calc(var(--hf-wobble-i,.02) * 50deg))}75%{transform:skewX(calc(var(--hf-wobble-i,.02) * 50deg)) skewY(0deg)}}
.hf-spin-hypnotic{left:50%;top:50%;width:var(--hf-spin-size,300px);height:var(--hf-spin-size,300px);border-radius:50%;border:6px dashed rgba(255,255,255,.3);border-top-color:rgba(100,200,255,.5);border-bottom-color:rgba(255,100,200,.5);animation:hf-spin-rotate var(--hf-spin-spd,8s) linear infinite}
@keyframes hf-spin-rotate{from{transform:translate(-50%,-50%) rotate(0deg)}to{transform:translate(-50%,-50%) rotate(360deg)}}
.hf-ripple-water{width:200px;height:200px;border-radius:50%;border:3px solid rgba(100,200,255,.4);animation:hf-ripple-expand var(--hf-ripple-spd,2s) ease-out infinite}
@keyframes hf-ripple-expand{from{transform:translate(-50%,-50%) scale(.2);opacity:.8}to{transform:translate(-50%,-50%) scale(3);opacity:0}}
.hf-fade-dip-black{width:100%;height:100%;left:0;top:0;transform:none;background:#000;animation:hf-dip-blink var(--hf-dip-hold,.3s) linear infinite}
@keyframes hf-dip-blink{0%,100%{opacity:0}50%{opacity:.8}}
.hf-flash-white{width:100%;height:100%;left:0;top:0;transform:none;background:white;animation:hf-flash-blink var(--hf-flash-hold,.15s) ease-out infinite}
@keyframes hf-flash-blink{0%{opacity:.9}100%{opacity:0}}
.hf-dream-soft{width:100%;height:100%;left:0;top:0;transform:none;backdrop-filter:blur(var(--hf-dream-blur,6px)) brightness(1.1) saturate(1.2);background:radial-gradient(ellipse at 50% 40%,rgba(255,200,255,calc(var(--hf-dream-glow,.4)*.3)),transparent 70%);mix-blend-mode:soft-light;animation:hf-dream-breathe 3s ease-in-out infinite alternate}
@keyframes hf-dream-breathe{from{opacity:var(--hf-dream-glow,.4)}to{opacity:calc(var(--hf-dream-glow,.4) * .6)}}

</style>${registryHeadInjection}</head><body><div id="stage" data-composition-id="mystudio-overlay" data-no-timeline data-start="0" data-duration="${durationS}" data-width="${request.width}" data-height="${request.height}" data-fps="${request.fps}">
${windows}
</div>${registryScripts.length ? `<script>\n${registryScripts.join("\n")}\n</script>` : ""}<script>
window.__timelines = window.__timelines || {};
window.__timelines["mystudio-overlay"] = {
  duration: () => ${durationS},
  totalDuration: () => ${durationS},
  getChildren: () => [],
  pause: () => undefined,
  play: () => undefined,
  seek: () => undefined,
  totalTime: () => undefined
};
</script></body></html>\n`;
}

export function buildHyperFramesCliArgs(projectDir: string, request: HyperFramesOverlayRequestV1, outputPath = request.outputPath): string[] {
  const format = request.alphaFormat === "prores-4444-mov" ? "mov" : request.alphaFormat === "webm-vp9-alpha" ? "webm" : "png-sequence";
  // registry 模板源码(上游 HTML)普遍含 Math.random/rAF/未作用域选择器,--strict-all
  // 严格 lint 必拒(08-22 实证);仅纯本地合成保留 strict,registry 合成放宽 lint 仍走同渲染器
  const strict = request.windows.some((w) => isRegistryTemplate(w.templateId)) ? [] : ["--strict-all"];
  return ["render", projectDir, "--format", format, "--output", outputPath, "--fps", String(request.fps), "--quiet", ...strict];
}

