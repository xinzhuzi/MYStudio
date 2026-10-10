// vsc:grain-dissolve —— 文字砂化凝聚(章尾能量峰值拍):干净整行字先爆裂成
// 沸腾颗粒噪点(轮廓隐约可辨+白辉光),斜纹选区框浮现;噪点云急速凝聚成更大
// 号发光短字标,位移衰减归零、辉光冲高回落,凝固定格。
// 卡片: references/shots/outro/grain-dissolve.md @ 5ddbf521,
// 参考实现 demos/outro/grain-dissolve/GrainDissolve.tsx(motion-lab 定稿转原生)。
// 批D 章级能力嫁接(design §5 outro;能量曲线=开场低开→中段推进→outro 峰值)。
//
// 与上游 demo 的差异(改造说明全文见 ../ATTRIBUTION-vsc.md):
// - 文案参数化:上游烧死「{ ACME. Now Live }」/「ACME」;本仓库 tagline(整行
//   句式)与 shortMark(短标)由 workflowConfig.chapterOutro 注入,须指同一对象
//   (卡片已知坑:两行 text 指不同对象=叙事断裂)。
// - 上游 _fixtures/Motion 的 seg/useT/E 就地等价重写(interpolate+clamp,
//   Easing.out(cubic)/inOut(cubic) 逐值同曲线);DesignStage 剥离——SVG
//   viewBox 640×360 直接铺满任意 composition 帧尺寸。
// - 短标字号自适应(卡片已知坑:>6 字符须缩字号否则超出选区框视觉重心偏移):
//   54px 起,每超 1 字缩 3px,下限 36px。
// - 确定性渲染铁律:feTurbulence seed=floor(t·46)(帧号派生,同帧同噪声图),
//   无随机无时钟;帧级采样 grainDissolveSampleAtFrame 供测试烧金样。

import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { GRAIN_DISSOLVE_DURATION, VSC_GRAIN_DISSOLVE_ID } from "./chapter-vsc-registry";

// 常量真源已迁 chapter-vsc-registry.ts(纯数据,主进程图可安全 import);
// 此处再导出保既有消费方不改。
export { GRAIN_DISSOLVE_DURATION, VSC_GRAIN_DISSOLVE_ID };

const BG = "#0a0a0c";

/** 卡片参数表(烧死默认值,决议 D4 同款纪律:首批不可调)。 */
export interface GrainDissolveProps {
  /** 整行句式(砂化解体前的「一句话」;非空,props 校验 fail-closed)。 */
  tagline: string;
  /** 凝聚终字标(短标,建议 ≤6 字符;与 tagline 指同一对象)。 */
  shortMark: string;
}

/** 某帧的完整采样(纯函数;四段曲线+辉光包络+噪声种子)。 */
export interface GrainDissolveSample {
  /** t=frame/duration 归一进度(0..1)。 */
  t: number;
  /** 干净字→砂化(0.13–0.28,outCubic)。 */
  burst: number;
  /** 整行噪点云→短字标噪点云(0.60–0.71,inOutCubic,交叉淡化驱动)。 */
  cond: number;
  /** 位移衰减凝固(0.68–0.90,outCubic;1=displacement/blur 归零)。 */
  lock: number;
  /** 辉光回落(0.88–1,outCubic)。 */
  settle: number;
  /** 白辉光包络:砂化期 0.3 弱光→凝聚冲高 0.7→回落留 0.45 柔光余温。 */
  glow: number;
  /** feTurbulence 逐帧种子(2s 内 46 次换图;帧号派生=确定性)。 */
  seed: number;
  /** 短标字号(54px 起,>6 字符每字缩 3px,下限 36px——卡片已知坑)。 */
  shortMarkFontSize: number;
  /** 选区框浮现度(burst 驱动,凝聚前 0.55–0.64 撤掉)。 */
  boxOpacity: number;
}

const OUT_CUBIC = Easing.out(Easing.cubic);
const IN_OUT_CUBIC = Easing.inOut(Easing.cubic);

/** 上游 seg(t, a, b, easing) 等价:归一区间插值(两端钳制)。 */
function seg(t: number, from: number, to: number, easing: (x: number) => number): number {
  return interpolate(t, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });
}

/**
 * 砂化凝聚逐帧采样(纯函数):burst/cond/lock/settle 四段曲线与辉光包络
 * burst·0.3 + cond·0.7 − settle·0.45 逐值对齐上游 GrainDissolve.tsx。
 */
export function grainDissolveSampleAtFrame(
  frame: number,
  durationInFrames: number,
  props: GrainDissolveProps,
): GrainDissolveSample {
  const t = durationInFrames > 0 ? frame / durationInFrames : 0;
  const burst = seg(t, 0.13, 0.28, OUT_CUBIC);
  const cond = seg(t, 0.60, 0.71, IN_OUT_CUBIC);
  const lock = seg(t, 0.68, 0.90, OUT_CUBIC);
  const settle = seg(t, 0.88, 1, OUT_CUBIC);
  const glow = burst * 0.3 + cond * 0.7 - settle * 0.45;
  const overflow = Math.max(0, props.shortMark.length - 6);
  return {
    t,
    burst,
    cond,
    lock,
    settle,
    glow,
    seed: Math.floor(t * 46),
    shortMarkFontSize: Math.max(36, 54 - overflow * 3),
    boxOpacity: burst * (1 - seg(t, 0.55, 0.64, OUT_CUBIC)),
  };
}

