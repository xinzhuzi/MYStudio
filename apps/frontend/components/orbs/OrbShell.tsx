"use client";

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  animate,
  motion,
  useAnimationFrame,
  useDragControls,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from "motion/react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { toast } from "sonner";
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
/** 长按解锁拖拽(09-12 防粘连用户裁定):按住满该时长球才可跟手移动;蓄力期
 * 位移超点击阈值=划走,取消解锁。 */
const LONG_PRESS_MS = 1000;
/** 解锁啮合位移上限(09-15 webview 盲区根修):armed 后首根可见 move 距上一
 * 可见采样超过该值=盲区回流,手势作废;正常拖拽自静止按压点起步,不误伤。 */
const ARM_ENGAGE_JUMP_PX = 32;
const VIEWPORT_FALLBACK = { width: 1440, height: 900 };
/** 滚动星球(09-11 真 3D 轮):每像素位移折算的球体旋转角(deg)。 */
const ROLL_DEG_PER_DRAG_PX = 0.55;
/** 自旋(09-11 用户裁定:地球仪要自旋转;参考 GitHub 球体 gist 的 animateSphere
 * 30s 线性关键帧,折算 ~24deg/s,取 16deg/s 更克制)。拖拽/吸附动画期间让路。 */
const AUTO_SPIN_DEG_PER_SEC = 16;
const AUTO_SPIN_PAUSE_MS = 900;
/** 隐藏态持久化键(09-12 orb-manage:隐藏后重启保持,唤回即清)。 */
const ORB_HIDDEN_KEY = "mystudio.orb.hidden";
/** 唤回键提示文案(Ctrl+B=侧栏/Ctrl+M=分镜/Ctrl+Z=画布历史,Shift+B 错开)。 */
const ORB_RECALL_HINT = "悬浮球已隐藏，按 Ctrl+Shift+B（⌘⇧B）唤回";
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
  /** 位置持久化键(按业务球指定;现役唯一球=WORKFLOW_ORB_POSITION_KEY)。 */
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
  /** 右键菜单业务附加项(09-12 orb-manage:如「打开设置」);壳自带
   * 回到默认位置/隐藏悬浮球两项,业务项拼接其后,壳保持零业务依赖。 */
  contextMenuExtra?: ReactNode;
}

