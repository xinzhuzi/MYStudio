import { useCallback, useEffect, useRef } from "react";
import { interactionDeferBegin, interactionDeferEnd } from "./previews/interaction-defer";
import { useSmoothWheelZoom, type SmoothWheelZoomApi } from "./previews/smooth-wheel-zoom";

/**
 * 工作流画布手势内核(08-30 节点图架构收敛 Phase2):
 * 两画布(主生产图/图像工作流图)的视口手势层单源——
 * 滚轮平滑缩放 + 交互期容器打标(CSS 降级重活) + 图片加载门闸接线 + 卸载清理。
 *
 * 策略注入(画布间真实差异,不硬统一):
 * - interactingClass:打标类名(两画布 CSS 规则各自挂名)
 * - classRemovalDelayMs:摘标延迟(图像画布 180ms 防末帧闪烁;主画布 0 立即)
 * - zoom:滚轮缩放界
 * - onUserGestureStart:用户手势开始钩子(主画布:视口所有权接管 claimViewportForUser)
 *
 * 语义铁律(两画布实弹教训固化,勿改):
 * - onMoveStart 只在带 event(用户手势)时关闸——程序性视口变化(挂载 fitView/
 *   布局对齐)不拦图片,否则首屏被误拦(装机 smoke 2026-08-26 实证)
 * - onMoveEnd 无条件开闸——wheel 的 moveEnd 未必带 event(d3 对滚轮与拖拽走
 *   不同路径),按 event 门控会让闸门永久关死(「滚轮没效果」根因)
 */
export function useCanvasGestureKernel({
  containerRef,
  viewportApi,
  interactingClass,
  classRemovalDelayMs = 180,
  zoom,
  onUserGestureStart,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  /** 平滑缩放视口适配器(两画布统一形态:flowInstance && {get/setViewport});null=未就绪 */
  viewportApi: SmoothWheelZoomApi | null;
  interactingClass: string;
  classRemovalDelayMs?: number;
  zoom: { minZoom: number; maxZoom: number };
  onUserGestureStart?: () => void;
}) {
  // 策略钩子走 ref:调用方回调身份变化不重建手势处理器
  const userGestureStartRef = useRef(onUserGestureStart);
  userGestureStartRef.current = onUserGestureStart;

  useSmoothWheelZoom(containerRef, viewportApi, zoom);

  const interactEndTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setInteracting = useCallback(
    (on: boolean) => {
      const el = containerRef.current;
      if (!el) return;
      clearTimeout(interactEndTimerRef.current);
      if (on) {
        el.classList.add(interactingClass);
      } else if (classRemovalDelayMs > 0) {
        // 拖/缩放结束稍微延迟摘标,避免最后一帧抖动闪烁
        interactEndTimerRef.current = setTimeout(() => {
          el.classList.remove(interactingClass);
        }, classRemovalDelayMs);
      } else {
        el.classList.remove(interactingClass);
      }
    },
    [classRemovalDelayMs, containerRef, interactingClass],
  );
  useEffect(() => () => clearTimeout(interactEndTimerRef.current), []);

  const handleMoveStart = useCallback((event: MouseEvent | TouchEvent | null) => {
    setInteracting(true);
    // 程序性视口变化(event=null)不关闸,仅用户手势延迟图片加载
    if (event) {
      interactionDeferBegin();
      userGestureStartRef.current?.();
    }
  }, [setInteracting]);

  const handleMoveEnd = useCallback(() => {
    setInteracting(false);
    // 开闸必须无条件:wheel 手势的 onMoveEnd 未必带 event
    interactionDeferEnd();
  }, [setInteracting]);

  const handleNodeDragStart = useCallback(() => setInteracting(true), [setInteracting]);

  return { setInteracting, handleMoveStart, handleMoveEnd, handleNodeDragStart };
}
