// vsc:brand-ink-open —— 墨线十字准星描画 → 字标逐字 letterpress → 打字机副标
// → 完整标题静止 ~30f → 上浮消散(章级开篇第一拍:正文画面出现前先立名号)。
// 卡片: references/shots/opening/brand-ink-open.md @ 5ddbf521,
// 参考实现 demos/typography/brand-ink-open/BrandInkOpen.tsx(原 template
// SceneOpen 帧 0–83 段剥离)。批D 章级能力嫁接(design §5 opening 首选水墨)。
//
// 与上游 demo 的差异(改造说明全文见 ../ATTRIBUTION-vsc.md):
// - 文案参数化:上游烧死产品名「AI Foundation Lab」;本仓库 wordmark/kicker
//   由 workflowConfig.chapterOpening 注入(workmark=作品名,kicker 可选副标)。
// - 时长=参考实现定稿 104f(卡片「约 2.8s」是早期版本;demo 语义=末字 67f
//   落定→完整标题 hold 67→97f(卡片 R1「出现后停留 1 秒」硬底线)→97–104f
//   上浮+缩+淡退场,「退场快于入场」)。入口/Player/测试共用本常量。
// - 字标字体=noto-serif-sc 900(仓库既有 fontsource bundle,水墨衬线;
//   上游 ui-serif 系统栈在无头渲染帧不稳)。曲线常数逐值对齐上游。
// - 确定性渲染铁律:全帧纯函数(frame→样式),无随机无时钟;帧级采样
//   brandInkOpenSampleAtFrame 供测试烧金样。

import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import "@fontsource/noto-serif-sc/900.css";
import { BRAND_INK_OPEN_DURATION, VSC_BRAND_INK_OPEN_ID } from "./chapter-vsc-registry";

// 常量真源已迁 chapter-vsc-registry.ts(纯数据,主进程图可安全 import);
// 此处再导出保既有消费方(入口/Player/测试)不改。
export { BRAND_INK_OPEN_DURATION, VSC_BRAND_INK_OPEN_ID };

const SERIF = '"Noto Serif SC", ui-serif, Georgia, serif';
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const INK = "oklch(18% 0.006 82)";
const AMBER = "oklch(52% 0.115 65)";
const INK2 = "oklch(50% 0.006 82)";
const PAPER = "#faf7f2";

/** 卡片参数表(烧死默认值,决议 D4 同款纪律:首批不可调)。 */
export interface BrandInkOpenProps {
  /** 章头字标(作品名/系列名;非空,props 校验 fail-closed)。 */
  wordmark: string;
  /** 副标 kicker(可选;缺省整行隐藏——上游 TEAM RESEARCH CONSOLE 槽位)。 */
  kicker?: string;
}

/** 逐字 letterpress 采样(卡片参数表:第 i 字 delay=10+i·3、12f,scale 1.6→1
 * origin center bottom + blur 6px→0;入场三件套定式)。 */
export interface BrandInkGlyphSample {
  char: string;
  /** letterpress 进度 0→1。 */
  t: number;
  /** 字底强调色 glint 0→1→0(delay+12±4f 短划闪过)。 */
  glint: number;
}

/** 某帧的完整采样(纯函数,测试与组件共用;确定性=同帧同值)。 */
export interface BrandInkOpenSample {
  /** 十字准星:竖线/横线 pathLength dashoffset(100=未描,0=描完)。 */
  crosshairVDashoffset: number;
  crosshairHDashoffset: number;
  /** 准星整体透明度(24→34f 淡出;描画完必须淡出,残留与字标抢焦点)。 */
  crosshairOpacity: number;
  glyphs: BrandInkGlyphSample[];
  /** kicker 打字机已出现的字符数(0.7f/字符,28f 起;装饰性小字专属速率)。 */
  kickerChars: number;
  /** 强调色块光标是否点亮(打字中恒亮;打字完 2f 周期闪,95f 停闪)。 */
  cursorOn: boolean;
  /** 品牌组退场进度 0→1(97→104f;1=完全上浮+缩+淡)。 */
  brandOut: number;
}

/**
 * 墨线开篇逐帧采样(纯函数):竖线 0→9f(卡片 ease)/横线 8→18f 描画,24→34f
 * 准星淡出;末字 67f 落定后完整标题 hold 至 97f,退场 7f(上浮 40px+缩 12%+淡出)。
 * 缓动常数逐值对齐上游 BrandInkOpen.tsx(测试烧金样守护)。
 */
