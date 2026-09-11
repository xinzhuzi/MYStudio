"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
} from "motion/react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  ORB_MARGIN,
  ORB_SIZE,
  clampOrbPosition,
  snapToNearestEdge,
  useOrbPosition,
  type OrbAnchor,
} from "./use-orb-position";

/** 位移小于该阈值判定为点击(开面板),否则视为拖拽。 */
const CLICK_THRESHOLD_PX = 6;
const VIEWPORT_FALLBACK = { width: 1440, height: 900 };
/** 滚动星球(09-11 真 3D 轮):每像素位移折算的球体旋转角(deg)。 */
const ROLL_DEG_PER_DRAG_PX = 0.55;
/** 真 3D 经纬球几何 v2(真透视版):环系直径缩一档(42px),透视(200px)鼓出后
 * 仍收在 48px 球缘内;经线每 30° 一圈;纬线赤道±30°±60°。 */
const GLOBE_INSET = 3;
const GLOBE_SIZE = ORB_SIZE - GLOBE_INSET * 2;
const MERIDIANS = [0, 30, 60, 90, 120, 150];
const PARALLEL_DEGS = [60, 30, 0, -30, -60];

/** 实时视口(09-10 实弹修复):挂载瞬间可能拿到过渡期视口(如标题栏样式
 * 应用前的高度),且此后零 resize 事件——所有钳制/吸附必须读实时值,
 * 不吃挂载期快照。 */
function windowDims() {
  if (typeof window === "undefined") return VIEWPORT_FALLBACK;
  return { width: window.innerWidth, height: window.innerHeight };
}

/** resize 监听仅作重渲染触发(约束/吸附数值一律实时读)。 */
function useViewportTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onResize = () => setTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return tick;
}

export interface OrbShellProps {
  /** 位置持久化键(工作流球=旧键零迁移;本地模型球=独立键)。 */
  storageKey: string;
  /** 默认锚位角(工作流球右下避侧栏轨道;沉浸球左下)。 */
  defaultAnchor?: OrbAnchor;
  /** 球根 data 属性名,如 "workflow-orb" → data-workflow-orb。 */
  dataOrb: string;
  /** 球体附加 data(如 data-workflow-active-stage)。 */
  dataAttrs?: Record<string, string>;
  /** 无障碍名(aria-label),应含动态进度/模式摘要。 */
  ariaLabel: string;
  /** hover 胶囊文案。契约:胶囊恒在 DOM(opacity 藏),可被 innerText 断言读到
   * (smoke 文本锚依赖;opacity 不剔出 innerText)。 */
  capsuleText: string;
  /** 球体内容(进度环+序号 / 图标),由业务球提供。 */
  ballContent: ReactNode;
  /** 弹出面板内容,render prop 注入 close(选中条目后收面板)。 */
  panelContent: (api: { close: () => void }) => ReactNode;
  /** 面板宽度 class,默认 w-80。 */
  panelClassName?: string;
  /** 上下文重置键(09-11:键变即收面板)——视图切换后球面板不跨视图滞留
   * (导航已发生,收起=确认;smoke 胶囊锚也因 panelOpen-hidden 而依赖此行为)。 */
  resetKey?: string | number;
}

/** 通用悬浮球壳(09-10 拆双球裁定:基础设施独立模块,零业务依赖)。
 * 承载:拖拽+贴边吸附+位置持久化+点击/拖拽判定(6px 阈值,pointerup 主路+
 * click 兜底+toggle 吞 click+多指防串)+视口钳制+胶囊左右翻+键盘开合。
 * 球体与面板内容、胶囊文案、data 契约全部由业务球注入。
 * 契约不变量:球 zIndex 40(高于画布 webview 与常规 chrome,低于 dropdown
 * z-50、Dialog z-[250] 与面板本体 z-[300]);面板关闭焦点回球。 */
