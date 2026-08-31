import { HyperFramesSegmentWindow, SUPPORTED_TEMPLATES, animationPhaseStyle, escapeHtml, numberParameter, textParameter } from "./hf-shared";
import { isRegistryTemplate, materializeRegistryTemplate } from "./hf-templates";

/**
 * HyperFrames 窗口渲染——单窗口 HTML 生成(renderWindow)。file-size-reduction P1 拆出,体逐字保留。
 */
export function renderWindow(window: HyperFramesSegmentWindow, index: number): string {
  // hy:* registry 模板:加载外部 HTML 并包装为定位容器
  if (isRegistryTemplate(window.templateId)) {
    const template = materializeRegistryTemplate(window.templateId);
    if (!template) return ""; // 依赖缺失已告警,降级丢弃该窗不阻塞渲染
    const startS = window.startUs / 1_000_000;
    const durationS = window.durationUs / 1_000_000;
    // class="clip" 是运行时按 data-start/data-duration 控可见性的钩子;
    // .clip 基础样式假设"居中点定位",registry 全幅窗用专属规则抵消
    const id = `hyr-${window.templateId.replace(/[^A-Za-z0-9-]/g, "-")}-${index + 1}`;
    return `<div id="${id}" class="clip hy-registry-window" data-template="${window.templateId}" data-start="${startS}" data-duration="${durationS}" style="position:absolute;inset:0;width:100%;height:100%;overflow:hidden;">${template.body}</div>`;
  }
  if (!SUPPORTED_TEMPLATES.has(window.templateId)) {
    throw new Error(`不支持的 HyperFrames templateId: ${window.templateId}`);
  }
  const parameters = window.parameters;
  const left = numberParameter(parameters, "x", 50, 0, 100);
  const top = numberParameter(parameters, "y", 50, 0, 100);
  const fontSize = numberParameter(parameters, "fontSize", 64, 12, 240);
  const color = typeof parameters.color === "string" && /^#[0-9a-fA-F]{6}$/.test(parameters.color)
    ? parameters.color
    : "#ffffff";
  const text = escapeHtml(textParameter(parameters, window.slotId));
  const elementId = `hf-${window.slotId.replace(/[^A-Za-z0-9_-]/g, "-")}-${index + 1}`;
  const startS = window.startUs / 1_000_000;
  const durationS = window.durationUs / 1_000_000;
  const phaseStyle = animationPhaseStyle(window);
  const phaseOffsetS = window.animationOffsetUs && window.animationOffsetUs > 0 ? window.animationOffsetUs / 1_000_000 : 0;

  // --- Cinematic overlay templates (full-frame, no text) ---
  switch (window.templateId) {
    case "light-leak": {
      const intensity = numberParameter(parameters, "intensity", 0.6, 0, 1);
      const hue = numberParameter(parameters, "hue", 30, 0, 360);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-light-leak" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-intensity:${intensity};--hf-hue:${hue}deg;"></div>`;
    }
    case "film-grain": {
      const opacity = numberParameter(parameters, "opacity", 0.15, 0, 1);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-film-grain" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-grain-opacity:${opacity};"></div>`;
    }
    case "lens-flare": {
      const xPos = numberParameter(parameters, "x", 50, 0, 100);
      const yPos = numberParameter(parameters, "y", 30, 0, 100);
      const size = numberParameter(parameters, "size", 200, 50, 800);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-lens-flare" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}left:${xPos}%;top:${yPos}%;--hf-flare-size:${size}px;"></div>`;
    }
    case "vignette-pulse": {
      const darkness = numberParameter(parameters, "darkness", 0.5, 0, 1);
      const speed = numberParameter(parameters, "speed", 2, 0.5, 10);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-vignette-pulse" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-vignette:${darkness};--hf-pulse-speed:${speed}s;"></div>`;
    }
    case "particle-dust": {
      const count = numberParameter(parameters, "count", 30, 5, 100);
      const speed = numberParameter(parameters, "speed", 8, 1, 30);
      let particles = "";
      for (let i = 0; i < count; i++) {
        const px = Math.round((i * 37) % 100);
        const py = Math.round((i * 53) % 100);
        // CSS negative delays start each particle at its global animation
        // phase. Adding the offset would replay the crossing segment instead.
        const delay = (((i * 0.3) % 3) - phaseOffsetS).toFixed(1);
        particles += `<span class="hf-dust-particle" style="left:${px}%;top:${py}%;animation-delay:${delay}s;animation-duration:${speed}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-particle-dust" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${particles}</div>`;
    }
    case "letterbox-cinematic": {
      const barHeight = numberParameter(parameters, "barHeight", 10, 0, 25);
      const fadeS = numberParameter(parameters, "fadeIn", 0.5, 0, 3);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-letterbox" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-bar-height:${barHeight}%;--hf-letterbox-fade:${fadeS}s;"></div>`;

    }
    // --- 08-18-hy-effects Phase 1 本地自写装饰模板 ---
    case "ink-bloom": {
      const intensity = numberParameter(parameters, "intensity", 0.5, 0, 1);
      const xPos = numberParameter(parameters, "x", 50, 0, 100);
      const yPos = numberParameter(parameters, "y", 45, 0, 100);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-ink-bloom" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}left:${xPos}%;top:${yPos}%;--hf-ink:${intensity};"></div>`;
    }
    case "mist-drift": {
      const opacity = numberParameter(parameters, "opacity", 0.25, 0, 1);
      const speed = numberParameter(parameters, "speed", 14, 4, 40);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-mist-drift" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-mist:${opacity};--hf-mist-speed:${speed}s;"></div>`;
    }
    case "gold-flecks": {
      const count = Math.round(numberParameter(parameters, "count", 8, 3, 12));
      const intensity = numberParameter(parameters, "intensity", 0.5, 0, 1);
      let flecks = "";
      for (let i = 0; i < count; i++) {
        const px = Math.round((i * 41) % 100);
        const py = Math.round((i * 61) % 100);
        const delay = (((i * 0.4) % 4) - phaseOffsetS).toFixed(1);
        flecks += `<span class="hf-fleck" style="left:${px}%;top:${py}%;animation-delay:${delay}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-gold-flecks" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}--hf-fleck:${intensity};"` : ""}>${flecks}</div>`;
    }
    case "brush-sweep": {
      const hue = numberParameter(parameters, "hue", 210, 0, 360);
      const speed = numberParameter(parameters, "speed", 3, 1, 10);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-brush-sweep" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-brush-hue:${hue}deg;--hf-brush-speed:${speed}s;"></div>`;
    }
    case "paper-breath": {
      const warmth = numberParameter(parameters, "warmth", 0.15, 0, 1);
      const speed = numberParameter(parameters, "speed", 6, 2, 20);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-paper-breath" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-warmth:${warmth};--hf-breath-speed:${speed}s;"></div>`;
    }
    case "candle-flicker": {
      const intensity = numberParameter(parameters, "intensity", 0.4, 0, 1);
      const xPos = numberParameter(parameters, "x", 70, 0, 100);
      const yPos = numberParameter(parameters, "y", 65, 0, 100);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-candle-flicker" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}left:${xPos}%;top:${yPos}%;--hf-candle:${intensity};"></div>`;
    }
    case "moon-glow": {
      const xPos = numberParameter(parameters, "x", 24, 0, 100);
      const yPos = numberParameter(parameters, "y", 22, 0, 100);
      const size = numberParameter(parameters, "size", 260, 80, 700);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-moon-glow" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}left:${xPos}%;top:${yPos}%;--hf-moon-size:${size}px;"></div>`;
    }
    case "rain-streaks": {
      const count = Math.round(numberParameter(parameters, "count", 10, 4, 14));
      const speed = numberParameter(parameters, "speed", 1.2, 0.4, 4);
      let streaks = "";
      for (let i = 0; i < count; i++) {
        const px = Math.round((i * 29 + 7) % 100);
        const delay = (((i * 0.17) % 1.2) - phaseOffsetS).toFixed(2);
        streaks += `<span class="hf-rain" style="left:${px}%;animation-delay:${delay}s;animation-duration:${speed}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-rain-streaks" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${streaks}</div>`;
    }
    case "snow-drift": {
      const count = Math.round(numberParameter(parameters, "count", 10, 4, 14));
      const speed = numberParameter(parameters, "speed", 9, 3, 25);
      let flakes = "";
      for (let i = 0; i < count; i++) {
        const px = Math.round((i * 43 + 13) % 100);
        const delay = (((i * 0.6) % 5) - phaseOffsetS).toFixed(1);
        flakes += `<span class="hf-snow" style="left:${px}%;animation-delay:${delay}s;animation-duration:${speed}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-snow-drift" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${flakes}</div>`;
    }
    case "aura-pulse": {
      const intensity = numberParameter(parameters, "intensity", 0.35, 0, 1);
      const speed = numberParameter(parameters, "speed", 2.5, 0.5, 8);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-aura-pulse" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-aura:${intensity};--hf-aura-speed:${speed}s;"></div>`;
    }
    case "sword-flash": {
      const angle = numberParameter(parameters, "angle", 24, -60, 60);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-sword-flash" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-sword-angle:${angle}deg;"></div>`;
    }
    case "seal-glow": {
      const intensity = numberParameter(parameters, "intensity", 0.3, 0, 1);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-seal-glow" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-seal:${intensity};"></div>`;
    }
    case "speed-lines": {
      const intensity = numberParameter(parameters, "intensity", 0.5, 0, 1);
      const direction = numberParameter(parameters, "direction", 0, 0, 360);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-speed-lines" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-speed:${intensity};--hf-speed-dir:${direction}deg;"></div>`;
    }
    case "shockwave-ring": {
      const intensity = numberParameter(parameters, "intensity", 0.6, 0, 1);
      const speed = numberParameter(parameters, "speed", 1.5, 0.5, 5);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-shockwave" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-wave:${intensity};--hf-wave-speed:${speed}s;"></div>`;
    }
    case "breathing-light": {
      const intensity = numberParameter(parameters, "intensity", 0.35, 0, 1);
      const speed = numberParameter(parameters, "speed", 3, 1, 10);
      const hue = numberParameter(parameters, "hue", 45, 0, 360);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-breathing-light" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-breathe-l:${intensity};--hf-breathe-speed:${speed}s;--hf-breathe-hue:${hue}deg;"></div>`;
    }
    // --- 08-21 剪映风格特效扩容(20 新模板,3 类) ---
    // 故障/复古类(5)
    case "glitch-rgb": {
      const intensity = numberParameter(parameters, "intensity", 0.6, 0, 1);
      const speed = numberParameter(parameters, "speed", 3, 1, 10);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-glitch-rgb" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-glitch-i:${intensity};--hf-glitch-spd:${speed}s;"></div>`;
    }
    case "glitch-slice": {
      const intensity = numberParameter(parameters, "intensity", 0.5, 0, 1);
      const slices = Math.round(numberParameter(parameters, "slices", 6, 2, 12));
      let strips = "";
      for (let i = 0; i < slices; i++) {
        strips += `<span class="hf-glitch-strip" style="top:${Math.round((i * 100) / slices)}%;animation-delay:${(i * 0.08).toFixed(2)}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-glitch-slice" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}--hf-slice-i:${intensity};"` : ""}>${strips}</div>`;
    }
    case "glitch-scanline": {
      const intensity = numberParameter(parameters, "intensity", 0.4, 0, 1);
      const speed = numberParameter(parameters, "speed", 8, 1, 20);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-glitch-scanline" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-scan-i:${intensity};--hf-scan-spd:${speed}s;"></div>`;
    }
    case "vhs-rewind": {
      const intensity = numberParameter(parameters, "intensity", 0.5, 0, 1);
      const hue = numberParameter(parameters, "hue", 280, 0, 360);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-vhs-rewind" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-vhs-i:${intensity};--hf-vhs-hue:${hue}deg;"></div>`;
    }
    case "pixel-blur": {
      const intensity = numberParameter(parameters, "intensity", 0.5, 0, 1);
      const size = Math.round(numberParameter(parameters, "size", 12, 4, 30));
      return `<div id="${escapeHtml(elementId)}" class="clip hf-pixel-blur" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-pixel-i:${intensity};--hf-pixel-size:${size}px;"></div>`;
    }
    // 光效/粒子类(8)
    case "strobe-flash": {
      const speed = numberParameter(parameters, "speed", 4, 1, 10);
      const color = numberParameter(parameters, "color", 60, 0, 360);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-strobe-flash" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-strobe-spd:${speed}s;--hf-strobe-hue:${color}deg;"></div>`;
    }
    case "neon-glow": {
      const hue = numberParameter(parameters, "hue", 190, 0, 360);
      const intensity = numberParameter(parameters, "intensity", 0.7, 0, 1);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-neon-glow" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-neon-hue:${hue}deg;--hf-neon-i:${intensity};"></div>`;
    }
    case "bokeh-lights": {
      const count = Math.round(numberParameter(parameters, "count", 12, 4, 30));
      const hue = numberParameter(parameters, "hue", 40, 0, 360);
      const speed = numberParameter(parameters, "speed", 5, 1, 15);
      let bokeh = "";
      for (let i = 0; i < count; i++) {
        const bx = Math.round((i * 61 + 13) % 100);
        const by = Math.round((i * 37 + 29) % 100);
        const sz = 30 + ((i * 19) % 60);
        bokeh += `<span class="hf-bokeh" style="left:${bx}%;top:${by}%;width:${sz}px;height:${sz}px;--hf-bokeh-hue:${hue}deg;animation-duration:${(speed + (i % 3)).toFixed(1)}s;animation-delay:${(i * 0.4).toFixed(1)}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-bokeh-lights" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${bokeh}</div>`;
    }
    case "star-twinkle": {
      const count = Math.round(numberParameter(parameters, "count", 15, 5, 40));
      const speed = numberParameter(parameters, "speed", 2, 0.5, 6);
      let stars = "";
      for (let i = 0; i < count; i++) {
        const sx = Math.round((i * 47 + 7) % 100);
        const sy = Math.round((i * 31 + 19) % 100);
        stars += `<span class="hf-star" style="left:${sx}%;top:${sy}%;animation-duration:${(speed + (i % 4) * 0.5).toFixed(1)}s;animation-delay:${(i * 0.15).toFixed(2)}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-star-twinkle" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${stars}</div>`;
    }
    case "confetti-burst": {
      const count = Math.round(numberParameter(parameters, "count", 20, 5, 50));
      const speed = numberParameter(parameters, "speed", 3, 1, 8);
      let confetti = "";
      const colors = ["#f44336", "#e91e63", "#9c27b0", "#2196f3", "#4caf50", "#ff9800", "#ffeb3b"];
      for (let i = 0; i < count; i++) {
        const cx = Math.round((i * 53 + 11) % 100);
        confetti += `<span class="hf-confetti" style="left:${cx}%;background:${colors[i % colors.length]};animation-duration:${(speed + (i % 3) * 0.5).toFixed(1)}s;animation-delay:${(i * 0.1).toFixed(1)}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-confetti-burst" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${confetti}</div>`;
    }
    case "heart-float": {
      const count = Math.round(numberParameter(parameters, "count", 8, 3, 20));
      const speed = numberParameter(parameters, "speed", 4, 1, 10);
      let hearts = "";
      for (let i = 0; i < count; i++) {
        const hx = Math.round((i * 67 + 17) % 100);
        const hs = 14 + ((i * 11) % 20);
        hearts += `<span class="hf-heart" style="left:${hx}%;font-size:${hs}px;animation-duration:${(speed + (i % 3)).toFixed(1)}s;animation-delay:${(i * 0.5).toFixed(1)}s;">♥</span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-heart-float" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${hearts}</div>`;
    }
    case "bubble-rise": {
      const count = Math.round(numberParameter(parameters, "count", 10, 4, 25));
      const speed = numberParameter(parameters, "speed", 6, 2, 15);
      let bubbles = "";
      for (let i = 0; i < count; i++) {
        const bx = Math.round((i * 43 + 23) % 100);
        const bs = 12 + ((i * 17) % 30);
        bubbles += `<span class="hf-bubble" style="left:${bx}%;width:${bs}px;height:${bs}px;animation-duration:${(speed + (i % 4)).toFixed(1)}s;animation-delay:${(i * 0.3).toFixed(1)}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-bubble-rise" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${bubbles}</div>`;
    }
    // 动态/过渡类(7)
    case "zoom-pulse": {
      const intensity = numberParameter(parameters, "intensity", 0.06, 0.01, 0.2);
      const speed = numberParameter(parameters, "speed", 2, 0.5, 6);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-zoom-pulse" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-zoom-i:${intensity};--hf-zoom-spd:${speed}s;"></div>`;
    }
    case "shake-earthquake": {
      const intensity = numberParameter(parameters, "intensity", 8, 2, 20);
      const speed = numberParameter(parameters, "speed", 10, 2, 20);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-shake-eq" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-shake-i:${intensity}px;--hf-shake-spd:${(1 / speed).toFixed(3)}s;"></div>`;
    }
    case "wobble-jelly": {
      const intensity = numberParameter(parameters, "intensity", 0.02, 0.01, 0.1);
      const speed = numberParameter(parameters, "speed", 3, 1, 8);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-wobble-jelly" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-wobble-i:${intensity};--hf-wobble-spd:${speed}s;"></div>`;
    }
    case "spin-hypnotic": {
      const speed = numberParameter(parameters, "speed", 8, 2, 20);
      const size = Math.round(numberParameter(parameters, "size", 300, 100, 600));
      return `<div id="${escapeHtml(elementId)}" class="clip hf-spin-hypnotic" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-spin-spd:${speed}s;--hf-spin-size:${size}px;"></div>`;
    }
    case "ripple-water": {
      const x = numberParameter(parameters, "x", 50, 0, 100);
      const y = numberParameter(parameters, "y", 50, 0, 100);
      const speed = numberParameter(parameters, "speed", 2, 0.5, 5);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-ripple-water" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}left:${x}%;top:${y}%;--hf-ripple-spd:${speed}s;"></div>`;
    }
    case "fade-dip-black": {
      const hold = numberParameter(parameters, "hold", 0.3, 0.1, 1);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-fade-dip-black" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-dip-hold:${hold}s;"></div>`;
    }
    case "flash-white": {
      const hold = numberParameter(parameters, "hold", 0.15, 0.05, 0.5);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-flash-white" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-flash-hold:${hold}s;"></div>`;
    }
    case "dream-soft": {
      const blur = numberParameter(parameters, "blur", 6, 2, 20);
      const glow = numberParameter(parameters, "glow", 0.4, 0.1, 1);
      return `<div id="${escapeHtml(elementId)}" class="clip hf-dream-soft" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}--hf-dream-blur:${blur}px;--hf-dream-glow:${glow};"></div>`;
    }
    case "dust-motes": {
      const count = Math.round(numberParameter(parameters, "count", 12, 4, 16));
      const speed = numberParameter(parameters, "speed", 18, 6, 40);
      let motes = "";
      for (let i = 0; i < count; i++) {
        const px = Math.round((i * 31 + 5) % 100);
        const py = Math.round((i * 47 + 19) % 100);
        const delay = (((i * 0.8) % 6) - phaseOffsetS).toFixed(1);
        motes += `<span class="hf-mote" style="left:${px}%;top:${py}%;animation-delay:${delay}s;animation-duration:${speed}s;"></span>`;
      }
      return `<div id="${escapeHtml(elementId)}" class="clip hf-dust-motes" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}"${phaseStyle ? ` style="${phaseStyle}"` : ""}>${motes}</div>`;
    }
  }

  // --- Text-based templates (original) ---
  const className = window.templateId === "highlight-box" ? "hf-highlight" : window.templateId === "kinetic-caption" ? "hf-caption" : "hf-title";
  const content = window.templateId === "highlight-box" ? "" : text;
  return `<div id="${escapeHtml(elementId)}" class="clip ${className}" data-start="${startS}" data-duration="${durationS}" data-track-index="${index + 1}" style="${phaseStyle}left:${left}%;top:${top}%;font-size:${fontSize}px;color:${color};">${content}</div>`;
}

/** 本次请求中因依赖缺失被降级丢弃的 registry 模板(写进 artifact 供渲染证据链查询) */