export function brandInkOpenSampleAtFrame(
  frame: number,
  props: BrandInkOpenProps,
): BrandInkOpenSample {
  const vDraw = interpolate(frame, [0, 9], [100, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.3, 0, 0.2, 1),
  });
  const hDraw = interpolate(frame, [8, 18], [100, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.linear,
  });
  const crossFade = interpolate(frame, [24, 34], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glyphs: BrandInkGlyphSample[] = Array.from(props.wordmark, (char, index) => {
    const delay = 10 + index * 3;
    const t = interpolate(frame, [delay, delay + 12], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.2, 0.7, 0.25, 1),
    });
    const glintCenter = delay + 12;
    const glint = interpolate(frame, [glintCenter - 4, glintCenter, glintCenter + 4], [0, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return { char, t, glint };
  });
  const perChar = 0.7;
  const kickStart = 28;
  const kicker = props.kicker ?? "";
  const kickChars = Math.floor(Math.max(0, frame - kickStart) / perChar);
  const kickDone = kickStart + kicker.length * perChar;
  const cursorOn = (() => {
    if (frame < kickStart || kicker.length === 0) return false;
    if (frame < kickDone) return true;
    if (frame > 95) return false;
    const b = frame - kickDone;
    return Math.floor(b / 2) % 2 === 0;
  })();
  const brandOut = interpolate(frame, [97, 104], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.4, 0, 0.5, 1),
  });
  return {
    crosshairVDashoffset: vDraw,
    crosshairHDashoffset: hDraw,
    crosshairOpacity: crossFade,
    glyphs,
    kickerChars: kickChars,
    cursorOn,
    brandOut,
  };
}

/** 组件(薄包装:采样→CSS;确定性渲染铁律=无随机无时钟)。 */
export function BrandInkOpen(props: BrandInkOpenProps): React.ReactElement {
  const frame = useCurrentFrame();
  const sample = brandInkOpenSampleAtFrame(frame, props);
  const groupOpacity = 1 - sample.brandOut;
  const groupY = -sample.brandOut * 40;
  const groupScale = 1 - sample.brandOut * 0.12;
  return (
    <AbsoluteFill style={{ backgroundColor: PAPER, justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          textAlign: "center",
          opacity: groupOpacity,
          transform: `translateY(${roundPx(groupY)}px) scale(${round5(groupScale)})`,
        }}
      >
        {/* 十字准星:隐形琥珀笔描画(竖 0→9f、横 8→18f,描完 24→34f 淡出) */}
        <svg
          width={64}
          height={64}
          viewBox="0 0 64 64"
          style={{ display: "block", margin: "0 auto 34px", opacity: sample.crosshairOpacity }}
        >
          <line
            x1={32} y1={2} x2={32} y2={62}
            stroke={AMBER} strokeWidth={5} strokeLinecap="round"
            pathLength={100} strokeDasharray={100} strokeDashoffset={sample.crosshairVDashoffset}
          />
          <line
            x1={2} y1={32} x2={62} y2={32}
            stroke={AMBER} strokeWidth={5} strokeLinecap="round"
            pathLength={100} strokeDasharray={100} strokeDashoffset={sample.crosshairHDashoffset}
          />
        </svg>

        {/* 字标逐字 letterpress:scale 1.6→1(origin center bottom)+blur 6px→0,
            字底琥珀 glint 短划闪过(卡片「入场三件套」定式,缺 blur 会显得硬) */}
        <div
          style={{
            fontFamily: SERIF,
            fontSize: 132,
            fontWeight: 900,
            color: INK,
            letterSpacing: "-0.01em",
            lineHeight: 1,
            whiteSpace: "pre",
            display: "inline-flex",
            alignItems: "flex-end",
          }}
        >
          {sample.glyphs.map((glyph, index) => (
            <span
              key={index}
              style={{
                position: "relative",
                display: "inline-block",
                opacity: round5(glyph.t),
                transform: `scale(${round5(1.6 - 0.6 * glyph.t)})`,
                transformOrigin: "center bottom",
                filter: `blur(${round5((1 - glyph.t) * 6)}px)`,
              }}
            >
              {glyph.char === " " ? " " : glyph.char}
              <span
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: -6,
                  transform: "translateX(-50%)",
                  width: `${round5(glyph.glint * 100)}%`,
                  height: 2,
                  background: AMBER,
                  opacity: round5(glyph.glint),
                  borderRadius: 2,
                }}
              />
            </span>
          ))}
        </div>

        {/* kicker 副标打字机(0.7f/字符=装饰性小字专属;正文交互打字要 3f/字符)
            + 强调色块光标周期闪(2f 周期,95f 停闪) */}
        {props.kicker ? (
          <div
            style={{
              fontFamily: MONO,
              fontSize: 26,
              letterSpacing: "0.14em",
              color: INK2,
              marginTop: 30,
              textTransform: "uppercase",
              height: 30,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <span style={{ whiteSpace: "pre" }}>
              {props.kicker.slice(0, sample.kickerChars)}
            </span>
            <span
              style={{
                display: "inline-block",
                width: 14,
                height: 24,
                marginLeft: 4,
                background: AMBER,
                opacity: sample.cursorOn ? 0.85 : 0,
              }}
            />
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}

// Trim float noise so identical math yields byte-identical style strings
// (visual-style.ts round 同纪律,配方层样式自 round)。
function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

function roundPx(value: number): number {
  return Math.round(value * 10) / 10;
}