/** 通用悬浮球壳(基础设施独立模块,零业务依赖;09-11 归一后全应用唯一球,
 * 面孔/内容由 AppOrb 注入)。
 * 承载:拖拽(长按 1s 解锁,09-12 防粘连:受控 dragControls,按下不即跟手;
 * 09-15 webview 盲区根修:按下俘获指针+解锁后惰性啮合——按键在且无大跳的
 * 可见 move 才真正启动拖拽会话)
 * +贴边吸附+位置持久化+点击/拖拽判定(6px 阈值,pointerup 主路+click 兜底
 * +toggle 吞 click+多指防串)+视口钳制+胶囊左右翻+键盘开合。
 * 球体与面板内容、胶囊文案、data 契约全部由业务球注入。
 * 契约不变量:球 zIndex 40(高于画布 webview 与常规 chrome,低于 dropdown
 * z-50、Dialog z-[250] 与面板本体 z-[300]);面板关闭焦点去向(09-12):
 * 外点进 webview 不抢焦点;在场有 webview(ComfyUI 画布)交还 webview;
 * 常规视图回球保键盘路径。 */
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
  contextMenuExtra,
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
  // 自旋(09-11):闲置时绕纵轴缓转;拖拽中/吸附弹簧飞行中让路,reduced-motion 关闭
  const reduceMotion = useReducedMotion();
  const draggingRef = useRef(false);
  const autoSpinPausedUntilRef = useRef(0);
  useAnimationFrame((_, delta) => {
    if (reduceMotion || draggingRef.current) return;
    if (Date.now() < autoSpinPausedUntilRef.current) return;
    rollY.set(rollY.get() + (AUTO_SPIN_DEG_PER_SEC * delta) / 1000);
  });
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
  // 外点是否落在 webview(ComfyUI 画布)上——是则关闭面板后宿主不得回抢焦点
  // (点击本身已把焦点送进 guest;09-12 键盘/手势归 ComfyUI 裁定)
  const pressedIntoWebviewRef = useRef(false);
  const orbRef = useRef<HTMLDivElement | null>(null);
  // 长按解锁拖拽(09-12 防粘连;09-15 webview 盲区根修):按下即蓄力(charging),
  // 满 1s 且未划走才解锁(armed);解锁不再即刻启动拖拽会话,待下一根「按键
  // 仍按住且无大跳」的可见 move 才啮合——ComfyUI 画布是 <webview>,宿主
  // window 对 guest 区域是指针事件盲区,松手/划走发生在球外盲区时计时器无从
  // 得知,旧实现会把已松手/划走的手势照常解锁成拖拽(球跳到光标幽灵跟随)
  const dragControls = useDragControls();
  const [holdState, setHoldState] = useState<"idle" | "charging" | "armed">(
    "idle",
  );
  const holdTimerRef = useRef<number | null>(null);
  const armedRef = useRef(false);
  // 蓄力期位移监听挂 window(配合按下时的 setPointerCapture,俘获成功则
  // move/up 恒达球体;jsdom 无俘获 API,window 直达事件可测)
  const holdMoveHandlerRef = useRef<((event: PointerEvent) => void) | null>(
    null,
  );
  // 最近一次宿主可见的指针位置:啮合连续性判据(大跳=盲区回流,作废)
  const lastSeenPointRef = useRef<{ x: number; y: number } | null>(null);
  // 解锁后待啮合的 move 监听(手势结束/作废/二手势重启蓄力时须撤)
  const armEngageHandlerRef = useRef<((event: PointerEvent) => void) | null>(
    null,
  );
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

  // 滚动到目标位(位移+旋转同弹簧):吸附/钳制时球一路滚过去;期间自旋让路
  const rollWith = useCallback(
    (tx: number, ty: number, spring: { type: "spring"; stiffness: number; damping: number }) => {
      autoSpinPausedUntilRef.current = Date.now() + AUTO_SPIN_PAUSE_MS;
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

  // 隐藏/唤回(09-12 orb-manage):持久化 localStorage;唤回键恒注册(隐藏时也在听),
  // 只唤回不 toggle-hide(防误藏;隐藏唯一入口=右键菜单,且 toast 报键位)
  const [hidden, setHidden] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(ORB_HIDDEN_KEY) === "1",
  );
  const hideOrb = useCallback(() => {
    setHidden(true);
    try {
      window.localStorage.setItem(ORB_HIDDEN_KEY, "1");
    } catch {
      // 存储不可用时仅内存隐藏
    }
    toast.info(ORB_RECALL_HINT, { duration: 6000 });
  }, []);
  const showOrb = useCallback(() => {
    setHidden(false);
    try {
      window.localStorage.removeItem(ORB_HIDDEN_KEY);
    } catch {
      // 同上
    }
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "b") return;
      event.preventDefault();
      showOrb();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showOrb]);

  // 右键「回到默认位置」:取锚位角默认坐标,滚动星球一路滚回(复用吸附动画)
  const resetToDefaultAnchor = useCallback(() => {
    const d = windowDims();
    const fallback = clampOrbPosition(null, d.width, d.height, defaultAnchor);
    rollWith(fallback.x, fallback.y, {
      type: "spring",
      stiffness: 380,
      damping: 30,
    });
    setPosition(fallback);
  }, [defaultAnchor, rollWith, setPosition]);

  // 撤除待啮合监听(独立于整体复位:二手势重启蓄力时也要先撤,防旧监听劫走新手势的 move)
  const detachArmEngage = useCallback(() => {
    const handler = armEngageHandlerRef.current;
    if (handler) {
      window.removeEventListener("pointermove", handler);
      armEngageHandlerRef.current = null;
    }
  }, []);

  // 结束/中止长按手势:清计时器与监听,armed 复位(拖拽收尾由 onDragEnd 承担)
  const clearHoldGesture = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const moveHandler = holdMoveHandlerRef.current;
    if (moveHandler) {
      window.removeEventListener("pointermove", moveHandler);
      holdMoveHandlerRef.current = null;
    }
    detachArmEngage();
    armedRef.current = false;
    setHoldState((state) => (state === "idle" ? state : "idle"));
  }, [detachArmEngage]);

  // 卸载防泄漏:迟发解锁不得在卸载后触发
  useEffect(() => clearHoldGesture, [clearHoldGesture]);

  // 蓄力开始:1s 计时 + 位移监听(>6px=划走取消,长按须按住不动)
  const beginHold = useCallback(
    (event: React.PointerEvent) => {
      // 新手势从零判:上一手势若仍挂着待啮合监听,先撤
      detachArmEngage();
      armedRef.current = false;
      setHoldState("charging");
      lastSeenPointRef.current = { x: event.clientX, y: event.clientY };
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null;
        const moveHandler = holdMoveHandlerRef.current;
        if (moveHandler) {
          window.removeEventListener("pointermove", moveHandler);
          holdMoveHandlerRef.current = null;
        }
        // 手势已结束(up/cancel 已清指针)则不解锁
        if (activePointerIdRef.current === null) return;
        armedRef.current = true;
        // 解锁即吞 click:armed 原地松手=取消(不开面板),真机拖拽释放的
        // 尾随 click(pointerup 可能被 motion 会话吞掉)也一并拦下
        suppressNextClickRef.current = true;
        setHoldState("armed");
        // 惰性啮合(09-15 webview 盲区根修):拖拽会话由下一根可见 move 启动,
        // 须按键仍按住(松手若发生在盲区,此处拦下幽灵拖拽)且距上一可见采样
        // 无大跳(拦盲区回流)。motion 官方受控拖拽入口接受原生 PointerEvent。
        const onArmEngage = (move: PointerEvent) => {
          if (move.pointerId !== activePointerIdRef.current) return;
          const seen = lastSeenPointRef.current;
          const jumped =
            !seen ||
            Math.hypot(move.clientX - seen.x, move.clientY - seen.y) >
              ARM_ENGAGE_JUMP_PX;
          if ((move.buttons & 1) === 0 || jumped) {
            // 按键已松/盲区回流:手势作废(吞 click 标志一并回滚,别误吞下一次点击)
            suppressNextClickRef.current = false;
            clearHoldGesture();
            return;
          }
          detachArmEngage();
          dragControls.start(move);
        };
        armEngageHandlerRef.current = onArmEngage;
        window.addEventListener("pointermove", onArmEngage);
      }, LONG_PRESS_MS);
      const onHoldMove = (move: PointerEvent) => {
        if (move.pointerId !== activePointerIdRef.current) return;
        lastSeenPointRef.current = { x: move.clientX, y: move.clientY };
        const start = pressStartRef.current;
        if (!start || holdTimerRef.current === null) return;
        const distance = Math.hypot(
          move.clientX - start.x,
          move.clientY - start.y,
        );
        if (distance < CLICK_THRESHOLD_PX) return;
        // 划走:取消蓄力,手势按普通路径收尾(位移超阈值=不开面板)
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
        window.removeEventListener("pointermove", onHoldMove);
        holdMoveHandlerRef.current = null;
        setHoldState("idle");
      };
      holdMoveHandlerRef.current = onHoldMove;
      window.addEventListener("pointermove", onHoldMove);
    },
    [dragControls, detachArmEngage, clearHoldGesture],
  );

  const handlePointerUp = (event: React.PointerEvent) => {
    if (event.pointerId !== activePointerIdRef.current) return;
    activePointerIdRef.current = null;
    const start = pressStartRef.current;
    pressStartRef.current = null;
    // 长按手势收尾:清蓄力(未满 1s=取消)
    const wasArmed = armedRef.current;
    clearHoldGesture();
    if (!start) return;
    // 交互后自愈(幂等,不吃事件语义):视口过渡期写入的越界位置在首次触摸即被钳回
    clampNow();
    if (wasArmed) {
      // 长按解锁后的原地释放=取消:不开面板不 toggle(拖拽收尾已由 onDragEnd
      // 承担);吞尾随 click(解锁时刻已置,此处幂等覆盖 up 先于 click 的窗口)
      suppressNextClickRef.current = true;
      return;
    }
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

  // 隐藏态:整球离场(hooks 已全部落位,早退不违钩子序;唤回键 effect 恒在听)
  if (hidden) return null;

  return (
    <Popover open={panelOpen} onOpenChange={setPanelOpen}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <PopoverAnchor asChild>
            <motion.div
          {...{ [`data-${dataOrb}`]: true }}
          {...dataAttrs}
          role="button"
          tabIndex={0}
          aria-label={ariaLabel}
          aria-expanded={panelOpen}
          drag
          dragListener={false}
          dragControls={dragControls}
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
          className="group flex h-12 w-12 cursor-grab items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/70 active:cursor-grabbing"
          ref={orbRef}
          onPointerDown={(event) => {
            // 指针链路只认主键(09-12 orb-manage R3):右键走上下文菜单,
            // 不得记手势起点开面板/污染拖拽判定
            if (event.button !== 0) return;
            // webview 盲区根修(09-15):按下即俘获指针——后续 move/up 即使
            // 光标走在 ComfyUI <webview> 上也定向送回球体(宿主 window 对
            // guest 区收不到指针事件);俘获不可用(jsdom 等)静默回落,
            // 由啮合护栏兜底
            try {
              orbRef.current?.setPointerCapture?.(event.pointerId);
            } catch {
              // 回落 window 监听路径
            }
            activePointerIdRef.current = event.pointerId;
            panelOpenAtPressRef.current = panelOpen;
            pressStartRef.current = { x: event.clientX, y: event.clientY };
            // 每手势全新判定:上一手势若未产生尾随 click(如拖拽释放在窗外),
            // 吞点击标志不得滞留污染本次手势
            suppressNextClickRef.current = false;
            // 长按蓄力开始:1s 内按住不动即解锁拖拽
            beginHold(event);
          }}
          onPointerUp={handlePointerUp}
          onPointerCancel={(event) => {
            if (event.pointerId !== activePointerIdRef.current) return;
            // 手势取消(系统中断/滚轮接管):三态全清,下一次交互从头判
            activePointerIdRef.current = null;
            pressStartRef.current = null;
            panelOpenAtPressRef.current = false;
            suppressNextClickRef.current = false;
            clearHoldGesture();
          }}
          onClick={handleClick}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setPanelOpen((open) => !open);
            }
          }}
          onDragStart={() => {
            // 自旋让路:拖拽期间停转
            draggingRef.current = true;
          }}
          onDrag={(_, info) => {
            // 滚动星球:拖拽位移 1:1 折算球体旋转(不重渲染,motion 直驱 transform)
            rollY.set(rollY.get() + info.delta.x * ROLL_DEG_PER_DRAG_PX);
            rollX.set(rollX.get() - info.delta.y * ROLL_DEG_PER_DRAG_PX);
          }}
          onDragEnd={() => {
            draggingRef.current = false;
            // 受控拖拽收尾:清 armed 态(蓄力环熄灭)
            clearHoldGesture();
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
          {/* 长按蓄力环(09-12 防粘连配套):按住期间球缘进度弧 0→满,满 1s 即
              解锁拖拽(armed 满格提亮);松手/划走即消。reduce-motion 不做充能
              动画,仅 armed 满格提示。 */}
          {holdState !== "idle" && (
            <svg
              data-orb-hold-ring
              data-hold-state={holdState}
              aria-hidden
              viewBox="0 0 54 54"
              className="pointer-events-none absolute -inset-[3px] -rotate-90"
            >
              <motion.circle
                cx={27}
                cy={27}
                r={26}
                fill="none"
                strokeWidth={1.5}
                strokeLinecap="round"
                className={cn(
                  "transition-[stroke] duration-150",
                  holdState === "armed" ? "stroke-primary" : "stroke-primary/70",
                )}
                initial={{ pathLength: 0 }}
                animate={{
                  pathLength: reduceMotion
                    ? holdState === "armed"
                      ? 1
                      : 0
                    : 1,
                }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: LONG_PRESS_MS / 1000, ease: "linear" }
                }
              />
            </svg>
          )}
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
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={resetToDefaultAnchor}>
            回到默认位置
          </ContextMenuItem>
          <ContextMenuItem onSelect={hideOrb}>隐藏悬浮球</ContextMenuItem>
          {contextMenuExtra}
        </ContextMenuContent>
      </ContextMenu>
      <PopoverContent
        align="start"
        side="top"
        collisionPadding={12}
        className={cn(
          // 09-11 质感:面板=更厚实的玻璃面(更大 surface=更强 blur+更深影,apple-design §12)
          "w-80 border-white/12 bg-popover/95 p-2 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl backdrop-saturate-150",
          panelClassName,
        )}
        onPointerDownOutside={(event) => {
          const path = (event.detail?.originalEvent as Event | undefined)?.composedPath?.() ?? [];
          pressedIntoWebviewRef.current = path.some(
            (node): node is HTMLElement =>
              node instanceof HTMLElement && node.tagName === "WEBVIEW",
          );
        }}
        onCloseAutoFocus={(event) => {
          // Anchor(非 Trigger)模式下 Radix 不自动回焦,手动定向:外点进
          // webview=焦点已随点击入 guest,不抢;在场有 webview(ComfyUI 画布
          // 视图)=球是跳转入口,用完把焦点交还主界面;常规视图维持回球保
          // 键盘路径(09-12 裁定配套)。
          event.preventDefault();
          if (pressedIntoWebviewRef.current) {
            pressedIntoWebviewRef.current = false;
            return;
          }
          const webview = document.querySelector("webview");
          if (webview) {
            (webview as HTMLElement).focus();
            return;
          }
          orbRef.current?.focus();
        }}
      >
        {panelContent({ close: () => setPanelOpen(false) })}
      </PopoverContent>
    </Popover>
  );
}
