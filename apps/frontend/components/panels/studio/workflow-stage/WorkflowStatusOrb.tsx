import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
} from "motion/react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { WorkflowReadiness } from "@/lib/studio/workflow-readiness";
import { cn } from "@/lib/utils";
import { StageReadinessPanel } from "./StageReadinessPanel";
import {
  ORB_MARGIN,
  ORB_SIZE,
  clampOrbPosition,
  useOrbPosition,
} from "./use-orb-position";

/** 位移小于该阈值判定为点击(开面板),否则视为拖拽。 */
const CLICK_THRESHOLD_PX = 6;
const VIEWPORT_FALLBACK = { width: 1440, height: 900 };

function useViewportSize() {
  const [size, setSize] = useState(() =>
    typeof window === "undefined"
      ? VIEWPORT_FALLBACK
      : { width: window.innerWidth, height: window.innerHeight },
  );
  useEffect(() => {
    const onResize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/** 松手吸附:到最近边(留 6px 边距,整球完整可见)。 */
export function snapToNearestEdge(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  const clampY = (value: number) =>
    Math.min(
      Math.max(value, ORB_MARGIN),
      Math.max(ORB_MARGIN, viewportHeight - ORB_SIZE - ORB_MARGIN),
    );
  const clampX = (value: number) =>
    Math.min(
      Math.max(value, ORB_MARGIN),
      Math.max(ORB_MARGIN, viewportWidth - ORB_SIZE - ORB_MARGIN),
    );
  const candidates = [
    { x: ORB_MARGIN, y: clampY(y) },
    { x: viewportWidth - ORB_SIZE - ORB_MARGIN, y: clampY(y) },
    { x: clampX(x), y: ORB_MARGIN },
    { x: clampX(x), y: viewportHeight - ORB_SIZE - ORB_MARGIN },
  ];
  let best = candidates[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const dist = (candidate.x - x) ** 2 + (candidate.y - y) ** 2;
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

/** 工作流状态悬浮球:收起(进度弧)/hover(胶囊)/点击(就绪面板)三态,
 * 可拖拽+贴边吸附,位置持久化。接替退役的 WorkflowStageStatusBar。
 * navigation:面板底部追加区(沉浸视图的导航枢纽;studio 视图不传=不变)。 */
export function WorkflowStatusOrb({
  readiness,
  activeStage,
  onStageChange,
  navigation,
}: {
  readiness: WorkflowReadiness;
  activeStage: string;
  onStageChange: (stageId: string) => void;
  navigation?: ReactNode;
}) {
  const { position, setPosition } = useOrbPosition();
  const viewport = useViewportSize();
  const x = useMotionValue(position.x);
  const y = useMotionValue(position.y);
  const [panelOpen, setPanelOpen] = useState(false);
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

  // 窗口变化时把球钳回视口内
  useEffect(() => {
    const current = { x: x.get(), y: y.get() };
    const clamped = clampOrbPosition(
      current,
      viewport.width,
      viewport.height,
    );
    if (clamped.x !== current.x || clamped.y !== current.y) {
      animate(x, clamped.x, { type: "spring", stiffness: 400, damping: 32 });
      animate(y, clamped.y, { type: "spring", stiffness: 400, damping: 32 });
      setPosition(clamped);
    }
  }, [viewport, x, y, setPosition]);

  const handlePointerUp = (event: React.PointerEvent) => {
    if (event.pointerId !== activePointerIdRef.current) return;
    activePointerIdRef.current = null;
    const start = pressStartRef.current;
    pressStartRef.current = null;
    if (!start) return;
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

  const currentStage =
    readiness.stages.find((stage) => stage.id === readiness.nextStageId) ??
    readiness.stages[0];
  const readyCount = readiness.stages.filter(
    (stage) => stage.status === "ready",
  ).length;
  const total = readiness.stages.length;
  const stageNumber = currentStage
    ? readiness.stages.indexOf(currentStage) + 1
    : 0;
  const firstMissing = currentStage?.missing[0] ?? currentStage?.actionLabel ?? "";
  const ariaLabel = `工作流进度：${currentStage?.label ?? "工作流"}，${readyCount}/${total} 已就绪，点按打开阶段面板`;

  return (
    <Popover open={panelOpen} onOpenChange={setPanelOpen}>
      <PopoverAnchor asChild>
        <motion.div
          data-workflow-orb
          data-workflow-active-stage={activeStage}
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
            right: Math.max(ORB_MARGIN, viewport.width - ORB_SIZE - ORB_MARGIN),
            bottom: Math.max(
              ORB_MARGIN,
              viewport.height - ORB_SIZE - ORB_MARGIN,
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
          className="group flex h-12 w-12 cursor-grab items-center justify-center rounded-full border border-border/70 bg-card/90 shadow-[0_6px_20px_rgba(0,0,0,0.35)] backdrop-blur-md outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
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
          onDragEnd={() => {
            const snapped = snapToNearestEdge(
              x.get(),
              y.get(),
              viewport.width,
              viewport.height,
            );
            animate(x, snapped.x, { type: "spring", stiffness: 380, damping: 30 });
            animate(y, snapped.y, { type: "spring", stiffness: 380, damping: 30 });
            setPosition(snapped);
          }}
        >
          <ProgressRing readiness={readiness} />
          <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-foreground">
            {stageNumber || total}
          </span>
          <span
            data-orb-capsule
            aria-hidden
            className={cn(
              "pointer-events-none absolute whitespace-nowrap rounded-full border border-border/70 bg-card/95 px-3 py-1.5 text-xs text-foreground shadow-[0_6px_20px_rgba(0,0,0,0.3)] opacity-0 backdrop-blur-md transition-opacity duration-150 group-hover:opacity-100",
              capsuleOnLeft ? "right-full mr-3" : "left-full ml-3",
              panelOpen && "hidden",
            )}
          >
            {currentStage?.label} · {readyCount}/{total}
            {firstMissing ? ` · 缺：${firstMissing}` : ""}
          </span>
        </motion.div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="top"
        collisionPadding={12}
        className="w-80 p-2"
        onCloseAutoFocus={(event) => {
          // Anchor(非 Trigger)模式下 Radix 不自动回焦,手动回球保键盘路径
          event.preventDefault();
          orbRef.current?.focus();
        }}
      >
        <StageReadinessPanel
          readiness={readiness}
          activeStage={activeStage}
          onStageChange={onStageChange}
          onClose={() => setPanelOpen(false)}
          navigation={navigation}
        />
      </PopoverContent>
    </Popover>
  );
}

/** 六段进度弧:ready=success / active=warning / blocked=muted。 */
function ProgressRing({ readiness }: { readiness: WorkflowReadiness }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const segmentGap = 3;
  const segmentLength = circumference / readiness.stages.length - segmentGap;
  return (
    <svg
      viewBox="0 0 48 48"
      className="absolute inset-0 h-full w-full -rotate-90"
      aria-hidden
    >
      <circle
        cx="24"
        cy="24"
        r={radius}
        fill="none"
        strokeWidth="3"
        className="stroke-border/50"
      />
      {readiness.stages.map((stage, index) => (
        <circle
          key={stage.id}
          data-orb-segment={stage.id}
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(segmentLength, 0)} ${circumference - Math.max(segmentLength, 0)}`}
          strokeDashoffset={-(index * circumference) / readiness.stages.length}
          className={cn(
            stage.status === "ready" && "stroke-success",
            stage.status === "active" && "stroke-warning",
            stage.status === "blocked" && "stroke-muted-foreground/40",
          )}
        />
      ))}
    </svg>
  );
}