export function OrbShell({
  storageKey,
  defaultAnchor = "bottom-left",
  dataOrb,
  dataAttrs,
  ariaLabel,
  capsuleText,
  ballContent,
  panelContent,
  panelClassName,
  resetKey,
}: OrbShellProps) {
  const { position, setPosition } = useOrbPosition(storageKey, defaultAnchor);
  const viewportTick = useViewportTick();
  const x = useMotionValue(position.x);
  const y = useMotionValue(position.y);
  // 滚动星球(09-11 真 3D 轮):经纬球体随位移真实旋转——横拖=绕纵轴,纵拖=翻滚;
  // roll 值=旋转角(deg),motion template 直驱容器 transform,零重渲染
  const rollX = useMotionValue(0);
  const rollY = useMotionValue(0);
  const globeTransform = useMotionTemplate`rotateY(${rollY}deg) rotateX(${rollX}deg)`;
  const [panelOpen, setPanelOpen] = useState(false);
  // 视图切换即收面板(09-11):面板不跨视图滞留
  useEffect(() => {
    setPanelOpen(false);
  }, [resetKey]);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  // 按下时面板是否开着(toggle 语义:Radix 已因外点关掉,别再重开)
  const panelOpenAtPressRef = useRef(false);
  // 多指防串:up/cancel 只处理与 down 同源的指针(不用 isPrimary——jsdom 构造默认 false 会全拒)
  const activePointerIdRef = useRef<number | null>(null);
  // 球内拖拽释放后浏览器仍派发 click,吞一次防误开
  const suppressNextClickRef = useRef(false);
  const orbRef = useRef<HTMLDivElement | null>(null);
  // 球靠右半屏时胶囊翻到左侧,避免吸右缘后伸出视口
  const [capsuleOnLeft, setCapsuleOnLeft] = useState(() =>
    typeof window === "undefined"
      ? false
      : position.x > window.innerWidth / 2,
  );
  useMotionValueEvent(x, "change", (latest) => {
    if (typeof window === "undefined") return;
    setCapsuleOnLeft(latest > window.innerWidth / 2);
  });

  // 滚动到目标位(位移+旋转同弹簧):吸附/钳制时球一路滚过去
  const rollWith = useCallback(
    (tx: number, ty: number, spring: { type: "spring"; stiffness: number; damping: number }) => {
      animate(rollX, rollX.get() - (ty - y.get()) * ROLL_DEG_PER_DRAG_PX, spring);
      animate(rollY, rollY.get() + (tx - x.get()) * ROLL_DEG_PER_DRAG_PX, spring);
      animate(x, tx, spring);
      animate(y, ty, spring);
    },
    [x, y, rollX, rollY],
  );

  // 窗口变化时把球钳回视口内(数值一律实时读——挂载快照可能是过渡期视口)
  const clampNow = useCallback(() => {
    const dims = windowDims();
    const current = { x: x.get(), y: y.get() };
    const clamped = clampOrbPosition(current, dims.width, dims.height, defaultAnchor);
    if (clamped.x !== current.x || clamped.y !== current.y) {
      rollWith(clamped.x, clamped.y, { type: "spring", stiffness: 400, damping: 32 });
      setPosition(clamped);
    }
  }, [x, y, rollWith, setPosition, defaultAnchor]);

  useEffect(() => {
    clampNow();
  }, [viewportTick, clampNow]);

  // 衰减式延迟自愈:挂载瞬间的视口是过渡值(实测 940/943→900 落定可能晚于
  // 任何单一时点,且全程零 resize 事件),多枪重试覆盖任意落定节奏
  useEffect(() => {
    const timers = [600, 1400, 2600].map((ms) => setTimeout(clampNow, ms));
    return () => timers.forEach((t) => clearTimeout(t));
  }, [clampNow]);

  const handlePointerUp = (event: React.PointerEvent) => {
    if (event.pointerId !== activePointerIdRef.current) return;
    activePointerIdRef.current = null;
    const start = pressStartRef.current;
    pressStartRef.current = null;
    if (!start) return;
    // 交互后自愈(幂等,不吃事件语义):视口过渡期写入的越界位置在首次触摸即被钳回
    clampNow();
    const distance = Math.hypot(
      event.clientX - start.x,
      event.clientY - start.y,
    );
    if (distance < CLICK_THRESHOLD_PX) {
      // 按下时面板本就开着:toggle 收起。真机 Radix 已在 pointerdown 关过(幂等),
      // 尾随 click 须吞;jsdom 无 Radix 外点关闭,由此主动关。
      if (panelOpenAtPressRef.current) {
        panelOpenAtPressRef.current = false;
        suppressNextClickRef.current = true;
        setPanelOpen(false);
        return;
      }
      setPanelOpen(true);
    } else {
      suppressNextClickRef.current = true;
    }
  };

  // 真实点击兜底:motion drag 会话可能吞掉 pointerup,click 自带释放点坐标,
  // 可独立复判位移<阈值=点击(布尔 setState 幂等,双开无害);
  // 合成 click(无 pointer 前置,smoke 脚本路径)无起点,直接开面板。
  const handleClick = (event: React.MouseEvent) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    if (panelOpenAtPressRef.current) {
      // pointerup 被吞的 toggle 路径:click 直接承担收起
      panelOpenAtPressRef.current = false;
      setPanelOpen(false);
      return;
    }
    const start = pressStartRef.current;
    pressStartRef.current = null;
    if (!start) {
      setPanelOpen(true);
      return;
    }
    const distance = Math.hypot(
      event.clientX - start.x,
      event.clientY - start.y,
    );
    if (distance < CLICK_THRESHOLD_PX) setPanelOpen(true);
  };

  // 约束随渲染实时读视口(resize 触发重渲染刷新)
  const dims = windowDims();

  return (
    <Popover open={panelOpen} onOpenChange={setPanelOpen}>
      <PopoverAnchor asChild>
        <motion.div
          {...{ [`data-${dataOrb}`]: true }}
          {...dataAttrs}
          role="button"
          tabIndex={0}
          aria-label={ariaLabel}
          aria-expanded={panelOpen}
          drag
          dragMomentum={false}
          dragElastic={0}
          dragConstraints={{
            left: ORB_MARGIN,
            top: ORB_MARGIN,
            right: Math.max(ORB_MARGIN, dims.width - ORB_SIZE - ORB_MARGIN),
            bottom: Math.max(
              ORB_MARGIN,
              dims.height - ORB_SIZE - ORB_MARGIN,
            ),
          }}
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            width: ORB_SIZE,
            height: ORB_SIZE,
            x,
            y,
            // 层序契约:高于画布 webview 与常规 chrome(z-10/20),低于 dropdown(z-50)、
            // Dialog(z-[250])与面板本体(z-[300])——弹窗打开时球沉到遮罩之下,不可点。
            zIndex: 40,
          }}
          className="group flex h-12 w-12 cursor-grab items-center justify-center rounded-full outline-none active:cursor-grabbing"
          ref={orbRef}
          onPointerDown={(event) => {
            activePointerIdRef.current = event.pointerId;
            panelOpenAtPressRef.current = panelOpen;
            pressStartRef.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerUp={handlePointerUp}
          onPointerCancel={(event) => {
            if (event.pointerId !== activePointerIdRef.current) return;
            // 手势取消(系统中断/滚轮接管):三态全清,下一次交互从头判
            activePointerIdRef.current = null;
            pressStartRef.current = null;
            panelOpenAtPressRef.current = false;
            suppressNextClickRef.current = false;
          }}
          onClick={handleClick}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setPanelOpen((open) => !open);
            }
          }}
          onDrag={(_, info) => {
            // 滚动星球:拖拽位移 1:1 折算球体旋转(不重渲染,motion 直驱 transform)
            rollY.set(rollY.get() + info.delta.x * ROLL_DEG_PER_DRAG_PX);
            rollX.set(rollX.get() - info.delta.y * ROLL_DEG_PER_DRAG_PX);
          }}
          onDragEnd={() => {
            const d = windowDims();
            const snapped = snapToNearestEdge(
              x.get(),
              y.get(),
              d.width,
              d.height,
            );
            rollWith(snapped.x, snapped.y, { type: "spring", stiffness: 380, damping: 30 });
            setPosition(snapped);
          }}
        >
          {/* 球体皮肤层(09-11 质感升级,apple-design §12 材质与分层):
              玻璃面(半透明底+blur+saturate)+顶部内高光(光落在材料上)+分层投影
              (近距环境影+远距主影);缩放反馈独立于 motion 的拖拽 transform。
              悬停=1.06 提起(150ms ease-out),按压=0.92 即时(Apple §1 按下即反馈);
              Electron 桌面鼠标环境,悬停免 pointer 门控;motion-reduce 全静。 */}
          <div className="pointer-events-none absolute -inset-1.5 rounded-full bg-primary/15 opacity-0 blur-md transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none" />
          <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border border-white/12 bg-card/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),inset_0_-1px_0_rgba(0,0,0,0.22),0_2px_6px_rgba(0,0,0,0.25),0_10px_28px_rgba(0,0,0,0.4)] backdrop-blur-md backdrop-saturate-150 transition-transform duration-150 ease-out group-hover:scale-[1.06] group-active:scale-[0.92] motion-reduce:transition-none motion-reduce:transform-none">
            {/* 真 3D 经纬球 v2(09-11 不圆润反馈):真透视(perspective 200px)给出
                近大远小——环椭圆不对称=圆润感的核心线索;环系整体缩一档(42px),
                透视鼓出后仍收在球缘内(1.12×47<48),皮肤裁剪兜底不越界。
                纬线加密到赤道±30°±60°,线色提亮,赤道最亮=球仪经纬层次。 */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 [perspective:200px] [transform-style:preserve-3d]"
            >
              <motion.div
                className="absolute inset-0 [transform-style:preserve-3d]"
                style={{ transform: globeTransform }}
              >
                {MERIDIANS.map((deg) => (
                  <div
                    key={`m${deg}`}
                    className="absolute rounded-full border border-white/18"
                    style={{
                      left: GLOBE_INSET,
                      top: GLOBE_INSET,
                      width: GLOBE_SIZE,
                      height: GLOBE_SIZE,
                      transform: `rotateY(${deg}deg)`,
                    }}
                  />
                ))}
                {PARALLEL_DEGS.map((phi) => {
                  const rad = (phi * Math.PI) / 180;
                  const size = GLOBE_SIZE * Math.cos(rad);
                  const height = (GLOBE_SIZE / 2) * Math.sin(rad);
                  return (
                    <div
                      key={`p${phi}`}
                      className="absolute rounded-full border"
                      style={{
                        width: size,
                        height: size,
                        left: (ORB_SIZE - size) / 2,
                        top: (ORB_SIZE - size) / 2,
                        borderColor:
                          phi === 0
                            ? "rgba(255,255,255,0.24)"
                            : "rgba(255,255,255,0.14)",
                        transform: `rotateX(90deg) translateZ(${-height}px)`,
                      }}
                    />
                  );
                })}
              </motion.div>
            </div>
            {/* 球体明暗 v2(圆润感主承担):左上主高光+右上小镜面光点+右下暗部
                +边缘暗角(rim vignette,让平面圆读出球体转折)。 */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 34% 28%, rgba(255,255,255,0.24), rgba(255,255,255,0.04) 34%, transparent 56%), radial-gradient(circle at 66% 22%, rgba(255,255,255,0.14), transparent 22%), radial-gradient(circle at 72% 78%, rgba(0,0,0,0.36), transparent 58%), radial-gradient(circle at 50% 50%, transparent 52%, rgba(0,0,0,0.42) 96%)",
              }}
            />
            {ballContent}
          </div>
          <span
            data-orb-capsule
            aria-hidden
            className={cn(
              "pointer-events-none absolute whitespace-nowrap rounded-full border border-white/12 bg-card/90 px-3 py-1.5 text-xs text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_6px_20px_rgba(0,0,0,0.35)] opacity-0 backdrop-blur-md transition-[opacity,transform] duration-200 ease-out group-hover:opacity-100 motion-reduce:transition-none",
              capsuleOnLeft
                ? "right-full mr-3 translate-x-1 group-hover:translate-x-0"
                : "left-full ml-3 -translate-x-1 group-hover:translate-x-0",
              panelOpen && "hidden",
            )}
          >
            {capsuleText}
          </span>
        </motion.div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="top"
        collisionPadding={12}
        className={cn(
          // 09-11 质感:面板=更厚实的玻璃面(更大 surface=更强 blur+更深影,apple-design §12)
          "w-80 border-white/12 bg-popover/95 p-2 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl backdrop-saturate-150",
          panelClassName,
        )}
        onCloseAutoFocus={(event) => {
          // Anchor(非 Trigger)模式下 Radix 不自动回焦,手动回球保键盘路径
          event.preventDefault();
          orbRef.current?.focus();
        }}
      >
        {panelContent({ close: () => setPanelOpen(false) })}
      </PopoverContent>
    </Popover>
  );
}