/** 组件(薄包装:采样→SVG 滤镜链;确定性=seed 帧号派生)。 */
export function GrainDissolve(props: GrainDissolveProps): React.ReactElement {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const duration = durationInFrames > 0 ? durationInFrames : GRAIN_DISSOLVE_DURATION;
  const s = grainDissolveSampleAtFrame(frame, duration, props);
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <svg
        viewBox="0 0 640 360"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", background: BG }}
      >
        <defs>
          {/* 滤镜链是唯一引擎:turbulence(baseFreq 0.9→+0.4)→displacement(峰值
              52,lock 衰减归零)→blur(1.1px);seed 逐帧换图=颗粒永不静止。 */}
          <filter id="vsc-grain-dissolve" x="-40%" y="-150%" width="180%" height="400%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={round3(0.9 + s.burst * 0.4)}
              numOctaves={2}
              seed={s.seed}
              result="n"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="n"
              scale={round3(s.burst * 52 * (1 - s.lock))}
              xChannelSelector="R"
              yChannelSelector="G"
              result="d"
            />
            <feGaussianBlur in="d" stdDeviation={round3(s.burst * 1.1 * (1 - s.lock))} />
          </filter>
        </defs>
        {/* 四角 HUD 括角+圆点+左右中线短划(全程常驻;坐标=上游 viewBox 原值) */}
        <g>
          <Corner x={88} y={96} sx={1} sy={1} />
          <Corner x={552} y={96} sx={-1} sy={1} />
          <Corner x={88} y={264} sx={1} sy={-1} />
          <Corner x={552} y={264} sx={-1} sy={-1} />
          <line x1={52} y1={180} x2={76} y2={180} stroke="#4a4a50" strokeWidth={1.5} strokeDasharray="4 3" />
          <line x1={564} y1={180} x2={588} y2={180} stroke="#4a4a50" strokeWidth={1.5} strokeDasharray="4 3" />
        </g>
        {/* 斜纹选区框(45° 线阵+四角像素棋盘手柄):砂化浮现、凝聚前撤掉——
            框留到凝固后读作「还没选完」,语义反了(卡片已知坑)。 */}
        <g opacity={round3(s.boxOpacity)}>
          <clipPath id="vsc-grain-dissolve-clip">
            <rect x={BX} y={BY} width={BW} height={BH} />
          </clipPath>
          <g clipPath="url(#vsc-grain-dissolve-clip)">
            {HATCH_XS.map((x) => (
              <line key={x} x1={x} y1={BY + BH} x2={x + BH} y2={BY} stroke="#2c2c31" strokeWidth={1} />
            ))}
          </g>
          <rect x={BX} y={BY} width={BW} height={BH} fill="none" stroke="#55565c" strokeWidth={1} />
          <Handle x={BX} y={BY} />
          <Handle x={BX + BW} y={BY} />
          <Handle x={BX} y={BY + BH} />
          <Handle x={BX + BW} y={BY + BH} />
        </g>
        {/* 文字组:整行字与终字标同走滤镜链+白辉光(换字发生在最沸腾段,看不到切换) */}
        <g
          style={{
            filter: `url(#vsc-grain-dissolve) drop-shadow(0 0 ${round3(4 + Math.max(0, s.glow) * 20)}px rgba(255,255,255,${round3(Math.max(0, s.glow) * 0.9)}))`,
          }}
        >
          <text
            x={320}
            y={191}
            textAnchor="middle"
            opacity={round3(1 - s.cond)}
            style={{
              fill: "#eceef2",
              font: `500 33px Inter,'Helvetica Neue',system-ui,sans-serif`,
              letterSpacing: "2.5px",
            }}
          >
            {props.tagline}
          </text>
          <text
            x={320}
            y={198}
            textAnchor="middle"
            opacity={round3(s.cond)}
            style={{
              fill: "#fff",
              font: `800 ${s.shortMarkFontSize}px Inter,'Helvetica Neue',system-ui,sans-serif`,
              letterSpacing: "4px",
            }}
          >
            {props.shortMark}
          </text>
        </g>
      </svg>
    </AbsoluteFill>
  );
}

// 选区框几何(viewBox 坐标,上游原值)。
const BX = 128;
const BY = 148;
const BW = 384;
const BH = 62;

// 45° 斜纹:x 从 bx-bh 起每 34 一根,右下→左上(上游原值)。
const HATCH_XS: number[] = [];
for (let x = BX - BH; x < BX + BW; x += 34) HATCH_XS.push(x);

// 四角像素棋盘手柄(两块 5×5 错位方块)。
function Handle(props: { x: number; y: number }): React.ReactElement {
  return (
    <g transform={`translate(${props.x - 5},${props.y - 5})`} fill="#cfd2d8">
      <rect width={5} height={5} />
      <rect x={5} y={5} width={5} height={5} />
    </g>
  );
}

// HUD 括角+圆点(sx/sy 控制朝向)。
function Corner(props: { x: number; y: number; sx: number; sy: number }): React.ReactElement {
  return (
    <>
      <path
        d={`M${props.x + 14 * props.sx} ${props.y}H${props.x}V${props.y + 14 * props.sy}`}
        fill="none"
        stroke="#3a3a40"
        strokeWidth={1.5}
      />
      <circle cx={props.x + 34 * props.sx} cy={props.y + 28 * props.sy} r={1.6} fill="#8b8d94" />
    </>
  );
}

function round3(value: number): number {
  return Math.round(value * 1e3) / 1e3;
}
